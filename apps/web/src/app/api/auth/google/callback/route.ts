import { timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { eq, getDb, googleAccounts, users } from '@ikhimi/db'
import { createSession } from '@/server/auth/session'
import { findOrCreateUserByPhone, signInRole } from '@/server/auth/users'
import { exchangeGoogleCode, GOOGLE_COOKIE, googleConfig, googlePhone, type GoogleFlow } from '@/server/google'
import { getLocale, setSessionCookie } from '@/server/request'
import { safeNext } from '@/server/student-pages'

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

function readFlow(raw: string | undefined): GoogleFlow | null {
  if (!raw) return null
  try {
    const f = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as GoogleFlow
    return typeof f.state === 'string' && typeof f.nonce === 'string' && typeof f.verifier === 'string' ? { ...f, next: safeNext(f.next) ?? '/app' } : null
  } catch {
    return null
  }
}

/**
 * Google sends the person back here. The account is the one the Google account is linked to (google_accounts; after
 * linking Telegram it may be an older account with a phone number, server/auth/link.ts), else a new one whose phone
 * column is `google:<Google user id>`. Then the sign-in page: the welcome questions for a new account, else `next`.
 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const flow = readFlow((await cookies()).get(GOOGLE_COOKIE)?.value)
  const back = (path: string) => {
    const res = NextResponse.redirect(new URL(path, req.url))
    res.cookies.delete({ name: GOOGLE_COOKIE, path: '/api/auth/google' })
    return res
  }
  const signin = (extra = '') => `/signin?next=${encodeURIComponent(flow?.next ?? '/app')}${flow?.as ? `&as=${flow.as}` : ''}${extra}`
  const cfg = googleConfig()
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state') ?? ''
  // Closed Google's page, an old tab, or a request we didn't start (login CSRF): back to sign-in, signed out
  if (!cfg || !flow || !code || !same(state, flow.state)) return back(signin(url.searchParams.get('error') === 'access_denied' ? '' : '&error=google'))

  const google = await exchangeGoogleCode(cfg, { code, redirectUri: new URL('/api/auth/google/callback', url.origin).toString(), flow }).catch(() => null)
  if (!google) return back(signin('&error=google'))

  const db = getDb()
  const [link] = await db.select({ userId: googleAccounts.userId }).from(googleAccounts).where(eq(googleAccounts.sub, google.sub)).limit(1)
  const [linked] = link ? await db.select().from(users).where(eq(users.id, link.userId)).limit(1) : []
  let user: typeof users.$inferSelect
  if (linked) {
    // Signing in within 30 days of deleting the account restores it (spec §12)
    if (linked.deletedAt) await db.update(users).set({ deletedAt: null }).where(eq(users.id, linked.id))
    user = { ...linked, deletedAt: null }
    if (google.email) await db.update(googleAccounts).set({ email: google.email, updatedAt: new Date() }).where(eq(googleAccounts.sub, google.sub))
  } else {
    const made = await findOrCreateUserByPhone(db, { phone: googlePhone(google.sub), role: flow.as, uiLocale: await getLocale() })
    user = made.user
    await db.insert(googleAccounts).values({ userId: user.id, sub: google.sub, email: google.email }).onConflictDoNothing()
    if (made.isNew && google.name && google.name.length >= 2) {
      await db.update(users).set({ fullName: google.name }).where(eq(users.id, user.id))
      user.fullName = google.name
    }
  }
  // Blocked by staff (admin panel)
  if (user.blockedAt) return back(signin('&error=blocked'))

  const activeRole = (await signInRole(db, user, flow.as)) ?? undefined
  const { token, expiresAt } = await createSession(db, user.id, { userAgent: req.headers.get('user-agent'), activeRole, method: 'google' })
  const res = back(signin())
  setSessionCookie(res, token, expiresAt)
  return res
}
