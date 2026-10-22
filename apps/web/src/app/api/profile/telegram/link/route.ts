import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb, users, eq } from '@ikhimi/db'
import { linkTelegram } from '@/server/auth/link'
import { hashWithPepper } from '@/server/auth/otp'
import { createSession } from '@/server/auth/session'
import { signInRole } from '@/server/auth/users'
import { env } from '@/server/env'
import { clientIp, getLocale, HttpError, requireSession, route, setSessionCookie } from '@/server/request'
import { telegramLoginEnabled } from '@/server/telegram'
import { exchangeTelegramLogin, startTelegramLogin } from '@/server/telegram/login'

const body = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional() })

/**
 * Profile → link Telegram (an account made with Apple): without `token` it starts, like the Telegram sign-in (the
 * person shares their number with the bot); with `token` the page asks until they have. Then the number joins this
 * account, or this account gives way to the one the number already has (server/auth/link.ts).
 */
export const POST = route(async (req) => {
  const session = await requireSession()
  const { token } = body.parse(await req.json().catch(() => ({})))
  const db = getDb()

  if (!token) {
    if (!telegramLoginEnabled()) throw new HttpError(503, 'telegram_disabled')
    const ip = await clientIp()
    const r = await startTelegramLogin(db, { uiLocale: await getLocale(), ipHash: ip ? hashWithPepper(ip, env().AUTH_PEPPER) : null })
    if ('rateLimited' in r) throw new HttpError(429, 'rate_limited', { retryAfterSeconds: 600 })
    return NextResponse.json({ token: r.token, botUrl: `https://t.me/${env().TELEGRAM_BOT_USERNAME}?start=${r.token}` })
  }

  const r = await exchangeTelegramLogin(db, token)
  if (r.status !== 'approved') return NextResponse.json({ status: r.status })
  const result = await linkTelegram(db, session.user, { phone: r.phone, telegramChatId: r.telegramChatId })
  if (result.status !== 'switched') return NextResponse.json({ status: result.status })

  // Continue in the number's own account, on the side it was used last
  const [other] = await db.select().from(users).where(eq(users.id, result.userId)).limit(1)
  const activeRole = (await signInRole(db, other!)) ?? undefined
  const created = await createSession(db, result.userId, { userAgent: req.headers.get('user-agent'), activeRole, method: 'telegram' })
  const role = activeRole ?? other!.role
  const res = NextResponse.json({ status: 'switched', to: role === 'teacher' ? '/app' : '/work' })
  setSessionCookie(res, created.token, created.expiresAt)
  return res
})
