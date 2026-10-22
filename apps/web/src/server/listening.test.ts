import { PDFDocument } from 'pdf-lib'
import { beforeEach, describe, expect, it } from 'vitest'
import { createTestDb } from '@ikhimi/db/testing'
import { eq, exercises, materialBlobs, materials, users, type Db } from '@ikhimi/db'
import { convertItem, type GenerateResult, type LlmProvider } from '@ikhimi/ai'
import { createDraft, loadExercises, publishAssignment } from './assignments'
import { attachAudio, detachAudio } from './listening'
import { loadMaterialsForLlm, MaterialError, parsePageRange, MAX_PAGES } from './materials'

let db: Db

const listenItem = (label: string) => {
  const r = convertItem({ kind: 'gap_fill', skill: 'listening', prompt: '3. Listen and complete.', gapText: 'Tom lives in ___.', listening: true, audioLabel: label, sourceRef: 'Page 12, ex. 3', explanation: '' }, 1)
  if (!r.ok) throw new Error(r.reason)
  return r.ex
}
const result = (): GenerateResult => ({
  draft: { title: 'Unit 3', instructions: '', rationale: '', contentLanguage: 'en', cefrLevel: 'A2', estimatedMinutes: 5, exercises: [listenItem('Track 1.12'), listenItem('Track 1.13')] },
  meta: { model: 'fake', usage: { inputTokens: 0, outputTokens: 0 }, dropped: [], trimmedForTime: 0, solveBack: [], instructionsScriptOk: true, raw: {} },
})

/** Fake model: "hears" London unless told the recording is wrong */
const llm = (matches = true): LlmProvider & { calls: number } => {
  const l = {
    name: 'fake',
    calls: 0,
    async generateJson() {
      l.calls++
      return {
        json: matches ? { matches: true, answers: [{ n: 1, blanks: [{ accepted: ['London'] }], explanation: '"I live in London."' }] } : { matches: false, reason: 'Bu boshqa trek.' },
        usage: { inputTokens: 0, outputTokens: 0 },
        model: 'fake',
      }
    },
  }
  return l
}

async function setup() {
  const [t] = await db.insert(users).values({ role: 'teacher', roles: ['teacher'], phone: '+998900000041', fullName: 'Nodira' }).returning()
  const a = await createDraft(db, { teacherId: t!.id, conversationId: null, instructionLocale: 'ko', difficulty: 3, result: result() })
  const audio = async (name: string) => {
    const [m] = await db.insert(materials).values({ teacherId: t!.id, kind: 'audio', originalFilename: name, mimeType: 'audio/mpeg', processingStatus: 'ready' }).returning()
    await db.insert(materialBlobs).values({ materialId: m!.id, data: Buffer.from('ID3fake') })
    return m!.id
  }
  return { teacher: t!, a, audio }
}

beforeEach(async () => {
  db = await createTestDb()
})

describe('listening audio', () => {
  it('links a recording by its file name, keys the item from the audio, and only then allows publishing', async () => {
    const { a, audio } = await setup()
    await expect(publishAssignment(db, a, { newGroup: { name: '7-A' } })).rejects.toThrow('needs_audio')

    const r = await attachAudio(db, llm(), a, { materialId: await audio('Track 1.12.mp3'), instructionLocale: 'ko' })
    expect(r.ok).toBe(true)
    let rows = await loadExercises(db, a.id)
    expect(rows[0]).toMatchObject({ answerKey: { blanks: [['London']] }, verifyFlags: [], explanation: '"I live in London."' })
    expect(rows[0]!.audioMaterialId).not.toBeNull()
    expect(rows[1]!.audioMaterialId).toBeNull() // Track 1.13 still waiting
    await expect(publishAssignment(db, a, { newGroup: { name: '7-A' } })).rejects.toThrow('needs_audio')

    // A file name that doesn't say which exercise: the teacher is asked
    const unnamed = await audio('recording.mp3')
    const ask = await attachAudio(db, llm(), a, { materialId: unnamed, instructionLocale: 'ko' })
    expect(ask).toMatchObject({ ok: false, code: 'no_match', waiting: [{ label: 'Track 1.13' }] })
    await attachAudio(db, llm(), a, { materialId: unnamed, exerciseIds: [rows[1]!.id], instructionLocale: 'ko' })

    const pub = await publishAssignment(db, a, { newGroup: { name: '7-A' } })
    expect(pub.status).toBe('published')

    // Detaching puts the item back to "needs audio"
    rows = await loadExercises(db, a.id)
    await detachAudio(db, a, rows[1]!.id)
    expect((await loadExercises(db, a.id))[1]).toMatchObject({ audioMaterialId: null, verifyFlags: ['needs_audio'] })
  })

  it('refuses a recording the AI says does not belong to the exercise', async () => {
    const { a, audio } = await setup()
    const r = await attachAudio(db, llm(false), a, { materialId: await audio('Track 1.12.mp3'), instructionLocale: 'ko' })
    const rows = await loadExercises(db, a.id)
    expect(r).toEqual({ ok: false, code: 'mismatch', reason: 'Bu boshqa trek.', exerciseIds: [rows[0]!.id] })
    expect(rows[0]!.audioMaterialId).toBeNull()
  })

  it('"attach anyway": no listening, and an answer the AI only guessed is marked for checking', async () => {
    const { a, audio } = await setup()
    const rows = await loadExercises(db, a.id)
    const file = await audio('Track 1.12.mp3')
    // No model at all: nothing is listened to
    const r = await attachAudio(db, null, a, { materialId: file, exerciseIds: [rows[0]!.id], force: true, instructionLocale: 'ko' })
    expect(r).toEqual({ ok: true, exerciseIds: [rows[0]!.id] })
    const [first] = await loadExercises(db, a.id)
    expect(first).toMatchObject({ audioMaterialId: file, verifyFlags: ['answer_ai_inferred'] })
    // …and only for exercises the teacher named
    expect(await attachAudio(db, null, a, { materialId: file, force: true, instructionLocale: 'ko' })).toMatchObject({ ok: false, code: 'no_match' })
  })

  it("keeps the book's answer: the recording only confirms it's the right track", async () => {
    const { a, audio } = await setup()
    const [row] = await loadExercises(db, a.id)
    await db.update(exercises).set({ answerKey: { blanks: [['Paris']] }, answerSource: 'answer_key' }).where(eq(exercises.id, row!.id))
    const model = llm()
    await attachAudio(db, model, a, { materialId: await audio('Track 1.12.mp3'), instructionLocale: 'ko' })
    expect(model.calls).toBe(1)
    expect((await loadExercises(db, a.id))[0]).toMatchObject({ answerKey: { blanks: [['Paris']] }, answerSource: 'answer_key', verifyFlags: [] })
    expect((await loadExercises(db, a.id))[0]!.audioMaterialId).not.toBeNull()
  })

  it('an answer heard in the recording is marked as from the audio', async () => {
    const { a, audio } = await setup()
    await attachAudio(db, llm(), a, { materialId: await audio('Track 1.12.mp3'), instructionLocale: 'ko' })
    expect((await loadExercises(db, a.id))[0]).toMatchObject({ answerSource: 'audio', answerKey: { blanks: [['London']] } })
  })
})

describe('book pages', () => {
  it('parses page ranges', () => {
    expect(parsePageRange('12-14')).toEqual([12, 13, 14])
    expect(parsePageRange('3, 5 7–8')).toEqual([3, 5, 7, 8])
    expect(parsePageRange('abc')).toEqual([])
  })

  it('cuts a long PDF to the chosen pages and enforces the page limit', async () => {
    const { teacher } = await setup()
    const doc = await PDFDocument.create()
    for (let i = 0; i < 20; i++) doc.addPage()
    const [m] = await db.insert(materials).values({ teacherId: teacher.id, kind: 'pdf', originalFilename: 'book.pdf', mimeType: 'application/pdf', processingStatus: 'ready' }).returning()
    await db.insert(materialBlobs).values({ materialId: m!.id, data: Buffer.from(await doc.save()) })

    await expect(loadMaterialsForLlm(db, teacher.id, [m!.id])).rejects.toMatchObject({ code: 'pdf_pages', n: 20 })
    const [cut] = await loadMaterialsForLlm(db, teacher.id, [m!.id], { pdfPages: '12-14' })
    expect((await PDFDocument.load(Buffer.from(cut!.dataBase64, 'base64'))).getPageCount()).toBe(3)
    await expect(loadMaterialsForLlm(db, teacher.id, [m!.id], { pdfPages: `1-${MAX_PAGES + 1}` })).rejects.toBeInstanceOf(MaterialError)
    const [full] = await loadMaterialsForLlm(db, teacher.id, [m!.id], { pdfPages: `1-${MAX_PAGES}` })
    expect((await PDFDocument.load(Buffer.from(full!.dataBase64, 'base64'))).getPageCount()).toBe(MAX_PAGES)
  })
})
