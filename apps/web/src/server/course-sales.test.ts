import { beforeEach, describe, expect, it } from 'vitest'
import { createTestDb } from '@ikhimi/db/testing'
import { enrollments, eq, users, type Db } from '@ikhimi/db'
import { convertItem, type GenerateResult } from '@ikhimi/ai'
import { checkAnswer, createDraft, loadExercises, publishAssignment, startAttempt } from './assignments'
import { homeworkPlan } from './course-plans'
import { addLesson, canView, catalog, courseAccess, coursePage, createCourse, isPublished, reviewCourse, setCourseGroups, submitCourse, updateCourse, type CourseRow } from './courses'
import { teacherEarnings } from './earnings'
import { createCoursePayment, markCancelled, markPaid } from './payments/core'
import { grantPlan } from './plans'

let db: Db
let n = 0

/** A homework with one vocabulary item (Free) and one grammar item (Pro) */
const result = (): GenerateResult => {
  const vocab = convertItem({ kind: 'short_answer', skill: 'vocabulary', prompt: 'Opposite of hot?', acceptedAnswers: ['cold'], explanation: '' }, 1)
  const grammar = convertItem({ kind: 'short_answer', skill: 'grammar', prompt: 'Past of go?', acceptedAnswers: ['went'], explanation: '' }, 1)
  if (!vocab.ok || !grammar.ok) throw new Error('item')
  return {
    draft: { title: 'HW', instructions: '', rationale: '', contentLanguage: 'en', cefrLevel: 'A2', estimatedMinutes: 5, exercises: [vocab.ex, grammar.ex] },
    meta: { model: 'fake', usage: { inputTokens: 0, outputTokens: 0 }, dropped: [], trimmedForTime: 0, solveBack: [], instructionsScriptOk: true, raw: {} },
  }
}

async function user(role: 'teacher' | 'student', name: string) {
  const [u] = await db.insert(users).values({ role, roles: [role], phone: `+9989100${String(++n).padStart(5, '0')}`, fullName: name }).returning()
  return u!
}

/** A teacher, a homework of their class "9-B", and a course with it as a lesson, approved and open by link */
async function setup(priceKrw: number | null) {
  const t = await user('teacher', 'Nodira')
  const hw = await publishAssignment(db, await createDraft(db, { teacherId: t.id, conversationId: null, instructionLocale: 'ko', difficulty: 3, result: result() }), { newGroup: { name: '9-B' } })
  let c: CourseRow = await createCourse(db, t.id, { title: 'IELTS 6.5', visibility: 'unlisted' })
  await addLesson(db, c, { title: 'Intro', videoUrl: 'youtu.be/dQw4w9WgXcQ', isPreview: true })
  await addLesson(db, c, { title: 'Past', videoUrl: 'youtu.be/dQw4w9WgXcQ', assignmentId: hw.id })
  c = await updateCourse(db, c, { priceKrw })
  c = (await db.query.courses.findFirst({ where: (x, { eq: e }) => e(x.id, c.id) }))!
  expect(await submitCourse(db, c)).toEqual({ ok: true })
  c = await reviewCourse(db, c, t.id, 'approve', null)
  return { t, hw, c }
}

beforeEach(async () => {
  db = await createTestDb()
})

describe('publishing needs the admin, once', () => {
  it('draft → sent → approved; strangers see it only then; later changes need no new approval', async () => {
    const t = await user('teacher', 'Nodira')
    const s = await user('student', 'Aziz')
    let c: CourseRow = await createCourse(db, t.id, { title: 'A2', visibility: 'private' })
    expect(await submitCourse(db, c)).toEqual({ ok: false, reason: 'private' })
    c = await updateCourse(db, c, { visibility: 'marketplace' })
    expect(await submitCourse(db, c)).toEqual({ ok: false, reason: 'no_lessons' })
    await addLesson(db, c, { title: 'One', videoUrl: 'youtu.be/dQw4w9WgXcQ' })
    c = (await db.query.courses.findFirst({ where: (x, { eq: e }) => e(x.id, c.id) }))!
    expect(await submitCourse(db, c)).toEqual({ ok: true })
    c = (await db.query.courses.findFirst({ where: (x, { eq: e }) => e(x.id, c.id) }))!
    expect(c.reviewStatus).toBe('pending')
    expect(canView(c, await courseAccess(db, c, s.id))).toBe(false)
    expect(await catalog(db)).toEqual([])

    c = await reviewCourse(db, c, t.id, 'return', 'Videos are missing sound')
    expect(c).toMatchObject({ reviewStatus: 'returned', reviewNote: 'Videos are missing sound' })
    expect(isPublished(c)).toBe(false)
    expect(await submitCourse(db, c)).toEqual({ ok: true })
    c = (await db.query.courses.findFirst({ where: (x, { eq: e }) => e(x.id, c.id) }))!
    c = await reviewCourse(db, c, t.id, 'approve', null)
    expect(isPublished(c)).toBe(true)
    expect(canView(c, await courseAccess(db, c, s.id))).toBe(true)
    expect((await catalog(db)).map((x) => x.title)).toEqual(['A2'])

    // Approved once: a price, private and back again, all without a new approval
    c = await updateCourse(db, c, { priceKrw: 120_000, visibility: 'private' })
    c = await updateCourse(db, c, { visibility: 'unlisted' })
    expect(c.reviewStatus).toBe('approved')
    expect(await submitCourse(db, c)).toEqual({ ok: false, reason: 'already' })
  })
})

describe('which plan a course homework is done on', () => {
  it('a paid course: non-buyers (even VIP) get only the vocabulary; a buyer on Free gets everything', async () => {
    const { t, hw, c } = await setup(150_000)
    const vip = await user('student', 'Malika')
    await grantPlan(db, vip.id, 'vip', 30)
    const buyer = await user('student', 'Aziz')

    expect(await homeworkPlan(db, vip.id, hw)).toEqual({ plan: 'free', course: { slug: c.slug, title: 'IELTS 6.5' } })
    const at = await startAttempt(db, hw, vip.id)
    const [vocab, grammar] = await loadExercises(db, hw.id)
    expect(await checkAnswer(db, at, hw, { exerciseId: grammar!.id, value: 'went', revision: 1 })).toEqual({ ok: false, reason: 'plan' })
    expect(await checkAnswer(db, at, hw, { exerciseId: vocab!.id, value: 'cold', revision: 1 })).toMatchObject({ ok: true })
    // Opening a lesson of a published course doesn't put a stranger into the teacher's class
    expect(await db.select().from(enrollments).where(eq(enrollments.studentId, vip.id))).toEqual([])

    // The course page before buying: a taste of every lesson's homework, videos only in the preview
    const before = await coursePage(db, c, buyer.id)
    expect(before.buy).toBe(true)
    expect(before.lessons.map((l) => [l.open, l.enter, !!l.video, !!l.homework])).toEqual([
      [true, true, true, false],
      [false, true, false, true],
    ])

    const { payment } = await createCoursePayment(db, { studentId: buyer.id, courseId: c.id, provider: 'test' })
    // 60% of 150 000 to the teacher
    expect(payment).toMatchObject({ amountKrw: 150_000, commissionTeacherId: t.id, commissionKrw: 90_000 })
    expect(await homeworkPlan(db, buyer.id, hw)).toMatchObject({ plan: 'free' })
    await markPaid(db, payment.id)
    expect(await courseAccess(db, c, buyer.id)).toBe('bought')
    expect(await homeworkPlan(db, buyer.id, hw)).toEqual({ plan: 'vip', course: null })
    expect((await coursePage(db, c, buyer.id)).lessons.every((l) => l.open)).toBe(true)
    await expect(createCoursePayment(db, { studentId: buyer.id, courseId: c.id, provider: 'test' })).rejects.toThrow('already_bought')
    await expect(createCoursePayment(db, { studentId: t.id, courseId: c.id, provider: 'test' })).rejects.toThrow('own_course')

    // Taken down later: the buyer keeps it; others are back on their own plan
    const down = await reviewCourse(db, c, t.id, 'return', null)
    expect(await homeworkPlan(db, buyer.id, hw)).toMatchObject({ plan: 'vip' })
    expect(await homeworkPlan(db, vip.id, hw)).toMatchObject({ plan: 'vip', course: null })
    await expect(createCoursePayment(db, { studentId: vip.id, courseId: down.id, provider: 'test' })).rejects.toThrow('not_for_sale')

    // A refund takes it back (and the teacher's share)
    await markCancelled(db, payment.id)
    expect(await courseAccess(db, c, buyer.id)).toBe('open')
    expect((await teacherEarnings(db, t.id)).totalKrw).toBe(0)
  })

  it("the homework's own class does it on their own plan; a class linked to the course gets it in full", async () => {
    const { t, hw, c } = await setup(150_000)
    const classmate = await user('student', 'Bobur')
    await db.insert(enrollments).values({ groupId: hw.groupId!, studentId: classmate.id })
    expect(await homeworkPlan(db, classmate.id, hw)).toEqual({ plan: 'free', course: null })
    await grantPlan(db, classmate.id, 'pro', 30)
    expect(await homeworkPlan(db, classmate.id, hw)).toEqual({ plan: 'pro', course: null })

    // Another class of the teacher's, linked to the course: free, in full
    const other = await publishAssignment(db, await createDraft(db, { teacherId: t.id, conversationId: null, instructionLocale: 'ko', difficulty: 3, result: result() }), { newGroup: { name: '10-A' } })
    const linked = await user('student', 'Dilnoza')
    await db.insert(enrollments).values({ groupId: other.groupId!, studentId: linked.id })
    await setCourseGroups(db, c, [other.groupId!])
    expect(await courseAccess(db, c, linked.id)).toBe('group')
    expect(await homeworkPlan(db, linked.id, hw)).toEqual({ plan: 'vip', course: null })
  })

  it('a plan-covered course follows each student\'s own plan, like homework', async () => {
    const { hw, c } = await setup(null)
    const free = await user('student', 'Aziz')
    const vip = await user('student', 'Malika')
    await grantPlan(db, vip.id, 'vip', 30)
    expect(await homeworkPlan(db, free.id, hw)).toEqual({ plan: 'free', course: null })
    expect(await homeworkPlan(db, vip.id, hw)).toEqual({ plan: 'vip', course: null })
    expect((await coursePage(db, c, free.id)).buy).toBe(false)
    await expect(createCoursePayment(db, { studentId: free.id, courseId: c.id, provider: 'test' })).rejects.toThrow('not_for_sale')
  })

  it("a course sale records the teacher's share; a test payment never counts as earnings", async () => {
    const { t, c } = await setup(200_000)
    const s = await user('student', 'Aziz')
    // Only the test provider exists until a gateway is connected
    const { payment } = await createCoursePayment(db, { studentId: s.id, courseId: c.id, provider: 'test' })
    expect(payment).toMatchObject({ commissionTeacherId: t.id, commissionKrw: 120_000, amountKrw: 200_000 })
    await markPaid(db, payment.id)
    expect((await teacherEarnings(db, t.id)).totalKrw).toBe(0)
  })
})
