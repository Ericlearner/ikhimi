import { NextResponse } from 'next/server'
import { eq, getDb, users } from '@ikhimi/db'
import { passwordStep } from '@/server/auth/password'
import { createSession } from '@/server/auth/session'
import { findOrCreateUserByPhone, signInRole } from '@/server/auth/users'
import { getSession, setSessionCookie } from '@/server/request'
import { safeNext } from '@/server/student-pages'
import { exchangeTelegramLink } from '@/server/telegram/login'

/**
 * The bot's "로그인" button, for someone whose browser was lost on the way to Telegram: the number was just shared,
 * so this signs in once (as the browser's poll would) and continues on the sign-in page the same way: setting a
 * password, the welcome questions, then where the browser was going. A used or old link signs nobody in.
 */
export async function GET(req: Request) {
  const to = (path: string) => NextResponse.redirect(new URL(path, req.url))
  const db = getDb()
  const r = await exchangeTelegramLink(db, new URL(req.url).searchParams.get('c') ?? '')
  // Already used (often by the browser that started it, which is then signed in) or too old
  if (r.status !== 'approved') return to((await getSession()) ? '/app' : '/signin?error=telegram_link')

  const { user } = await findOrCreateUserByPhone(db, { phone: r.phone, role: r.as ?? undefined, uiLocale: r.uiLocale })
  if (user.blockedAt) return to('/signin?error=blocked')
  // Notifications go out through the same bot
  await db.update(users).set({ telegramChatId: r.telegramChatId }).where(eq(users.id, user.id))
  const activeRole = (await signInRole(db, user, r.as ?? undefined)) ?? undefined
  const { token, expiresAt } = await createSession(db, user.id, { userAgent: req.headers.get('user-agent'), activeRole, method: 'telegram' })
  const q = new URLSearchParams({ next: safeNext(r.next) ?? '/app' })
  if (r.as) q.set('as', r.as)
  if (passwordStep(user).needsPassword) q.set('step', 'password')
  const res = to(`/signin?${q}`)
  setSessionCookie(res, token, expiresAt)
  return res
}
