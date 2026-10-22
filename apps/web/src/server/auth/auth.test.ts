import { beforeEach, describe, expect, it } from 'vitest'
import { createTestDb } from '@ikhimi/db/testing'
import { appleAccounts, eq, googleAccounts, sessions, teacherProfiles, users, type Db } from '@ikhimi/db'
import { createSession, hashToken, validateSessionToken } from './session'
import { accountForSignIn, addRole, chooseFirstRole, findOrCreateUser, needsOnboarding, needsRoleChoice, signInRole } from './users'

const PHONE = 'google:1001'

let db: Db

beforeEach(async () => {
  db = await createTestDb()
})

const google = (sub: string, email: string | null, role?: 'teacher' | 'student') => accountForSignIn(db, { provider: 'google', sub, email, role, uiLocale: 'ko' })
const apple = (sub: string, email: string | null) => accountForSignIn(db, { provider: 'apple', sub, email, uiLocale: 'ko' })

describe('signing in with Google or Apple', () => {
  it('makes one account per Google account and opens it again next time', async () => {
    const a = await google('g1', 'Jieun@Gmail.com', 'teacher')
    expect(a.isNew).toBe(true)
    expect(a.user).toMatchObject({ phone: 'google:g1', email: 'jieun@gmail.com', roles: ['teacher'] })
    const b = await google('g1', 'jieun@gmail.com')
    expect(b).toMatchObject({ isNew: false, user: { id: a.user.id } })
    expect(await db.select().from(googleAccounts)).toHaveLength(1)
  })

  it('Apple with the same verified email opens the account made with Google, and the other way round', async () => {
    const web = await google('g1', 'jieun@gmail.com', 'teacher')
    const phone = await apple('a1', 'jieun@gmail.com')
    expect(phone).toMatchObject({ isNew: false, user: { id: web.user.id } })
    expect(await db.select().from(appleAccounts).where(eq(appleAccounts.userId, web.user.id))).toHaveLength(1)

    const app = await apple('a2', 'minho@naver.com')
    const site = await google('g2', 'minho@naver.com')
    expect(site.user.id).toBe(app.user.id)
  })

  it('without an email (Apple hid it) the Apple ID gets its own account', async () => {
    const web = await google('g1', 'jieun@gmail.com')
    const hidden = await apple('a1', null)
    expect(hidden.isNew).toBe(true)
    expect(hidden.user.id).not.toBe(web.user.id)
    expect(hidden.user).toMatchObject({ phone: 'apple:a1', email: null })
  })

  it('a second Google account with the same email does not take over the first account', async () => {
    const first = await google('g1', 'jieun@gmail.com')
    const second = await google('g2', 'jieun@gmail.com')
    expect(second.isNew).toBe(true)
    expect(second.user.id).not.toBe(first.user.id)
    // The email stays with the first account
    expect(second.user.email).toBeNull()
  })

  it('opens an account staff prepared with that email (the seeded demo teacher)', async () => {
    const [prepared] = await db.insert(users).values({ role: 'teacher', roles: ['teacher'], phone: 'seed:teacher', email: 'demo@example.com' }).returning()
    const r = await google('g9', 'demo@example.com')
    expect(r).toMatchObject({ isNew: false, user: { id: prepared!.id } })
  })

  it('signing in again within 30 days restores a deleted account; an erased one is never reopened by email', async () => {
    const a = await google('g1', 'jieun@gmail.com')
    await db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, a.user.id))
    expect((await google('g1', 'jieun@gmail.com')).user).toMatchObject({ id: a.user.id, deletedAt: null })

    const [erased] = await db.insert(users).values({ role: 'student', phone: 'deleted:x', email: 'gone@example.com' }).returning()
    const r = await apple('a1', 'gone@example.com')
    expect(r.user.id).not.toBe(erased!.id)
  })
})

describe('sessions', () => {
  it('creates, validates, refreshes and expires', async () => {
    const { user, isNew } = await findOrCreateUser(db, { phone: PHONE, role: 'teacher', uiLocale: 'ko' })
    expect(isNew).toBe(true)
    expect(needsOnboarding(user)).toBe(true)
    expect(user.uiLocale).toBe('ko')

    const t0 = new Date('2026-09-01T10:00:00Z')
    const { token } = await createSession(db, user.id, { now: t0 })
    const [row] = await db.select().from(sessions)
    expect(row!.id).toBe(hashToken(token))
    expect(row!.id).not.toBe(token)

    const v = await validateSessionToken(db, token, t0)
    expect(v?.user.id).toBe(user.id)
    expect(v?.refreshed).toBe(false)

    // The device stays signed in: renewed after about a month of use, gone after a year without
    const day20 = new Date(t0.getTime() + 20 * 86400_000)
    expect((await validateSessionToken(db, token, day20))?.refreshed).toBe(false)
    const day40 = new Date(t0.getTime() + 40 * 86400_000)
    expect((await validateSessionToken(db, token, day40))?.refreshed).toBe(true)

    const later = new Date(day40.getTime() + 366 * 86400_000)
    expect(await validateSessionToken(db, token, later)).toBeNull()
    expect(await db.select().from(sessions)).toHaveLength(0)
  })

  it('returns the same user for a returning sign-in, and never adds a role on sign-in', async () => {
    const a = await findOrCreateUser(db, { phone: PHONE, role: 'teacher', uiLocale: 'ko' })
    const b = await findOrCreateUser(db, { phone: PHONE, role: 'student', uiLocale: 'ko' })
    expect(b.isNew).toBe(false)
    expect(b.user.id).toBe(a.user.id)
    expect(b.user.roles).toEqual(['teacher'])
    // Asking for a role the account doesn't hold opens it in its own role
    expect(await signInRole(db, b.user, 'student')).toBeNull()
  })

  it('a dual-role account opens in the role asked for, else the one used last', async () => {
    const { user } = await findOrCreateUser(db, { phone: PHONE, role: 'teacher', uiLocale: 'ko' })
    const both = await addRole(db, user, 'student')
    expect(both.roles.sort()).toEqual(['student', 'teacher'])
    expect(await signInRole(db, both, 'student')).toBe('student')
    expect(await signInRole(db, both)).toBeNull()
    const { token } = await createSession(db, user.id, { activeRole: 'student' })
    // A session's active role wins over the primary role
    expect((await validateSessionToken(db, token))?.user.role).toBe('student')
    expect(await signInRole(db, both)).toBe('student')
  })

  it('a new account without a way in chooses teacher or student once', async () => {
    const { user } = await findOrCreateUser(db, { phone: PHONE, uiLocale: 'ko' })
    expect(needsRoleChoice(user)).toBe(true)
    const { token } = await createSession(db, user.id)
    const v = (await validateSessionToken(db, token))!
    expect(v.user.roleChosen).toBe(false)
    expect(needsOnboarding({ ...v.user, fullName: 'Aziz' })).toBe(true)
    expect(await db.select().from(teacherProfiles)).toHaveLength(0)

    const chosen = (await chooseFirstRole(db, user.id, 'teacher'))!
    expect(chosen).toMatchObject({ role: 'teacher', roles: ['teacher'] })
    expect(await db.select().from(teacherProfiles)).toHaveLength(1)
    // Only once: a chosen account can't choose again here
    expect(await chooseFirstRole(db, user.id, 'student')).toBeNull()
    expect((await validateSessionToken(db, token))!.user.roleChosen).toBe(true)
  })

  it('rejects unknown tokens', async () => {
    expect(await validateSessionToken(db, 'nope')).toBeNull()
  })
})
