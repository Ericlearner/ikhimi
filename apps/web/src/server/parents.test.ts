import { beforeEach, describe, expect, it } from 'vitest'
import { createTestDb } from '@ikhimi/db/testing'
import { users, type Db } from '@ikhimi/db'
import { convertItem, type GenerateResult } from '@ikhimi/ai'
import { createDraft, loadExercises, publishAssignment, saveAnswer, startAttempt, submitAttempt } from './assignments'
import { activeParentLink, createParentLink, parentView, revokeParentLink } from './parents'
import { grantPlan } from './plans'

let db: Db

const result = (): GenerateResult => {
  const r = convertItem({ kind: 'short_answer', skill: 'grammar', prompt: 'Past of take?', acceptedAnswers: ['took'], explanation: '' }, 3)
  if (!r.ok) throw new Error(r.reason)
  return {
    draft: { title: 'Past Simple', instructions: '', rationale: '', contentLanguage: 'en', cefrLevel: 'A2', estimatedMinutes: 5, exercises: [r.ex] },
    meta: { model: 'fake', usage: { inputTokens: 0, outputTokens: 0 }, dropped: [], trimmedForTime: 0, solveBack: [], instructionsScriptOk: true, raw: {} },
  }
}

async function person(phone: string, name: string, role: 'teacher' | 'student' = 'student') {
  const [u] = await db.insert(users).values({ role, roles: [role], phone, fullName: name }).returning()
  if (role === 'student') await grantPlan(db, u!.id, 'vip', 365)
  return u!
}

beforeEach(async () => {
  db = await createTestDb()
})

async function setup() {
  const teacher = await person('+998900000001', 'Nodira Karimova', 'teacher')
  const student = await person('+998900000002', 'Aziz Karimov')
  const a = await publishAssignment(db, await createDraft(db, { teacherId: teacher.id, conversationId: null, instructionLocale: 'ko', difficulty: 3, result: result() }), { newGroupName: '7-A' })
  const at = await startAttempt(db, a, student.id)
  await saveAnswer(db, at, { exerciseId: (await loadExercises(db, a.id))[0]!.id, value: 'took', revision: 1 })
  await submitAttempt(db, at)
  return { teacher, student }
}

describe('parent link', () => {
  it("shows the student's results through the teacher's eyes, first name only", async () => {
    const { teacher, student } = await setup()
    const link = (await createParentLink(db, teacher.id, student.id))!
    expect(link.token).toMatch(/^[A-Za-z0-9_-]{24}$/)
    const v = (await parentView(db, link.token))!
    expect(v).toMatchObject({ studentName: 'Aziz', teacherName: 'Nodira Karimova', groups: ['7-A'], completed: 1, assigned: 1, average: 100 })
    expect(v.recent).toEqual([expect.objectContaining({ title: 'Past Simple', percent: 100, late: false })])
    expect(JSON.stringify(v)).not.toContain('Karimov"')
  })

  it("can't be made by a teacher who doesn't teach the student", async () => {
    const { student } = await setup()
    const other = await person('+998900000003', 'Other', 'teacher')
    expect(await createParentLink(db, other.id, student.id)).toBeNull()
  })

  it('stops working when turned off or replaced', async () => {
    const { teacher, student } = await setup()
    const first = (await createParentLink(db, teacher.id, student.id))!
    const second = (await createParentLink(db, teacher.id, student.id))!
    expect(await parentView(db, first.token)).toBeNull()
    expect(await parentView(db, second.token)).not.toBeNull()
    expect((await activeParentLink(db, teacher.id, student.id))!.token).toBe(second.token)
    await revokeParentLink(db, teacher.id, student.id)
    expect(await parentView(db, second.token)).toBeNull()
    expect(await activeParentLink(db, teacher.id, student.id)).toBeNull()
    expect(await parentView(db, 'not a token')).toBeNull()
  })
})
