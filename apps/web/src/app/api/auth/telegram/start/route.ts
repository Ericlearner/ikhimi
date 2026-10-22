import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb } from '@ikhimi/db'
import { hashWithPepper } from '@/server/auth/otp'
import { env } from '@/server/env'
import { clientIp, getLocale, HttpError, route } from '@/server/request'
import { telegramLoginEnabled } from '@/server/telegram'
import { startTelegramLogin } from '@/server/telegram/login'
import { safeNext } from '@/server/student-pages'

/** What the sign-in page asks for, kept for the bot's "로그인" link: the role, and where to go after */
const body = z.object({ as: z.enum(['teacher', 'student']).optional(), next: z.string().max(500).optional() })

export const POST = route(async (req) => {
  if (!telegramLoginEnabled()) throw new HttpError(503, 'telegram_disabled')
  const input = body.parse(await req.json().catch(() => ({})))
  const ip = await clientIp()
  const r = await startTelegramLogin(getDb(), {
    uiLocale: await getLocale(),
    ipHash: ip ? hashWithPepper(ip, env().AUTH_PEPPER) : null,
    as: input.as ?? null,
    next: safeNext(input.next) ?? null,
  })
  if ('rateLimited' in r) throw new HttpError(429, 'rate_limited', { retryAfterSeconds: 600 })
  return NextResponse.json({
    token: r.token,
    botUrl: `https://t.me/${env().TELEGRAM_BOT_USERNAME}?start=${r.token}`,
    expiresAt: r.expiresAt,
  })
})
