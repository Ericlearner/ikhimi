import { describe, expect, it } from 'vitest'
import { createTestDb } from '@ikhimi/db/testing'
import { aiCalls, eq, materialBlobs, materials, users } from '@ikhimi/db'
import { normalizePlan, pcmToWav, type DraftExercise, type SpeechProvider } from '@ikhimi/ai'
import { attachSpeech, dropSilent, relisten } from './speech'

const plan = normalizePlan({
  title: 'Travel',
  sections: [{ title: 'a', kinds: [{ kind: 'gap_fill', count: 1 }], about: 'x' }],
  words: [
    { word: 'journey', meaning: 'sayohat' },
    { word: 'ticket', meaning: 'chipta' },
  ],
})!

const listen = (word: string): DraftExercise => ({
  kind: 'mcq_single',
  prompt: 'Eshiting va siz eshitgan so‘zni tanlang',
  payload: { options: [word, 'x', 'y', 'z'] },
  answerKey: { correct: 0 },
  points: 1,
  skill: 'vocabulary',
  explanation: '',
  sourceRef: null,
  estimatedSeconds: 15,
  flags: [],
  aiConfidence: 0.9,
  vocab: { word, stage: 'meet' },
  speak: word,
})

const fakeTts = (fail: string[] = []): SpeechProvider & { spoken: string[] } => {
  const spoken: string[] = []
  return {
    name: 'fake-tts',
    spoken,
    async speak(text) {
      spoken.push(text)
      if (fail.includes(text)) throw new Error('tts down')
      return { mimeType: 'audio/wav', data: pcmToWav(Buffer.alloc(4800), 24000), model: 'fake-tts-1', usage: { inputTokens: 3, outputTokens: 40 } }
    },
  }
}

async function setup() {
  const db = await createTestDb()
  const [u] = await db.insert(users).values({ phone: '+998900000001', role: 'teacher' }).returning()
  return { db, teacherId: u!.id }
}

describe('speech', () => {
  it('speaks each word once, stores it as audio and links every item that plays it', async () => {
    const { db, teacherId } = await setup()
    const items = [listen('journey'), listen('journey'), listen('ticket')]
    const tts = fakeTts()
    const ids = await attachSpeech(db, { teacherId, refId: 'run1', plan, locale: 'ko' }, items, tts)
    expect(tts.spoken).toEqual(['journey', 'ticket'])
    expect(Object.keys(ids)).toHaveLength(2)
    expect(items[0]!.audioFile).toBe(items[1]!.audioFile)
    const stored = await db.select().from(materials).where(eq(materials.id, ids[items[2]!.audioFile!]!))
    // Stored as MP3, not the model's WAV (server/audio.ts)
    expect(stored[0]).toMatchObject({ kind: 'audio', mimeType: 'audio/mpeg', teacherId })
    expect(stored[0]!.originalFilename).toMatch(/\.mp3$/)
    const [blob] = await db.select().from(materialBlobs).where(eq(materialBlobs.materialId, stored[0]!.id))
    expect(blob!.data[0]).toBe(0xff)
    expect(stored[0]!.bytes).toBe(blob!.data.length)
    const calls = await db.select().from(aiCalls)
    expect(calls.map((c) => [c.purpose, c.ok])).toEqual([
      ['speech', true],
      ['speech', true],
    ])
  })

  it('a word that cannot be spoken asks by its meaning instead, never a silent listen item', async () => {
    const { db, teacherId } = await setup()
    const items = [listen('journey'), listen('ticket')]
    await attachSpeech(db, { teacherId, refId: null, plan, locale: 'ko' }, items, fakeTts(['ticket']))
    expect(items[0]!.audioFile).toBeTruthy()
    expect(items[1]!.audioFile).toBeFalsy()
    expect(items[1]).toMatchObject({ speak: null, prompt: '‘chipta’에 해당하는 단어는 무엇인가요?' })
  })

  it('without text-to-speech every listen item asks by meaning', async () => {
    const { db, teacherId } = await setup()
    const items = [listen('journey')]
    expect(await attachSpeech(db, { teacherId, refId: null, plan, locale: 'ko' }, items, null)).toEqual({})
    expect(items[0]!.prompt).toBe('‘sayohat’에 해당하는 단어는 무엇인가요?')
  })

  it('a rewritten item that still asks students to listen gets its right option spoken', () => {
    const rewritten = { ...listen('ticket'), speak: null, vocab: null, payload: { options: ['x', 'ticket', 'y', 'z'] }, answerKey: { correct: 1 } }
    const other = { ...listen('journey'), prompt: 'Something else', speak: null }
    relisten([rewritten, other], (e) => e.prompt === rewritten.prompt)
    expect(rewritten.speak).toBe('ticket')
    expect(other.speak).toBeNull()
  })

  it('speaks every shadowing sentence and links it; a sentence that fails is left to read aloud', async () => {
    const { db, teacherId } = await setup()
    const shadow: DraftExercise = { ...listen('x'), kind: 'shadowing', speak: null, vocab: null, payload: { lines: [{ text: 'I think so.' }, { text: 'Thank you.' }] }, answerKey: {}, points: 0 }
    await attachSpeech(db, { teacherId, refId: null, plan, locale: 'ko' }, [shadow], fakeTts(['Thank you.']))
    const lines = shadow.payload.lines as { text: string; audioId?: string }[]
    expect(lines[0]!.audioId).toBeTruthy()
    expect(lines[1]).toEqual({ text: 'Thank you.' })
  })

  it('a minimal pair that cannot be spoken is taken out, never shown silent', async () => {
    const { db, teacherId } = await setup()
    const pair: DraftExercise = { ...listen('sheep'), vocab: null, skill: 'pronunciation' }
    const draft = { exercises: [pair, { ...listen('journey'), speak: null }] }
    await attachSpeech(db, { teacherId, refId: null, plan, locale: 'ko' }, draft.exercises, fakeTts(['sheep']))
    expect(pair.flags).toContain('speech_missing')
    expect(dropSilent(draft)).toBe(1)
    expect(draft.exercises).toHaveLength(1)
  })
})
