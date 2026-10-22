import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb } from '@ikhimi/db'
import { apiStaff } from '@/server/admin/guard'
import { audit } from '@/server/admin/staff'
import { getTelegramSettings, saveTelegramSettings } from '@/server/notify'
import { env } from '@/server/env'
import { getBot } from '@/server/telegram'
import { setupBot } from '@/server/telegram/setup'
import { HttpError, route } from '@/server/request'

const body = z.object({ links: z.boolean() })

/** The owner decides whether bot messages carry a link to the homework (off until the site is ready to be shown) */
export const PUT = route(async (req) => {
  const db = getDb()
  const { session, access } = await apiStaff(db, 'health')
  if (!access.owner) throw new HttpError(403, 'owner_only')
  const input = body.parse(await req.json())
  const before = await getTelegramSettings(db)
  await saveTelegramSettings(db, input, session.user.id)
  await audit(db, session.user.id, 'telegram.update', { type: 'settings', id: 'telegram' }, { before, after: input })
  return NextResponse.json({ ok: true })
})

/**
 * The owner sets the bot up with Telegram in one click: webhook with button presses, Menu, the texts before Start
 * (server/telegram/setup.ts). On the address the admin panel is open on, so it always matches the live site.
 */
export const POST = route(async (req) => {
  const db = getDb()
  const { session, access } = await apiStaff(db, 'health')
  if (!access.owner) throw new HttpError(403, 'owner_only')
  const secret = env().TELEGRAM_WEBHOOK_SECRET
  if (!process.env.TELEGRAM_BOT_TOKEN || !secret) throw new HttpError(400, 'telegram_not_configured')
  const { url } = await setupBot(getBot(), { origin: new URL(req.url).origin, secret })
  await audit(db, session.user.id, 'telegram.setup', { type: 'settings', id: 'telegram' }, { url })
  return NextResponse.json({ ok: true, url })
})
