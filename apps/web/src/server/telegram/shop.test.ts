import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestDb } from '@ikhimi/db/testing'
import { courses, eq, payments, subscriptions, users, type Db } from '@ikhimi/db'
import type { ReplyMarkup, TgUpdate } from './api'
import { handleTelegramUpdate } from './login'
import { handleReceipt, handleShopUpdate, isShopUpdate, remindCardReceipts, SHOP_BUTTON, type ShopBot } from './shop'
import { studentPlan } from '../plans'

let db: Db
let sent: { chatId: string; text: string; markup?: ReplyMarkup }[]
let copied: { to: string; from: string; messageId: number; caption?: string; markup?: ReplyMarkup }[]
let photos: { chatId: string; fileId: string; caption: string; markup?: ReplyMarkup }[]
const bot: ShopBot = {
  async sendMessage(chatId, text, markup) {
    sent.push({ chatId, text, markup })
  },
  async answerCallback() {},
  async copyMessage(to, from, messageId, caption, markup) {
    copied.push({ to, from, messageId, caption, markup })
  },
  async editButtons() {},
  async sendPhoto(chatId, fileId, caption, markup) {
    photos.push({ chatId, fileId, caption, markup })
  },
}

const CHAT = 7770001
const text = (t: string): TgUpdate => ({ update_id: 1, message: { chat: { id: CHAT, type: 'private' }, from: { id: CHAT }, text: t } })
const press = (data: string): TgUpdate => ({ update_id: 2, callback_query: { id: 'q', from: { id: CHAT }, data, message: { message_id: 1, chat: { id: CHAT, type: 'private' } } } })
const buttons = () => {
  const m = sent.at(-1)!.markup
  return m && 'inline_keyboard' in m ? m.inline_keyboard.flat() : []
}

beforeEach(async () => {
  db = await createTestDb()
  sent = []
  copied = []
  photos = []
})

async function student(chatId: string | null = String(CHAT)) {
  const [u] = await db.insert(users).values({ role: 'student', roles: ['student'], phone: '+998901112233', telegramChatId: chatId }).returning()
  return u!
}

describe('Buying a plan in the bot', () => {
  it('/plans and button presses go to the shop; a plain /start does not', () => {
    expect(isShopUpdate(text('/plans'))).toBe(true)
    expect(isShopUpdate(text('/start plan'))).toBe(true)
    expect(isShopUpdate(press('shop'))).toBe(true)
    expect(isShopUpdate(text('/start'))).toBe(false)
  })

  it('an unlinked chat shares its own contact, gets linked, then sees the plans', async () => {
    const u = await student(null)
    await handleShopUpdate(db, bot, text('/plans'))
    expect(sent.at(-1)!.markup).toMatchObject({ keyboard: [[{ request_contact: true }]] })

    await handleTelegramUpdate(db, bot, { update_id: 3, message: { chat: { id: CHAT, type: 'private' }, from: { id: CHAT }, contact: { phone_number: '998901112233', user_id: CHAT } } })
    const [row] = await db.select().from(users).where(eq(users.id, u.id))
    expect(row!.telegramChatId).toBe(String(CHAT))
    expect(sent.at(-1)!.text).toContain('어떤 요금제를 구매하시겠어요?')
  })

  it("someone else's contact does not link", async () => {
    await student(null)
    await handleTelegramUpdate(db, bot, { update_id: 3, message: { chat: { id: CHAT, type: 'private' }, from: { id: CHAT }, contact: { phone_number: '998901112233', user_id: 999 } } })
    expect((await db.select().from(users))[0]!.telegramChatId).toBeNull()
  })

  it('plan → months → test payment → VIP is on', async () => {
    const u = await student()
    await handleShopUpdate(db, bot, text('/plans'))
    expect(buttons().map((b) => b.text)).toEqual(['Pro', 'VIP'])

    await handleShopUpdate(db, bot, press('p:vip'))
    expect(buttons()[0]!.text).toMatch(/^1개월 — 14,900원/)

    await handleShopUpdate(db, bot, press('m:vip:3'))
    expect(buttons().some((b) => 'callback_data' in b && b.callback_data === 'pay:vip:3:test')).toBe(true)

    await handleShopUpdate(db, bot, press('pay:vip:3:test'))
    const [pay] = await db.select().from(payments)
    expect(pay!.status).toBe('created')

    await handleShopUpdate(db, bot, press(`tp:${pay!.id}`))
    expect((await db.select().from(payments))[0]!.status).toBe('paid')
    expect((await db.select().from(subscriptions))[0]!.status).toBe('active')
    expect(await studentPlan(db, u.id)).toBe('vip')
  })

  it("can't mark someone else's order paid", async () => {
    await student()
    await handleShopUpdate(db, bot, press('pay:pro:1:test'))
    const [pay] = await db.select().from(payments)
    await db.update(users).set({ telegramChatId: null })
    await db.insert(users).values({ role: 'student', roles: ['student'], phone: '+998909998877', telegramChatId: String(CHAT) })
    await handleShopUpdate(db, bot, press(`tp:${pay!.id}`))
    expect((await db.select().from(payments))[0]!.status).toBe('created')
  })
})

describe('Paying by bank transfer (until a payment gateway is connected)', () => {
  const ADMIN = 9990001
  const env = { ...process.env }
  beforeEach(() => {
    process.env.PAY_ACCOUNT_NUMBER = '110-123-456789'
    process.env.PAY_BANK_NAME = '신한은행'
    process.env.PAY_ACCOUNT_HOLDER = '김지은'
    process.env.PAY_ADMIN_CHAT_ID = String(ADMIN)
    process.env.OWNER_PHONES = '+998935550000'
  })
  afterEach(() => {
    process.env = { ...env }
  })
  const receipt = (messageId = 50): TgUpdate => ({ update_id: 4, message: { message_id: messageId, chat: { id: CHAT, type: 'private' }, from: { id: CHAT }, photo: [{ file_id: 'f1' }] } })
  const adminPress = (data: string, chat = ADMIN): TgUpdate => ({
    update_id: 5,
    callback_query: { id: 'a', from: { id: 1, first_name: 'Ali' }, data, message: { message_id: 9, chat: { id: chat, type: 'group' } } },
  })

  async function order() {
    // The owner, whose Telegram (user id 1) presses Approve in the admins' group
    await db.insert(users).values({ role: 'teacher', roles: ['teacher'], phone: '+998935550000', telegramChatId: '1' })
    const u = await student()
    await handleShopUpdate(db, bot, press('m:vip:1'))
    expect(buttons().some((b) => 'callback_data' in b && b.callback_data === 'card:vip:1')).toBe(true)
    await handleShopUpdate(db, bot, press('card:vip:1'))
    const [pay] = await db.select().from(payments)
    return { u, pay: pay! }
  }

  it('shows the account, the exact amount and a copy button; the confirmation goes to the admins; approving turns VIP on', async () => {
    const { u, pay } = await order()
    expect(pay.provider).toBe('card')
    expect(sent.at(-1)!.text).toContain('신한은행 110-123-456789')
    expect(sent.at(-1)!.text).toContain('예금주: 김지은')
    expect(sent.at(-1)!.text).toContain('14,900원')
    expect(buttons()).toContainEqual({ text: '📋 계좌번호 복사', copy_text: { text: '110123456789' } })

    expect(await handleReceipt(db, bot, receipt())).toBe(true)
    expect(copied).toHaveLength(1)
    expect(copied[0]).toMatchObject({ to: String(ADMIN), from: String(CHAT), messageId: 50 })
    expect((await db.select().from(payments))[0]!.status).toBe('pending')

    // Someone outside the admins' chat can't approve
    await handleShopUpdate(db, bot, adminPress(`ok:${pay.id}`, 1234))
    expect((await db.select().from(payments))[0]!.status).toBe('pending')
    // Nor can a group member who isn't staff with Money
    await handleShopUpdate(db, bot, { update_id: 5, callback_query: { id: 'b', from: { id: 2, first_name: 'Vali' }, data: `ok:${pay.id}`, message: { message_id: 9, chat: { id: ADMIN, type: 'group' } } } })
    expect((await db.select().from(payments))[0]!.status).toBe('pending')

    await handleShopUpdate(db, bot, adminPress(`ok:${pay.id}`))
    expect((await db.select().from(payments))[0]!.status).toBe('paid')
    expect(await studentPlan(db, u.id)).toBe('vip')
    // A second press does nothing more
    await handleShopUpdate(db, bot, adminPress(`no:${pay.id}`))
    expect((await db.select().from(payments))[0]!.status).toBe('paid')
  })

  it("a paid course: the course page's link → bank transfer → confirmation → approved; the course is the buyer's, the teacher's 60% recorded", async () => {
    await db.insert(users).values({ role: 'teacher', roles: ['teacher'], phone: '+998935550000', telegramChatId: '1' })
    const [teacher] = await db.insert(users).values({ role: 'teacher', roles: ['teacher'], phone: '+998935550001', fullName: 'Nodira' }).returning()
    const [c] = await db
      .insert(courses)
      .values({ teacherId: teacher!.id, slug: 'ielts-ab12', title: 'IELTS 6.5', visibility: 'unlisted', priceKrw: 150_000, reviewStatus: 'approved', lessonCount: 1 })
      .returning()
    const u = await student()
    expect(isShopUpdate(text(`/start course_${c!.id}`))).toBe(true)
    await handleShopUpdate(db, bot, text(`/start course_${c!.id}`))
    expect(sent.at(-1)!.text).toContain('“IELTS 6.5” 강좌')
    await handleShopUpdate(db, bot, press(`kcard:${c!.id}`))
    expect(sent.at(-1)!.text).toContain('150,000원')
    expect(sent.at(-1)!.text).toContain('구매한 강좌가 열리지')
    expect(await handleReceipt(db, bot, receipt())).toBe(true)
    expect(copied.at(-1)!.caption).toContain('강좌 “IELTS 6.5”')
    const [pay] = await db.select().from(payments)
    expect(pay).toMatchObject({ commissionTeacherId: teacher!.id, commissionKrw: 90_000 })
    await handleShopUpdate(db, bot, adminPress(`ok:${pay!.id}`))
    const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.studentId, u.id))
    expect(sub).toMatchObject({ courseId: c!.id, status: 'active', priceKrw: 150_000 })
    // Its own plan is unchanged; asking again says it's theirs
    expect(await studentPlan(db, u.id)).toBe('free')
    await handleShopUpdate(db, bot, text(`/start course_${c!.id}`))
    expect(sent.at(-1)!.text).toContain('이미 구매한 강좌예요')
  })

  it('rejecting tells the buyer and leaves them on Free', async () => {
    const { u, pay } = await order()
    await handleReceipt(db, bot, receipt())
    await handleShopUpdate(db, bot, adminPress(`no:${pay.id}`))
    expect((await db.select().from(payments))[0]!.status).toBe('cancelled')
    expect(sent.some((m) => m.chatId === String(CHAT) && m.text.includes('확인되지 않았어요'))).toBe(true)
    expect(await studentPlan(db, u.id)).toBe('free')
  })

  it('the order says the receipt is needed; a buyer who sends none is reminded once, after an hour', async () => {
    const { pay } = await order()
    expect(sent.at(-1)!.text).toContain('이체 확인 화면을 보내지 않으면 결제를 확인할 수 없어서')
    const keys = new Set<string>()
    const claim = async (k: string) => !keys.has(k) && !!keys.add(k)
    const made = pay.createdAt.getTime()
    // Too soon
    expect(await remindCardReceipts(db, bot, claim, new Date(made + 30 * 60_000))).toBe(0)
    expect(await remindCardReceipts(db, bot, claim, new Date(made + 2 * 3600_000))).toBe(1)
    expect(sent.at(-1)).toMatchObject({ chatId: String(CHAT), text: expect.stringContaining('이체 확인 화면을 아직 받지 못했어요') })
    // Once only
    expect(await remindCardReceipts(db, bot, claim, new Date(made + 5 * 3600_000))).toBe(0)
    // A buyer who sent the receipt isn't reminded
    await handleReceipt(db, bot, receipt())
    expect(await remindCardReceipts(db, bot, async () => true, new Date(made + 2 * 3600_000))).toBe(0)
  })

  it('a photo with no transfer order waiting is an ordinary message', async () => {
    await student()
    expect(await handleReceipt(db, bot, receipt())).toBe(false)
    expect(copied).toHaveLength(0)
  })

  it("the website's button opens the bot on the plan already chosen", async () => {
    await student()
    expect(isShopUpdate(text('/start plan_vip_3'))).toBe(true)
    await handleShopUpdate(db, bot, text('/start plan_vip_3'))
    expect(sent.at(-1)!.text).toMatch(/^VIP, 3개월/)
  })
})

describe('Buying in Telegram alone, and the owner\'s channel posts', () => {
  const env = { ...process.env }
  afterEach(() => {
    process.env = { ...env }
  })

  it('/start keeps the shop button under the chat and goes straight on to the plans', async () => {
    await student()
    await handleTelegramUpdate(db, bot, text('/start'))
    expect(sent.at(-2)!.markup).toMatchObject({ keyboard: [[{ text: SHOP_BUTTON }]] })
    expect(sent.at(-1)!.text).toContain('어떤 요금제를 구매하시겠어요?')
    expect(isShopUpdate(text(SHOP_BUTTON))).toBe(true)
  })

  it('a number with no account gets a student account, named as in Telegram, then the plans', async () => {
    await handleTelegramUpdate(db, bot, {
      update_id: 3,
      message: { chat: { id: CHAT, type: 'private' }, from: { id: CHAT }, contact: { phone_number: '998907776655', user_id: CHAT, first_name: 'Jieun', last_name: 'Kim' } },
    })
    const [u] = await db.select().from(users).where(eq(users.phone, '+998907776655'))
    expect(u).toMatchObject({ fullName: 'Jieun Kim', roles: ['student'], telegramChatId: String(CHAT) })
    expect(sent.at(-1)!.text).toContain('어떤 요금제를 구매하시겠어요?')
  })

  it('the owner previews a post, then it goes to the channel with only the shop button', async () => {
    process.env.OWNER_PHONES = '+998901112233'
    process.env.TELEGRAM_CHANNEL_ID = '@ikhimi_test'
    process.env.TELEGRAM_BOT_USERNAME = 'ikhimi_bot'
    await student()
    expect(isShopUpdate(text('/post VIP로 AI 튜터와 함께'))).toBe(true)
    await handleShopUpdate(db, bot, text('/post VIP로 AI 튜터와 함께'))
    expect(sent.at(-1)!.text).toBe('VIP로 AI 튜터와 함께')
    expect(buttons()).toContainEqual({ text: SHOP_BUTTON, url: 'https://t.me/ikhimi_bot?start=plan' })

    await handleShopUpdate(db, bot, press('post'))
    expect(copied).toEqual([{ to: '@ikhimi_test', from: String(CHAT), messageId: 1, caption: undefined, markup: { inline_keyboard: [[{ text: SHOP_BUTTON, url: 'https://t.me/ikhimi_bot?start=plan' }]] } }])
  })

  it('a photo with /post as its caption is previewed as a photo', async () => {
    process.env.OWNER_PHONES = '+998901112233'
    process.env.TELEGRAM_CHANNEL_ID = '@ikhimi_test'
    await student()
    const photo: TgUpdate = { update_id: 6, message: { message_id: 7, chat: { id: CHAT, type: 'private' }, from: { id: CHAT }, caption: '/post 새 강좌', photo: [{ file_id: 'small' }, { file_id: 'big' }] } }
    expect(isShopUpdate(photo)).toBe(true)
    await handleShopUpdate(db, bot, photo)
    expect(photos[0]).toMatchObject({ fileId: 'big', caption: '새 강좌' })
  })

  it('nobody else can post', async () => {
    process.env.OWNER_PHONES = '+998900000000'
    process.env.TELEGRAM_CHANNEL_ID = '@ikhimi_test'
    await student()
    await handleShopUpdate(db, bot, text('/post 안녕하세요'))
    await handleShopUpdate(db, bot, press('post'))
    expect(sent).toHaveLength(0)
    expect(copied).toHaveLength(0)
  })
})
