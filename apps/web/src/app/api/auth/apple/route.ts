import { after, NextResponse } from 'next/server'
import { z } from 'zod'
import { appleAccounts, eq, getDb, users } from '@ikhimi/db'
import { appleConfig, applePhone, exchangeAppleCode, verifyAppleIdentityToken } from '@/server/apple'
import { createSession } from '@/server/auth/session'
import { findOrCreateUserByPhone, needsOnboarding, needsRoleChoice, signInRole } from '@/server/auth/users'
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
 * here. The account is the one the Apple ID is linked to (apple_accounts; after linking Telegram it may be an older
 * account with a phone number, server/auth/link.ts), else a new one whose phone column is `apple:<Apple user id>`.
 */
export const POST = route(async (req) => {
  const cfg = appleConfig()
  if (!cfg) throw new HttpError(400, 'apple_unavailable')
  const input = body.parse(await req.json())
  const apple = await verifyAppleIdentityToken(input.identityToken, cfg.bundleId)
  if (!apple) throw new HttpError(400, 'apple_invalid')
  const db = getDb()

  const [link] = await db.select({ userId: appleAccounts.userId }).from(appleAccounts).where(eq(appleAccounts.sub, apple.sub)).limit(1)
  const [linked] = link ? await db.select().from(users).where(eq(users.id, link.userId)).limit(1) : []
  let user: typeof users.$inferSelect
  let isNew = false
  if (linked) {
    // Signing in within 30 days of deleting the account restores it (spec §12)
    if (linked.deletedAt) await db.update(users).set({ deletedAt: null }).where(eq(users.id, linked.id))
    user = { ...linked, deletedAt: null }
  } else {
    ;({ user, isNew } = await findOrCreateUserByPhone(db, { phone: applePhone(apple.sub), role: input.as, uiLocale: await getLocale() }))
    await db.insert(appleAccounts).values({ userId: user.id, sub: apple.sub }).onConflictDoNothing()
  }
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
    // The welcome screen offers to continue in an account they had with Telegram (LinkTelegram)
    appleNew: isNew,
  })
  setSessionCookie(res, token, expiresAt)
  return res
})
