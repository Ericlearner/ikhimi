import { beforeEach, describe, expect, it } from 'vitest'
import { createTestDb } from '@ikhimi/db/testing'
import { assignments, users, type Db } from '@ikhimi/db'
import { convertItem, type GenerateResult } from '@ikhimi/ai'
import { createDraft, loadExercises, publishAssignment, saveAnswer, startAttempt, submitAttempt } from './assignments'
import { grantPlan } from './plans'
import { answerReview, dueReview, reviewSummary, syncReview } from './review'

let db: Db
const DAY = 86400_000
const later = (d: Date, days: number) => new Date(d.getTime() + days * DAY + 60_000)

const result = (): GenerateResult => {
  const a = convertItem({ kind: 'short_answer', skill: 'grammar', prompt: 'Past of take?', acceptedAnswers: ['took'], explanation: 'take → took' }, 3)
  const b = convertItem({ kind: 'true_false', skill: 'vocabulary', prompt: '"Huge" means very small.', trueFalseAnswer: 'false', explanation: '' }, 1)
  const c = convertItem({ kind: 'true_false', skill: 'vocabulary', prompt: '"Tiny" means very small.', trueFalseAnswer: 'true', explanation: '' }, 1)
  if (!a.ok || !b.ok || !c.ok) throw new Error('item')
  return {
    draft: { title: 'Past Simple', instructions: '', rationale: '', contentLanguage: 'en', cefrLevel: 'A2', estimatedMinutes: 5, exercises: [a.ex, b.ex, c.ex] },
    meta: { model: 'fake', usage: { inputTokens: 0, outputTokens: 0 }, dropped: [], trimmedForTime: 0, solveBack: [], instructionsScriptOk: true, raw: {} },
  }
}

async function person(phone: string, role: 'teacher' | 'student' = 'student') {
  const [u] = await db.insert(users).values({ role, roles: [role], phone, fullName: phone }).returning()
  if (role === 'student') await grantPlan(db, u!.id, 'vip', 365)
  return u!
}

/** The student gets the grammar item and the first vocabulary item wrong, the last one right */
async function homeworkWithMistakes() {
  const teacher = await person('+998900000001', 'teacher')
  const student = await person('+998900000002')
  const a = await publishAssignment(db, await createDraft(db, { teacherId: teacher.id, conversationId: null, instructionLocale: 'ko', difficulty: 3, result: result() }), { newGroupName: '7-A' })
  const [grammar, huge, tiny] = await loadExercises(db, a.id)
  const at = await startAttempt(db, a, student.id)
  await saveAnswer(db, at, { exerciseId: grammar!.id, value: 'taked', revision: 1 })
  await saveAnswer(db, at, { exerciseId: huge!.id, value: 'true', revision: 1 })
  await saveAnswer(db, at, { exerciseId: tiny!.id, value: 'true', revision: 1 })
  const done = await submitAttempt(db, at)
  return { student, submittedAt: done.submittedAt!, grammar: grammar!, huge: huge! }
}

beforeEach(async () => {
  db = await createTestDb()
})

describe('work on mistakes', () => {
  it('brings each wrong item back 3 days later, then 7 and 21 days after right answers, then it is learned', async () => {
    const { student, submittedAt } = await homeworkWithMistakes()
    expect(await syncReview(db, student.id, submittedAt)).toBe(2)
    expect(await syncReview(db, student.id, submittedAt)).toBe(0)
    expect(await dueReview(db, student.id, submittedAt)).toEqual([])

    const day3 = later(submittedAt, 3)
    const due = await dueReview(db, student.id, day3)
    expect(due.map((d) => d.ex.prompt).sort()).toEqual(['"Huge" means very small.', 'Past of take?'])
    expect(due[0]!.homework).toBe('Past Simple')
    // As students see it: no answer key
    expect(JSON.stringify(due)).not.toContain('took')
    const item = due.find((d) => d.ex.prompt === 'Past of take?')!

    // Wrong again: the answer and why, and back in 2 days
    const wrong = await answerReview(db, student.id, item.itemId, 'taked', day3)
    expect(wrong).toMatchObject({ ok: true, isCorrect: false, learned: false, correctText: 'took', explanation: 'take → took' })
    expect(await answerReview(db, student.id, item.itemId, 'took', day3)).toEqual({ ok: false, reason: 'not_due' })
    expect((await reviewSummary(db, student.id, day3)).due).toBe(1)

    const day5 = later(day3, 2)
    expect(await answerReview(db, student.id, item.itemId, 'took', day5)).toMatchObject({ isCorrect: true, learned: false })
    expect(await dueReview(db, student.id, later(day5, 6))).toHaveLength(1) // only the other item
    const day12 = later(day5, 7)
    expect(await answerReview(db, student.id, item.itemId, 'took', day12)).toMatchObject({ isCorrect: true, learned: false })
    const day33 = later(day12, 21)
    expect(await answerReview(db, student.id, item.itemId, 'took', day33)).toMatchObject({ isCorrect: true, learned: true })
    expect(await reviewSummary(db, student.id, day33)).toMatchObject({ learned: 1, due: 1 })
  })

  it("only shows items of the student's plan", async () => {
    const { student, submittedAt } = await homeworkWithMistakes()
    await syncReview(db, student.id, submittedAt)
    await grantPlan(db, student.id, null, 0)
    const day3 = later(submittedAt, 3)
    const due = await dueReview(db, student.id, day3)
    // Free: vocabulary only
    expect(due.map((d) => d.ex.prompt)).toEqual(['"Huge" means very small.'])
    // The count on the cards is what the review opens (never "2" for an empty review); the rest waits for Pro
    expect(await reviewSummary(db, student.id, day3)).toMatchObject({ due: 1, locked: { pro: 1, vip: 0 } })
  })

  it("doesn't count mistakes from homework the teacher deleted", async () => {
    const { student, submittedAt } = await homeworkWithMistakes()
    await syncReview(db, student.id, submittedAt)
    await db.update(assignments).set({ deletedAt: submittedAt })
    const day3 = later(submittedAt, 3)
    expect(await reviewSummary(db, student.id, day3)).toMatchObject({ due: 0, locked: { pro: 0, vip: 0 } })
    expect(await dueReview(db, student.id, day3)).toEqual([])
  })

  it("never lets one student answer another's review", async () => {
    const { student, submittedAt } = await homeworkWithMistakes()
    await syncReview(db, student.id, submittedAt)
    const other = await person('+998900000003')
    const [item] = await dueReview(db, student.id, later(submittedAt, 3))
    expect(await answerReview(db, other.id, item!.itemId, 'took', later(submittedAt, 3))).toEqual({ ok: false, reason: 'not_found' })
  })
})
