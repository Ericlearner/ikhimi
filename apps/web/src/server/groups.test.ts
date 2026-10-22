import { beforeEach, describe, expect, it } from 'vitest'
import { createTestDb } from '@ikhimi/db/testing'
import { assignments, eq, groups, notificationLog, users, type Db } from '@ikhimi/db'
import { convertItem, type GenerateResult } from '@ikhimi/ai'
import { buildReport, checkAnswer, copyToGroup, createDraft, loadExercises, publishAssignment, setDueDays, startAttempt, submitAttempt } from './assignments'
import { endOfDayAfter } from './deadline'
import { groupDetailsSchema, groupOverview, joinGroupByCode, updateGroup } from './groups'
import { claim } from './notify'
import { studentHomeworkByCourse } from './profiles'
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

async function user(role: 'teacher' | 'student', phone: string, name: string) {
  const [u] = await db.insert(users).values({ role, roles: [role], phone, fullName: name }).returning()
  // Grading tests: the student sees every item (plans are tested in plans.test.ts)
  await grantPlan(db, u!.id, 'vip', 365)
  return u!
}
const draft = (teacherId: string) => createDraft(db, { teacherId, conversationId: null, instructionLocale: 'ko', difficulty: 3, result: result() })

beforeEach(async () => {
  db = await createTestDb()
})

describe('groups', () => {
  it('publishing into a new group stores its details; later homework joins the same group', async () => {
    const teacher = await user('teacher', '+998900000021', 'Nodira')
    const s = await user('student', '+998900000022', 'Aziz')
    const details = groupDetailsSchema.parse({ name: ' IELTS 6.5 ', cefrLevel: 'B2', startDate: '2026-10-01', expectedStudents: 12, description: 'Mon/Wed 16:00' })
    const a1 = await publishAssignment(db, await draft(teacher.id), { newGroup: details })
    const at = await startAttempt(db, a1, s.id)
    await checkAnswer(db, at, a1, { exerciseId: (await loadExercises(db, a1.id))[0]!.id, value: 'took', revision: 1 })
    await submitAttempt(db, at)
    await publishAssignment(db, await draft(teacher.id), { groupId: a1.groupId })

    const o = await groupOverview(db, teacher.id, a1.groupId!)
    expect(o!.group).toMatchObject({ name: 'IELTS 6.5', cefrLevel: 'B2', startDate: '2026-10-01', expectedStudents: 12, description: 'Mon/Wed 16:00' })
    expect(o!.published).toBe(2)
    expect(o!.students).toEqual([{ id: s.id, name: 'Aziz', done: 1, average: 100 }])
    expect(o!.average).toBe(100)
  })

  it('only the owning teacher can see or edit a group', async () => {
    const teacher = await user('teacher', '+998900000031', 'Nodira')
    const other = await user('teacher', '+998900000032', 'Other')
    const a = await publishAssignment(db, await draft(teacher.id), { newGroup: { name: '7-A' } })
    expect(await groupOverview(db, other.id, a.groupId!)).toBeNull()
    expect(await updateGroup(db, other.id, a.groupId!, { name: 'hacked' })).toBeNull()
    const g = await updateGroup(db, teacher.id, a.groupId!, { name: '7-B', expectedStudents: 20, description: '' })
    expect(g).toMatchObject({ name: '7-B', expectedStudents: 20, description: null })
  })

  it('gives a published homework to another group: a copy with its own link and results, nothing generated', async () => {
    const teacher = await user('teacher', '+998900000041', 'Nodira')
    const other = await user('teacher', '+998900000042', 'Other')
    const s = await user('student', '+998900000043', 'Aziz')
    const a = await publishAssignment(db, await draft(teacher.id), { newGroup: { name: '7-A' }, dueDays: 3 })
    const at = await startAttempt(db, a, s.id)
    await checkAnswer(db, at, a, { exerciseId: (await loadExercises(db, a.id))[0]!.id, value: 'took', revision: 1 })
    await submitAttempt(db, at)

    const copy = await copyToGroup(db, a, { newGroup: { name: '7-B' }, dueDays: 7 })
    expect(copy).toMatchObject({ status: 'published', title: a.title, teacherId: teacher.id, dueDays: 7 })
    expect(copy.id).not.toBe(a.id)
    expect(copy.shareSlug).not.toBe(a.shareSlug)
    expect(copy.groupId).not.toBe(a.groupId)
    const [orig, copied] = [await loadExercises(db, a.id), await loadExercises(db, copy.id)]
    expect(copied.map((e) => [e.kind, e.prompt, e.answerKey])).toEqual(orig.map((e) => [e.kind, e.prompt, e.answerKey]))
    // Results start empty in the new group; the first group's stay where they were
    expect((await groupOverview(db, teacher.id, copy.groupId!))!.students).toEqual([])
    expect((await groupOverview(db, teacher.id, a.groupId!))!.students).toHaveLength(1)

    await expect(copyToGroup(db, a, { groupId: a.groupId })).rejects.toThrow('same_group')
    const theirs = await publishAssignment(db, await draft(other.id), { newGroup: { name: 'Theirs' } })
    await expect(copyToGroup(db, a, { groupId: theirs.groupId })).rejects.toThrow('group_not_owned')
    await expect(copyToGroup(db, await draft(teacher.id), { groupId: copy.groupId })).rejects.toThrow('not_published')
  })

  it('rejects bad details', () => {
    expect(groupDetailsSchema.safeParse({ name: '  ' }).success).toBe(false)
    expect(groupDetailsSchema.safeParse({ name: 'A', startDate: '01.10.2026' }).success).toBe(false)
    expect(groupDetailsSchema.safeParse({ name: 'A', cefrLevel: 'Z9' }).success).toBe(false)
  })
})

describe('joining a group by its code', () => {
  it('enrols the student, who then sees the group\'s homework; a second time changes nothing', async () => {
    const teacher = await user('teacher', '+998900000041', 'Nodira')
    const s = await user('student', '+998900000042', 'Aziz')
    const a = await publishAssignment(db, await draft(teacher.id), { newGroup: { name: 'IELTS kechki' } })
    const [g] = await db.select().from(groups).where(eq(groups.id, a.groupId!))

    // Typed in lower case with a space: still the code
    const typed = `${g!.joinCode.slice(0, 3).toLowerCase()} ${g!.joinCode.slice(3)}`
    expect(await joinGroupByCode(db, s.id, typed)).toMatchObject({ ok: true, already: false, group: { name: 'IELTS kechki', teacherName: 'Nodira' } })
    expect(await joinGroupByCode(db, s.id, g!.joinCode)).toMatchObject({ ok: true, already: true })
    const mine = await studentHomeworkByCourse(db, s.id)
    expect(mine.courses.map((c) => [c.name, c.items.map((i) => i.id)])).toEqual([['IELTS kechki', [a.id]]])
    expect((await groupOverview(db, teacher.id, a.groupId!))!.students.map((x) => x.name)).toEqual(['Aziz'])
  })

  it('refuses a malformed or wrong code (as often as it is typed), an archived group and the teacher\'s own', async () => {
    const teacher = await user('teacher', '+998900000043', 'Nodira')
    const s = await user('student', '+998900000044', 'Aziz')
    const a = await publishAssignment(db, await draft(teacher.id), { newGroup: { name: '7-A' } })
    const [g] = await db.select().from(groups).where(eq(groups.id, a.groupId!))

    expect(await joinGroupByCode(db, s.id, 'AB')).toEqual({ ok: false, reason: 'invalid_code' })
    const wrong = g!.joinCode === 'ZZZZZZ' ? 'YYYYYY' : 'ZZZZZZ'
    for (let i = 0; i < 15; i++) expect(await joinGroupByCode(db, s.id, wrong)).toEqual({ ok: false, reason: 'code_not_found' })
    expect(await joinGroupByCode(db, teacher.id, g!.joinCode)).toEqual({ ok: false, reason: 'own_group' })
    await db.update(groups).set({ archivedAt: new Date() }).where(eq(groups.id, g!.id))
    expect(await joinGroupByCode(db, s.id, g!.joinCode)).toEqual({ ok: false, reason: 'code_not_found' })
    await db.update(groups).set({ archivedAt: null }).where(eq(groups.id, g!.id))
    expect(await joinGroupByCode(db, s.id, g!.joinCode)).toMatchObject({ ok: true, already: false })
  })
})

describe('deadlines are durations', () => {
  it('ends at 23:59 Seoul on the last day', () => {
    // 15:00 in Seoul on 20 Oct, two days → 23:59 on 22 Oct (14:59 UTC)
    expect(endOfDayAfter(new Date('2026-10-20T06:00:00Z'), 2)).toEqual(new Date('2026-10-22T14:59:00Z'))
    // 02:00 in Seoul on 21 Oct is still 20 Oct in UTC: Seoul's day counts
    expect(endOfDayAfter(new Date('2026-10-20T17:00:00Z'), 1)).toEqual(new Date('2026-10-22T14:59:00Z'))
  })

  it('each student gets the whole duration from when the homework reached them; a late joiner is not late', async () => {
    const teacher = await user('teacher', '+998900000051', 'Nodira')
    const early = await user('student', '+998900000052', 'Aziz')
    const late = await user('student', '+998900000053', 'Malika')
    const a = await publishAssignment(db, await draft(teacher.id), { newGroup: { name: '9-B' }, dueDays: 2 })
    // Published "five days ago": the group's two days are over
    const published = new Date(Date.now() - 5 * 86400_000)
    const [old] = await db.update(assignments).set({ publishedAt: published }).where(eq(assignments.id, a.id)).returning()
    const [g] = await db.select().from(groups).where(eq(groups.id, a.groupId!))
    // Aziz was in the group before it was published; Malika joins today with the code
    await joinGroupByCode(db, early.id, g!.joinCode, new Date(published.getTime() - 86400_000))
    await joinGroupByCode(db, late.id, g!.joinCode)

    expect((await studentHomeworkByCourse(db, early.id)).courses[0]!.items[0]!.dueAt).toEqual(endOfDayAfter(published, 2))
    const hers = (await studentHomeworkByCourse(db, late.id)).courses[0]!.items[0]!.dueAt!
    // Her two days run from today
    expect(hers.getTime()).toBeGreaterThan(Date.now() + 86400_000)
    expect(hers.getTime()).toBeLessThanOrEqual(endOfDayAfter(new Date(), 2).getTime())

    // Both hand it in now, with the same score: only Aziz is late, so Malika's effort is higher
    const ex = (await loadExercises(db, a.id))[0]!
    for (const s of [early, late]) {
      const at = await startAttempt(db, old!, s.id)
      await checkAnswer(db, at, old!, { exerciseId: ex.id, value: 'took', revision: 1 })
      await submitAttempt(db, at)
    }
    const report = await buildReport(db, old!)
    const effort = (id: string) => report.students.find((x) => x.studentId === id)!.effort
    expect(effort(late.id) - effort(early.id)).toBe(25)
  })

  it('the teacher changes or removes the duration; the "due tomorrow" reminder may go again', async () => {
    const teacher = await user('teacher', '+998900000054', 'Nodira')
    const d = await draft(teacher.id)
    await expect(setDueDays(db, d, 3)).rejects.toThrow('not_published')
    const a = await publishAssignment(db, d, { newGroup: { name: '9-B' }, dueDays: 1 })
    expect(a.dueAt).toEqual(endOfDayAfter(a.publishedAt!, 1))
    await claim(db, `due:${a.id}:someone`)
    await claim(db, 'due:other:someone')

    const changed = await setDueDays(db, a, 7)
    expect(changed).toMatchObject({ dueDays: 7, dueAt: endOfDayAfter(a.publishedAt!, 7) })
    expect((await db.select().from(notificationLog)).map((r) => r.key)).toEqual(['due:other:someone'])
    expect(await setDueDays(db, a, null)).toMatchObject({ dueDays: null, dueAt: null })
  })
})
