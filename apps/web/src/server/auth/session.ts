/**
 * Lucia-style sessions in Postgres: the cookie holds a random token, the DB holds sha256(token).
 * A DB leak therefore does not leak usable sessions.
 */
import { createHash, randomBytes } from 'node:crypto'
import { AUTH, eq, sessions, users, type Db, type SignInMethod } from '@ikhimi/db'

export const SESSION_COOKIE = 'tl_session'

type Role = 'teacher' | 'student' | 'admin'
/**
 * `role` is the session's ACTIVE role; `roles` is everything the account holds. `roleChosen` false: a new account
 * that hasn't said yet whether it teaches or learns (the welcome screen asks).
 */
export type SessionUser = Omit<typeof users.$inferSelect, 'passwordHash'> & { roleChosen?: boolean }
export type ValidatedSession = { sessionId: string; user: SessionUser; expiresAt: Date; refreshed: boolean; createdAt: Date; method: SignInMethod | null }

const DAY = 24 * 60 * 60 * 1000

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

export async function createSession(
  db: Db,
  userId: string,
  opts: { userAgent?: string | null; now?: Date; activeRole?: Role; method?: SignInMethod } = {},
) {
  const now = opts.now ?? new Date()
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(now.getTime() + AUTH.sessionTtlDays * DAY)
  await db.insert(sessions).values({
    id: hashToken(token),
    userId,
    expiresAt,
    activeRole: opts.activeRole ?? null,
    method: opts.method ?? null,
    userAgent: opts.userAgent?.slice(0, 300) ?? null,
    createdAt: now,
  })
  return { token, expiresAt }
}

export async function validateSessionToken(db: Db, token: string, now = new Date()): Promise<ValidatedSession | null> {
  const id = hashToken(token)
  const [row] = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, id))
    .limit(1)
  if (!row) return null
  // A blocked account's sessions end at once (admin panel)
  if (row.session.expiresAt <= now || row.user.deletedAt || row.user.blockedAt) {
    await db.delete(sessions).where(eq(sessions.id, id))
    return null
  }
  let expiresAt = row.session.expiresAt
  let refreshed = false
  if (expiresAt.getTime() - now.getTime() < AUTH.sessionRefreshWhenDaysLeft * DAY) {
    expiresAt = new Date(now.getTime() + AUTH.sessionTtlDays * DAY)
    await db.update(sessions).set({ expiresAt }).where(eq(sessions.id, id))
    refreshed = true
  }
  // Authorization everywhere reads user.role — make it the active role, if the account still holds it
  // The password hash never travels with the session
  const { passwordHash: _hash, ...user } = row.user
  const roles = user.roles.length ? user.roles : [user.role]
  const active = row.session.activeRole && roles.includes(row.session.activeRole) ? row.session.activeRole : user.role
  return {
    sessionId: id,
    user: { ...user, roles, role: active, roleChosen: user.roles.length > 0 },
    expiresAt,
    refreshed,
    createdAt: row.session.createdAt,
    method: row.session.method ?? null,
  }
}

export async function invalidateSession(db: Db, token: string) {
  await db.delete(sessions).where(eq(sessions.id, hashToken(token)))
}
