/**
 * Who may open the admin panel, and with which permissions. Owners are the Google emails in OWNER_EMAILS (a setting,
 * so nobody can remove them from inside the app); assistants are staff_members with a role, matched by email too.
 * Admin pages also need a recent sign-in: a session older than FRESH_HOURS must sign in again first (guard.ts).
 */
import { adminAudit, and, eq, isNull, staffMembers, staffRoles, type Db, type SignInMethod } from '@ikhimi/db'
import type { SessionUser, ValidatedSession } from '../auth/session'
import { isPermission, PERMISSIONS, type Permission } from './permissions'

export const FRESH_HOURS = 12

export type StaffAccess = {
  userId: string
  owner: boolean
  roleName: string | null
  permissions: Set<Permission>
}

/** A typed email the way accounts keep it (lower case), or null when it isn't one */
export function normalizeEmail(raw: string): string | null {
  const e = raw.trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254 ? e : null
}

export function ownerEmails(): string[] {
  return (process.env.OWNER_EMAILS ?? '')
    .split(',')
    .map(normalizeEmail)
    .filter((e): e is string => !!e)
}

export const isOwner = (user: Pick<SessionUser, 'email'>) => !!user.email && ownerEmails().includes(user.email)

export async function staffAccess(db: Db, user: Pick<SessionUser, 'id' | 'email' | 'blockedAt'>): Promise<StaffAccess | null> {
  if (user.blockedAt || !user.email) return null
  if (isOwner(user)) return { userId: user.id, owner: true, roleName: null, permissions: new Set(PERMISSIONS) }
  const [row] = await db
    .select({ role: staffRoles })
    .from(staffMembers)
    .innerJoin(staffRoles, eq(staffRoles.id, staffMembers.roleId))
    .where(and(eq(staffMembers.email, user.email), isNull(staffMembers.revokedAt)))
    .limit(1)
  if (!row) return null
  return { userId: user.id, owner: false, roleName: row.role.name, permissions: new Set(row.role.permissions.filter(isPermission)) }
}

/** Ways in that can't be done to someone by sending them a link */
export const STRONG_METHODS: readonly SignInMethod[] = ['apple', 'google']

export const isFresh = (s: Pick<ValidatedSession, 'createdAt' | 'method'>, now = Date.now()) =>
  now - s.createdAt.getTime() < FRESH_HOURS * 3600_000 && !!s.method && STRONG_METHODS.includes(s.method)

export const can = (a: StaffAccess, p: Permission | 'staff') => (p === 'staff' ? a.owner : a.permissions.has(p))

/** Record a staff action. Called for every change and every reveal of personal data. */
export async function audit(db: Db, actorId: string, action: string, target: { type?: string; id?: string } = {}, details: Record<string, unknown> = {}) {
  await db.insert(adminAudit).values({ actorId, action, targetType: target.type ?? null, targetId: target.id ?? null, details })
}
