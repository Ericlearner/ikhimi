import { beforeEach, describe, expect, it } from 'vitest'
import { createTestDb } from '@ikhimi/db/testing'
import { attempts, eq, users, type Db } from '@ikhimi/db'
import { convertItem, type GenerateResult } from '@ikhimi/ai'
import { groupAnalytics, studentAnalytics, trendOf, weakSpots } from './analytics'
import { createDraft, loadExercises, publishAssignment, saveAnswer, startAttempt, submitAttempt } from './assignments'
import { updateGroup } from './groups'
import { grantPlan } from './plans'

let db: Db
let teacher: { id: string; role: 'teacher' }

const result = (title: string): GenerateResult => {
  const r = convertItem({ kind: 'true_false', skill: 'grammar', prompt: 'x', trueFalseAnswer: 'true', explanation: '' }, 1)
  const r2 = convertItem({ kind: 'true_false', skill: 'vocabulary', prompt: 'y', trueFalseAnswer: 'false', explanation: '' }, 1)
  if (!r.ok || !r2.ok) throw new Error('item')
  return {
    draft: { title, instructions: '', rationale: '', contentLanguage: 'en', cefrLevel: 'A2', estimatedMinutes: 5, exercises: [r.ex, r2.ex] },
    meta: { model: 'f', usage: { inputTokens: 0, outputTokens: 0 }, dropped: [], trimmedForTime: 0, solveBack: [], instructionsScriptOk: true, raw: {} },
  }
}

async function person(phone: string, name: string, role: 'teacher' | 'student' = 'student') {
  const [u] = await db.insert(users).values({ role, phone, fullName: name }).returning()
  // Grading tests: the student sees every item (plans are tested in plans.test.ts)
  await grantPlan(db, u!.id, 'vip', 365)
  return u!
}

/** Answer both items: `right` of them correct */
async function doHomework(a: Awaited<ReturnType<typeof publishAssignment>>, studentId: string, right: 0 | 1 | 2) {
  const rows = await loadExercises(db, a.id)
  const at = await startAttempt(db, a, studentId)
  await saveAnswer(db, at, { exerciseId: rows[0]!.id, value: right >= 1 ? 'true' : 'false', revision: 1 })
  await saveAnswer(db, at, { exerciseId: rows[1]!.id, value: right >= 2 ? 'false' : 'true', revision: 1 })
  return submitAttempt(db, at)
}

beforeEach(async () => {
  db = await createTestDb()
  const t = await person('+998900000001', 'Nodira', 'teacher')
  teacher = { id: t.id, role: 'teacher' }
})

async function classOfThree() {
  const a1 = await publishAssignment(db, await createDraft(db, { teacherId: teacher.id, conversationId: null, instructionLocale: 'ko', difficulty: 3, result: result('HW1') }), {
    newGroupName: '7-A',
  })
  const a2 = await publishAssignment(db, await createDraft(db, { teacherId: teacher.id, conversationId: null, instructionLocale: 'ko', difficulty: 3, result: result('HW2') }), {
    groupId: a1.groupId!,
  })
  const aziz = await person('+998900000002', 'Aziz')
  const malika = await person('+998900000003', 'Malika')
  const bobur = await person('+998900000004', 'Bobur')
  await doHomework(a1, aziz.id, 1) // 50
  await doHomework(a1, malika.id, 2) // 100
  await doHomework(a1, bobur.id, 0) // 0
  await doHomework(a2, aziz.id, 2) // 100
  await doHomework(a2, malika.id, 2) // 100
  return { a1, a2, aziz, malika, bobur }
}

describe('studentAnalytics', () => {
  it('teacher view: results over time against the class, with ranks and standing', async () => {
    const { aziz } = await classOfThree()
    const s = (await studentAnalytics(db, teacher, aziz.id))!
    expect(s.timeline.map((x) => [x.title, x.percent, x.classAverage, x.rank])).toEqual([
      ['HW1', 50, 50, 2],
      ['HW2', 100, 100, 1],
    ])
    expect(s.average).toBe(75)
    expect(s.completed).toBe(2)
    expect(s.standings[0]).toMatchObject({ groupName: '7-A', average: 75, rank: 2, of: 3 })
    expect(s.skills.find((k) => k.skill === 'grammar')).toMatchObject({ accuracy: 100 })
  })

  it("student's own view: class averages, never ranks or standings", async () => {
    const { aziz } = await classOfThree()
    const s = (await studentAnalytics(db, { id: aziz.id, role: 'student' }, aziz.id))!
    expect(s.timeline.every((x) => x.rank === null)).toBe(true)
    expect(s.timeline[0]!.classAverage).toBe(50)
    expect(s.standings).toEqual([])
  })

  it('the student sees their own place once the teacher turns the class ranking on', async () => {
    const { a1, aziz } = await classOfThree()
    await updateGroup(db, teacher.id, a1.groupId!, { studentsSeeLeaderboard: true })
    const s = (await studentAnalytics(db, { id: aziz.id, role: 'student' }, aziz.id))!
    expect(s.timeline.map((x) => x.rank)).toEqual([2, 1])
    expect(s.standings[0]).toMatchObject({ rank: 2, of: 3 })
  })

  it("another teacher can't see the student; a classmate can't either", async () => {
    const { aziz, malika } = await classOfThree()
    const other = await person('+998900000009', 'Other', 'teacher')
    expect(await studentAnalytics(db, { id: other.id, role: 'teacher' }, aziz.id)).toBeNull()
    expect(await studentAnalytics(db, { id: malika.id, role: 'student' }, aziz.id)).toBeNull()
  })

  it('lists homework not handed in', async () => {
    const { bobur } = await classOfThree()
    const s = (await studentAnalytics(db, teacher, bobur.id))!
    expect(s.missing.map((m) => m.title)).toEqual(['HW2'])
    expect(s.assigned).toBe(2)
  })
})

describe('groupAnalytics', () => {
  it('class average per homework, spread of students, ranking', async () => {
    const { a1 } = await classOfThree()
    const g = (await groupAnalytics(db, teacher.id, a1.groupId!))!
    expect(g.perAssignment.map((p) => [p.title, p.average, p.min, p.submitted])).toEqual([
      ['HW1', 50, 0, 3],
      ['HW2', 100, 100, 2],
    ])
    expect(g.students.map((s) => [s.name, s.average])).toEqual([
      ['Malika', 100],
      ['Aziz', 75],
      ['Bobur', 0],
    ])
    expect(g.buckets.map((b) => b.count)).toEqual([1, 0, 1, 1])
  })

  it('only the group owner gets it', async () => {
    const { a1 } = await classOfThree()
    const other = await person('+998900000009', 'Other', 'teacher')
    expect(await groupAnalytics(db, other.id, a1.groupId!)).toBeNull()
  })

  it('ignores attempts still in progress', async () => {
    const { a1 } = await classOfThree()
    const late = await person('+998900000005', 'Kamola')
    await startAttempt(db, a1, late.id)
    const g = (await groupAnalytics(db, teacher.id, a1.groupId!))!
    expect(g.perAssignment[0]!.submitted).toBe(3)
    expect(g.students.find((s) => s.name === 'Kamola')?.average).toBeNull()
    const [row] = await db.select().from(attempts).where(eq(attempts.studentId, late.id))
    expect(row!.status).toBe('in_progress')
  })
})

describe('weakSpots', () => {
  it("names the items a group gets wrong most, with the right and the most common wrong answer, and no student", async () => {
    const { a1 } = await classOfThree()
    // HW1's grammar item: Bobur answered false (wrong), the others true
    const w = (await weakSpots(db, teacher.id, a1.groupId!, 'grammar'))!
    expect(w.accuracy).toBe(80)
    expect(w.items).toEqual([{ question: 'x', correct: 'true', commonWrong: 'false', wrong: 1 }])
    expect(JSON.stringify(w.items)).not.toMatch(/Aziz|Malika|Bobur/)
    expect(await weakSpots(db, 'someone-else', a1.groupId!, 'grammar')).toBeNull()
  })
})

describe('trendOf', () => {
  it('needs four results; compares the last three with the three before', () => {
    expect(trendOf([50, 60, 70])).toBeNull()
    expect(trendOf([40, 40, 40, 60, 70, 80])).toBe('up')
    expect(trendOf([90, 90, 90, 60, 60, 60])).toBe('down')
    expect(trendOf([70, 72, 68, 71, 69, 70])).toBe('flat')
  })
})
