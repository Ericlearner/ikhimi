import { afterEach, describe, expect, it } from 'vitest'
import { createTestDb } from '@ikhimi/db/testing'
import { aiCalls, assignments, generationRuns, staffMembers, staffRoles, teacherProfiles, users } from '@ikhimi/db'
import type { LlmProvider } from '@ikhimi/ai'
import { costUsd, metered, priceFor } from '../ai-usage'
import { createSession, validateSessionToken } from '../auth/session'
import { maskForStaff } from './permissions'
import { audit, can, isFresh, staffAccess } from './staff'
import { auditLog, businessStats, healthStats, homeworkDetail, moneyStats, recentHomework, searchUsers, staffOverview, userDetail, RUN_TIMEOUT_MS } from './stats'

const OWNER = 'owner@gmail.com'
afterEach(() => {
  delete process.env.OWNER_EMAILS
  delete process.env.AI_PRICES
})

async function setup() {
  const db = await createTestDb()
  // Accounts as Google makes them: the sign-in key and the verified email
  const add = async (email: string, fullName: string, role: 'teacher' | 'student' = 'teacher') =>
    (await db.insert(users).values({ role, roles: [role], phone: `google:${email}`, email, fullName }).returning())[0]!
  return { db, add }
}

describe('staff access', () => {
  it('owners come from OWNER_EMAILS and can do everything, staff included', async () => {
    const { db, add } = await setup()
    process.env.OWNER_EMAILS = ` Owner@Gmail.com , other@example.com, not-an-email`
    const owner = await add(OWNER, 'Owner')
    const a = (await staffAccess(db, owner))!
    expect(a.owner).toBe(true)
    expect(can(a, 'staff')).toBe(true)
    expect(can(a, 'users.email')).toBe(true)
    expect(await staffAccess(db, await add('teacher@gmail.com', 'Teacher'))).toBeNull()
    // An account without an email (Apple, hidden) is never staff
    expect(await staffAccess(db, { ...owner, email: null })).toBeNull()
  })

  it('an assistant gets exactly their role, loses it when removed or blocked, never manages staff', async () => {
    const { db, add } = await setup()
    const [role] = await db.insert(staffRoles).values({ name: 'Support', permissions: ['users.view', 'content', 'bogus'] }).returning()
    const helper = await add('helper@gmail.com', 'Helper')
    await db.insert(staffMembers).values({ email: 'helper@gmail.com', roleId: role!.id })
    const a = (await staffAccess(db, helper))!
    expect([...a.permissions].sort()).toEqual(['content', 'users.view'])
    expect(can(a, 'money')).toBe(false)
    expect(can(a, 'staff')).toBe(false)
    expect(await staffAccess(db, { ...helper, blockedAt: new Date() })).toBeNull()
    await db.update(staffMembers).set({ revokedAt: new Date() })
    expect(await staffAccess(db, helper)).toBeNull()
  })

  it('admin pages need a Google or Apple sign-in from the last 12 hours', () => {
    const now = Date.now()
    expect(isFresh({ createdAt: new Date(now - 3600_000), method: 'google' }, now)).toBe(true)
    expect(isFresh({ createdAt: new Date(now - 3600_000), method: 'apple' }, now)).toBe(true)
    expect(isFresh({ createdAt: new Date(now - 13 * 3600_000), method: 'google' }, now)).toBe(false)
    // Sessions from before the method was recorded
    expect(isFresh({ createdAt: new Date(now - 3600_000), method: null }, now)).toBe(false)
  })

  it('masks emails for lists', () => {
    expect(maskForStaff('jieun.kim@gmail.com', 'google:1')).toBe('j•••@gmail.com')
    expect(maskForStaff(null, 'apple:1')).toBe('Apple ID')
    expect(maskForStaff(null, 'google:1')).toBe('—')
  })

  it("a blocked user's session stops working", async () => {
    const { db, add } = await setup()
    const u = await add('blocked@gmail.com', 'Blocked')
    const { token } = await createSession(db, u.id)
    expect(await validateSessionToken(db, token)).not.toBeNull()
    await db.update(users).set({ blockedAt: new Date() })
    expect(await validateSessionToken(db, token)).toBeNull()
  })
})

describe('AI usage and cost', () => {
  it('records every call, including failures, and prices thinking as output', async () => {
    const { db, add } = await setup()
    const u = await add('t@example.com', 'T')
    let fail = false
    const llm: LlmProvider = {
      name: 'gemini',
      async generateJson() {
        if (fail) throw new Error('503')
        return { json: {}, usage: { inputTokens: 1_000_000, outputTokens: 100_000, thoughtsTokens: 400_000 }, model: 'gemini-x-flash' }
      },
    }
    const m = metered(llm, { db, userId: u.id, purpose: 'generate', refId: 'RUN1' })
    await m.generateJson({ system: '', parts: [], schema: {}, task: 'generate' })
    fail = true
    await expect(m.generateJson({ system: '', parts: [], schema: {} })).rejects.toThrow()
    const rows = await db.select().from(aiCalls)
    expect(rows.map((r) => [r.ok, r.purpose, r.refId, r.thoughtsTokens])).toEqual([
      [true, 'generate', 'RUN1', 400_000],
      [false, 'generate', 'RUN1', 0],
    ])
    // flash: $0.5 in + $3 out per million → 0.5 + 0.5 × 3
    expect(costUsd(rows[0]!)).toBeCloseTo(2)
    process.env.AI_PRICES = '{"gemini-x-flash":[1,10]}'
    expect(priceFor('gemini-x-flash')).toEqual([1, 10])
    expect(priceFor('gemini-2.5-pro')).toEqual([2, 12])
  })
})

describe('admin numbers', () => {
  it('health: failures with their reason, a run left running counts as a timeout, AI cost per homework', async () => {
    const { db, add } = await setup()
    const t = await add('teacher.a@example.com', 'Teacher A')
    await db.insert(generationRuns).values([
      { teacherId: t.id, mode: 'create', kind: 'new', status: 'ok', durationMs: 60_000, picturesAttached: 2 },
      { teacherId: t.id, mode: 'create', kind: 'new', status: 'failed', errorCode: 'ai_busy', durationMs: 5_000 },
      { teacherId: t.id, mode: 'digitize', kind: 'new', status: 'running', createdAt: new Date(Date.now() - RUN_TIMEOUT_MS - 1000) },
    ])
    await db.insert(aiCalls).values({ userId: t.id, purpose: 'generate', model: 'gemini-flash', inputTokens: 1_000_000, outputTokens: 0 })
    const h = await healthStats(db, 14)
    const today = h.days.at(-1)!
    expect(today).toMatchObject({ total: 3, ok: 1, failed: 2, avgMs: 60_000 })
    expect(today.pictures.attached).toBe(2)
    expect(h.failures.map((f) => f.status).sort()).toEqual(['failed', 'timeout'])
    expect(h.errorCodes).toEqual(expect.arrayContaining([{ code: 'ai_busy', n: 1 }, { code: 'timeout', n: 1 }]))
    expect(h.ai.perHomeworkUsd).toBeCloseTo(0.5)
    expect(h.ai.topUsers[0]).toMatchObject({ name: 'Teacher A' })
  })

  it('finds people by name or part of the email; the log names who did what to whom', async () => {
    const { db, add } = await setup()
    const a = await add('malika@gmail.com', 'Malika Karimova')
    const b = await add('aziz.k@naver.com', 'Aziz', 'student')
    expect((await searchUsers(db, 'malika')).map((u) => u.id)).toEqual([a.id])
    expect((await searchUsers(db, 'NAVER')).map((u) => u.id)).toEqual([b.id])
    await audit(db, a.id, 'user.block', { type: 'user', id: b.id }, { reason: 'spam' })
    expect(await auditLog(db)).toMatchObject([{ action: 'user.block', actorName: 'Malika Karimova', targetName: 'Aziz', details: { reason: 'spam' } }])
  })

  it('growth, money, a user and a homework all load', async () => {
    const { db, add } = await setup()
    const t = await add('teacher.b@example.com', 'Teacher B')
    await db.insert(teacherProfiles).values({ userId: t.id, dailyCap: 40 })
    const [a] = await db.insert(assignments).values({ teacherId: t.id, title: 'Past Simple', instructionLocale: 'ko', contentLanguage: 'en', shareSlug: 'abc123' }).returning()
    await db.insert(generationRuns).values({ teacherId: t.id, assignmentId: a!.id, mode: 'create', kind: 'new', status: 'ok' })
    const b = await businessStats(db)
    expect(b.users.teachers).toBe(1)
    expect(b.homework.createdWeek).toBe(1)
    expect(b.homeworkByDay.at(-1)!.n).toBe(1)
    expect((await moneyStats(db)).revenueKrw).toBe(0)
    const u = (await userDetail(db, t.id))!
    expect(u.counts.homework).toBe(1)
    expect(u.generationsToday).toBe(1)
    expect(u.profile?.dailyCap).toBe(40)
    expect((await recentHomework(db, { q: 'past' }))[0]!.teacherName).toBe('Teacher B')
    expect((await homeworkDetail(db, a!.id))!.runs).toHaveLength(1)
    expect(await staffOverview(db)).toEqual({ roles: [], members: [] })
  })
})
