import { expect, it } from 'vitest'
import { createTestDb } from '@ikhimi/db/testing'
import { responses, sql, users } from '@ikhimi/db'
import { convertItem } from '@ikhimi/ai'
import { checkAnswer, createDraft, loadExercises, publishAssignment, startAttempt, submitAttempt } from './assignments'
import { grantPlan } from './plans'
/** Regression: JSON was parsed twice on read, so a stored "false" came back as false and graded wrong. */
it('answers that look like JSON scalars survive the round trip', async () => {
  const db = await createTestDb()
  const [t] = await db.insert(users).values({ role: 'teacher', roles: ['teacher'], phone: '+998900001111', fullName: 'T' }).returning()
  const [s] = await db.insert(users).values({ role: 'student', roles: ['student'], phone: '+998900001112', fullName: 'S' }).returning()
  // Grading tests: the student sees every item (plans are tested in plans.test.ts)
  await grantPlan(db, s!.id, 'vip', 365)
  const items = [
    convertItem({ kind: 'true_false', skill: 'grammar', prompt: 'x', trueFalseAnswer: 'false', explanation: '' }, 1),
    convertItem({ kind: 'true_false', skill: 'grammar', prompt: 'y', trueFalseAnswer: 'true', explanation: '' }, 1),
    convertItem({ kind: 'short_answer', skill: 'grammar', prompt: '10 + 2?', acceptedAnswers: ['12'], explanation: '' }, 1),
  ].map((r) => {
    if (!r.ok) throw new Error(r.reason)
    return r.ex
  })
  const a = await publishAssignment(db, await createDraft(db, { teacherId: t!.id, conversationId: null, instructionLocale: 'ko', difficulty: 3, result: { draft: { title: 'x', instructions: '', rationale: '', contentLanguage: 'en', cefrLevel: null, estimatedMinutes: 1, exercises: items }, meta: { model: 'f', usage: { inputTokens: 0, outputTokens: 0 }, dropped: [], trimmedForTime: 0, solveBack: [], instructionsScriptOk: true, raw: {} } } }), { newGroup: { name: 'g' } })
  const at = await startAttempt(db, a, s!.id)
  const ex = await loadExercises(db, a.id)
  const values = ['false', 'true', '12']
  for (const [i, value] of values.entries()) {
    const r = await checkAnswer(db, at, a, { exerciseId: ex[i]!.id, value, revision: 1 })
    expect(r).toMatchObject({ ok: true, isCorrect: true })
  }
  const done = await submitAttempt(db, at)
  expect(done).toMatchObject({ percent: 100 })
  const rows = await db.select().from(responses)
  expect(rows.map((r) => r.value).sort()).toEqual(['12', 'false', 'true'])
})
