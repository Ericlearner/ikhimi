import { beforeEach, describe, expect, it } from 'vitest'
import { createTestDb } from '@ikhimi/db/testing'
import { and, assignments, attempts, enrollments, eq, responses, users, type Db } from '@ikhimi/db'
import { convertItem, type GenerateResult } from '@ikhimi/ai'
import { grantPlan } from './plans'
import {
  buildReport,
  checkAnswer,
  createDraft,
  loadExercises,
  publicExercise,
  publishAssignment,
  saveAnswer,
  startAttempt,
  submitAttempt,
  toDraft,
} from './assignments'

let db: Db
let teacherId: string

const ex = (item: Parameters<typeof convertItem>[0]) => {
  const r = convertItem(item, 3)
  if (!r.ok) throw new Error(r.reason)
  return r.ex
}

const result = (): GenerateResult => ({
  draft: {
    title: 'Past Simple',
    instructions: 'Mashqlarni bajaring',
    rationale: 'Takrorlash',
    contentLanguage: 'en',
    cefrLevel: 'A2',
    estimatedMinutes: 10,
    exercises: [
      ex({ kind: 'mcq_single', skill: 'grammar', prompt: 'I ___ home.', options: ['went', 'go', 'goed'], correctOptionIndexes: [0], explanation: 'go → went' }),
      ex({ kind: 'gap_fill', skill: 'grammar', prompt: 'Fill', gapText: 'She ___ bread.', gapAnswers: [{ accepted: ['bought'] }], explanation: 'buy → bought' }),
      ex({ kind: 'short_answer', skill: 'writing', prompt: 'Past of take?', acceptedAnswers: ['took'], explanation: 'take → took' }),
    ],
  },
  meta: { model: 'fake', usage: { inputTokens: 1, outputTokens: 1 }, dropped: [], trimmedForTime: 0, solveBack: [], instructionsScriptOk: true, raw: {} },
})

beforeEach(async () => {
  db = await createTestDb()
  const [t] = await db.insert(users).values({ role: 'teacher', phone: '+998900000001', fullName: 'Nodira' }).returning()
  teacherId = t!.id
})

async function student(phone: string, name: string) {
  const [s] = await db.insert(users).values({ role: 'student', phone, fullName: name }).returning()
  // Grading tests: the student sees every item (plans are tested in plans.test.ts)
  await grantPlan(db, s!.id, 'vip', 365)
  return s!
}

describe('assignment lifecycle', () => {
  it('draft → publish into a new group → students answer → graded → report', async () => {
    const a = await createDraft(db, { teacherId, conversationId: null, instructionLocale: 'ko', difficulty: 3, result: result() })
    expect(a.status).toBe('draft')
    expect(a.totalPoints).toBe(3)
    expect(a.shareSlug).toMatch(/^[2-9A-HJKMNP-Z]{8}$/)

    const pub = await publishAssignment(db, a, { newGroupName: '9-B' })
    expect(pub.status).toBe('published')
    expect(pub.groupId).toBeTruthy()

    const rows = await loadExercises(db, a.id)
    // Students never receive answer keys
    for (const r of rows) expect(JSON.stringify(publicExercise(r))).not.toMatch(/bought|took|answerKey|explanation|go → went/)

    const aziz = await student('+998900000002', 'Aziz')
    const malika = await student('+998900000003', 'Malika')
    const idle = await student('+998900000004', 'Bobur')
    await db.insert(enrollments).values({ groupId: pub.groupId!, studentId: idle.id })

    const at1 = await startAttempt(db, pub, aziz.id)
    expect((await startAttempt(db, pub, aziz.id)).id).toBe(at1.id) // idempotent
    const mcqCorrect = (rows[0]!.answerKey as { correct: number }).correct
    await saveAnswer(db, at1, { exerciseId: rows[0]!.id, value: mcqCorrect, revision: 1 })
    await saveAnswer(db, at1, { exerciseId: rows[1]!.id, value: ['Bought'], revision: 1 })
    await saveAnswer(db, at1, { exerciseId: rows[2]!.id, value: 'tok', revision: 1, activeSeconds: 420 })
    // Stale revision from an offline phone is ignored
    expect(await saveAnswer(db, at1, { exerciseId: rows[2]!.id, value: 'zzz', revision: 1 })).toMatchObject({ stale: true })
    await saveAnswer(db, at1, { exerciseId: rows[2]!.id, value: 'took', revision: 2 })
    const g1 = await submitAttempt(db, at1)
    expect(g1.status).toBe('graded')
    expect(g1.percent).toBe(100)
    // Can't change answers after submitting
    expect(await saveAnswer(db, g1, { exerciseId: rows[0]!.id, value: 0, revision: 9 })).toMatchObject({ ok: false })

    const at2 = await startAttempt(db, pub, malika.id)
    await saveAnswer(db, at2, { exerciseId: rows[0]!.id, value: (mcqCorrect + 1) % 3, revision: 1 })
    const g2 = await submitAttempt(db, at2)
    expect(g2.percent).toBe(0)
    // Auto-enrolled from the link
    expect(await db.select().from(enrollments).where(eq(enrollments.studentId, malika.id))).toHaveLength(1)

    const report = await buildReport(db, pub)
    expect(report.counts).toMatchObject({ submitted: 2, notStarted: 1 })
    expect(report.averagePercent).toBe(50)
    expect(report.top.map((s) => s.name)).toEqual(['Aziz'])
    expect(report.needsHelp.map((s) => s.name)).toEqual(['Malika'])
    expect(report.passive.map((s) => s.name)).toContain('Bobur')
    expect(report.hardest[0]!.wrong).toBe(1)
    expect(report.hardest.find((h) => h.n === 1)?.commonWrong).toBeTruthy()
  })

  it('two saves of the same new answer at once both succeed, and the newer one is kept', async () => {
    const a = await publishAssignment(db, await createDraft(db, { teacherId, conversationId: null, instructionLocale: 'ko', difficulty: 3, result: result() }), {})
    const rows = await loadExercises(db, a.id)
    const at = await startAttempt(db, a, (await student('+998900000009', 'Zarina')).id)
    // The autosave and the heartbeat: both find no answer yet and both create it (this used to fail with a 500)
    const both = await Promise.all([
      saveAnswer(db, at, { exerciseId: rows[2]!.id, value: 'tok', revision: 1, timeSpentSec: 5 }),
      saveAnswer(db, at, { exerciseId: rows[2]!.id, value: 'took', revision: 2, timeSpentSec: 9 }),
    ])
    expect(both.map((r) => r.ok)).toEqual([true, true])
    const saved = await db.select().from(responses).where(and(eq(responses.attemptId, at.id), eq(responses.exerciseId, rows[2]!.id)))
    expect(saved.map((r) => [r.value, r.revisionCount, r.timeSpentSec])).toEqual([['took', 2, 9]])
    // An older revision arriving second changes nothing
    await Promise.all([
      saveAnswer(db, at, { exerciseId: rows[1]!.id, value: ['bought'], revision: 3 }),
      saveAnswer(db, at, { exerciseId: rows[1]!.id, value: ['buyed'], revision: 2 }),
    ])
    expect((await db.select().from(responses).where(and(eq(responses.attemptId, at.id), eq(responses.exerciseId, rows[1]!.id))))[0]).toMatchObject({ value: ['bought'], revisionCount: 3 })
  })

  it('instant feedback grades one item, reveals the key, and locks the answer (§9)', async () => {
    const a = await publishAssignment(db, await createDraft(db, { teacherId, conversationId: null, instructionLocale: 'ko', difficulty: 3, result: result() }), {})
    const rows = await loadExercises(db, a.id)
    const s = await student('+998900000006', 'Laylo')
    const at = await startAttempt(db, a, s.id)
    const wrong = await checkAnswer(db, at, a, { exerciseId: rows[2]!.id, value: 'taked', revision: 1 })
    expect(wrong).toMatchObject({ ok: true, isCorrect: false, correctValue: 'took', correctText: 'took', explanation: 'take → took' })
    // Locked: changing the answer after seeing the key is refused, and re-checking returns the same verdict
    expect(await saveAnswer(db, at, { exerciseId: rows[2]!.id, value: 'took', revision: 5 })).toMatchObject({ ok: false, reason: 'locked' })
    expect(await checkAnswer(db, at, a, { exerciseId: rows[2]!.id, value: 'took', revision: 6 })).toMatchObject({ isCorrect: false })
    const right = await checkAnswer(db, at, a, { exerciseId: rows[1]!.id, value: ['bought'], revision: 1 })
    expect(right).toMatchObject({ ok: true, isCorrect: true })
    const graded = await submitAttempt(db, at)
    expect(graded.score).toBe(1) // gap right, short answer wrong, mcq unanswered
  })

  it('"never show answers" hides the key but still says right/wrong', async () => {
    const d = await createDraft(db, { teacherId, conversationId: null, instructionLocale: 'ko', difficulty: 3, result: result() })
    await db.update(assignments).set({ settings: { showAnswersAfter: 'never' } }).where(eq(assignments.id, d.id))
    const a = await publishAssignment(db, (await db.select().from(assignments).where(eq(assignments.id, d.id)))[0]!, {})
    const rows = await loadExercises(db, a.id)
    const s = await student('+998900000007', 'Kamola')
    const at = await startAttempt(db, a, s.id)
    expect(await checkAnswer(db, at, a, { exerciseId: rows[2]!.id, value: 'x', revision: 1 })).toMatchObject({ isCorrect: false, correctValue: null, explanation: null })
  })

  it('toDraft round-trips rows for refine context', async () => {
    const a = await createDraft(db, { teacherId, conversationId: null, instructionLocale: 'ko', difficulty: 2, result: result() })
    const d = toDraft(a, await loadExercises(db, a.id))
    expect(d.exercises.map((e) => e.kind)).toEqual(['mcq_single', 'gap_fill', 'short_answer'])
    expect(d.rationale).toBe('Takrorlash')
  })

  it("refuses to publish into another teacher's group", async () => {
    const a = await createDraft(db, { teacherId, conversationId: null, instructionLocale: 'ko', difficulty: 3, result: result() })
    const [other] = await db.insert(users).values({ role: 'teacher', phone: '+998900000009' }).returning()
    const b = await createDraft(db, { teacherId: other!.id, conversationId: null, instructionLocale: 'ko', difficulty: 3, result: result() })
    const pubB = await publishAssignment(db, b, { newGroupName: 'Other' })
    await expect(publishAssignment(db, a, { groupId: pubB.groupId })).rejects.toThrow('group_not_owned')
  })

  it('an unsubmitted attempt counts as in progress', async () => {
    const a = await publishAssignment(db, await createDraft(db, { teacherId, conversationId: null, instructionLocale: 'ko', difficulty: 3, result: result() }), {})
    const s = await student('+998900000005', 'Dilnoza')
    await startAttempt(db, a, s.id)
    const r = await buildReport(db, a)
    expect(r.counts).toMatchObject({ opened: 1, inProgress: 1, submitted: 0 })
    expect((await db.select().from(attempts))[0]!.status).toBe('in_progress')
  })
})
