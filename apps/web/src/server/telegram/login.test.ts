import { beforeEach, describe, expect, it } from 'vitest'
import { createTestDb } from '@ikhimi/db/testing'
import { CONFIG, type Db } from '@ikhimi/db'
import type { BotApi, ReplyMarkup, TgUpdate } from './api'
import { exchangeTelegramLink, exchangeTelegramLogin, handleTelegramUpdate, startTelegramLogin } from './login'

let db: Db
let sent: { chatId: string; text: string; markup?: ReplyMarkup }[]
const bot: BotApi = {
  async sendMessage(chatId, text, markup) {
    sent.push({ chatId, text, markup })
  },
}

const CHAT = 5550001
const msg = (m: NonNullable<TgUpdate['message']>): TgUpdate => ({ update_id: 1, message: m })
const startCmd = (token?: string, chat = CHAT) =>
  msg({ chat: { id: chat, type: 'private' }, from: { id: chat }, text: token ? `/start ${token}` : '/start' })
const contact = (phone: string, userId = CHAT, from = CHAT) =>
  msg({ chat: { id: from, type: 'private' }, from: { id: from }, contact: { phone_number: phone, user_id: userId } })

beforeEach(async () => {
  db = await createTestDb()
  sent = []
})

async function newLogin(locale: 'ko' = 'ko') {
  const r = await startTelegramLogin(db, { uiLocale: locale, ipHash: 'ip1' })
  if ('rateLimited' in r) throw new Error('rate limited')
  return r.token
}

describe('Log in with Telegram', () => {
  it('happy path: /start → share own contact → browser gets the verified phone once', async () => {
    const token = await newLogin()
    expect(await exchangeTelegramLogin(db, token)).toEqual({ status: 'pending' })

    await handleTelegramUpdate(db, bot, startCmd(token))
    expect(sent.at(-1)!.markup).toMatchObject({ keyboard: [[{ request_contact: true, text: '📱 내 번호 보내기' }]] })

    // Telegram sends numbers without "+"
    await handleTelegramUpdate(db, bot, contact('79161234567'))
    expect(sent.at(-1)!.text).toMatch(/완료/)

    expect(await exchangeTelegramLogin(db, token)).toEqual({ status: 'approved', phone: '+79161234567', telegramChatId: String(CHAT) })
    expect(await exchangeTelegramLogin(db, token)).toEqual({ status: 'expired' })
  })

  it('replies in Korean', async () => {
    const token = await newLogin()
    await handleTelegramUpdate(db, bot, startCmd(token))
    expect(sent.at(-1)!.text).toMatch(/익히미에 로그인하려면/)
  })

  it('a number typed by hand gets the share button again; it approves nothing', async () => {
    const token = await newLogin()
    await handleTelegramUpdate(db, bot, startCmd(token))
    await handleTelegramUpdate(db, bot, msg({ chat: { id: CHAT, type: 'private' }, from: { id: CHAT }, text: '+998 50 503-09-74' }))
    expect(sent.at(-1)).toMatchObject({ text: expect.stringMatching(/번호를 직접 입력하지 않아도/), markup: { keyboard: [[{ request_contact: true, text: '📱 내 번호 보내기' }]] } })
    expect(await exchangeTelegramLogin(db, token)).toEqual({ status: 'pending' })
    // With no login waiting too
    await handleTelegramUpdate(db, bot, msg({ chat: { id: 777, type: 'private' }, from: { id: 777 }, text: '911180223' }))
    expect(sent.at(-1)).toMatchObject({ chatId: '777', text: expect.stringMatching(/번호를 직접 입력하지 않아도/) })
  })

  it('the bot also sends a one-time “로그인” link, for a browser that was lost; whichever comes first signs in', async () => {
    const r = await startTelegramLogin(db, { uiLocale: 'ko', ipHash: null, as: 'student', next: '/s/abc' })
    if ('rateLimited' in r) throw new Error()
    await handleTelegramUpdate(db, bot, startCmd(r.token))
    // Nothing to sign in with before the number is shared
    await handleTelegramUpdate(db, bot, contact('+998901234567'))
    const done = sent.at(-1)!
    expect(done.text).toMatch(/완료/)
    expect(done.text).toMatch(/아래 ‘로그인’을 누르세요/)
    const button = (done.markup as { inline_keyboard: { text: string; url: string }[][] }).inline_keyboard[0]![0]!
    expect(button.text).toBe('🔐 로그인')
    const prefix = `${CONFIG.publicOrigin.replace(/\/$/, '')}/api/auth/telegram/link?c=`
    expect(button.url.startsWith(prefix)).toBe(true)
    const code = button.url.slice(prefix.length)

    // The link carries what the browser asked for, and works once; the browser then finds it used
    expect(await exchangeTelegramLink(db, code)).toEqual({ status: 'approved', phone: '+998901234567', telegramChatId: String(CHAT), as: 'student', next: '/s/abc', uiLocale: 'ko' })
    expect(await exchangeTelegramLink(db, code)).toEqual({ status: 'expired' })
    expect(await exchangeTelegramLogin(db, r.token)).toEqual({ status: 'expired' })
    expect(await exchangeTelegramLink(db, 'not-a-real-code')).toEqual({ status: 'expired' })
  })

  it('when the browser signs in first, the link is used up; an old link signs nobody in', async () => {
    const t0 = new Date('2026-09-01T10:00:00Z')
    const token = await newLogin()
    await handleTelegramUpdate(db, bot, startCmd(token))
    await handleTelegramUpdate(db, bot, contact('+998901234567'))
    const url = (sent.at(-1)!.markup as { inline_keyboard: { url: string }[][] }).inline_keyboard[0]![0]!.url
    expect(await exchangeTelegramLogin(db, token)).toMatchObject({ status: 'approved' })
    expect(await exchangeTelegramLink(db, url.split('c=')[1]!)).toEqual({ status: 'expired' })

    // Ten minutes from the moment the number was shared
    const r = await startTelegramLogin(db, { uiLocale: 'ko', ipHash: null, now: t0 })
    if ('rateLimited' in r) throw new Error()
    await handleTelegramUpdate(db, bot, startCmd(r.token, 8800), t0)
    await handleTelegramUpdate(db, bot, contact('+998907654321', 8800, 8800), new Date(t0.getTime() + 9 * 60 * 1000))
    expect(sent.at(-1)!.text).toMatch(/로그인/)
    const late = (sent.at(-1)!.markup as { inline_keyboard: { url: string }[][] }).inline_keyboard[0]![0]!.url.split('c=')[1]!
    expect(await exchangeTelegramLink(db, late, new Date(t0.getTime() + 20 * 60 * 1000))).toEqual({ status: 'expired' })
    expect(await exchangeTelegramLink(db, late, new Date(t0.getTime() + 15 * 60 * 1000))).toMatchObject({ status: 'approved', uiLocale: 'ko' })
  })

  it("rejects someone else's forwarded contact", async () => {
    const token = await newLogin()
    await handleTelegramUpdate(db, bot, startCmd(token))
    await handleTelegramUpdate(db, bot, contact('+998901234567', 999999))
    expect(sent.at(-1)!.text).toMatch(/본인 번호/)
    expect(await exchangeTelegramLogin(db, token)).toEqual({ status: 'pending' })
  })

  it('a contact from a chat that never started this login approves nothing', async () => {
    const token = await newLogin()
    await handleTelegramUpdate(db, bot, startCmd(token))
    await handleTelegramUpdate(db, bot, contact('+998901234567', 7777, 7777))
    expect(await exchangeTelegramLogin(db, token)).toEqual({ status: 'pending' })
  })

  it('expired and unknown tokens are refused', async () => {
    const t0 = new Date('2026-09-01T10:00:00Z')
    const r = await startTelegramLogin(db, { uiLocale: 'ko', ipHash: null, now: t0 })
    if ('rateLimited' in r) throw new Error()
    const later = new Date(t0.getTime() + 11 * 60 * 1000)
    await handleTelegramUpdate(db, bot, startCmd(r.token), later)
    expect(sent.at(-1)!.text).toMatch(/만료된 링크/)
    await handleTelegramUpdate(db, bot, startCmd('not-a-real-token'))
    expect(sent.at(-1)!.text).toMatch(/만료된 링크/)
    expect(await exchangeTelegramLogin(db, 'not-a-real-token')).toEqual({ status: 'expired' })
  })

  it('plain /start gets a welcome, group chats are ignored', async () => {
    await handleTelegramUpdate(db, bot, startCmd())
    expect(sent.at(-1)!.text).toMatch(/안녕하세요/)
    const n = sent.length
    await handleTelegramUpdate(db, bot, msg({ chat: { id: -100, type: 'group' }, text: '/start x' }))
    expect(sent).toHaveLength(n)
  })

  it('rate-limits login starts per IP', async () => {
    for (let i = 0; i < 20; i++) await newLogin()
    expect(await startTelegramLogin(db, { uiLocale: 'ko', ipHash: 'ip1' })).toEqual({ rateLimited: true })
  })
})
