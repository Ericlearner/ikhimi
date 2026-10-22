/**
 * Who may open the admin panel, and with which permissions. Owners are the phone numbers in OWNER_PHONES
 * (a setting, so nobody can remove them from inside the app); assistants are staff_members with a role.
 * Admin pages also need a recent sign-in: a session older than FRESH_HOURS must sign in again first (guard.ts), with a
 * password, a code, Apple or Google. Not with the Telegram link: someone could send an owner a login link and get in.
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

export function ownerPhones(): string[] {
  return (process.env.OWNER_PHONES ?? '')
    .split(',')
    .map((p) => p.replace(/[^\d+]/g, ''))
    .filter((p) => /^\+\d{8,15}$/.test(p))
}

export async function staffAccess(db: Db, user: Pick<SessionUser, 'id' | 'phone' | 'blockedAt'>): Promise<StaffAccess | null> {
  if (user.blockedAt) return null
  if (ownerPhones().includes(user.phone)) return { userId: user.id, owner: true, roleName: null, permissions: new Set(PERMISSIONS) }
  const [row] = await db
    .select({ role: staffRoles })
    .from(staffMembers)
    .innerJoin(staffRoles, eq(staffRoles.id, staffMembers.roleId))
    .where(and(eq(staffMembers.phone, user.phone), isNull(staffMembers.revokedAt)))
    .limit(1)
  if (!row) return null
  return { userId: user.id, owner: false, roleName: row.role.name, permissions: new Set(row.role.permissions.filter(isPermission)) }
}

/** Ways in that can't be done to someone by sending them a link */
export const STRONG_METHODS: readonly SignInMethod[] = ['password', 'otp', 'apple', 'google']

export const isFresh = (s: Pick<ValidatedSession, 'createdAt' | 'method'>, now = Date.now()) =>
  now - s.createdAt.getTime() < FRESH_HOURS * 3600_000 && !!s.method && STRONG_METHODS.includes(s.method)

export const can = (a: StaffAccess, p: Permission | 'staff') => (p === 'staff' ? a.owner : a.permissions.has(p))

/** Record a staff action. Called for every change and every reveal of personal data. */
export async function audit(db: Db, actorId: string, action: string, target: { type?: string; id?: string } = {}, details: Record<string, unknown> = {}) {
  await db.insert(adminAudit).values({ actorId, action, targetType: target.type ?? null, targetId: target.id ?? null, details })
}
