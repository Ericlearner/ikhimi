import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestDb } from '@ikhimi/db/testing'
import { assignments, enrollments, eq, pushDevices, users, type Db, type UserPrefs } from '@ikhimi/db'
import { convertItem, type GenerateResult } from '@ikhimi/ai'
import { createDraft, loadExercises, publishAssignment, saveAnswer, startAttempt, submitAttempt } from './assignments'
import { alertOwner, notificationStats, notifyDraftReady, notifyNewHomework, remindDueSoon, remindNotDone } from './notify'
import { studentDue } from './deadline'
import { grantPlan } from './plans'
import type { PushMessage, Pusher } from './push'

let db: Db
let pushed: PushMessage[]
const push: Pusher = {
  async send(_db, messages) {
    pushed.push(...messages)
    return messages.length
  },
}

const result = (title: string): GenerateResult => {
  const r = convertItem({ kind: 'short_answer', skill: 'vocabulary', prompt: 'Past of take?', acceptedAnswers: ['took'], explanation: '' }, 3)
  if (!r.ok) throw new Error(r.reason)
  return {
    draft: { title, instructions: '', rationale: '', contentLanguage: 'en', cefrLevel: 'A2', estimatedMinutes: 5, exercises: [r.ex] },
    meta: { model: 'fake', usage: { inputTokens: 0, outputTokens: 0 }, dropped: [], trimmedForTime: 0, solveBack: [], instructionsScriptOk: true, raw: {} },
  }
}

let devices = 0
/** Someone, with the iOS app (notifications on) when `app` */
async function person(key: string, name: string, opts: { app?: boolean; email?: string; prefs?: UserPrefs; role?: 'teacher' | 'student' } = {}) {
  const role = opts.role ?? 'student'
  const [u] = await db.insert(users).values({ role, roles: [role], phone: `google:${key}`, email: opts.email ?? null, fullName: name, prefs: opts.prefs ?? {} }).returning()
  if (opts.app) await db.insert(pushDevices).values({ token: String(++devices).padStart(64, '0'), userId: u!.id, env: 'production' })
  if (role === 'student') await grantPlan(db, u!.id, 'vip', 365)
  return u!
}

let teacherId: string
const homework = async (title: string, input: Parameters<typeof publishAssignment>[2]) =>
  publishAssignment(db, await createDraft(db, { teacherId, conversationId: null, instructionLocale: 'ko', difficulty: 3, result: result(title) }), input)

/** A group with one student who has the app, one who turned notifications off, and one without the app */
async function classOfThree(dueDays: number | null = null) {
  const a = await homework('Past Simple', { newGroupName: '7-A', dueDays })
  const withApp = await person('s2', 'Aziz', { app: true })
  const quiet = await person('s3', 'Malika', { app: true, prefs: { notifications: { newAssignment: false, dueSoon: false } } })
  const noApp = await person('s4', 'Bobur')
  await db.insert(enrollments).values([withApp, quiet, noApp].map((s) => ({ groupId: a.groupId!, studentId: s.id })))
  return { a, withApp, quiet, noApp }
}

async function handIn(a: Awaited<ReturnType<typeof homework>>, studentId: string) {
  const at = await startAttempt(db, a, studentId)
  await saveAnswer(db, at, { exerciseId: (await loadExercises(db, a.id))[0]!.id, value: 'took', revision: 1 })
  await submitAttempt(db, at)
}

beforeEach(async () => {
  db = await createTestDb()
  pushed = []
  teacherId = (await person('t1', 'Nodira Karimova', { role: 'teacher' })).id
})

describe('new homework', () => {
  it('reaches students with the app and notifications on, once, and opens the homework', async () => {
    const { a, withApp } = await classOfThree()
    expect(await notifyNewHomework(db, a, { push })).toEqual({ sent: 1 })
    expect(pushed).toHaveLength(1)
    expect(pushed[0]).toMatchObject({ userId: withApp.id, url: `/t/${a.shareSlug}` })
    expect(pushed[0]!.body).toContain('Past Simple')
    expect(pushed[0]!.body).toContain('Nodira Karimova')
    // Publishing again (or a retry) never sends twice
    expect(await notifyNewHomework(db, a, { push })).toEqual({ sent: 0 })
  })

  it('sends nothing without the Apple key', async () => {
    const { a } = await classOfThree()
    expect(await notifyNewHomework(db, a, { push: null })).toEqual({ sent: 0 })
  })
})

describe('homework ready (the teacher left the Create screen)', () => {
  it('tells the teacher once, in the iOS app', async () => {
    await db.insert(pushDevices).values({ token: 'dd'.repeat(32), userId: teacherId, env: 'production' })
    const ready = { teacherId, runId: 'run1', assignmentId: 'a1', title: 'Past Simple' }
    expect(await notifyDraftReady(db, ready, { push })).toEqual({ sent: 1 })
    expect(pushed[0]).toMatchObject({ userId: teacherId, url: '/app/a/a1', body: expect.stringContaining('Past Simple') })
    expect(await notifyDraftReady(db, ready, { push })).toEqual({ sent: 0 })
  })
})

describe('admin stats', () => {
  it('counts students the app can reach and what was sent this week', async () => {
    const { a } = await classOfThree()
    await notifyNewHomework(db, a, { push })
    await remindNotDone(db, a, new Date(), { push })
    expect(await notificationStats(db)).toMatchObject({ students: 3, withApp: 2, sent: { new: 1, due: 0, nudge: 1, graded: 0, alert: 0 } })
  })
})

describe('due soon (daily job)', () => {
  it('reminds once, only those who have not handed it in, only for homework due within 30 hours', async () => {
    const { a, withApp } = await classOfThree(1)
    // Three days: not yet
    await homework('Next week', { groupId: a.groupId, dueDays: 3 })
    const done = await homework('Done already', { groupId: a.groupId, dueDays: 1 })
    await handIn(done, withApp.id)

    // The evening before: 20 hours before the end of tomorrow
    const now = new Date(studentDue(a)!.getTime() - 20 * 3600_000)
    expect(await remindDueSoon(db, now, { push })).toEqual({ sent: 1 })
    expect(pushed.map((m) => m.body)).toEqual([expect.stringContaining('Past Simple')])
    expect(await remindDueSoon(db, now, { push })).toEqual({ sent: 0 })
  })
})

describe('due soon for a student who joined later', () => {
  it('follows their own deadline, not the group\'s', async () => {
    const { a, withApp } = await classOfThree(2)
    // Published ten days ago: the group's two days are long over, but these students only just joined
    const [old] = await db.update(assignments).set({ publishedAt: new Date(Date.now() - 10 * 86400_000) }).where(eq(assignments.id, a.id)).returning()
    const [member] = await db.select().from(enrollments).where(eq(enrollments.groupId, a.groupId!)).limit(1)
    const theirs = studentDue(old!, member!.joinedAt)!
    expect(theirs.getTime()).toBeGreaterThan(Date.now() + 86400_000)
    expect(await remindDueSoon(db, new Date(theirs.getTime() - 20 * 3600_000), { push })).toEqual({ sent: 1 })
    expect(pushed[0]!.userId).toBe(withApp.id)
  })
})

describe("the teacher's reminder", () => {
  it('reaches who it can, once a day, and says how many it cannot reach', async () => {
    const { a, withApp } = await classOfThree()
    expect(await remindNotDone(db, a, new Date(), { push })).toEqual({ sent: 1, already: 0, unreachable: 2, pending: 3 })
    expect(pushed[0]!.userId).toBe(withApp.id)
    expect(await remindNotDone(db, a, new Date(), { push })).toEqual({ sent: 0, already: 1, unreachable: 2, pending: 3 })
    await handIn(a, withApp.id)
    expect(await remindNotDone(db, a, new Date(), { push })).toMatchObject({ pending: 2, sent: 0 })
  })

  it('without the Apple key nobody can be reached', async () => {
    const { a } = await classOfThree()
    expect(await remindNotDone(db, a, new Date(), { push: null })).toEqual({ sent: 0, already: 0, unreachable: 3, pending: 3 })
  })
})

describe('alerts to the owner', () => {
  const before = process.env.OWNER_EMAILS
  afterEach(() => {
    process.env.OWNER_EMAILS = before
  })

  it("go to the owner's iOS app, at most once an hour per topic", async () => {
    process.env.OWNER_EMAILS = 'owner@gmail.com'
    const owner = await person('o1', 'Owner', { app: true, email: 'owner@gmail.com', role: 'teacher' })
    const now = new Date('2026-10-08T10:15:00Z')
    expect(await alertOwner(db, 'api:POST /api/x', 'boom', { push, now })).toBe(true)
    expect(pushed).toEqual([{ userId: owner.id, body: '⚠️ 익히미: boom', url: '/admin/health' }])
    expect(await alertOwner(db, 'api:POST /api/x', 'boom again', { push, now: new Date('2026-10-08T10:50:00Z') })).toBe(false)
    expect(await alertOwner(db, 'api:POST /api/y', 'other', { push, now })).toBe(true)
    expect(await alertOwner(db, 'api:POST /api/x', 'next hour', { push, now: new Date('2026-10-08T11:05:00Z') })).toBe(true)
  })

  it('without the owner on the app, an alert is only logged', async () => {
    process.env.OWNER_EMAILS = 'owner@gmail.com'
    await person('o1', 'Owner', { email: 'owner@gmail.com', role: 'teacher' })
    expect(await alertOwner(db, 'api:POST /api/x', 'boom', { push })).toBe(false)
    expect(pushed).toEqual([])
  })
})
