import { beforeEach, describe, expect, it } from 'vitest'
import { createTestDb } from '@ikhimi/db/testing'
import { eq, passwordFailures, sessions, users, type Db } from '@ikhimi/db'
import { hashPassword, passwordProblem, passwordStep, setPassword, signInWithPassword, verifyPassword } from './password'
import { createSession } from './session'

let db: Db
const PHONE = '+998901234567'
const deps = () => ({ db, pepper: 'pep' })

async function person(password?: string) {
  const [u] = await db.insert(users).values({ role: 'student', roles: ['student'], phone: PHONE, fullName: 'Aziz', passwordHash: password ? await hashPassword(password) : null }).returning()
  return u!
}

beforeEach(async () => {
  db = await createTestDb()
})

describe('password sign-in', () => {
  it('hashes with a fresh salt and checks', async () => {
    const a = await hashPassword('ochiq-eshik-77')
    const b = await hashPassword('ochiq-eshik-77')
    expect(a).not.toBe(b)
    expect(a).not.toContain('ochiq')
    expect(await verifyPassword(a, 'ochiq-eshik-77')).toBe(true)
    expect(await verifyPassword(a, 'ochiq-eshik-78')).toBe(false)
    expect(await verifyPassword('garbage', 'x')).toBe(false)
  })

  it('refuses short, common and phone-number passwords', () => {
    expect(passwordProblem('abc', PHONE)).toBe('too_short')
    expect(passwordProblem('12345678', PHONE)).toBe('too_common')
    expect(passwordProblem('aaaaaaaaaa', PHONE)).toBe('too_common')
    expect(passwordProblem('901234567', PHONE)).toBe('is_phone')
    expect(passwordProblem('998901234567', PHONE)).toBe('is_phone')
    expect(passwordProblem('kitob-oqiyman', PHONE)).toBeNull()
  })

  it('signs in with the right password; the same answer for a wrong one and for no account', async () => {
    const u = await person('kitob-oqiyman')
    expect(await signInWithPassword(deps(), { phone: PHONE, password: 'kitob-oqiyman', ip: '1.2.3.4' })).toMatchObject({ ok: true, user: { id: u.id } })
    expect(await signInWithPassword(deps(), { phone: PHONE, password: 'boshqa-parol', ip: '1.2.3.4' })).toEqual({ ok: false, reason: 'invalid' })
    expect(await signInWithPassword(deps(), { phone: '+998907770000', password: 'kitob-oqiyman', ip: '1.2.3.4' })).toEqual({ ok: false, reason: 'invalid' })
  })

  it('an account without a password cannot be opened with one', async () => {
    await person()
    expect(await signInWithPassword(deps(), { phone: PHONE, password: 'anything-at-all', ip: null })).toEqual({ ok: false, reason: 'invalid' })
  })

  it('pauses after 5 wrong tries for a number, even with the right password, and a success clears the count', async () => {
    await person('kitob-oqiyman')
    for (let i = 0; i < 4; i++) await signInWithPassword(deps(), { phone: PHONE, password: `wrong-${i}-xx`, ip: `10.0.0.${i}` })
    expect((await signInWithPassword(deps(), { phone: PHONE, password: 'kitob-oqiyman', ip: null })).ok).toBe(true)
    expect(await db.select().from(passwordFailures)).toHaveLength(0)
    for (let i = 0; i < 5; i++) await signInWithPassword(deps(), { phone: PHONE, password: `wrong-${i}-xx`, ip: `10.0.0.${i}` })
    expect(await signInWithPassword(deps(), { phone: PHONE, password: 'kitob-oqiyman', ip: null })).toMatchObject({ ok: false, reason: 'rate_limited' })
  })

  it('pauses one IP that tries many numbers', async () => {
    for (let i = 0; i < 20; i++) await signInWithPassword(deps(), { phone: `+9989000000${String(i).padStart(2, '0')}`, password: 'guess-guess', ip: '6.6.6.6' })
    expect(await signInWithPassword(deps(), { phone: PHONE, password: 'guess-guess', ip: '6.6.6.6' })).toMatchObject({ ok: false, reason: 'rate_limited' })
  })

  it('blocked accounts stay out', async () => {
    const u = await person('kitob-oqiyman')
    await db.update(users).set({ blockedAt: new Date() }).where(eq(users.id, u.id))
    expect(await signInWithPassword(deps(), { phone: PHONE, password: 'kitob-oqiyman', ip: null })).toEqual({ ok: false, reason: 'blocked' })
  })
})

describe('setting a password in Profile', () => {
  it('sets one, then changing it needs the current one unless the sign-in is new; other sessions end', async () => {
    const u = await person()
    const now = new Date()
    await createSession(db, u.id, { now })
    const me = { sessionId: 'mine', createdAt: now }
    await db.insert(sessions).values({ id: 'mine', userId: u.id, expiresAt: new Date(now.getTime() + 86400_000) })
    expect(await setPassword(db, me, { userId: u.id, password: 'kitob-oqiyman' }, now)).toEqual({ ok: true })
    expect((await db.select().from(sessions)).map((s) => s.id)).toEqual(['mine'])

    // A fresh sign-in (how a forgotten password is replaced) doesn't need the old one
    expect(await setPassword(db, me, { userId: u.id, password: 'yangi-parol-1' }, now)).toEqual({ ok: true })
    const later = new Date(now.getTime() + 3600_000)
    expect(await setPassword(db, me, { userId: u.id, password: 'yangi-parol-2' }, later)).toEqual({ ok: false, reason: 'current_required' })
    expect(await setPassword(db, me, { userId: u.id, password: 'yangi-parol-2', current: 'notogri-parol' }, later)).toEqual({ ok: false, reason: 'wrong_current' })
    expect(await setPassword(db, me, { userId: u.id, password: 'yangi-parol-2', current: 'yangi-parol-1' }, later)).toEqual({ ok: true })
    expect((await signInWithPassword(deps(), { phone: PHONE, password: 'yangi-parol-2', ip: null })).ok).toBe(true)
  })

  it('Apple and Google accounts have no number to sign in with, so no password', async () => {
    const [g] = await db.insert(users).values({ role: 'student', roles: ['student'], phone: 'google:123' }).returning()
    expect(await setPassword(db, { sessionId: 'x', createdAt: new Date() }, { userId: g!.id, password: 'kitob-oqiyman' })).toEqual({ ok: false, reason: 'no_phone' })
  })
})

describe('after Telegram or a code proves the number', () => {
  it('goes on to setting a password (a new one if it had one), except for the review login and number-less accounts', () => {
    expect(passwordStep({ phone: PHONE, passwordHash: null })).toEqual({ needsPassword: true, hasPassword: false, phone: PHONE })
    expect(passwordStep({ phone: PHONE, passwordHash: 'scrypt$…' })).toEqual({ needsPassword: true, hasPassword: true, phone: PHONE })
    expect(passwordStep({ phone: PHONE, passwordHash: null }, { review: true })).toEqual({})
    expect(passwordStep({ phone: 'google:1', passwordHash: null })).toEqual({})
  })
})
