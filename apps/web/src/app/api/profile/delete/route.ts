import { cookies } from 'next/headers'
import { after, NextResponse } from 'next/server'
import { appleAccounts, eq, getDb, pushDevices, sessions, users } from '@ikhimi/db'
import { appleConfig, revokeAppleToken } from '@/server/apple'
import { SESSION_COOKIE } from '@/server/auth/session'
import { HttpError, requireSession, route } from '@/server/request'

/** Must have signed in within this window to delete — the "fresh verification" step (spec §12). */
const FRESH_AUTH_MS = 10 * 60 * 1000

/** Soft delete: account hidden now, restorable by logging in within 30 days, purged after. */
export const POST = route(async () => {
  const session = await requireSession()
  if (Date.now() - session.createdAt.getTime() > FRESH_AUTH_MS) throw new HttpError(403, 'reauth_required')
  const db = getDb()
  await db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, session.user.id))
  await db.delete(sessions).where(eq(sessions.userId, session.user.id))
  await db.delete(pushDevices).where(eq(pushDevices.userId, session.user.id))
  // Signed up with Apple: Apple forgets the link too (App Store rule 5.1.1). The Apple ID stays linked here, so signing
  // in with Apple again within 30 days restores the account; it's erased with the account (purge.ts).
  const [apple] = await db
    .select({ refreshToken: appleAccounts.refreshToken })
    .from(appleAccounts)
    .where(eq(appleAccounts.userId, session.user.id))
    .limit(1)
  if (apple?.refreshToken) await db.update(appleAccounts).set({ refreshToken: null }).where(eq(appleAccounts.userId, session.user.id))
  const cfg = appleConfig()
  if (apple?.refreshToken && cfg) {
    const refreshToken = apple.refreshToken
    after(() => revokeAppleToken(cfg, refreshToken).catch((e) => console.warn('[apple] revoke failed', String(e).slice(0, 200))))
  }
  const res = NextResponse.json({ ok: true })
  res.cookies.delete(SESSION_COOKIE)
  ;(await cookies()).delete(SESSION_COOKIE)
  return res
})
