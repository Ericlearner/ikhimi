import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getDb } from '@ikhimi/db'
import { env } from '@/server/env'
import { TelegramBotApi } from '@/server/telegram/api'
import { handleSupportUpdate, type SupportUpdate } from '@/server/telegram/support'

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

/** Telegram → support bot. Registered with `pnpm --filter @ikhimi/web telegram:support-webhook`. */
export async function POST(req: Request) {
  const e = env()
  const got = req.headers.get('x-telegram-bot-api-secret-token') ?? ''
  if (!e.SUPPORT_BOT_TOKEN || !e.TELEGRAM_WEBHOOK_SECRET || !same(got, e.TELEGRAM_WEBHOOK_SECRET)) return new NextResponse('forbidden', { status: 403 })
  try {
    await handleSupportUpdate(getDb(), new TelegramBotApi(e.SUPPORT_BOT_TOKEN), (await req.json()) as SupportUpdate, e.SUPPORT_ADMIN_CHAT_ID)
  } catch (err) {
    console.error('[support-bot]', err)
  }
  return NextResponse.json({ ok: true })
}
