/**
 * Pronunciation for vocabulary items: every word a "listen and choose" item plays is read aloud by Gemini
 * text-to-speech, stored as the teacher's own audio material, and linked like a listening item's recording, so the
 * player shows it with the same audio control. A word that can't be spoken turns the item into "which word means
 * …?" (same options, same answer): the homework never shows a listen item without sound.
 */
import { aiCalls, materialBlobs, materials, type Db } from '@ikhimi/db'
import { compressSpeech } from './audio'
import { GeminiSpeechProvider, normalizePlan, pcmToWav, withoutSpeech, type DraftExercise, type HomeworkPlan, type InstructionLocale, type SpeechProvider } from '@ikhimi/ai'
import type { ExerciseRow } from './assignments'
import { env } from './env'

let speech: SpeechProvider | undefined
export function getSpeech(): SpeechProvider | null {
  const e = env()
  // Local demos without a key: a short tone stands in for the voice. Never in production.
  if (!e.GEMINI_API_KEY && process.env.LLM_FAKE === '1' && e.NODE_ENV !== 'production') return demoSpeech
  if (!e.GEMINI_API_KEY || !e.GEMINI_MODEL_TTS || e.GEMINI_MODEL_TTS === 'off') return null
  speech ??= new GeminiSpeechProvider({ apiKey: e.GEMINI_API_KEY, model: e.GEMINI_MODEL_TTS, voice: e.GEMINI_TTS_VOICE })
  return speech
}

const demoSpeech: SpeechProvider = {
  name: 'demo-tts',
  async speak(text) {
    const rate = 24000
    const pcm = Buffer.alloc(Math.round(rate * Math.min(2, 0.3 + text.length * 0.04)) * 2)
    for (let i = 0; i < pcm.length / 2; i++) pcm.writeInt16LE(Math.round(Math.sin((i / rate) * 2 * Math.PI * 440) * 6000), i * 2)
    return { mimeType: 'audio/wav', data: pcmToWav(pcm, rate), model: 'demo-tts', usage: { inputTokens: 0, outputTokens: 0 } }
  },
}

/** Words spoken at once */
const PARALLEL = 4

/**
 * Speak every item's word or sentence and every shadowing line, store each text once, and link it: an item's
 * audioFile (returned name → material id, merged into the draft's audioIds), a shadowing line's audioId. A
 * vocabulary word that can't be spoken is asked by its meaning instead; any other heard item that can't be spoken
 * is flagged speech_missing (dropSilent takes it out). A shadowing line without sound is still read aloud by the
 * student.
 */
export async function attachSpeech(
  db: Db,
  ctx: { teacherId: string; refId: string | null; plan: Pick<HomeworkPlan, 'words'>; locale: InstructionLocale },
  exercises: DraftExercise[],
  tts: SpeechProvider | null = getSpeech(),
): Promise<Record<string, string>> {
  const todo = exercises.filter((e) => e.speak)
  const shadowing = exercises.filter((e) => e.kind === 'shadowing')
  if (!todo.length && !shadowing.length) return {}
  const lines = (e: DraftExercise) => (e.payload.lines as { text: string; audioId?: string }[] | undefined) ?? []
  const texts = [...new Set([...todo.map((e) => e.speak!), ...shadowing.flatMap((e) => lines(e).map((l) => l.text))])]
  const ids: Record<string, string> = {}
  const byText = new Map<string, { name: string; id: string }>()
  if (tts) {
    let next = 0
    const worker = async () => {
      while (next < texts.length) {
        const i = next++
        const text = texts[i]!
        const started = Date.now()
        try {
          const spoken = await tts.speak(text)
          // Stored as MP3, about 8× smaller than the WAV the model returns (server/audio.ts)
          const audio = { ...spoken, ...compressSpeech(spoken) }
          const name = `say-${i + 1}.${audio.ext}`
          const [m] = await db
            .insert(materials)
            .values({ teacherId: ctx.teacherId, kind: 'audio', originalFilename: name, mimeType: audio.mimeType, bytes: audio.data.length, processingStatus: 'ready' })
            .returning({ id: materials.id })
          await db.insert(materialBlobs).values({ materialId: m!.id, data: audio.data })
          ids[name] = m!.id
          byText.set(text, { name, id: m!.id })
          await record(db, ctx, { model: audio.model, inputTokens: audio.usage.inputTokens, outputTokens: audio.usage.outputTokens, durationMs: Date.now() - started, ok: true })
        } catch (err) {
          console.warn(`[speech] could not speak «${text.slice(0, 60)}»`, err)
          await record(db, ctx, { model: tts.name, durationMs: Date.now() - started, ok: false, error: 'error' })
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(PARALLEL, texts.length) }, worker))
  }
  for (const e of todo) {
    const got = byText.get(e.speak!)
    if (got) e.audioFile = got.name
    else if (e.vocab) withoutSpeech(e, ctx.plan, ctx.locale)
    else if (!e.flags.includes('speech_missing')) e.flags.push('speech_missing')
  }
  for (const e of shadowing) e.payload = { ...e.payload, lines: lines(e).map((l) => ({ text: l.text, ...(byText.get(l.text) ? { audioId: byText.get(l.text)!.id } : {}) })) }
  console.info(`[speech] spoke ${byText.size} of ${texts.length} texts`)
  return ids
}

/** Heard items whose sound couldn't be made are taken out, never shown silent (unless that would empty the homework) */
export function dropSilent<T extends { exercises: DraftExercise[] }>(draft: T): number {
  const silent = draft.exercises.filter((e) => e.flags.includes('speech_missing'))
  if (!silent.length || silent.length === draft.exercises.length) return 0
  draft.exercises = draft.exercises.filter((e) => !silent.includes(e))
  return silent.length
}

/** A stored item that plays a spoken word (not a teacher's recording, which has the book's audio label) */
export const isSpoken = (r: ExerciseRow) => !!r.audioMaterialId && !r.audioLabel

/**
 * A revision or a regenerated item is rewritten without sound. An item that still asks students to listen (the
 * prompt of a spoken item it replaces) gets its right option spoken again, so it never plays nothing.
 */
export function relisten(items: DraftExercise[], isListen: (e: DraftExercise) => boolean) {
  for (const e of items) {
    if (e.kind !== 'mcq_single' || e.speak || e.audioLabel || !isListen(e)) continue
    const word = (e.payload.options as string[] | undefined)?.[(e.answerKey as { correct?: number }).correct ?? -1]
    if (word) {
      e.speak = word
      e.vocab = { word, stage: 'meet' }
    }
  }
}

/** The homework's planned words (for "which word means …?" when a word can't be spoken) */
export function plannedWords(generationMeta: unknown): Pick<HomeworkPlan, 'words'> {
  return { words: normalizePlan((generationMeta as { plan?: { plan?: unknown } } | null)?.plan?.plan)?.words ?? [] }
}

/** One ai_calls row per spoken word, so the admin cost page counts pronunciation too */
async function record(db: Db, ctx: { teacherId: string; refId: string | null }, row: { model: string; inputTokens?: number; outputTokens?: number; durationMs: number; ok: boolean; error?: string }) {
  try {
    await db.insert(aiCalls).values({ ...row, purpose: 'speech', task: 'speech', userId: ctx.teacherId, refId: ctx.refId })
  } catch (e) {
    console.warn('[ai-usage] could not record a call', e)
  }
}
