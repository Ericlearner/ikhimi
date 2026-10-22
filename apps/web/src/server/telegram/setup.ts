/**
 * The bot's setup with Telegram, all at once: the webhook (with button presses), the Menu commands, and the texts
 * people see before pressing Start. Run from Admin → Health → Telegram (the server has the secret) or
 * `pnpm telegram:webhook`. Running it again is harmless.
 */
import type { TelegramBotApi } from './api'

const DESCRIPTION =
  '익히미 — 숙제, 강좌, AI 튜터.\n\n💳 Pro나 VIP 요금제는 여기서 바로 구매할 수 있어요: ‘시작’을 누르고 요금제를 고른 뒤 계좌로 이체하고 이체 확인 화면을 보내 주세요.\n\n궁금한 점은 여기에 남겨 주세요.'
const SHORT = '익히미: 이 봇에서 Pro와 VIP 요금제를 구매하세요. 문의도 여기서 받아요.'

export async function setupBot(api: Pick<TelegramBotApi, 'call'>, input: { origin: string; secret: string }) {
  const url = `${input.origin.replace(/\/$/, '')}/api/telegram/webhook`
  await api.call('setWebhook', { url, secret_token: input.secret, allowed_updates: ['message', 'callback_query'] })
  await api.call('setMyCommands', { commands: [{ command: 'plans', description: '💳 요금제 구매 (Pro / VIP)' }, { command: 'start', description: '시작' }] })
  // The Menu button by the text field lists those commands
  await api.call('setChatMenuButton', { menu_button: { type: 'commands' } })
  // What an empty chat shows before "Start" (a bot can't write first), and the line on the bot's profile
  await api.call('setMyDescription', { description: DESCRIPTION })
  await api.call('setMyShortDescription', { short_description: SHORT })
  return { url }
}
