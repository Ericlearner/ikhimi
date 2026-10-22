/**
 * pnpm telegram:poll     — local dev: receive bot updates by long polling (no public URL needed)
 * pnpm telegram:webhook  — production: point the bot at https://<PUBLIC_ORIGIN>/api/telegram/webhook
 */
import { getDb } from '@ikhimi/db'
import { TelegramBotApi, type TgUpdate } from '../src/server/telegram/api'
import { handleTelegramUpdate } from '../src/server/telegram/login'
import { handleSupportUpdate, type SupportUpdate } from '../src/server/telegram/support'
import { isLoginUpdate } from '../src/server/telegram/index'
import { handleReceipt, handleShopUpdate, isShopUpdate } from '../src/server/telegram/shop'
import { setupBot } from '../src/server/telegram/setup'

const mode = process.argv[2]
const support = mode?.startsWith('support')
const token = support ? process.env.SUPPORT_BOT_TOKEN : process.env.TELEGRAM_BOT_TOKEN
if (!token) throw new Error(`${support ? 'SUPPORT_BOT_TOKEN' : 'TELEGRAM_BOT_TOKEN'} not set`)
const api = new TelegramBotApi(token)

if (mode === 'support-webhook') {
  const origin = process.env.PUBLIC_ORIGIN
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET
  if (!origin?.startsWith('https://') || !secret) throw new Error('Need an https PUBLIC_ORIGIN and TELEGRAM_WEBHOOK_SECRET')
  await setupBot(api, { origin, secret })
  console.log(`Webhook set to ${origin}/api/telegram/webhook`)
} else {
  await api.call('deleteWebhook')
  const me = await api.call<{ username: string }>('getMe')
  console.log(`Polling as @${me.username} — open https://t.me/${me.username}`)
  const db = getDb()
  let offset = 0
  for (;;) {
    const updates = await api.call<TgUpdate[]>('getUpdates', { offset, timeout: 30, allowed_updates: ['message', 'callback_query'] }).catch((e) => {
      console.error(e)
      return []
    })
    for (const u of updates) {
      offset = u.update_id + 1
      const shared = !process.env.SUPPORT_BOT_TOKEN
      const handle = isShopUpdate(u)
        ? handleShopUpdate(db, api, u)
        : handleReceipt(db, api, u).then((receipt) =>
            receipt ? undefined : isLoginUpdate(u, process.env.SUPPORT_ADMIN_CHAT_ID) || !shared ? handleTelegramUpdate(db, api, u) : handleSupportUpdate(db, api, u as SupportUpdate, process.env.SUPPORT_ADMIN_CHAT_ID, { shared: true }),
          )
      await handle.catch((e) => console.error('[telegram]', e))
    }
  }
}
