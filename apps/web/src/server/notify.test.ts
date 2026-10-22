import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestDb } from '@ikhimi/db/testing'
import { assignments, enrollments, eq, pushDevices, users, type Db, type UserPrefs } from '@ikhimi/db'
import { convertItem, type GenerateResult } from '@ikhimi/ai'
import { createDraft, loadExercises, publishAssignment, saveAnswer, startAttempt, submitAttempt } from './assignments'
import { alertOwner, notifyDraftReady, notifyNewHomework, remindDueSoon, remindNotDone, saveTelegramSettings, telegramStats } from './notify'
import { studentDue } from './deadline'
import { grantPlan } from './plans'
import type { PushMessage, Pusher } from './push'

let db: Db
let sent: { chatId: string; text: string; markup?: unknown }[]
const bot = {
  async sendMessage(chatId: string, text: string, markup?: unknown) {
    sent.push({ chatId, text, markup })
  },
}
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

async function person(phone: string, name: string, opts: { chat?: string; prefs?: UserPrefs; role?: 'teacher' | 'student' } = {}) {
  const role = opts.role ?? 'student'
  const [u] = await db.insert(users).values({ role, roles: [role], phone, fullName: name, telegramChatId: opts.chat ?? null, prefs: opts.prefs ?? {} }).returning()
  if (role === 'student') await grantPlan(db, u!.id, 'vip', 365)
  return u!
}

let teacherId: string
const homework = async (title: string, input: Parameters<typeof publishAssignment>[2]) =>
  publishAssignment(db, await createDraft(db, { teacherId, conversationId: null, instructionLocale: 'ko', difficulty: 3, result: result(title) }), input)

/** A group with one student on Telegram, one who turned messages off, and one without Telegram */
async function classOfThree(dueDays: number | null = null) {
  const a = await homework('Past Simple', { newGroupName: '7-A', dueDays })
  const linked = await person('+998900000002', 'Aziz', { chat: '1001' })
  const quiet = await person('+998900000003', 'Malika', { chat: '1002', prefs: { notifications: { newAssignment: false, dueSoon: false } } })
  const offline = await person('+998900000004', 'Bobur')
  await db.insert(enrollments).values([linked, quiet, offline].map((s) => ({ groupId: a.groupId!, studentId: s.id })))
  return { a, linked, quiet, offline }
}

async function handIn(a: Awaited<ReturnType<typeof homework>>, studentId: string) {
  const at = await startAttempt(db, a, studentId)
  await saveAnswer(db, at, { exerciseId: (await loadExercises(db, a.id))[0]!.id, value: 'took', revision: 1 })
  await submitAttempt(db, at)
}

beforeEach(async () => {
  db = await createTestDb()
  sent = []
  pushed = []
  teacherId = (await person('+998900000001', 'Nodira Karimova', { role: 'teacher' })).id
})

describe('new homework', () => {
  it('reaches students with Telegram and messages on, once, saying where to find it (no link until the owner allows)', async () => {
    const { a } = await classOfThree()
    expect(await notifyNewHomework(db, a, { bot })).toEqual({ sent: 1 })
    expect(sent).toHaveLength(1)
    expect(sent[0]!.chatId).toBe('1001')
    expect(sent[0]!.text).toContain('Past Simple')
    expect(sent[0]!.text).toContain('Nodira Karimova')
    expect(sent[0]!.text).toContain('내 숙제')
    expect(sent[0]!.markup).toBeUndefined()
    // Publishing again (or a retry) never sends twice
    expect(await notifyNewHomework(db, a, { bot })).toEqual({ sent: 0 })
  })

  it('carries a button to the homework once links are on', async () => {
    const { a } = await classOfThree()
    await saveTelegramSettings(db, { links: true }, teacherId)
    const b = await homework('Irregular verbs', { groupId: a.groupId })
    await notifyNewHomework(db, b, { bot })
    expect(sent[0]!.markup).toMatchObject({ inline_keyboard: [[{ url: expect.stringContaining(`/t/${b.shareSlug}`) }]] })
  })
})

describe('the iOS app', () => {
  it('reaches a student without Telegram who has the app, once, and opens the homework', async () => {
    const { a, linked, quiet, offline } = await classOfThree()
    await db.insert(pushDevices).values([
      { token: 'aa'.repeat(32), userId: offline.id, env: 'production' },
      { token: 'bb'.repeat(32), userId: quiet.id, env: 'production' },
      { token: 'cc'.repeat(32), userId: linked.id, env: 'sandbox' },
    ])
    expect(await notifyNewHomework(db, a, { bot, push })).toEqual({ sent: 3 })
    expect(sent.map((m) => m.chatId)).toEqual(['1001'])
    // Malika turned new-homework messages off: the app keeps that too
    expect(pushed.map((m) => m.userId).sort()).toEqual([linked.id, offline.id].sort())
    expect(pushed[0]).toMatchObject({ body: expect.stringContaining('Past Simple'), url: `/t/${a.shareSlug}` })
    expect(await notifyNewHomework(db, a, { bot, push })).toEqual({ sent: 0 })
  })

  it("counts app users as reachable for the teacher's reminder, and works without the bot", async () => {
    const { a, offline } = await classOfThree()
    await db.insert(pushDevices).values({ token: 'aa'.repeat(32), userId: offline.id, env: 'production' })
    expect(await remindNotDone(db, a, new Date(), { bot: null, push })).toEqual({ sent: 1, already: 0, unreachable: 2, pending: 3 })
    expect(pushed.map((m) => m.userId)).toEqual([offline.id])
  })
})

describe('homework ready (the teacher left the Create screen)', () => {
  it('tells the teacher once, in Telegram and the iOS app, where to find the draft', async () => {
    const [t] = await db.update(users).set({ telegramChatId: '2001' }).where(eq(users.id, teacherId)).returning()
    await db.insert(pushDevices).values({ token: 'dd'.repeat(32), userId: t!.id, env: 'production' })
    const ready = { teacherId, runId: 'run1', assignmentId: 'a1', title: 'Past Simple' }
    expect(await notifyDraftReady(db, ready, { bot, push })).toEqual({ sent: 2 })
    expect(sent[0]).toMatchObject({ chatId: '2001', text: expect.stringContaining('초안') })
    expect(pushed[0]).toMatchObject({ userId: teacherId, url: '/app/a/a1', body: expect.stringContaining('Past Simple') })
    expect(await notifyDraftReady(db, ready, { bot, push })).toEqual({ sent: 0 })
  })
})

describe('admin stats', () => {
  it('counts students the bot can reach and what it sent this week', async () => {
    const { a } = await classOfThree()
    await notifyNewHomework(db, a, { bot })
    await remindNotDone(db, a, new Date(), { bot })
    expect(await telegramStats(db)).toMatchObject({ students: 3, linked: 2, sent: { new: 1, due: 0, nudge: 1, graded: 0, alert: 0 } })
  })
})

describe('due soon (daily job)', () => {
  it('reminds once, only those who have not handed it in, only for homework due within 30 hours', async () => {
    const { a, linked } = await classOfThree(1)
    // Three days: not yet
    await homework('Next week', { groupId: a.groupId, dueDays: 3 })
    const done = await homework('Done already', { groupId: a.groupId, dueDays: 1 })
    await handIn(done, linked.id)

    // The evening before: 20 hours before the end of tomorrow
    const now = new Date(studentDue(a)!.getTime() - 20 * 3600_000)
    expect(await remindDueSoon(db, now, { bot })).toEqual({ sent: 1 })
    expect(sent.map((m) => m.text)).toEqual([expect.stringContaining('Past Simple')])
    expect(await remindDueSoon(db, now, { bot })).toEqual({ sent: 0 })
  })
})

describe('due soon for a student who joined later', () => {
  it('follows their own deadline, not the group\'s', async () => {
    const { a } = await classOfThree(2)
    // Published ten days ago: the group's two days are long over, but these students only just joined
    const [old] = await db.update(assignments).set({ publishedAt: new Date(Date.now() - 10 * 86400_000) }).where(eq(assignments.id, a.id)).returning()
    const [member] = await db.select().from(enrollments).where(eq(enrollments.groupId, a.groupId!)).limit(1)
    const theirs = studentDue(old!, member!.joinedAt)!
    expect(theirs.getTime()).toBeGreaterThan(Date.now() + 86400_000)
    expect(await remindDueSoon(db, new Date(theirs.getTime() - 20 * 3600_000), { bot })).toEqual({ sent: 1 })
    expect(sent[0]!.chatId).toBe('1001')
  })
})

describe("the teacher's reminder", () => {
  it('reaches who it can, once a day, and says how many it cannot reach', async () => {
    const { a, linked } = await classOfThree()
    expect(await remindNotDone(db, a, new Date(), { bot })).toEqual({ sent: 1, already: 0, unreachable: 2, pending: 3 })
    expect(sent[0]!.chatId).toBe('1001')
    expect(await remindNotDone(db, a, new Date(), { bot })).toEqual({ sent: 0, already: 1, unreachable: 2, pending: 3 })
    await handIn(a, linked.id)
    expect(await remindNotDone(db, a, new Date(), { bot })).toMatchObject({ pending: 2, sent: 0 })
  })
})

describe('alerts to the owner', () => {
  const before = process.env.OWNER_PHONES
  afterEach(() => {
    process.env.OWNER_PHONES = before
  })

  it("go to the owner's Telegram, at most once an hour per topic", async () => {
    process.env.OWNER_PHONES = '+998900000099'
    await person('+998900000099', 'Owner', { chat: '9999', role: 'teacher' })
    const now = new Date('2026-10-08T10:15:00Z')
    expect(await alertOwner(db, 'api:POST /api/x', 'boom', { bot, now })).toBe(true)
    expect(sent).toEqual([{ chatId: '9999', text: "⚠️ 익히미: boom", markup: undefined }])
    expect(await alertOwner(db, 'api:POST /api/x', 'boom again', { bot, now: new Date('2026-10-08T10:50:00Z') })).toBe(false)
    expect(await alertOwner(db, 'api:POST /api/y', 'other', { bot, now })).toBe(true)
    expect(await alertOwner(db, 'api:POST /api/x', 'next hour', { bot, now: new Date('2026-10-08T11:05:00Z') })).toBe(true)
  })
})
