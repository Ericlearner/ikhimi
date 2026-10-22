import { beforeEach, describe, expect, it } from 'vitest'
import { createTestDb } from '@ikhimi/db/testing'
import { users, type Db } from '@ikhimi/db'
import { convertItem, type GenerateResult } from '@ikhimi/ai'
import { createDraft, loadExercises, publishAssignment, saveAnswer, startAttempt, submitAttempt } from './assignments'
import { updateGroup } from './groups'
import { grantPlan } from './plans'
import { groupRanking, rankStudents, shortName, studentRankings } from './ranking'

const day = (n: number) => new Date(Date.UTC(2026, 9, n, 12))
/** Published on day `published`, to do by the end of day `due` (a duration of due − published days) */
const hw = (id: string, published: number, due: number | null = null) => ({ id, publishedAt: day(published), dueDays: due === null ? null : due - published })
const member = (id: string, joined = 1) => ({ id, name: id, joinedAt: day(joined) })
const did = (assignmentId: string, studentId: string, percent: number, at: number) => ({ assignmentId, studentId, percent, submittedAt: day(at) })

describe('rankStudents', () => {
  it('counts missed homework as 0 once it is due, never before', () => {
    const homework = [hw('h1', 1, 3), hw('h2', 4, 10)]
    const done = [did('h1', 'a', 100, 2), did('h1', 'b', 90, 2), did('h2', 'b', 90, 5)]
    // Day 6: h2 isn't due yet, so a's 100 beats b's 90
    expect(rankStudents(homework, [member('a'), member('b')], done, day(6)).map((r) => [r.studentId, r.place, r.score])).toEqual([
      ['a', 1, 100],
      ['b', 2, 90],
    ])
    // Day 11: a missed h2 → (100 + 0) / 2 = 50
    expect(rankStudents(homework, [member('a'), member('b')], done, day(11)).map((r) => [r.studentId, r.place, r.score, r.counted])).toEqual([
      ['b', 1, 90, 2],
      ['a', 2, 50, 2],
    ])
  })

  it('without a due date, homework closes when a newer one is published; earlier homework counts only if done', () => {
    const homework = [hw('h1', 1), hw('h2', 5), hw('h3', 8)]
    // c joined on day 4: h1 doesn't count for them; h2 (closed by h3) does, as a miss
    const r = rankStudents(homework, [member('c', 4)], [did('h3', 'c', 80, 9)], day(9))[0]!
    expect(r).toMatchObject({ counted: 2, done: 1, score: 40 })
  })

  it('ties go to more homework on time, then whoever finished first; nothing counted means no place', () => {
    const homework = [hw('h1', 1, 3)]
    const done = [did('h1', 'late', 80, 4), did('h1', 'early', 80, 2), did('h1', 'first', 80, 1.5 as number)]
    const rows = rankStudents(homework, [member('late'), member('early'), member('first'), member('new', 5)], done, day(2))
    expect(rows.map((r) => [r.studentId, r.place])).toEqual([
      ['first', 1],
      ['early', 2],
      ['late', 3],
      ['new', null],
    ])
  })
})

describe('rankStudents and late joiners', () => {
  it('a student who joined after the deadline is never late for that homework', () => {
    const homework = [hw('h1', 1, 3)]
    // Both scored 80: "old" was in the group and handed in late; "new" joined on day 5 and handed in on day 6
    const done = [did('h1', 'old', 80, 4), did('h1', 'new', 80, 6)]
    const rows = rankStudents(homework, [member('old'), member('new', 5)], done, day(7))
    expect(rows.map((r) => [r.studentId, r.place, r.onTime])).toEqual([
      ['new', 1, 1],
      ['old', 2, 0],
    ])
  })
})

describe('shortName', () => {
  it('first name and last initial', () => {
    expect(shortName('Aziz Karimov')).toBe('Aziz K.')
    expect(shortName('Malika')).toBe('Malika')
  })
})

describe('groupRanking', () => {
  let db: Db
  beforeEach(async () => {
    db = await createTestDb()
  })

  const result = (title: string): GenerateResult => {
    const r = convertItem({ kind: 'short_answer', skill: 'grammar', prompt: 'Past of take?', acceptedAnswers: ['took'], explanation: '' }, 3)
    if (!r.ok) throw new Error(r.reason)
    return {
      draft: { title, instructions: '', rationale: '', contentLanguage: 'en', cefrLevel: 'A2', estimatedMinutes: 5, exercises: [r.ex] },
      meta: { model: 'fake', usage: { inputTokens: 0, outputTokens: 0 }, dropped: [], trimmedForTime: 0, solveBack: [], instructionsScriptOk: true, raw: {} },
    }
  }
  async function person(phone: string, name: string, role: 'teacher' | 'student' = 'student') {
    const [u] = await db.insert(users).values({ role, roles: [role], phone, fullName: name }).returning()
    if (role === 'student') await grantPlan(db, u!.id, 'vip', 365)
    return u!
  }
  async function answer(a: Awaited<ReturnType<typeof publishAssignment>>, studentId: string, value: string) {
    const at = await startAttempt(db, a, studentId)
    await saveAnswer(db, at, { exerciseId: (await loadExercises(db, a.id))[0]!.id, value, revision: 1 })
    await submitAttempt(db, at)
  }

  it('moves with each homework and shows who went up or down; students see it only when the teacher allows', async () => {
    const teacher = await person('+998900000001', 'Nodira', 'teacher')
    const draft = async (title: string) => createDraft(db, { teacherId: teacher.id, conversationId: null, instructionLocale: 'ko', difficulty: 3, result: result(title) })
    const h1 = await publishAssignment(db, await draft('HW1'), { newGroupName: '7-A' })
    const aziz = await person('+998900000002', 'Aziz Karimov')
    const malika = await person('+998900000003', 'Malika Tosheva')
    await answer(h1, aziz.id, 'took') // 100
    await answer(h1, malika.id, 'taked') // 0
    expect((await groupRanking(db, h1.groupId!)).map((r) => [r.name, r.place, r.change])).toEqual([
      ['Aziz Karimov', 1, null],
      ['Malika Tosheva', 2, null],
    ])

    const h2 = await publishAssignment(db, await draft('HW2'), { groupId: h1.groupId })
    await answer(h2, malika.id, 'took') // Malika 50, Aziz 100 (h2 still open for him)
    const h3 = await publishAssignment(db, await draft('HW3'), { groupId: h1.groupId })
    await answer(h3, malika.id, 'took') // h2 closed by h3: Aziz (100 + 0) / 2 = 50; Malika (0 + 100 + 100) / 3 = 67
    const now = await groupRanking(db, h1.groupId!)
    expect(now.map((r) => [r.name, r.place, r.score, r.change])).toEqual([
      ['Malika Tosheva', 1, 67, 1],
      ['Aziz Karimov', 2, 50, -1],
    ])

    expect(await studentRankings(db, aziz.id)).toEqual([])
    await updateGroup(db, teacher.id, h1.groupId!, { studentsSeeLeaderboard: true })
    const [seen] = await studentRankings(db, aziz.id)
    expect(seen!.rows.map((r) => [r.name, r.me])).toEqual([
      ['Malika T.', false],
      ['Aziz Karimov', true],
    ])
  })
})
