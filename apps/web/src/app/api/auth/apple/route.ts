import { after, NextResponse } from 'next/server'
import { z } from 'zod'
import { appleAccounts, eq, getDb, users } from '@ikhimi/db'
import { appleConfig, exchangeAppleCode, verifyAppleIdentityToken } from '@/server/apple'
import { createSession } from '@/server/auth/session'
import { accountForSignIn, needsOnboarding, needsRoleChoice, signInRole } from '@/server/auth/users'
import { getLocale, HttpError, route, setSessionCookie } from '@/server/request'

const body = z.object({
  identityToken: z.string().max(4000),
  authorizationCode: z.string().max(400).optional(),
  /** Apple gives the name only the first time someone signs in to the app */
  fullName: z.string().max(120).optional(),
  as: z.enum(['teacher', 'student']).optional(),
})

/**
 * Sign in with Apple, from the iOS app: the app asks Apple natively and hands the result to the page, which posts it
 * here. The account is the one the Apple ID is linked to, else the one with the same verified email (made with Google
 * on the website), else a new one whose phone column is `apple:<Apple user id>` (server/auth/users.ts).
 */
export const POST = route(async (req) => {
  const cfg = appleConfig()
  if (!cfg) throw new HttpError(400, 'apple_unavailable')
  const input = body.parse(await req.json())
  const apple = await verifyAppleIdentityToken(input.identityToken, cfg.bundleId)
  if (!apple) throw new HttpError(400, 'apple_invalid')
  const db = getDb()

  const { user, isNew } = await accountForSignIn(db, { provider: 'apple', sub: apple.sub, email: apple.email, role: input.as, uiLocale: await getLocale() })
  // Blocked by staff (admin panel)
  if (user.blockedAt) throw new HttpError(403, 'account_blocked')
  const name = input.fullName?.trim()
  if (isNew && name && name.length >= 2) {
    await db.update(users).set({ fullName: name }).where(eq(users.id, user.id))
    user.fullName = name
  }
  // Apple's refresh token, kept only so deleting the account can revoke it
  if (input.authorizationCode) {
    const code = input.authorizationCode
    after(async () => {
      const refreshToken = await exchangeAppleCode(cfg, code).catch(() => null)
      if (!refreshToken) return
      await db.update(appleAccounts).set({ refreshToken, updatedAt: new Date() }).where(eq(appleAccounts.sub, apple.sub))
    })
  }

  const activeRole = (await signInRole(db, user, input.as)) ?? undefined
  const { token, expiresAt } = await createSession(db, user.id, { userAgent: req.headers.get('user-agent'), activeRole, method: 'apple' })
  const res = NextResponse.json({
    needsOnboarding: needsOnboarding(user) || needsRoleChoice(user),
    needsRole: needsRoleChoice(user),
    role: activeRole ?? user.role,
  })
  setSessionCookie(res, token, expiresAt)
  return res
})
