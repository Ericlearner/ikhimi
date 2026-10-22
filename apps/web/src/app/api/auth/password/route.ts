import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb } from '@ikhimi/db'
import { normalizePhone, type CountryCode } from '@ikhimi/i18n'
import { PASSWORD_MAX, signInWithPassword } from '@/server/auth/password'
import { cookies } from 'next/headers'
import { createSession, invalidateSession, SESSION_COOKIE } from '@/server/auth/session'
import { needsOnboarding, needsRoleChoice, signInRole } from '@/server/auth/users'
import { env } from '@/server/env'
import { clientIp, HttpError, route, setSessionCookie } from '@/server/request'

const body = z.object({
  phone: z.string().max(40),
  country: z.string().regex(/^[A-Z]{2}$/).optional(),
  password: z.string().min(1).max(PASSWORD_MAX),
  as: z.enum(['teacher', 'student']).optional(),
})

/** Sign in with the phone number and the password set in Profile (server/auth/password.ts) */
export const POST = route(async (req) => {
  const input = body.parse(await req.json())
  const phone = normalizePhone(input.phone, (input.country as CountryCode | undefined) ?? 'UZ')
  if (!phone) throw new HttpError(400, 'phone_invalid')
  const db = getDb()
  const r = await signInWithPassword({ db, pepper: env().AUTH_PEPPER }, { phone, password: input.password, ip: await clientIp() })
  if (!r.ok) {
    if (r.reason === 'rate_limited') throw new HttpError(429, 'rate_limited', { retryAfterSeconds: r.retryAfterSeconds })
    // The same answer whether the number has no account, no password or another one
    throw new HttpError(r.reason === 'blocked' ? 403 : 400, r.reason === 'blocked' ? 'account_blocked' : 'password_invalid')
  }
  const { user } = r
  // The session this browser had (e.g. the Telegram one used to set the password) gives way to this one
  const old = (await cookies()).get(SESSION_COOKIE)?.value
  if (old) await invalidateSession(db, old)
  const activeRole = (await signInRole(db, user, input.as)) ?? undefined
  const { token, expiresAt } = await createSession(db, user.id, { userAgent: req.headers.get('user-agent'), activeRole, method: 'password' })
  const res = NextResponse.json({ needsOnboarding: needsOnboarding(user) || needsRoleChoice(user), needsRole: needsRoleChoice(user), role: activeRole ?? user.role })
  setSessionCookie(res, token, expiresAt)
  return res
})
