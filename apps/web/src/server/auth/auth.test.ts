import { beforeEach, describe, expect, it } from 'vitest'
import { createTestDb } from '@ikhimi/db/testing'
import { otpCodes, sessions, teacherProfiles, type Db } from '@ikhimi/db'
import { ConsoleSmsProvider } from '../sms/console'
import { OtpUndeliverableError } from '../sms/types'
import { requestOtp, verifyOtp } from './otp'
import { createSession, hashToken, validateSessionToken } from './session'
import { addRole, chooseFirstRole, findOrCreateUserByPhone, needsOnboarding, needsRoleChoice, signInRole } from './users'

const PEPPER = 'test-pepper-0123456789'
const PHONE = '+998901234567'

let db: Db
let sms: ConsoleSmsProvider
let clock: Date
const now = () => clock
const advance = (s: number) => (clock = new Date(clock.getTime() + s * 1000))
const lastCode = () => /(\d{6})/.exec(sms.sent.at(-1)!.text)![1]!

const send = (phone = PHONE, ip: string | null = '10.0.0.1') =>
  requestOtp({ db, pepper: PEPPER, sms, now }, { phone, ip, smsText: (c) => `code ${c}` })
const verify = (code: string, phone = PHONE) => verifyOtp({ db, pepper: PEPPER, now }, { phone, code })

beforeEach(async () => {
  db = await createTestDb()
  sms = new ConsoleSmsProvider()
  clock = new Date('2026-09-01T10:00:00Z')
  // keep test output quiet
  sms.send = async (phone, text) => {
    sms.sent.push({ phone, text })
    return {}
  }
})

describe('OTP', () => {
  it('sends a 6-digit code and never stores it in plaintext', async () => {
    expect(await send()).toEqual({ ok: true, resendAfterSeconds: 60 })
    const code = lastCode()
    const [row] = await db.select().from(otpCodes)
    expect(row!.codeHash).not.toContain(code)
    expect(row!.codeHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('verifies the right code once', async () => {
    await send()
    const code = lastCode()
    expect(await verify(code)).toEqual({ ok: true })
    expect(await verify(code)).toEqual({ ok: false, reason: 'expired' })
  })

  it('rejects wrong codes and locks after 5 attempts', async () => {
    await send()
    const code = lastCode()
    const wrong = code === '000000' ? '111111' : '000000'
    for (let i = 0; i < 4; i++) expect(await verify(wrong)).toEqual({ ok: false, reason: 'invalid' })
    expect(await verify(wrong)).toEqual({ ok: false, reason: 'too_many_attempts' })
    // Even the right code is refused now
    expect(await verify(code)).toEqual({ ok: false, reason: 'too_many_attempts' })
  })

  it('expires after 5 minutes', async () => {
    await send()
    advance(5 * 60 + 1)
    expect(await verify(lastCode())).toEqual({ ok: false, reason: 'expired' })
  })

  it('rejects non-numeric input without throwing', async () => {
    await send()
    expect(await verify("' OR 1=1 --")).toEqual({ ok: false, reason: 'invalid' })
  })

  it('enforces a 60s resend cooldown and 3 sends per 15 minutes', async () => {
    expect((await send()).ok).toBe(true)
    const early = await send()
    expect(early).toMatchObject({ ok: false, reason: 'rate_limited' })
    advance(61)
    expect((await send()).ok).toBe(true)
    advance(61)
    expect((await send()).ok).toBe(true)
    advance(61)
    const blocked = await send()
    expect(blocked).toMatchObject({ ok: false, reason: 'rate_limited' })
    if (!blocked.ok) expect(blocked.retryAfterSeconds).toBeGreaterThan(10 * 60)
    advance(15 * 60)
    expect((await send()).ok).toBe(true)
    expect(sms.sent).toHaveLength(4)
  })

  it('only the latest code is valid', async () => {
    await send()
    const first = lastCode()
    advance(61)
    await send()
    const second = lastCode()
    if (first !== second) expect(await verify(first)).toMatchObject({ ok: false })
    expect(await verify(second)).toEqual({ ok: true })
  })

  it('a failed delivery (e.g. no Telegram) does not use up the allowance', async () => {
    const realSend = sms.send
    sms.send = async () => {
      throw new OtpUndeliverableError('telegram', 'PHONE_NUMBER_NOT_FOUND')
    }
    for (let i = 0; i < 4; i++) await expect(send()).rejects.toBeInstanceOf(OtpUndeliverableError)
    expect(await db.select().from(otpCodes)).toHaveLength(0)
    sms.send = realSend
    expect((await send()).ok).toBe(true)
  })

  it('passes the bare code and ttl to the channel', async () => {
    let got: unknown
    sms.send = async (_p, _t, opts) => ((got = opts), {})
    await send()
    expect(got).toMatchObject({ code: expect.stringMatching(/^\d{6}$/), ttlSeconds: 300 })
  })

  it('stops a single IP from spraying many phones', async () => {
    for (let i = 0; i < 10; i++) expect((await send(`+99890000000${i}`)).ok).toBe(true)
    expect(await send('+998900000099')).toMatchObject({ ok: false, reason: 'rate_limited' })
    expect(sms.sent).toHaveLength(10)
  })
})

describe('sessions', () => {
  it('creates, validates, refreshes and expires', async () => {
    const { user, isNew } = await findOrCreateUserByPhone(db, { phone: PHONE, role: 'teacher', uiLocale: 'ko' })
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

  it('returns the same user for a returning phone, and never adds a role on sign-in', async () => {
    const a = await findOrCreateUserByPhone(db, { phone: PHONE, role: 'teacher', uiLocale: 'ko' })
    const b = await findOrCreateUserByPhone(db, { phone: PHONE, role: 'student', uiLocale: 'ko' })
    expect(b.isNew).toBe(false)
    expect(b.user.id).toBe(a.user.id)
    expect(b.user.roles).toEqual(['teacher'])
    // Asking for a role the account doesn't hold opens it in its own role
    expect(await signInRole(db, b.user, 'student')).toBeNull()
  })

  it('a dual-role account opens in the role asked for, else the one used last', async () => {
    const { user } = await findOrCreateUserByPhone(db, { phone: PHONE, role: 'teacher', uiLocale: 'ko' })
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
    const { user } = await findOrCreateUserByPhone(db, { phone: PHONE, uiLocale: 'ko' })
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
