import { beforeEach, describe, expect, it } from 'vitest'
import { createTestDb } from '@ikhimi/db/testing'
import { assignments, eq, responses, users, type Db } from '@ikhimi/db'
import { convertItem, type GenerateResult, type LlmProvider, type LlmRequest } from '@ikhimi/ai'
import { checkAnswer, createDraft, loadExercises, publishAssignment, startAttempt } from './assignments'
import { grantPlan, hasFeature } from './plans'
import { checkPractice, tutorNotes } from './tutor'

let db: Db

function tutorLlm() {
  const requests: LlmRequest[] = []
  const llm: LlmProvider = {
    name: 'fake',
    async generateJson(req) {
      requests.push(req)
      const practice = req.system.includes('wants to practise')
        ? { practice: { question: 'My family ___ at home now.', options: ['is', 'are'], answers: ['is'], why: 'family — birlik.' } }
        : {}
      return { json: { text: `Izoh ${requests.length}`, example: 'Everyone is listening.', ...practice }, usage: { inputTokens: 1, outputTokens: 1 }, model: 'fake' }
    },
  }
  return { llm, requests }
}

async function setup(opts: { studentPlan?: 'pro' | 'vip'; hideAnswers?: boolean } = {}) {
  const [t] = await db.insert(users).values({ role: 'teacher', phone: '+998900000001', fullName: 'Nodira' }).returning()
  const r = convertItem({ kind: 'mcq_single', skill: 'grammar', prompt: 'Hurry up! Everybody ___ for you.', options: ['is waiting', 'are waiting'], correctOptionIndexes: [0], explanation: 'Everybody — birlik.' }, 1)
  if (!r.ok) throw new Error(r.reason)
  const result: GenerateResult = {
    draft: { title: 'Present Continuous', instructions: '', rationale: '', contentLanguage: 'en', cefrLevel: 'A2', estimatedMinutes: 3, exercises: [r.ex] },
    meta: { model: 'fake', usage: { inputTokens: 0, outputTokens: 0 }, dropped: [], trimmedForTime: 0, solveBack: [], instructionsScriptOk: true, raw: {} },
  }
  let a = await publishAssignment(db, await createDraft(db, { teacherId: t!.id, conversationId: null, instructionLocale: 'ko', difficulty: 3, result }), { newGroupName: '7-A' })
  if (opts.hideAnswers) a = (await db.update(assignments).set({ settings: { showAnswersAfter: 'never' } }).where(eq(assignments.id, a.id)).returning())[0]!
  const [s] = await db.insert(users).values({ role: 'student', phone: '+998900000002', fullName: 'Aziz' }).returning()
  if (opts.studentPlan) await grantPlan(db, s!.id, opts.studentPlan, 30)
  const at = await startAttempt(db, a!, s!.id)
  const [ex] = await loadExercises(db, a!.id)
  const options = (ex!.payload as { options: string[] }).options
  return { a: a!, at, ex: ex!, wrong: options.indexOf('are waiting'), right: options.indexOf('is waiting') }
}

beforeEach(async () => {
  db = await createTestDb()
})

describe('AI tutor', () => {
  it('is for students on the VIP plan only', async () => {
    const pro = await setup({ studentPlan: 'pro' })
    expect(await hasFeature(db, pro.at.studentId, 'tutor')).toBe(false)
    const { llm, requests } = tutorLlm()
    await checkAnswer(db, pro.at, pro.a, { exerciseId: pro.ex.id, value: pro.wrong, revision: 1 })
    expect(await tutorNotes(db, pro.at, pro.a, { exerciseId: pro.ex.id }, llm)).toEqual({ ok: false, reason: 'not_vip' })
    expect(requests).toHaveLength(0)

    db = await createTestDb()
    const vip = await setup({ studentPlan: 'vip' })
    expect(await hasFeature(db, vip.at.studentId, 'tutor')).toBe(true)
  })

  it('explains a checked wrong answer once, keeps it, then answers the buttons up to the cap', async () => {
    const { a, at, ex, wrong } = await setup({ studentPlan: 'vip' })
    const { llm, requests } = tutorLlm()
    expect(await tutorNotes(db, at, a, { exerciseId: ex.id }, llm)).toEqual({ ok: false, reason: 'not_wrong' }) // not checked yet
    await checkAnswer(db, at, a, { exerciseId: ex.id, value: wrong, revision: 1 })

    const first = await tutorNotes(db, at, a, { exerciseId: ex.id }, llm)
    expect(first).toEqual({ ok: true, notes: [{ text: 'Izoh 1', example: 'Everyone is listening.', mode: 'explain' }] })
    const sent = JSON.parse((requests[0]!.parts[0] as { text: string }).text)
    expect(sent).toMatchObject({ studentAnswer: 'are waiting', correctAnswer: 'is waiting', noteFromTheHomework: 'Everybody — birlik.' })
    expect(JSON.stringify(sent)).not.toContain('Aziz')

    // A reload costs nothing
    await tutorNotes(db, at, a, { exerciseId: ex.id }, llm)
    expect(requests).toHaveLength(1)

    const simpler = await tutorNotes(db, at, a, { exerciseId: ex.id, mode: 'simpler' }, llm)
    expect(simpler.ok && simpler.notes.map((n) => n.mode)).toEqual(['explain', 'simpler'])
    expect(requests[1]!.system).toContain('DIFFERENT, simpler')
    expect((requests[1]!.parts[0] as { text: string }).text).toContain('Izoh 1')

    await tutorNotes(db, at, a, { exerciseId: ex.id, mode: 'example' }, llm)
    await tutorNotes(db, at, a, { exerciseId: ex.id, mode: 'example' }, llm)
    await tutorNotes(db, at, a, { exerciseId: ex.id, mode: 'simpler' }, llm)
    expect(requests).toHaveLength(5)
    expect(await tutorNotes(db, at, a, { exerciseId: ex.id, mode: 'simpler' }, llm)).toEqual({ ok: false, reason: 'no_more' })
  })

  it('checks a practice item once, never sends its answer before, and never touches the score', async () => {
    const { a, at, ex, wrong } = await setup({ studentPlan: 'vip' })
    const { llm } = tutorLlm()
    await checkAnswer(db, at, a, { exerciseId: ex.id, value: wrong, revision: 1 })
    await tutorNotes(db, at, a, { exerciseId: ex.id }, llm)
    const r = await tutorNotes(db, at, a, { exerciseId: ex.id, mode: 'practice' }, llm)
    if (!r.ok) throw new Error(r.reason)
    const p = r.notes[1]!.practice!
    expect(p).toEqual({ question: 'My family ___ at home now.', options: expect.any(Array) })
    expect(JSON.stringify(r)).not.toContain('birlik')

    expect(await checkPractice(db, at, a, { exerciseId: ex.id, index: 0, value: 0 })).toEqual({ ok: false, reason: 'not_practice' })
    const wrongPick = p.options!.indexOf('are')
    const done = await checkPractice(db, at, a, { exerciseId: ex.id, index: 1, value: wrongPick })
    expect(done.ok && done.notes[1]!.practice).toMatchObject({ given: 'are', right: false, answers: ['is'], why: 'family — birlik.' })
    // One try: a second answer keeps the first result
    const again = await checkPractice(db, at, a, { exerciseId: ex.id, index: 1, value: p.options!.indexOf('is') })
    expect(again.ok && again.notes[1]!.practice).toMatchObject({ given: 'are', right: false })

    const [resp] = await db.select().from(responses).where(eq(responses.exerciseId, ex.id))
    expect(resp!.isCorrect).toBe(false)
    expect(resp!.pointsAwarded).toBe(0)
  })

  it('checks a written practice answer with the homework\'s answer rules', async () => {
    const { a, at, ex, wrong } = await setup({ studentPlan: 'vip' })
    await checkAnswer(db, at, a, { exerciseId: ex.id, value: wrong, revision: 1 })
    await db
      .update(responses)
      .set({ tutor: [{ text: 'Sinab ko‘ring', example: null, mode: 'practice', practice: { question: 'She ___ (be) happy.', options: null, answers: ['is'], why: '' } }] })
      .where(eq(responses.exerciseId, ex.id))
    const r = await checkPractice(db, at, a, { exerciseId: ex.id, index: 0, value: '  Is. ' })
    expect(r.ok && r.notes[0]!.practice).toMatchObject({ given: 'Is.', right: true })
  })

  it('does not explain a right answer, and keeps hidden answers hidden', async () => {
    const r = await setup({ studentPlan: 'vip' })
    const { llm } = tutorLlm()
    await checkAnswer(db, r.at, r.a, { exerciseId: r.ex.id, value: r.right, revision: 1 })
    expect(await tutorNotes(db, r.at, r.a, { exerciseId: r.ex.id }, llm)).toEqual({ ok: false, reason: 'not_wrong' })

    db = await createTestDb()
    const h = await setup({ studentPlan: 'vip', hideAnswers: true })
    const hidden = tutorLlm()
    await checkAnswer(db, h.at, h.a, { exerciseId: h.ex.id, value: h.wrong, revision: 1 })
    await tutorNotes(db, h.at, h.a, { exerciseId: h.ex.id }, hidden.llm)
    expect((hidden.requests[0]!.parts[0] as { text: string }).text).not.toContain('correctAnswer')
  })
})
