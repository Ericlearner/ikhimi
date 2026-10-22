import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestDb } from '@ikhimi/db/testing'
import { payments, users, type Db } from '@ikhimi/db'
import { convertItem, type GenerateResult } from '@ikhimi/ai'
import { parseVideoUrl } from '@/lib/video'
import { createDraft, publishAssignment, startAttempt } from './assignments'
import { addLesson, canView, courseAccess, coursePage, courseStats, createCourse, enrollFree, reorderLessons, loadLessons, setCourseGroups } from './courses'
import { createPlanPayment, markCancelled, markPaid } from './payments/core'
import { studentPlan } from './plans'

let db: Db
const env = { ...process.env }

const result = (): GenerateResult => {
  const r = convertItem({ kind: 'short_answer', skill: 'grammar', prompt: 'Past of go?', acceptedAnswers: ['went'], explanation: '' }, 1)
  if (!r.ok) throw new Error(r.reason)
  return {
    draft: { title: 'HW', instructions: '', rationale: '', contentLanguage: 'en', cefrLevel: 'A2', estimatedMinutes: 5, exercises: [r.ex] },
    meta: { model: 'fake', usage: { inputTokens: 0, outputTokens: 0 }, dropped: [], trimmedForTime: 0, solveBack: [], instructionsScriptOk: true, raw: {} },
  }
}
let n = 0
async function user(role: 'teacher' | 'student', name: string) {
  const [u] = await db.insert(users).values({ role, roles: [role], phone: `+9989000${String(++n).padStart(5, '0')}`, fullName: name }).returning()
  return u!
}

beforeEach(async () => {
  db = await createTestDb()
})
afterEach(() => {
  process.env = { ...env }
})

describe('video links', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&modestbranding=1&start=42'],
    ['youtu.be/dQw4w9WgXcQ', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&modestbranding=1'],
    ['https://youtube.com/shorts/dQw4w9WgXcQ', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&modestbranding=1'],
    ['https://vimeo.com/76979871', 'https://player.vimeo.com/video/76979871?dnt=1'],
    ['https://vimeo.com/76979871/a1b2c3d4e5', 'https://player.vimeo.com/video/76979871?dnt=1&h=a1b2c3d4e5'],
    ['https://player.vimeo.com/video/76979871?h=abcdef12', 'https://player.vimeo.com/video/76979871?dnt=1&h=abcdef12'],
  ])('%s', (input, embed) => expect(parseVideoUrl(input)?.embedUrl).toBe(embed))

  it('rejects anything else', () => {
    for (const bad of ['https://example.com/video.mp4', 'https://youtube.com/watch?v=short', 'not a url', '']) expect(parseVideoUrl(bad)).toBeNull()
  })
})

describe('courses', () => {
  it('free course: open → enrolled; lessons keep order; private hides from strangers', async () => {
    const t = await user('teacher', 'Nodira')
    const s = await user('student', 'Aziz')
    const c = await createCourse(db, t.id, { title: 'Ingliz tili A2', visibility: 'unlisted' })
    expect(c.slug).toMatch(/^ingliz-tili-a2-[a-z0-9]{4}$/)
    const l1 = await addLesson(db, c, { title: 'Oila', videoUrl: 'youtu.be/dQw4w9WgXcQ' })
    const l2 = await addLesson(db, c, { title: 'Uy', isPreview: true })
    await reorderLessons(db, c, [l2.id, l1.id])
    expect((await loadLessons(db, c.id)).map((l) => l.title)).toEqual(['Uy', 'Oila'])

    expect(await courseAccess(db, c, s.id)).toBe('open')
    await enrollFree(db, c, s.id)
    await enrollFree(db, c, s.id) // idempotent
    expect(await courseAccess(db, c, s.id)).toBe('enrolled')
    expect((await courseStats(db, [c.id])).get(c.id)).toEqual({ students: 1 })
  })

  it('courses are never sold: lessons open once joined, previews before; a private course is for its class', async () => {
    const t = await user('teacher', 'Nodira')
    const s = await user('student', 'Aziz')
    const g = await user('student', 'Malika')
    const hw = await publishAssignment(db, await createDraft(db, { teacherId: t.id, conversationId: null, instructionLocale: 'ko', difficulty: 3, result: result() }), { newGroup: { name: '9-B' } })
    await startAttempt(db, hw, g.id) // Malika is in 9-B
    const c = await createCourse(db, t.id, { title: 'IELTS', visibility: 'private' })
    expect(c.priceKrw).toBeNull()
    await addLesson(db, c, { title: 'Intro', videoUrl: 'youtu.be/dQw4w9WgXcQ', isPreview: true })
    await addLesson(db, c, { title: 'Past', videoUrl: 'youtu.be/dQw4w9WgXcQ', assignmentId: hw.id })

    const page = await coursePage(db, c, s.id)
    expect(page.access).toBe('open')
    expect(canView(c, page.access)).toBe(false) // private: strangers don't see it
    expect(page.lessons.map((l) => [l.open, !!l.video, !!l.homework, l.hasHomework])).toEqual([
      [true, true, false, false],
      [false, false, false, true],
    ])
    await setCourseGroups(db, c, [hw.groupId!])
    expect(await courseAccess(db, c, g.id)).toBe('group')
    await enrollFree(db, c, s.id)
    expect(await courseAccess(db, c, s.id)).toBe('enrolled')
  })
})

describe('payments', () => {
  // Pro for 3 months: 3 × 9 900 − 10% = 26 730, rounded to 26 700 won
  async function proOrder(provider: 'test') {
    const s = await user('student', 'Aziz')
    const { payment } = await createPlanPayment(db, { studentId: s.id, plan: 'pro', months: 3, provider })
    return { s, payment }
  }

  it('paid → plan; retries are harmless; refund removes it', async () => {
    const { s, payment } = await proOrder('test')
    expect(payment).toMatchObject({ amountKrw: 26_700, status: 'created' })
    await markPaid(db, payment.id)
    await markPaid(db, payment.id)
    expect(await studentPlan(db, s.id)).toBe('pro')
    await markCancelled(db, payment.id)
    expect(await studentPlan(db, s.id)).toBe('free')
    await expect(markPaid(db, payment.id)).rejects.toThrow('payment_closed')
  })
})
