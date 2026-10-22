import { beforeEach, describe, expect, it } from 'vitest'
import { createTestDb } from '@ikhimi/db/testing'
import { assignments, attempts, exercises, groups, responses, users, type Db } from '@ikhimi/db'
import { studentResults } from './student-results'

// Thursday 15 October 2026 in Seoul; the week began on Monday the 12th
const NOW = new Date('2026-10-15T10:00:00Z')
const DAY = 86_400_000
let db: Db
let student: string
let teacher: string
let group: string
let n = 0

/** A handed-in homework (or one still open): `answers` are [skill, right?] pairs */
async function homework(title: string, daysAgo: number, answers: [string, boolean][], status: 'graded' | 'in_progress' = 'graded') {
  n++
  const [a] = await db.insert(assignments).values({ teacherId: teacher, groupId: group, title, instructionLocale: 'ko', contentLanguage: 'en', shareSlug: `s${n}` }).returning()
  const at = new Date(NOW.getTime() - daysAgo * DAY)
  const [t] = await db.insert(attempts).values({ assignmentId: a!.id, studentId: student, status, submittedAt: status === 'graded' ? at : null }).returning()
  for (const [i, [skill, right]] of answers.entries()) {
    const [e] = await db.insert(exercises).values({ assignmentId: a!.id, orderIndex: i, kind: 'mcq_single', prompt: {}, answerKey: {}, skillTags: [skill] }).returning()
    await db.insert(responses).values({ attemptId: t!.id, exerciseId: e!.id, value: 0, isCorrect: right, updatedAt: at })
  }
}
const times = (k: number, skill: string, right: boolean) => Array.from({ length: k }, () => [skill, right] as [string, boolean])

beforeEach(async () => {
  db = await createTestDb()
  const [tc] = await db.insert(users).values({ role: 'teacher', roles: ['teacher'], phone: '+998900000001' }).returning()
  const [s] = await db.insert(users).values({ role: 'student', roles: ['student'], phone: '+998900000002' }).returning()
  const [g] = await db.insert(groups).values({ teacherId: tc!.id, name: '9-B', subject: 'english', contentLanguage: 'en', joinCode: 'ABC123' }).returning()
  teacher = tc!.id
  student = s!.id
  group = g!.id
})

describe("the student's results", () => {
  it('⭐ counts every right answer ever, and this week separately; open homework counts for ⭐ but not for scores', async () => {
    await homework('Old', 10, [...times(3, 'grammar', true), ['grammar', false]])
    await homework('This week', 1, [...times(2, 'grammar', true), ['grammar', false]])
    await homework('Still open', 0, times(2, 'grammar', true), 'in_progress')
    const r = await studentResults(db, student, NOW)
    expect(r.stars).toEqual({ total: 7, thisWeek: 4 })
    // 5 right of 7 handed in
    expect(r.accuracy).toBe(71)
  })

  it('a skill shows its strongest topics and the ones to work on, never the same topic twice', async () => {
    await homework('Past Simple', 6, times(4, 'grammar', true))
    await homework('Articles', 5, [...times(1, 'grammar', true), ...times(3, 'grammar', false)])
    await homework('Can / Cant', 4, [...times(3, 'grammar', true), ['grammar', false]])
    await homework('Prepositions', 3, [...times(2, 'grammar', true), ...times(2, 'grammar', false)])
    const [g] = (await studentResults(db, student, NOW)).skills
    expect(g!.skill).toBe('grammar')
    expect(g!.percent).toBe(63)
    expect(g!.strengths.map((t) => [t.title, t.percent])).toEqual([['Past Simple', 100], ['Can / Cant', 75]])
    expect(g!.attention.map((t) => [t.title, t.percent])).toEqual([['Articles', 25], ['Prepositions', 50]])
  })

  it('the change compares the latest three homework with the three before, once there are six', async () => {
    for (let i = 0; i < 3; i++) await homework(`Early ${i}`, 20 - i, [...times(1, 'reading', true), ...times(3, 'reading', false)])
    let [r] = (await studentResults(db, student, NOW)).skills
    expect(r!.change).toBeNull()
    for (let i = 0; i < 3; i++) await homework(`Late ${i}`, 5 - i, [...times(3, 'reading', true), ...times(1, 'reading', false)])
    ;[r] = (await studentResults(db, student, NOW)).skills
    // 25% → 75%
    expect(r!.change).toBe(50)
  })
})
