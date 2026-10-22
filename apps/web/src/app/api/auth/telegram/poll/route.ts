import { NextResponse } from 'next/server'
import { z } from 'zod'
import { eq, getDb, users } from '@ikhimi/db'
import { passwordStep } from '@/server/auth/password'
import { createSession } from '@/server/auth/session'
import { findOrCreateUserByPhone, needsOnboarding, needsRoleChoice, signInRole } from '@/server/auth/users'
import { getLocale, route, setSessionCookie } from '@/server/request'
import { exchangeTelegramLogin } from '@/server/telegram/login'

const body = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), as: z.enum(['teacher', 'student']).optional() })

/** The browser polls until the user has shared their number in Telegram. */
export const POST = route(async (req) => {
  const { token, as } = body.parse(await req.json())
  const db = getDb()
  const r = await exchangeTelegramLogin(db, token)
  if (r.status !== 'approved') return NextResponse.json({ status: r.status })

  const { user } = await findOrCreateUserByPhone(db, { phone: r.phone, role: as, uiLocale: await getLocale() })
  // Blocked by staff (admin panel)
  if (user.blockedAt) return NextResponse.json({ status: 'blocked' })
  // Keep the chat id: notifications (§12) go out through the same free bot.
  await db.update(users).set({ telegramChatId: r.telegramChatId }).where(eq(users.id, user.id))
  const activeRole = (await signInRole(db, user, as)) ?? undefined
  const { token: sessionToken, expiresAt } = await createSession(db, user.id, { userAgent: req.headers.get('user-agent'), activeRole, method: 'telegram' })
  const res = NextResponse.json({ status: 'approved', needsOnboarding: needsOnboarding(user) || needsRoleChoice(user), needsRole: needsRoleChoice(user), role: activeRole ?? user.role, ...passwordStep(user) })
  setSessionCookie(res, sessionToken, expiresAt)
  return res
})
