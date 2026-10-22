import { beforeEach, describe, expect, it } from 'vitest'
import { createTestDb } from '@ikhimi/db/testing'
import { appleAccounts, eq, googleAccounts, groups, pushDevices, sessions, subscriptions, users, type Db } from '@ikhimi/db'
import { linkTelegram } from './link'
import { createSession } from './session'

let db: Db
const tg = { phone: '+998901112233', telegramChatId: '5005' }

async function person(phone: string, roles: ('teacher' | 'student')[] = ['student']) {
  const [u] = await db.insert(users).values({ role: roles[0]!, roles, phone, fullName: 'Aziz' }).returning()
  return u!
}
/** An account made with Sign in with Apple, as api/auth/apple makes it */
async function appleUser(sub = '001.abc') {
  const u = await person(`apple:${sub}`)
  await db.insert(appleAccounts).values({ userId: u.id, sub, refreshToken: 'rt' })
  return u
}
const row = async (id: string) => (await db.select().from(users).where(eq(users.id, id)))[0]!
const appleOwner = async (sub: string) => (await db.select().from(appleAccounts).where(eq(appleAccounts.sub, sub)))[0]?.userId

beforeEach(async () => {
  db = await createTestDb()
})

describe('linking Telegram to an account made with Apple', () => {
  it('a number nobody uses: the account takes it, and Apple still opens it', async () => {
    const a = await appleUser()
    expect(await linkTelegram(db, a, tg)).toEqual({ status: 'linked' })
    expect(await row(a.id)).toMatchObject({ phone: tg.phone, telegramChatId: '5005' })
    expect(await appleOwner('001.abc')).toBe(a.id)
  })

  it("the number's own account: Apple moves there, the empty Apple account closes", async () => {
    const old = await person(tg.phone)
    const a = await appleUser()
    await createSession(db, a.id)
    await db.insert(pushDevices).values({ token: 'ab'.repeat(32), userId: a.id, env: 'production' })
    // The free welcome gift is not "work"
    await db.insert(subscriptions).values({ studentId: a.id, plan: 'vip', status: 'active', priceKrw: 0, periodStart: new Date(), periodEnd: new Date() })

    expect(await linkTelegram(db, a, tg)).toEqual({ status: 'switched', userId: old.id })
    expect(await appleOwner('001.abc')).toBe(old.id)
    expect((await db.select().from(appleAccounts).where(eq(appleAccounts.userId, old.id)))[0]?.refreshToken).toBe('rt')
    expect(await row(old.id)).toMatchObject({ telegramChatId: '5005', deletedAt: null })
    expect((await row(a.id)).deletedAt).not.toBeNull()
    expect(await db.select().from(sessions).where(eq(sessions.userId, a.id))).toHaveLength(0)
    expect(await db.select().from(pushDevices).where(eq(pushDevices.userId, a.id))).toHaveLength(0)
  })

  it('never closes an Apple account that has work in it', async () => {
    await person(tg.phone)
    const a = await appleUser()
    await db.insert(groups).values({ teacherId: a.id, name: '7-A', subject: 'english', contentLanguage: 'en', joinCode: 'ABC123' })
    expect(await linkTelegram(db, a, tg)).toEqual({ status: 'both_have_work' })
    expect((await row(a.id)).deletedAt).toBeNull()
    expect(await appleOwner('001.abc')).toBe(a.id)
  })

  it("won't give an account a second Apple ID", async () => {
    const old = await person(tg.phone)
    await db.insert(appleAccounts).values({ userId: old.id, sub: '002.other' })
    const a = await appleUser()
    expect(await linkTelegram(db, a, tg)).toEqual({ status: 'other_apple' })
  })

  it('a phone account only refreshes its own Telegram', async () => {
    const p = await person('+998905556677')
    expect(await linkTelegram(db, p, tg)).toEqual({ status: 'has_number' })
    expect(await linkTelegram(db, p, { phone: '+998905556677', telegramChatId: '6006' })).toEqual({ status: 'linked' })
    expect((await row(p.id)).telegramChatId).toBe('6006')
  })
})

describe('linking Telegram to an account made with Google', () => {
  async function googleUser(sub = '1089') {
    const u = await person(`google:${sub}`)
    await db.insert(googleAccounts).values({ userId: u.id, sub, email: 'a@gmail.com' })
    return u
  }
  const googleOwner = async (sub: string) => (await db.select().from(googleAccounts).where(eq(googleAccounts.sub, sub)))[0]?.userId

  it('a number nobody uses: the account takes it, and Google still opens it', async () => {
    const g = await googleUser()
    expect(await linkTelegram(db, g, tg)).toEqual({ status: 'linked' })
    expect((await row(g.id)).phone).toBe(tg.phone)
    expect(await googleOwner('1089')).toBe(g.id)
  })

  it("the number's own account: Google moves there, the empty Google account closes", async () => {
    const old = await person(tg.phone)
    const g = await googleUser()
    expect(await linkTelegram(db, g, tg)).toEqual({ status: 'switched', userId: old.id })
    expect(await googleOwner('1089')).toBe(old.id)
    expect((await row(g.id)).deletedAt).not.toBeNull()
  })

  it("won't give an account a second Google account", async () => {
    const old = await person(tg.phone)
    await db.insert(googleAccounts).values({ userId: old.id, sub: '2000' })
    expect(await linkTelegram(db, await googleUser(), tg)).toEqual({ status: 'other_google' })
  })
})
