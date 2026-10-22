import { assertNoPII } from '../sanitize'
import { LlmError, type EmbeddingProvider, type LlmProvider, type LlmRequest, type LlmTask, type LlmUsage, type SpeechProvider } from './types'

/**
 * Google Gemini via REST generateContent, structured JSON output.
 * Only learning content ever reaches this adapter (every text part passes assertNoPII) — whatever the tier.
 *
 * Each call names its task; `models` routes tasks to models (e.g. the strongest model for generating and
 * grading, a fast one for chores), falling back to `model`. `thinking` turns on the model's reasoning:
 * 'level' (Gemini 3 thinkingLevel) or 'budget' (Gemini 2.5 thinkingBudget); 'off' sends nothing.
 */
export type GeminiThinking = 'off' | 'level' | 'budget'

export class GeminiProvider implements LlmProvider {
  readonly name = 'gemini'
  constructor(
    private readonly opts: {
      apiKey: string
      model: string
      fallbackModels?: string[]
      models?: Partial<Record<LlmTask, string>>
      thinking?: GeminiThinking
    },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** The model this task runs on */
  modelFor(task: LlmTask = 'generate') {
    return this.opts.models?.[task] || this.opts.model
  }

  private thinkingConfig(effort: 'low' | 'high' = 'high') {
    if (this.opts.thinking === 'level') return { thinkingConfig: { thinkingLevel: effort } }
    // -1 = let the model decide how long to think
    if (this.opts.thinking === 'budget') return { thinkingConfig: { thinkingBudget: effort === 'low' ? 1024 : -1 } }
    return {}
  }

  async generateJson(req: LlmRequest) {
    for (const p of req.parts) if ('text' in p) assertNoPII(p.text)
    assertNoPII(req.system)

    const body = {
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [
        {
          role: 'user',
          parts: req.parts.map((p) => ('text' in p ? { text: p.text } : 'fileUri' in p ? { fileData: { mimeType: p.mimeType, fileUri: p.fileUri } } : { inlineData: { mimeType: p.mimeType, data: p.dataBase64 } })),
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: req.schema,
        // Gemini 3 with thinking is tuned for its default temperature (1.0); Google warns lower values can
        // make it loop or degrade. Only pass ours when thinking is off.
        ...(this.opts.thinking === 'level' ? {} : { temperature: req.temperature ?? 0.7 }),
        // Flash models allow 65,536 output tokens, and "thinking" counts against it: a 30-minute homework
        // (25+ items with explanations) overflowed the old 16k cap and came back cut off mid-JSON.
        maxOutputTokens: req.maxOutputTokens ?? 65536,
        ...this.thinkingConfig(req.effort),
      },
    }

    // Google's "high demand" 503s are per model: after retries, move on to the next model.
    const primary = this.modelFor(req.task)
    const models = req.fallback === false ? [primary] : [primary, ...[this.opts.model, ...(this.opts.fallbackModels ?? [])].filter((m, i, all) => m && m !== primary && all.indexOf(m) === i)]
    let lastErr: unknown
    for (const [i, model] of models.entries()) {
      try {
        return await this.call(model, body)
      } catch (e) {
        const busy = e instanceof LlmError && (e.code === 'unavailable' || e.code === 'rate_limited')
        // A fallback name this key can't use (404) shouldn't hide the primary's real error
        const missingFallback = i > 0 && e instanceof LlmError && e.code === 'config'
        if (!busy && !missingFallback) throw e
        if (busy) lastErr = e
        console.warn(`[gemini] ${model} failed (${e instanceof LlmError ? e.code : 'error'}), trying next model`)
      }
    }
    throw lastErr
  }

  private async call(model: string, body: unknown) {
    let lastErr: unknown
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await this.fetchImpl(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.opts.apiKey },
          body: JSON.stringify(body),
        },
      )
      if (res.status === 429 || res.status >= 500) {
        lastErr = new LlmError(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`, res.status === 429 ? 'rate_limited' : 'unavailable')
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1) ** 2))
        continue
      }
      if (res.status === 400 || res.status === 401 || res.status === 403 || res.status === 404) {
        throw new LlmError(`Gemini ${res.status}: ${(await res.text()).slice(0, 500)}`, 'config')
      }
      const data = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]
        promptFeedback?: { blockReason?: string }
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number }
        modelVersion?: string
      }
      if (data.promptFeedback?.blockReason) throw new LlmError(`Blocked: ${data.promptFeedback.blockReason}`, 'blocked')
      const cand = data.candidates?.[0]
      const text = cand?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
      try {
        return {
          json: JSON.parse(text),
          usage: {
            inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
            outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
            ...(data.usageMetadata?.thoughtsTokenCount ? { thoughtsTokens: data.usageMetadata.thoughtsTokenCount } : {}),
            ...(cand?.finishReason ? { finishReason: cand.finishReason } : {}),
          },
          model: data.modelVersion ?? model,
        }
      } catch {
        // Cut off at the output limit: retrying the same request would be cut off again
        if (cand?.finishReason === 'MAX_TOKENS') throw new LlmError('Output hit the token limit', 'too_long')
        lastErr = new LlmError(`Unparseable output (finishReason=${cand?.finishReason})`, 'bad_output')
      }
    }
    throw lastErr
  }
}

/**
 * Google Gemini embeddings, used by the pedagogy package's retrieval (§8.5). Only
 * methodology text (never student/teacher content) is embedded through this adapter.
 * outputDimensionality must match EMBEDDING_DIMENSIONS in @ikhimi/db's schema (1024).
 */
export class GeminiEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'gemini-embedding'
  constructor(
    private readonly opts: { apiKey: string; model: string; outputDimensionality?: number },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async embed(text: string): Promise<number[]> {
    let lastErr: unknown
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await this.fetchImpl(
        `https://generativelanguage.googleapis.com/v1beta/models/${this.opts.model}:embedContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.opts.apiKey },
          body: JSON.stringify({
            content: { parts: [{ text }] },
            outputDimensionality: this.opts.outputDimensionality ?? 1024,
          }),
        },
      )
      if (res.status === 429 || res.status >= 500) {
        lastErr = new LlmError(`Gemini embed ${res.status}: ${(await res.text()).slice(0, 300)}`, res.status === 429 ? 'rate_limited' : 'unavailable')
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1) ** 2))
        continue
      }
      if (res.status === 400 || res.status === 401 || res.status === 403 || res.status === 404) {
        throw new LlmError(`Gemini embed ${res.status}: ${(await res.text()).slice(0, 500)}`, 'config')
      }
      const data = (await res.json()) as { embedding?: { values?: number[] } }
      const values = data.embedding?.values
      if (!values?.length) throw new LlmError('Gemini embed: empty embedding', 'bad_output')
      return values
    }
    throw lastErr
  }
}

/**
 * Google Gemini text-to-speech: a word or short phrase read aloud for vocabulary items ("listen and choose the
 * word"). Gemini returns raw 16-bit PCM; it is wrapped as WAV so every browser plays it. Only target-language words
 * from the homework ever reach it, never anything about a person.
 */
export class GeminiSpeechProvider implements SpeechProvider {
  readonly name = 'gemini-tts'
  constructor(
    private readonly opts: { apiKey: string; model: string; voice?: string },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async speak(text: string) {
    assertNoPII(text)
    // Only the word is sent as text, so only the word is spoken; how to say it goes in the style, which is not read out
    const say = text
    const voice = this.opts.voice ?? 'Kore'
    try {
      return await this.request('interactions', {
        model: this.opts.model,
        input: [{ type: 'user_input', content: [{ type: 'text', text: say, annotations: [{ type: 'speech_metadata', style: 'clear and slow, like a language teacher saying a new word' }] }] }],
        response_format: { type: 'audio', mime_type: 'audio/wav', sample_rate: 24000 },
        generation_config: { speech_config: [{ voice }] },
      })
    } catch (e) {
      // Older TTS models answer only generateContent
      if (!(e instanceof LlmError) || e.code !== 'config') throw e
      return this.request(`models/${this.opts.model}:generateContent`, {
        contents: [{ parts: [{ text: say }] }],
        generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
      })
    }
  }

  private async request(path: string, body: unknown) {
    let lastErr: unknown
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await this.fetchImpl(`https://generativelanguage.googleapis.com/v1beta/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.opts.apiKey },
        body: JSON.stringify(body),
      })
      if (res.status === 429 || res.status >= 500) {
        lastErr = new LlmError(`Gemini TTS ${res.status}: ${(await res.text()).slice(0, 300)}`, res.status === 429 ? 'rate_limited' : 'unavailable')
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1) ** 2))
        continue
      }
      if (!res.ok) throw new LlmError(`Gemini TTS ${res.status}: ${(await res.text()).slice(0, 500)}`, 'config')
      const audio = speechAudio(await res.json())
      if (!audio) throw new LlmError('Gemini TTS: no audio', 'bad_output')
      const rate = Number(/rate=(\d+)/.exec(audio.mimeType)?.[1]) || 24000
      const bytes = Buffer.from(audio.data, 'base64')
      return {
        mimeType: 'audio/wav',
        // The Interactions API sends a WAV file; generateContent sends bare PCM
        data: bytes.subarray(0, 4).toString('latin1') === 'RIFF' ? bytes : pcmToWav(bytes, rate),
        model: audio.model ?? this.opts.model,
        usage: audio.usage,
      }
    }
    throw lastErr
  }
}

type SpeechReply = {
  // Interactions API
  steps?: { type?: string; content?: { type?: string; data?: string; mime_type?: string }[] }[]
  usage?: { input_tokens?: number; output_tokens?: number; total_input_tokens?: number; total_output_tokens?: number }
  model?: string
  // generateContent
  candidates?: { content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] } }[]
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
  modelVersion?: string
}

/** The audio in a TTS reply, from either API */
export function speechAudio(json: unknown): { data: string; mimeType: string; model?: string; usage: LlmUsage } | null {
  const r = json as SpeechReply
  const step = (r.steps ?? [])
    .filter((s) => s.type === 'model_output')
    .flatMap((s) => s.content ?? [])
    .filter((c) => c.type === 'audio' && c.data)
    .at(-1)
  if (step?.data) {
    const u = r.usage ?? {}
    return { data: step.data, mimeType: step.mime_type ?? 'audio/wav', model: r.model, usage: { inputTokens: u.input_tokens ?? u.total_input_tokens ?? 0, outputTokens: u.output_tokens ?? u.total_output_tokens ?? 0 } }
  }
  const part = r.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData
  if (part?.data) {
    return {
      data: part.data,
      mimeType: part.mimeType ?? '',
      model: r.modelVersion,
      usage: { inputTokens: r.usageMetadata?.promptTokenCount ?? 0, outputTokens: r.usageMetadata?.candidatesTokenCount ?? 0 },
    }
  }
  return null
}

/** 16-bit mono PCM → a WAV file */
export function pcmToWav(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}
