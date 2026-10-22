import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getDb } from '@ikhimi/db'
import { env } from '@/server/env'
import { getBot, isLoginUpdate, supportSharesLoginBot } from '@/server/telegram'
import { handleSupportUpdate, type SupportUpdate } from '@/server/telegram/support'
import type { TgUpdate } from '@/server/telegram/api'
import { handleTelegramUpdate } from '@/server/telegram/login'
import { handleReceipt, handleShopUpdate, isShopUpdate } from '@/server/telegram/shop'

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

/** Telegram → us. Registered with `pnpm telegram:webhook`. */
export async function POST(req: Request) {
  const secret = env().TELEGRAM_WEBHOOK_SECRET
  const got = req.headers.get('x-telegram-bot-api-secret-token') ?? ''
  if (!secret || !same(got, secret)) return new NextResponse('forbidden', { status: 403 })
  try {
    const update = (await req.json()) as TgUpdate & SupportUpdate
    // One bot, several jobs: the shop, card receipts, login; everything else is a support conversation
    if (isShopUpdate(update)) await handleShopUpdate(getDb(), getBot(), update)
    // A card payment's receipt (a photo or file while an order waits): to the admins, not to support
    else if (await handleReceipt(getDb(), getBot(), update)) return NextResponse.json({ ok: true })
    else if (isLoginUpdate(update, env().SUPPORT_ADMIN_CHAT_ID) || !supportSharesLoginBot()) await handleTelegramUpdate(getDb(), getBot(), update)
    else await handleSupportUpdate(getDb(), getBot(), update, env().SUPPORT_ADMIN_CHAT_ID, { shared: true })
  } catch (err) {
    console.error('[telegram]', err)
  }
  // Always 200, or Telegram retries the same update forever.
  return NextResponse.json({ ok: true })
}
