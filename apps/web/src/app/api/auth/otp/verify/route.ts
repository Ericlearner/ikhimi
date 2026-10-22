import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb } from '@ikhimi/db'
import { normalizePhone, type CountryCode } from '@ikhimi/i18n'
import { verifyOtp } from '@/server/auth/otp'
import { passwordStep } from '@/server/auth/password'
import { prepareReviewAccount, reviewCodeMatches } from '@/server/auth/review'
import { createSession } from '@/server/auth/session'
import { findOrCreateUserByPhone, needsOnboarding, needsRoleChoice, signInRole } from '@/server/auth/users'
import { env } from '@/server/env'
import { getLocale, HttpError, route, setSessionCookie } from '@/server/request'

const body = z.object({
  phone: z.string().max(40),
  country: z.string().regex(/^[A-Z]{2}$/).optional(),
  code: z.string().max(12),
  /** The way in asked for a role (a homework link: student). Absent: an existing account keeps its roles, a new one chooses */
  as: z.enum(['teacher', 'student']).optional(),
})

export const POST = route(async (req) => {
  const input = body.parse(await req.json())
  const phone = normalizePhone(input.phone, (input.country as CountryCode | undefined) ?? 'UZ')
  if (!phone) throw new HttpError(400, 'phone_invalid')
  const db = getDb()
  const review = reviewCodeMatches(phone, input.code)
  if (!review) {
    const result = await verifyOtp({ db, pepper: env().AUTH_PEPPER }, { phone, code: input.code.trim() })
    if (!result.ok) throw new HttpError(result.reason === 'too_many_attempts' ? 429 : 400, `code_${result.reason}`)
  }

  let { user } = await findOrCreateUserByPhone(db, { phone, role: input.as, uiLocale: await getLocale() })
  // The store reviewers' account: ready with a name, both sides and VIP
  if (review) {
    await prepareReviewAccount(db, user.id)
    user = (await findOrCreateUserByPhone(db, { phone, uiLocale: await getLocale() })).user
  }
  // Blocked by staff (admin panel)
  if (user.blockedAt) throw new HttpError(403, 'account_blocked')
  const activeRole = (await signInRole(db, user, input.as)) ?? undefined
  const { token, expiresAt } = await createSession(db, user.id, { userAgent: req.headers.get('user-agent'), activeRole, method: 'otp' })
  const res = NextResponse.json({ needsOnboarding: needsOnboarding(user) || needsRoleChoice(user), needsRole: needsRoleChoice(user), role: activeRole ?? user.role, ...passwordStep(user, { review }) })
  setSessionCookie(res, token, expiresAt)
  return res
})
