import { beforeEach, describe, expect, it } from 'vitest'
import { createTestDb } from '@ikhimi/db/testing'
import { users, type Db } from '@ikhimi/db'
import { convertItem, type GenerateResult } from '@ikhimi/ai'
import { checkAnswer, createDraft, loadExercises, publishAssignment, startAttempt, submitAttempt } from './assignments'
import { learnerProgress, teacherGroups, teacherImpact } from './profiles'
import { grantPlan } from './plans'

let db: Db

const ex = (item: Parameters<typeof convertItem>[0]) => {
  const r = convertItem(item, 3)
  if (!r.ok) throw new Error(r.reason)
  return r.ex
}
const result = (): GenerateResult => ({
  draft: {
    title: 'Past Simple',
    instructions: '',
    rationale: '',
    contentLanguage: 'en',
    cefrLevel: 'A2',
    estimatedMinutes: 5,
    exercises: [
      ex({ kind: 'short_answer', skill: 'grammar', prompt: 'Past of take?', acceptedAnswers: ['took'], explanation: '' }),
      ex({ kind: 'short_answer', skill: 'vocabulary', prompt: 'Opposite of big?', acceptedAnswers: ['small'], explanation: '' }),
    ],
  },
  meta: { model: 'fake', usage: { inputTokens: 0, outputTokens: 0 }, dropped: [], trimmedForTime: 0, solveBack: [], instructionsScriptOk: true, raw: {} },
})

async function user(role: 'teacher' | 'student', phone: string, name: string) {
  const [u] = await db.insert(users).values({ role, roles: [role], phone, fullName: name }).returning()
  // Grading tests: the student sees every item (plans are tested in plans.test.ts)
  await grantPlan(db, u!.id, 'vip', 365)
  return u!
}

beforeEach(async () => {
  db = await createTestDb()
})

describe('profiles', () => {
  it('learner progress: completed, average, per-skill accuracy — and only for allowed viewers', async () => {
    const teacher = await user('teacher', '+998900000001', 'Nodira')
    const other = await user('teacher', '+998900000002', 'Other')
    const s1 = await user('student', '+998900000003', 'Aziz')
    const s2 = await user('student', '+998900000004', 'Malika')
    const a = await publishAssignment(db, await createDraft(db, { teacherId: teacher.id, conversationId: null, instructionLocale: 'ko', difficulty: 3, result: result() }), { newGroupName: '9-B' })
    const rows = await loadExercises(db, a.id)
    const at = await startAttempt(db, a, s1.id)
    await checkAnswer(db, at, a, { exerciseId: rows[0]!.id, value: 'took', revision: 1 })
    await checkAnswer(db, at, a, { exerciseId: rows[1]!.id, value: 'tiny', revision: 1 })
    await submitAttempt(db, at)

    const own = await learnerProgress(db, { id: s1.id, role: 'student' }, s1.id)
    expect(own).toMatchObject({ completed: 1, averagePercent: 50 })
    expect(own!.skills.find((s) => s.skill === 'grammar')?.accuracy).toBe(100)
    expect(own!.skills.find((s) => s.skill === 'vocabulary')?.accuracy).toBe(0)
    expect(own!.groups.map((g) => g.name)).toEqual(['9-B'])

    // Privacy stance (design spec §12), enforced in code
    expect(await learnerProgress(db, { id: teacher.id, role: 'teacher' }, s1.id)).not.toBeNull() // their teacher
    expect(await learnerProgress(db, { id: s2.id, role: 'student' }, s1.id)).toBeNull() // a classmate
    expect(await learnerProgress(db, { id: other.id, role: 'teacher' }, s1.id)).toBeNull() // another teacher

    const impact = await teacherImpact(db, teacher.id)
    expect(impact).toEqual({ assignmentsCreated: 1, studentsTaught: 1, averageClassScore: 50, hoursSaved: 0.8 })
    const groups = await teacherGroups(db, teacher.id)
    expect(groups[0]).toMatchObject({ name: '9-B', students: 1, average: 50, lastAssignment: { title: 'Past Simple' } })
  })

  it('pending work lists published group homework not yet done', async () => {
    const teacher = await user('teacher', '+998900000011', 'Nodira')
    const s = await user('student', '+998900000012', 'Aziz')
    const a1 = await publishAssignment(db, await createDraft(db, { teacherId: teacher.id, conversationId: null, instructionLocale: 'ko', difficulty: 3, result: result() }), { newGroupName: '7-A' })
    await startAttempt(db, a1, s.id) // joins 7-A
    const a2 = await publishAssignment(db, await createDraft(db, { teacherId: teacher.id, conversationId: null, instructionLocale: 'ko', difficulty: 3, result: result() }), { groupId: a1.groupId })
    const p = await learnerProgress(db, { id: s.id, role: 'student' }, s.id)
    expect(p!.pending.map((x) => x.id).sort()).toEqual([a1.id, a2.id].sort())
    expect(p!.completed).toBe(0)
  })
})
