/**
 * Buying Pro or VIP inside the bot (and paid courses: the course page's t.me/<bot>?start=course_<id>, DECISIONS.md BL): /plans (or a channel post's t.me/<bot>?start=plan button, or the website's
 * t.me/<bot>?start=plan_<plan>_<months>) → plan → months → a payment gateway once one is connected, or a bank transfer
 * (payments/card.ts: the buyer sends the transfer confirmation, an admin approves it here). The money goes through the
 * same payments as the website (teacher commission, Admin → Money). Telegram's own invoices are not used: for digital
 * goods they accept only Stars.
 */
import { and, courses, desc, eq, gt, inArray, isNull, lt, payments, subscriptions, users, type Db } from '@ikhimi/db'
import { planTotal, pricingMonths, type PaidPlan } from '@ikhimi/ai'
import { formatDate, formatKrw, normalizePhone } from '@ikhimi/i18n'
import { can, ownerPhones, staffAccess } from '../admin/staff'
import { findOrCreateUserByPhone } from '../auth/users'
import { SITE } from '../../content/site'
import { cardAdminChats, cardPayment } from '../payments/card'
import { createCoursePayment, createPlanPayment, loadPayment, markCancelled, markPaid, markPending, payerId, paymentCourse, type ProviderId } from '../payments/core'
import { enabledProviders, PROVIDERS, testProvider } from '../payments/providers'
import { ownsCourse } from '../courses'
import { studentPlanInfo } from '../plans'
import { getPricing } from '../pricing'
import { TelegramBotApi, type BotApi, type InlineButton, type ReplyMarkup, type TgUpdate } from './api'

/** The bot plus button presses, and passing a transfer confirmation on to the admins */
export type ShopBot = BotApi & {
  answerCallback(id: string, text?: string): Promise<void>
  copyMessage(toChatId: string, fromChatId: string, messageId: number, caption?: string, replyMarkup?: ReplyMarkup): Promise<void>
  editButtons(chatId: string, messageId: number, replyMarkup?: ReplyMarkup): Promise<void>
  sendPhoto(chatId: string, fileId: string, caption: string, replyMarkup?: ReplyMarkup): Promise<void>
}

/** The shop's button: kept under the bot's chat (/start) and under channel posts */
export const SHOP_BUTTON = '💳 요금제 구매'

const NAME: Record<PaidPlan, string> = { pro: 'Pro', vip: 'VIP' }
const won = (n: number) => formatKrw(n, '원')
const BACK: InlineButton = { text: '← 뒤로', callback_data: 'shop' }

/** Updates the shop answers: /plans, /start plan, the menu button, and any inline button press */
export function isShopUpdate(u: TgUpdate) {
  if (u.callback_query) return true
  const m = u.message
  if (!m || m.chat.type !== 'private') return false
  // The owner's channel post (text, or a photo's caption)
  if (/^\/post(\s|$)/.test(m.text ?? m.caption ?? '')) return true
  return /^\/(plans|start plan(_(pro|vip)_\d{1,2})?|start course_[0-9A-Za-z]{10,40})$/.test(m.text ?? '') || m.text === SHOP_BUTTON
}

const linkedUser = async (db: Db, chatId: string) =>
  (await db.select().from(users).where(and(eq(users.telegramChatId, chatId), isNull(users.deletedAt), isNull(users.blockedAt))).limit(1))[0]

export async function handleShopUpdate(db: Db, bot: ShopBot, update: TgUpdate): Promise<void> {
  const cb = update.callback_query
  const chatId = String(cb?.message?.chat.id ?? update.message?.chat.id ?? '')
  if (!chatId) return
  if (cb) await bot.answerCallback(cb.id).catch(() => {})
  // An admin approving or rejecting a transfer confirmation (in the admins' chat, often a group)
  if (cb && /^(ok|no):/.test(cb.data ?? '')) return reviewCardPayment(db, bot, cb)
  // The owner's channel post: written, previewed, then posted
  if (/^\/post(\s|$)/.test(update.message?.text ?? update.message?.caption ?? '')) return preparePost(db, bot, update.message!)
  if (cb && (cb.data === 'post' || cb.data === 'unpost')) return publishPost(db, bot, cb)
  if (!chatId || (cb?.message && cb.message.chat.type !== 'private')) return

  const user = await linkedUser(db, chatId)
  if (!user) {
    return bot.sendMessage(chatId, '요금제를 사려면 먼저 익히미 계정을 연결하세요. 아래 버튼으로 전화번호를 보내 주세요.', {
      keyboard: [[{ text: '📱 내 번호 보내기', request_contact: true }]],
      resize_keyboard: true,
      one_time_keyboard: true,
    })
  }

  // The website's "pay in Telegram" button opens the bot on the plan and months already chosen, or on a paid course
  const deep = /^\/start plan_(pro|vip)_(\d{1,2})$/.exec(update.message?.text ?? '')
  const course = /^\/start course_([0-9A-Za-z]{10,40})$/.exec(update.message?.text ?? '')
  const [step, a, b, c] = (cb?.data ?? (deep ? `m:${deep[1]}:${deep[2]}` : course ? `k:${course[1]}` : 'shop')).split(':')
  if ((step === 'k' || step === 'kcard' || step === 'kpay') && a) return courseShop(db, bot, chatId, user.id, step, a, b)
  const pricing = await getPricing(db)

  if (step === 'p' && (a === 'pro' || a === 'vip')) {
    const rows = pricingMonths(pricing).flatMap((m) => {
      const total = planTotal(pricing, a, m)
      const off = pricing.periodDiscount[String(m)] ?? 0
      return total ? [[{ text: `${m}개월 — ${won(total)}${off ? ` (−${off}%)` : ''}`, callback_data: `m:${a}:${m}` }]] : []
    })
    return bot.sendMessage(chatId, `${NAME[a]}: 몇 개월 이용하시겠어요?`, { inline_keyboard: [...rows, [BACK]] })
  }

  if (step === 'cx' && a) return cancelCardPayment(db, bot, chatId, user.id, a)
  if (step === 'rc') {
    const order = a ? await loadPayment(db, a) : null
    return bot.sendMessage(chatId, `📎 이체 확인 화면(스크린샷 또는 PDF)을 이 채팅에 보내 주세요.\n\n${noReceipt(!!order?.subscription?.courseId)}`)
  }

  if ((step === 'm' || step === 'pay' || step === 'card') && (a === 'pro' || a === 'vip')) {
    const months = Number(b)
    const total = planTotal(pricing, a, months)
    if (!total || !pricingMonths(pricing).includes(months)) return bot.sendMessage(chatId, '이 요금제는 지금 판매하지 않아요.', { inline_keyboard: [[BACK]] })
    const providers = enabledProviders()
    const card = cardPayment()

    if (step === 'm') {
      if (!providers.length && !card) return bot.sendMessage(chatId, '아직 결제 수단이 연결되지 않았어요. 곧 여기서 결제할 수 있어요.', { inline_keyboard: [[BACK]] })
      const methods: InlineButton[][] = [
        ...(providers.length ? [providers.map((p) => ({ text: p.label, callback_data: `pay:${a}:${months}:${p.id}` }))] : []),
        ...(card ? [[{ text: '🏦 계좌이체', callback_data: `card:${a}:${months}` }]] : []),
      ]
      return bot.sendMessage(
        chatId,
        `${NAME[a]}, ${months}개월 — ${won(total)}\n\n결제 방법을 고르세요. 결제하면 이용약관과 환불 규정에 동의하게 돼요.`,
        { inline_keyboard: [...methods, [BACK]] },
      )
    }

    if (step === 'card') {
      if (!card) return bot.sendMessage(chatId, '이 결제 방법은 지금 쓸 수 없어요.', { inline_keyboard: [[BACK]] })
      const { payment } = await createPlanPayment(db, { studentId: user.id, plan: a, months, provider: 'card', offerVersion: SITE.legalVersion })
      return bot.sendMessage(
        chatId,
        [
          `🏦 ${NAME[a]}, ${months}개월 — ${won(payment.amountKrw)}`,
          '',
          `1. 아래 계좌로 정확히 ${won(payment.amountKrw)}을 이체하세요:`,
          ...accountLines(card),
          '',
          '2. 이체 확인 화면(스크린샷 또는 PDF)을 이 채팅에 보내 주세요.',
          '',
          `주문 번호: #${orderCode(payment.id)}`,
          '확인되면 요금제가 켜지고 여기로 메시지가 와요.',
          '',
          NO_RECEIPT,
        ].join('\n'),
        {
          inline_keyboard: [
            [{ text: '📋 계좌번호 복사', copy_text: { text: card.number } }],
            [{ text: '📎 이체 확인 보내기', callback_data: `rc:${payment.id}` }],
            [{ text: '❌ 취소', callback_data: `cx:${payment.id}` }],
          ],
        },
      )
    }

    const provider = PROVIDERS[c as ProviderId]
    if (!provider || !providers.includes(provider)) return bot.sendMessage(chatId, '이 결제 방법은 지금 쓸 수 없어요.', { inline_keyboard: [[BACK]] })
    const { payment } = await createPlanPayment(db, { studentId: user.id, plan: a, months, provider: provider.id, offerVersion: SITE.legalVersion })
    // The test provider has no page to open from Telegram: a button marks the order paid instead
    if (provider === testProvider) {
      return bot.sendMessage(chatId, `테스트 결제: ${won(payment.amountKrw)}`, { inline_keyboard: [[{ text: '✅ 결제 완료 (테스트)', callback_data: `tp:${payment.id}` }]] })
    }
    const bot_ = process.env.TELEGRAM_BOT_USERNAME
    const url = provider.checkoutUrl({
      paymentId: payment.id,
      amountKrw: payment.amountKrw,
      // After paying, the provider's page sends the buyer back to the bot, not to the website
      returnUrl: bot_ ? `https://t.me/${bot_}` : 'https://t.me',
      description: `익히미 ${NAME[a]}`,
    })
    return bot.sendMessage(chatId, `${NAME[a]}, ${months}개월 — ${won(payment.amountKrw)}\n결제하면 요금제가 바로 켜지고 여기로 메시지가 와요.`, {
      inline_keyboard: [[{ text: `${provider.label}(으)로 결제`, url }]],
    })
  }

  if (step === 'tp' && a && testProvider.enabled()) {
    const row = await loadPayment(db, a)
    if (!row || row.payment.provider !== 'test' || payerId(row) !== user.id) return
    await markPaid(db, row.payment.id, { test: true })
    return
  }

  // The menu
  const info = await studentPlanInfo(db, user.id)
  const now = info.plan === 'free' ? 'Free' : `${NAME[info.plan]}${info.until ? `, ${formatDate(info.until)}까지` : ''}`
  const plans = (['pro', 'vip'] as const).filter((p) => pricing.monthly[p])
  if (!plans.length) return bot.sendMessage(chatId, `지금 요금제: ${now}\n\n지금은 판매 중인 요금제가 없어요.`)
  return bot.sendMessage(chatId, `지금 요금제: ${now}\n\n${plans.map((p) => `${NAME[p]} — 월 ${won(pricing.monthly[p]!)}`).join('\n')}\n\n어떤 요금제를 구매하시겠어요?`, {
    inline_keyboard: [plans.map((p) => ({ text: NAME[p], callback_data: `p:${p}` }))],
  })
}

/**
 * A paid course in the bot: its price and the ways to pay (the same bank transfer and providers as plans). Bought
 * once, it's the buyer's for life; the teacher's share is recorded with the payment.
 */
async function courseShop(db: Db, bot: ShopBot, chatId: string, userId: string, step: string, courseId: string, providerId?: string) {
  const [c] = await db.select().from(courses).where(and(eq(courses.id, courseId), isNull(courses.deletedAt))).limit(1)
  if (!c || !c.priceKrw || c.reviewStatus !== 'approved' || c.visibility === 'private') return bot.sendMessage(chatId, '이 강좌는 지금 판매하지 않아요.')
  const [bought] = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(and(eq(subscriptions.studentId, userId), eq(subscriptions.courseId, c.id), eq(subscriptions.status, 'active'), ownsCourse))
    .limit(1)
  if (bought) return bot.sendMessage(chatId, `✅ 이미 구매한 강좌예요: “${c.title}”. 앱이나 웹사이트의 ‘강좌’에서 열어 보세요.`)
  if (c.teacherId === userId) return bot.sendMessage(chatId, '내가 만든 강좌예요.')
  const providers = enabledProviders()
  const card = cardPayment()

  if (step === 'k') {
    if (!providers.length && !card) return bot.sendMessage(chatId, '아직 결제 수단이 연결되지 않았어요. 곧 여기서 결제할 수 있어요.')
    const methods: InlineButton[][] = [
      ...(providers.length ? [providers.map((p) => ({ text: p.label, callback_data: `kpay:${c.id}:${p.id}` }))] : []),
      ...(card ? [[{ text: '🏦 계좌이체', callback_data: `kcard:${c.id}` }]] : []),
    ]
    return bot.sendMessage(
      chatId,
      `📚 “${c.title}” 강좌 — ${won(c.priceKrw)}\n한 번 결제하면 강좌 전체가 열려요.\n\n결제 방법을 고르세요. 결제하면 이용약관과 환불 규정에 동의하게 돼요.`,
      { inline_keyboard: methods },
    )
  }

  if (step === 'kcard') {
    if (!card) return bot.sendMessage(chatId, '이 결제 방법은 지금 쓸 수 없어요.')
    const { payment } = await createCoursePayment(db, { studentId: userId, courseId: c.id, provider: 'card', offerVersion: SITE.legalVersion })
    return bot.sendMessage(
      chatId,
      [
        `🏦 “${c.title}” 강좌 — ${won(payment.amountKrw)}`,
        '',
        `1. 아래 계좌로 정확히 ${won(payment.amountKrw)}을 이체하세요:`,
        ...accountLines(card),
        '',
        '2. 이체 확인 화면(스크린샷 또는 PDF)을 이 채팅에 보내 주세요.',
        '',
        `주문 번호: #${orderCode(payment.id)}`,
        '확인되면 강좌가 열리고 여기로 메시지가 와요.',
        '',
        noReceipt(true),
      ].join('\n'),
      {
        inline_keyboard: [
          [{ text: '📋 계좌번호 복사', copy_text: { text: card.number } }],
          [{ text: '📎 이체 확인 보내기', callback_data: `rc:${payment.id}` }],
          [{ text: '❌ 취소', callback_data: `cx:${payment.id}` }],
        ],
      },
    )
  }

  const provider = PROVIDERS[providerId as ProviderId]
  if (!provider || !providers.includes(provider)) return bot.sendMessage(chatId, '이 결제 방법은 지금 쓸 수 없어요.')
  const { payment } = await createCoursePayment(db, { studentId: userId, courseId: c.id, provider: provider.id, offerVersion: SITE.legalVersion })
  if (provider === testProvider) {
    return bot.sendMessage(chatId, `테스트 결제: ${won(payment.amountKrw)}`, { inline_keyboard: [[{ text: '✅ 결제 완료 (테스트)', callback_data: `tp:${payment.id}` }]] })
  }
  const bot_ = process.env.TELEGRAM_BOT_USERNAME
  const url = provider.checkoutUrl({ paymentId: payment.id, amountKrw: payment.amountKrw, returnUrl: bot_ ? `https://t.me/${bot_}` : 'https://t.me', description: `익히미: ${c.title}`.slice(0, 120) })
  return bot.sendMessage(chatId, `“${c.title}” 강좌 — ${won(payment.amountKrw)}\n결제하면 강좌가 바로 열리고 여기로 메시지가 와요.`, {
    inline_keyboard: [[{ text: `${provider.label}(으)로 결제`, url }]],
  })
}

/**
 * A shared contact with no login waiting: link this chat to the 익히미 account with that phone, then open the
 * shop. Only the sender's own contact counts (Telegram has verified that number). A number with no account yet gets
 * a student account here, named as in Telegram: buying needs no visit to the website, and signing in there or in the
 * app with Telegram later opens the same account.
 */
export async function linkByContact(db: Db, bot: ShopBot, update: TgUpdate): Promise<void> {
  const m = update.message
  if (!m?.contact || m.chat.type !== 'private') return
  const chatId = String(m.chat.id)
  if (!m.from || m.contact.user_id !== m.from.id) return bot.sendMessage(chatId, '버튼으로 본인 번호를 보내 주세요.')
  const raw = m.contact.phone_number
  const phone = normalizePhone(raw.startsWith('+') ? raw : `+${raw}`)
  if (!phone) return bot.sendMessage(chatId, '번호를 읽지 못했어요. 버튼으로 다시 보내 주세요.')
  const { user, isNew } = await findOrCreateUserByPhone(db, { phone, role: 'student', uiLocale: 'ko' })
  if (user.blockedAt) return bot.sendMessage(chatId, '차단된 계정이에요. 궁금한 점은 고객센터에 문의하세요.', { remove_keyboard: true })
  const name = [m.contact.first_name, m.contact.last_name].filter(Boolean).join(' ').trim()
  if (isNew && name.length >= 2 && !user.fullName) await db.update(users).set({ fullName: name }).where(eq(users.id, user.id))
  // One chat, one account: an earlier link from this chat moves to this one
  await db.update(users).set({ telegramChatId: null }).where(eq(users.telegramChatId, chatId))
  await db.update(users).set({ telegramChatId: chatId }).where(eq(users.id, user.id))
  await bot.sendMessage(chatId, isNew ? '✅ 익히미 계정이 만들어졌어요.' : '✅ 계정이 연결됐어요.', { keyboard: [[{ text: SHOP_BUTTON }]], resize_keyboard: true })
  return handleShopUpdate(db, bot, { update_id: update.update_id, message: { ...m, contact: undefined, text: '/plans' } })
}

/** After a plan or a course is paid (on the site or in the bot): tell the buyer in Telegram, if their account is linked */
export async function notifyPlanPaid(db: Db, paymentId: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return
  const row = await loadPayment(db, paymentId)
  const sub = row?.subscription
  if (!row || !sub) return
  const [user] = await db.select({ chatId: users.telegramChatId }).from(users).where(eq(users.id, sub.studentId)).limit(1)
  if (!user?.chatId) return
  const course = await paymentCourse(db, row)
  if (course) return void (await new TelegramBotApi(token).sendMessage(user.chatId, `✅ 결제가 확인됐어요: “${course.title}” 강좌가 열렸어요. ‘강좌’에서 찾을 수 있어요.`))
  if (sub.plan !== 'pro' && sub.plan !== 'vip') return
  const until = sub.periodEnd ? ` (${formatDate(sub.periodEnd)}까지)` : ''
  await new TelegramBotApi(token).sendMessage(user.chatId, `✅ 결제가 확인됐어요: ${NAME[sub.plan]} 요금제가 켜졌어요${until}.`)
}

// ─── bank transfers (payments/card.ts) ──────────────────────────────────────

/** A short order number the buyer and the admins both see */
const orderCode = (paymentId: string) => paymentId.slice(-6).toUpperCase()

/** The account to transfer to: bank and number, then the holder */
const accountLines = (a: NonNullable<ReturnType<typeof cardPayment>>) => [[a.bank, a.pretty].filter(Boolean).join(' '), ...(a.holder ? [`예금주: ${a.holder}`] : [])]

/** Said with every transfer order, and in the reminder: without the confirmation the plan (or course) can't be turned on */
const NO_RECEIPT = '⚠️ 이체 확인 화면을 보내지 않으면 결제를 확인할 수 없어서 구매한 요금제가 켜지지 않을 수 있어요. 꼭 이 채팅에 보내 주세요. 감사합니다!'
const noReceipt = (course: boolean) => (course ? NO_RECEIPT.replace('구매한 요금제가 켜지지', '구매한 강좌가 열리지') : NO_RECEIPT)

/**
 * The daily job: a transfer order still waiting for its confirmation (made an hour to three days ago) gets one reminder
 * in the bot. Buyers pay and forget to send it; the owner can't turn the plan on without it.
 */
export async function remindCardReceipts(db: Db, bot: BotApi, claim: (key: string) => Promise<boolean>, now = new Date()) {
  const rows = await db
    .select({ payment: payments, chatId: users.telegramChatId, courseId: subscriptions.courseId })
    .from(payments)
    .innerJoin(subscriptions, eq(subscriptions.id, payments.subscriptionId))
    .innerJoin(users, eq(users.id, subscriptions.studentId))
    .where(
      and(
        eq(payments.provider, 'card'),
        eq(payments.status, 'created'),
        lt(payments.createdAt, new Date(now.getTime() - 3600_000)),
        gt(payments.createdAt, new Date(now.getTime() - 3 * 86400_000)),
      ),
    )
  let sent = 0
  for (const r of rows) {
    if (!r.chatId || !(await claim(`card-receipt:${r.payment.id}`))) continue
    await bot
      .sendMessage(
        r.chatId,
        `⏰ 알림: 주문 #${orderCode(r.payment.id)} (${won(r.payment.amountKrw)})의 이체 확인 화면을 아직 받지 못했어요.\n\n이체하셨다면 확인 화면(스크린샷 또는 PDF)을 이 채팅에 보내 주세요.\n\n${noReceipt(!!r.courseId)}`,
        { inline_keyboard: [[{ text: '📎 이체 확인 보내기', callback_data: `rc:${r.payment.id}` }], [{ text: '❌ 취소', callback_data: `cx:${r.payment.id}` }]] },
      )
      .then(() => sent++)
      .catch(() => {})
  }
  return sent
}

/** The buyer's latest transfer order still waiting (made in the last 2 days), if any */
async function openCardOrder(db: Db, studentId: string) {
  const [row] = await db
    .select({ id: payments.id })
    .from(payments)
    .innerJoin(subscriptions, eq(subscriptions.id, payments.subscriptionId))
    .where(
      and(
        eq(subscriptions.studentId, studentId),
        eq(payments.provider, 'card'),
        inArray(payments.status, ['created', 'pending']),
        gt(payments.createdAt, new Date(Date.now() - 2 * 86400_000)),
      ),
    )
    .orderBy(desc(payments.createdAt))
    .limit(1)
  return row ? loadPayment(db, row.id) : null
}

/**
 * A photo or file in the bot's private chat from someone with a transfer order waiting: their confirmation. It goes to
 * the admins with Approve / Reject. False when it isn't one (then it's an ordinary message, e.g. for support).
 */
export async function handleReceipt(db: Db, bot: ShopBot, update: TgUpdate): Promise<boolean> {
  const m = update.message
  if (!m || m.chat.type !== 'private' || !m.message_id || (!m.photo?.length && !m.document)) return false
  const chatId = String(m.chat.id)
  const user = await linkedUser(db, chatId)
  if (!user) return false
  const row = await openCardOrder(db, user.id)
  const sub = row?.subscription
  if (!row || !sub) return false
  const course = await paymentCourse(db, row)
  if (!course && sub.plan !== 'pro' && sub.plan !== 'vip') return false

  const admins = await cardAdminChats(db)
  if (!admins.length) {
    console.error('[card] a transfer confirmation came, but PAY_ADMIN_CHAT_ID is not set and no owner has linked Telegram')
    await bot.sendMessage(chatId, '이체 확인을 받을 수 없어요: 확인 담당자가 아직 설정되지 않았어요. 고객센터에 문의해 주세요.')
    return true
  }
  await markPending(db, row.payment.id, `card:${chatId}:${m.message_id}`, { receipt: { chatId, messageId: m.message_id, at: new Date().toISOString() } })
  const caption = [
    `🏦 계좌이체 #${orderCode(row.payment.id)}`,
    `${user.fullName?.trim() || '이름 없음'}`,
    course ? `📚 강좌 “${course.title}” — ${won(row.payment.amountKrw)}` : `${NAME[sub.plan as PaidPlan]}, ${sub.months}개월 — ${won(row.payment.amountKrw)}`,
    '',
    '계좌에 이 금액이 들어왔는지 확인하세요.',
  ].join('\n')
  const buttons: ReplyMarkup = {
    inline_keyboard: [
      [
        { text: '✅ 승인', callback_data: `ok:${row.payment.id}` },
        { text: '❌ 거절', callback_data: `no:${row.payment.id}` },
      ],
    ],
  }
  for (const admin of admins) await bot.copyMessage(admin, chatId, m.message_id, caption, buttons).catch((e) => console.error('[card] confirmation not passed on', e))
  await bot.sendMessage(chatId, `✅ 이체 확인을 받았어요 (#${orderCode(row.payment.id)}). 확인 후 ${course ? '강좌를 열어' : '요금제를 켜'} 드릴게요. 보통 몇 분에서 몇 시간 걸려요. 결과는 여기로 알려 드려요.`)
  return true
}

/** An admin pressed Approve or Reject under a transfer confirmation (only in the admins' chat) */
async function reviewCardPayment(db: Db, bot: ShopBot, cb: NonNullable<TgUpdate['callback_query']>) {
  const chatId = String(cb.message?.chat.id ?? '')
  if (!chatId || !(await cardAdminChats(db)).includes(chatId)) return
  // Being in the admins' chat isn't enough: the presser must be staff allowed to handle money (Telegram linked)
  if (!(await isMoneyStaff(db, cb.from.id))) {
    return bot.sendMessage(chatId, `${cb.from.first_name ?? '이 사용자'}: 결제는 ‘매출’ 권한이 있는 직원만 승인할 수 있어요 (텔레그램이 익히미 계정에 연결돼 있어야 해요).`)
  }
  const [action, paymentId] = (cb.data ?? '').split(':')
  const row = paymentId ? await loadPayment(db, paymentId) : null
  if (!row || row.payment.provider !== 'card') return
  const code = orderCode(row.payment.id)
  const by = cb.from.first_name ?? String(cb.from.id)
  if (cb.message) await bot.editButtons(chatId, cb.message.message_id).catch(() => {})
  if (row.payment.status === 'paid' || row.payment.status === 'cancelled') {
    return bot.sendMessage(chatId, `#${code}는 이미 처리됐어요 (${row.payment.status === 'paid' ? '승인됨' : '거절됨'}).`)
  }
  if (action === 'ok') {
    // The buyer hears it from markPaid (notifyPlanPaid)
    await markPaid(db, row.payment.id, { approvedBy: cb.from.id })
    return bot.sendMessage(chatId, `✅ #${code} 승인됨 (${by}).`)
  }
  await markCancelled(db, row.payment.id, { rejectedBy: cb.from.id })
  const buyer = payerId(row)
  const [u] = buyer ? await db.select({ chatId: users.telegramChatId }).from(users).where(eq(users.id, buyer)).limit(1) : []
  const again = row.subscription?.courseId ? '' : ' 다시 구매: /plans'
  if (u?.chatId) await bot.sendMessage(u.chatId, `❌ 결제 #${code}가 확인되지 않았어요. 궁금한 점은 고객센터에 문의하세요.${again}`).catch(() => {})
  return bot.sendMessage(chatId, `❌ #${code} 거절됨 (${by}).`)
}

/** A Telegram user (private chat id = their user id) whose 익히미 account is the owner or staff with Money */
async function isMoneyStaff(db: Db, telegramUserId: number) {
  const [u] = await db
    .select()
    .from(users)
    .where(and(eq(users.telegramChatId, String(telegramUserId)), isNull(users.deletedAt)))
    .limit(1)
  const access = u ? await staffAccess(db, u) : null
  return !!access && can(access, 'money')
}

/** The buyer changed their mind before sending the transfer confirmation */
async function cancelCardPayment(db: Db, bot: ShopBot, chatId: string, userId: string, paymentId: string) {
  const row = await loadPayment(db, paymentId)
  if (!row || row.payment.provider !== 'card' || payerId(row) !== userId) return
  if (row.payment.status !== 'created') return bot.sendMessage(chatId, '이체 확인을 이미 보냈어요. 이제 담당자가 확인해요.')
  await markCancelled(db, row.payment.id, { cancelledBy: 'buyer' })
  return bot.sendMessage(chatId, '취소됐어요.', { inline_keyboard: [[BACK]] })
}

// ─── the owner's channel posts ───────────────────────────────────────────────

/** The bot's shop, opened from a channel post's button */
const shopLink = () => `https://t.me/${process.env.TELEGRAM_BOT_USERNAME ?? ''}?start=plan`

/** The owner's own chat with the bot (OWNER_PHONES, linked by signing in with Telegram) */
async function isOwnerChat(db: Db, chatId: string) {
  const phones = ownerPhones()
  if (!phones.length) return false
  const [u] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.telegramChatId, chatId), inArray(users.phone, phones), isNull(users.deletedAt)))
    .limit(1)
  return !!u
}

/**
 * `/post <text>` (or a photo with `/post <text>` as its caption), from the owner: a preview with the shop's button, and
 * "post it" / "cancel". TELEGRAM_CHANNEL_ID is the channel (@name or its -100… id); the bot must be its admin.
 */
async function preparePost(db: Db, bot: ShopBot, m: NonNullable<TgUpdate['message']>) {
  const chatId = String(m.chat.id)
  if (!(await isOwnerChat(db, chatId))) return
  if (!process.env.TELEGRAM_CHANNEL_ID) return bot.sendMessage(chatId, '채널이 설정되지 않았어요: Vercel에 TELEGRAM_CHANNEL_ID(예: @channel_name)를 넣고 봇을 채널 관리자로 지정하세요.')
  const body = (m.text ?? m.caption ?? '').replace(/^\/post\s*/, '').trim()
  const photo = m.photo?.at(-1)?.file_id
  if (!body && !photo) return bot.sendMessage(chatId, '게시글을 쓰세요: /post 내용…\n사진과 함께: 사진을 보내고 설명에 /post 내용… 이라고 쓰세요.')
  const preview: ReplyMarkup = {
    inline_keyboard: [
      [{ text: SHOP_BUTTON, url: shopLink() }],
      [
        { text: '✅ 채널에 게시', callback_data: 'post' },
        { text: '❌ 취소', callback_data: 'unpost' },
      ],
    ],
  }
  if (photo) await bot.sendPhoto(chatId, photo, body, preview)
  else await bot.sendMessage(chatId, body, preview)
}

/** The owner confirmed (or cancelled) a preview: it goes to the channel with only the shop's button */
async function publishPost(db: Db, bot: ShopBot, cb: NonNullable<TgUpdate['callback_query']>) {
  const chatId = String(cb.message?.chat.id ?? '')
  const messageId = cb.message?.message_id
  if (!chatId || !messageId || !(await isOwnerChat(db, chatId))) return
  await bot.editButtons(chatId, messageId).catch(() => {})
  if (cb.data === 'unpost') return bot.sendMessage(chatId, '취소됐어요.')
  const channel = process.env.TELEGRAM_CHANNEL_ID
  if (!channel) return
  try {
    await bot.copyMessage(channel, chatId, messageId, undefined, { inline_keyboard: [[{ text: SHOP_BUTTON, url: shopLink() }]] })
    return bot.sendMessage(chatId, '✅ 채널에 게시됐어요.')
  } catch (e) {
    console.error('[post]', e)
    return bot.sendMessage(chatId, '게시하지 못했어요: 봇이 채널 관리자인지, TELEGRAM_CHANNEL_ID가 맞는지 확인하세요.')
  }
}
