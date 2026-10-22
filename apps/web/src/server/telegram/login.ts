/**
 * "Log in with Telegram" — free, no SMS. See telegramLogins in the schema for the flow. The browser that started it
 * waits for the number; once it is shared, the bot also sends a one-time "로그인" link, for someone whose browser
 * was lost on the way to Telegram (whichever comes first signs in; the other then finds it used).
 */
import { createHash, randomBytes } from 'node:crypto'
import { and, CONFIG, desc, eq, gt, sql, telegramLogins, type Db } from '@ikhimi/db'
import { DEFAULT_LOCALE, getTranslator, isLocale, normalizePhone, type Locale } from '@ikhimi/i18n'
import type { BotApi, TgUpdate } from './api'
import { handleShopUpdate, linkByContact, SHOP_BUTTON, type ShopBot } from './shop'

export const TELEGRAM_LOGIN_TTL_SECONDS = 10 * 60
const MAX_STARTS_PER_IP = 20 // per TTL window

const hash = (s: string) => createHash('sha256').update(s).digest('hex')

export async function startTelegramLogin(
  db: Db,
  input: { uiLocale: Locale; ipHash: string | null; as?: 'teacher' | 'student' | null; next?: string | null; now?: Date },
): Promise<{ token: string; expiresAt: Date } | { rateLimited: true }> {
  const now = input.now ?? new Date()
  if (input.ipHash) {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(telegramLogins)
      .where(and(eq(telegramLogins.ipHash, input.ipHash), gt(telegramLogins.createdAt, new Date(now.getTime() - TELEGRAM_LOGIN_TTL_SECONDS * 1000))))
    if ((row?.n ?? 0) >= MAX_STARTS_PER_IP) return { rateLimited: true }
  }
  // t.me start payloads allow [A-Za-z0-9_-], max 64 chars
  const token = randomBytes(24).toString('base64url')
  const expiresAt = new Date(now.getTime() + TELEGRAM_LOGIN_TTL_SECONDS * 1000)
  await db.insert(telegramLogins).values({ tokenHash: hash(token), uiLocale: input.uiLocale, ipHash: input.ipHash, asRole: input.as ?? null, next: input.next ?? null, expiresAt, createdAt: now })
  return { token, expiresAt }
}

export type LinkResult = { status: 'expired' } | { status: 'approved'; phone: string; telegramChatId: string; as: 'teacher' | 'student' | null; next: string | null; uiLocale: Locale }

/** The bot's "로그인" link: works once, while the login is approved and nobody (the browser) has used it yet */
export async function exchangeTelegramLink(db: Db, code: string, now = new Date()): Promise<LinkResult> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(code)) return { status: 'expired' }
  const [row] = await db
    .update(telegramLogins)
    .set({ status: 'consumed' })
    .where(and(eq(telegramLogins.linkHash, hash(code)), eq(telegramLogins.status, 'approved'), gt(telegramLogins.expiresAt, now)))
    .returning()
  if (!row?.phone || !row.telegramChatId) return { status: 'expired' }
  return { status: 'approved', phone: row.phone, telegramChatId: row.telegramChatId, as: row.asRole ?? null, next: row.next, uiLocale: row.uiLocale }
}

export type ExchangeResult =
  | { status: 'pending' }
  | { status: 'expired' }
  | { status: 'approved'; phone: string; telegramChatId: string }

/** Browser polls with its token. Approved → returned exactly once (then consumed). */
export async function exchangeTelegramLogin(db: Db, token: string, now = new Date()): Promise<ExchangeResult> {
  const [row] = await db.select().from(telegramLogins).where(eq(telegramLogins.tokenHash, hash(token))).limit(1)
  if (!row || row.status === 'consumed' || row.expiresAt <= now) return { status: 'expired' }
  if (row.status === 'pending') return { status: 'pending' }
  const claimed = await db
    .update(telegramLogins)
    .set({ status: 'consumed' })
    .where(and(eq(telegramLogins.id, row.id), eq(telegramLogins.status, 'approved')))
    .returning({ id: telegramLogins.id })
  if (claimed.length === 0) return { status: 'expired' }
  return { status: 'approved', phone: row.phone!, telegramChatId: row.telegramChatId! }
}

/** A message that is only a phone number typed by hand ("010-1234-5678", "01012345678") */
export function looksLikePhone(text: string | undefined): boolean {
  const t = (text ?? '').trim()
  if (!/^\+?[\d\s\-().]+$/.test(t)) return false
  const digits = t.replace(/\D/g, '').length
  return digits >= 9 && digits <= 15
}

/** The newest login this chat started that still waits for its number */
async function pendingLogin(db: Db, chatId: string, now: Date) {
  const [row] = await db
    .select()
    .from(telegramLogins)
    .where(and(eq(telegramLogins.telegramChatId, chatId), eq(telegramLogins.status, 'pending'), gt(telegramLogins.expiresAt, now)))
    .orderBy(desc(telegramLogins.createdAt))
    .limit(1)
  return row
}

/** Bot side: handle one update from Telegram (webhook or dev polling). */
export async function handleTelegramUpdate(db: Db, bot: BotApi, update: TgUpdate, now = new Date()): Promise<void> {
  const msg = update.message
  if (!msg || msg.chat.type !== 'private') return
  const chatId = String(msg.chat.id)
  const fallbackLocale: Locale = DEFAULT_LOCALE

  // /start <token>
  const start = msg.text?.match(/^\/start(?:\s+([A-Za-z0-9_-]{1,64}))?$/)
  if (start) {
    const token = start[1]
    // The plain /start: hello, the shop's button kept under the chat, and straight on to the plans (or the number, for
    // someone new): buying needs no other tap
    if (!token) {
      await bot.sendMessage(chatId, getTranslator(fallbackLocale)('tg.welcome'), { keyboard: [[{ text: SHOP_BUTTON }]], resize_keyboard: true })
      if ('answerCallback' in bot) await handleShopUpdate(db, bot as ShopBot, { update_id: update.update_id, message: { ...msg, text: '/plans' } })
      return
    }
    const [row] = await db.select().from(telegramLogins).where(eq(telegramLogins.tokenHash, hash(token))).limit(1)
    const t = getTranslator(row && isLocale(row.uiLocale) ? row.uiLocale : fallbackLocale)
    if (!row || row.status !== 'pending' || row.expiresAt <= now) return bot.sendMessage(chatId, t('tg.expired'))
    await db
      .update(telegramLogins)
      .set({ telegramChatId: chatId, telegramUserId: msg.from ? String(msg.from.id) : null })
      .where(eq(telegramLogins.id, row.id))
    return bot.sendMessage(chatId, t('tg.startPrompt'), {
      keyboard: [[{ text: t('tg.shareButton'), request_contact: true }]],
      resize_keyboard: true,
      one_time_keyboard: true,
    })
  }

  // A number typed by hand proves nothing (anyone can type any number): show the share button again. People who lost
  // the button type their number instead, and used to wait for an answer from support
  if (!msg.contact && looksLikePhone(msg.text)) {
    const row = await pendingLogin(db, chatId, now)
    const t = getTranslator(row && isLocale(row.uiLocale) ? row.uiLocale : fallbackLocale)
    return bot.sendMessage(chatId, t('tg.typedPhone'), { keyboard: [[{ text: t('tg.shareButton'), request_contact: true }]], resize_keyboard: true, one_time_keyboard: true })
  }

  // Shared contact
  if (msg.contact) {
    const row = await pendingLogin(db, chatId, now)
    const t = getTranslator(row && isLocale(row.uiLocale) ? row.uiLocale : fallbackLocale)
    // No login waiting: the contact links this chat for the bot's shop
    if (!row) return 'answerCallback' in bot ? linkByContact(db, bot as ShopBot, update) : bot.sendMessage(chatId, t('tg.expired'), { remove_keyboard: true })
    // Only the sender's own contact proves ownership of the number (a forwarded card would not).
    if (!msg.from || msg.contact.user_id !== msg.from.id) return bot.sendMessage(chatId, t('tg.notOwnContact'))
    const raw = msg.contact.phone_number
    const phone = normalizePhone(raw.startsWith('+') ? raw : `+${raw}`)
    if (!phone) return bot.sendMessage(chatId, t('tg.expired'), { remove_keyboard: true })
    // The browser that started this may be gone (closed, or left behind in another app): the bot's button signs in
    // too, once, for the next ten minutes
    const link = randomBytes(24).toString('base64url')
    await db
      .update(telegramLogins)
      .set({ status: 'approved', phone, linkHash: hash(link), expiresAt: new Date(now.getTime() + TELEGRAM_LOGIN_TTL_SECONDS * 1000) })
      .where(eq(telegramLogins.id, row.id))
    const url = `${CONFIG.publicOrigin.replace(/\/$/, '')}/api/auth/telegram/link?c=${link}`
    return bot.sendMessage(chatId, t('tg.done'), { inline_keyboard: [[{ text: t('tg.signInButton'), url }]] })
  }
}
