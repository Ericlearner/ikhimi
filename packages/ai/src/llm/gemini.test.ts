import { afterEach, describe, expect, it, vi } from 'vitest'
import { GeminiProvider, GeminiSpeechProvider, pcmToWav } from './gemini'
import { LlmError } from './types'

const ok = () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"a":1}' }] } }] }), { status: 200 })
const status = (n: number) => new Response('{}', { status: n })
const req = { system: 'Make exercises', parts: [{ text: 'Past simple' }], schema: {} }

// Skip the retry backoff waits
vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void) => (fn(), 0)) as unknown as typeof setTimeout)
afterEach(() => vi.clearAllMocks())

const modelOf = (url: string) => url.match(/models\/([^:]+):/)![1]

describe('GeminiProvider fallback', () => {
  it('moves to the fallback model when the main one stays overloaded', async () => {
    const f = vi.fn(async (url: string) => (modelOf(url) === 'main' ? status(503) : ok()))
    const p = new GeminiProvider({ apiKey: 'k', model: 'main', fallbackModels: ['backup'] }, f as unknown as typeof fetch)
    const r = await p.generateJson(req as never)
    expect(r.json).toEqual({ a: 1 })
    expect(r.model).toBe('backup')
    expect(f.mock.calls.map(([u]) => modelOf(u))).toEqual(['main', 'main', 'main', 'backup'])
  })

  it('a fallback the key cannot use keeps the busy error', async () => {
    const f = vi.fn(async (url: string) => (modelOf(url) === 'main' ? status(503) : status(404)))
    const p = new GeminiProvider({ apiKey: 'k', model: 'main', fallbackModels: ['gone'] }, f as unknown as typeof fetch)
    await expect(p.generateJson(req as never)).rejects.toMatchObject({ code: 'unavailable' })
  })

  it("the Lab stays on its model: busy is an error, never a weaker model's answer", async () => {
    const f = vi.fn(async (url: string) => (modelOf(url) === 'strongest' ? status(503) : ok()))
    const p = new GeminiProvider({ apiKey: 'k', model: 'flash', fallbackModels: ['lite'], models: { lab: 'strongest' } }, f as unknown as typeof fetch)
    await expect(p.generateJson({ ...req, task: 'lab', fallback: false } as never)).rejects.toMatchObject({ code: 'unavailable' })
    expect(f.mock.calls.map(([u]) => modelOf(u))).toEqual(['strongest', 'strongest', 'strongest'])
  })

  it('a rejected request is not retried on other models', async () => {
    const f = vi.fn(async () => status(400))
    const p = new GeminiProvider({ apiKey: 'k', model: 'main', fallbackModels: ['backup'] }, f as unknown as typeof fetch)
    await expect(p.generateJson(req as never)).rejects.toBeInstanceOf(LlmError)
    expect(f).toHaveBeenCalledTimes(1)
  })
})

describe('GeminiProvider task routing and thinking', () => {
  const bodyOf = (init: unknown) => JSON.parse((init as { body: string }).body) as { generationConfig: Record<string, unknown> }

  it('routes each task to its model and falls back to the default model when that one is busy', async () => {
    const f = vi.fn(async (url: string) => (modelOf(url) === 'pro' ? status(503) : ok()))
    const p = new GeminiProvider({ apiKey: 'k', model: 'flash', models: { generate: 'pro', fast: 'lite' } }, f as unknown as typeof fetch)
    await p.generateJson({ ...req, task: 'fast' } as never)
    expect(modelOf(f.mock.calls[0]![0])).toBe('lite')
    f.mockClear()
    const r = await p.generateJson({ ...req, task: 'generate' } as never)
    expect(r.model).toBe('flash')
    expect(f.mock.calls.map(([u]) => modelOf(u))).toEqual(['pro', 'pro', 'pro', 'flash'])
    // A task without its own model uses the default
    expect(p.modelFor('grade')).toBe('flash')
  })

  it('sends thinkingLevel (Gemini 3) or thinkingBudget (2.5) by effort, and nothing when off', async () => {
    const f = vi.fn(async (_url: string, _init?: RequestInit) => ok())
    await new GeminiProvider({ apiKey: 'k', model: 'm', thinking: 'level' }, f as unknown as typeof fetch).generateJson({ ...req, effort: 'low' } as never)
    expect(bodyOf(f.mock.calls[0]![1]).generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'low' })
    await new GeminiProvider({ apiKey: 'k', model: 'm', thinking: 'budget' }, f as unknown as typeof fetch).generateJson({ ...req, effort: 'high' } as never)
    expect(bodyOf(f.mock.calls[1]![1]).generationConfig.thinkingConfig).toEqual({ thinkingBudget: -1 })
    await new GeminiProvider({ apiKey: 'k', model: 'm' }, f as unknown as typeof fetch).generateJson(req as never)
    expect(bodyOf(f.mock.calls[2]![1]).generationConfig.thinkingConfig).toBeUndefined()
  })
})

describe('temperature with thinking', () => {
  it('leaves Gemini 3 thinking at its default temperature, keeps ours otherwise', async () => {
    const f = vi.fn(async (_url: string, _init?: RequestInit) => ok())
    await new GeminiProvider({ apiKey: 'k', model: 'm', thinking: 'level' }, f as unknown as typeof fetch).generateJson({ ...req, temperature: 0 } as never)
    await new GeminiProvider({ apiKey: 'k', model: 'm' }, f as unknown as typeof fetch).generateJson({ ...req, temperature: 0 } as never)
    const cfg = (i: number) => JSON.parse((f.mock.calls[i]![1] as { body: string }).body).generationConfig
    expect(cfg(0).temperature).toBeUndefined()
    expect(cfg(1).temperature).toBe(0)
  })
})

describe('GeminiSpeechProvider', () => {
  const wav = pcmToWav(Buffer.alloc(480), 24000)
  it('speaks through the Interactions API and keeps its WAV file', async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = []
    const fetchImpl = (async (url: string, init: { body: string }) => {
      calls.push({ url, body: JSON.parse(init.body) })
      return new Response(JSON.stringify({ model: 'gemini-3.8-flash-lite-tts', steps: [{ type: 'model_output', content: [{ type: 'audio', data: wav.toString('base64'), mime_type: 'audio/wav' }] }], usage: { input_tokens: 9, output_tokens: 30 } }))
    }) as unknown as typeof fetch
    const r = await new GeminiSpeechProvider({ apiKey: 'k', model: 'gemini-3.8-flash-lite-tts' }, fetchImpl).speak('journey')
    expect(calls[0]!.url).toMatch(/\/v1beta\/interactions$/)
    // Only the word is read out; the pace is a style, not spoken text
    const content = (calls[0]!.body.input as { content: { text: string; annotations: { style: string }[] }[] }[])[0]!.content[0]!
    expect(content.text).toBe('journey')
    expect(content.annotations[0]!.style).toMatch(/slow/)
    expect(r.data.equals(wav)).toBe(true)
    expect(r.usage).toEqual({ inputTokens: 9, outputTokens: 30 })
  })
  it('falls back to generateContent and wraps its bare PCM as WAV', async () => {
    const urls: string[] = []
    const fetchImpl = (async (url: string) => {
      urls.push(url)
      if (url.endsWith('/interactions')) return new Response('not found', { status: 404 })
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: Buffer.alloc(480).toString('base64') } }] } }] }))
    }) as unknown as typeof fetch
    const r = await new GeminiSpeechProvider({ apiKey: 'k', model: 'gemini-2.5-flash-preview-tts' }, fetchImpl).speak('ticket')
    expect(urls[1]).toMatch(/models\/gemini-2.5-flash-preview-tts:generateContent$/)
    expect(r.data.subarray(0, 4).toString()).toBe('RIFF')
    expect(r.data.length).toBe(480 + 44)
  })
})
