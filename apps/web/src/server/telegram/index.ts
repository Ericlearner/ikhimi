import { env } from '../env'
import { TelegramBotApi } from './api'
import { looksLikePhone } from './login'

let bot: TelegramBotApi | undefined
export function getBot(): TelegramBotApi {
  const token = env().TELEGRAM_BOT_TOKEN
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN not set')
  bot ??= new TelegramBotApi(token)
  return bot
}

export const telegramLoginEnabled = () => !!env().TELEGRAM_BOT_TOKEN && !!env().TELEGRAM_BOT_USERNAME

/**
 * Does this update belong to login (a /start with a login token, a shared contact, or a number typed by hand)? A
 * number in the support admin chat is the admin's answer to a user, never a login.
 */
export function isLoginUpdate(u: { message?: { text?: string; contact?: unknown; chat: { id?: number; type: string } } }, adminChatId?: string) {
  const m = u.message
  if (!m || m.chat.type !== 'private') return false
  return !!m.contact || /^\/start(\s|$)/.test(m.text ?? '') || (looksLikePhone(m.text) && String(m.chat.id) !== adminChatId)
}

/** With no separate support bot configured, the login bot doubles as the support desk */
export const supportSharesLoginBot = () => !env().SUPPORT_BOT_TOKEN

/** The bot that runs the support desk (the separate support bot, or the login bot), or null without a token */
export function getSupportBot(): TelegramBotApi | null {
  const e = env()
  if (e.SUPPORT_BOT_TOKEN) return new TelegramBotApi(e.SUPPORT_BOT_TOKEN)
  return e.TELEGRAM_BOT_TOKEN ? getBot() : null
}
