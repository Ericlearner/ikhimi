import { and, appleAccounts, desc, eq, googleAccounts, isNotNull, sessions, sql, teacherProfiles, users, type Db } from '@ikhimi/db'
import type { Locale } from '@ikhimi/i18n'
import { applePhone } from '../apple'
import { googlePhone } from '../google'
import { giveVipGift } from '../plans'

type Role = 'teacher' | 'student'
type User = typeof users.$inferSelect

/**
 * Find or create the account with this sign-in key (the phone column: `google:<id>`, `apple:<id>`). Signing in never
 * adds a role: an existing account keeps the roles it has. A new account gets `role` when the way in says it (a
 * homework link: student); otherwise it has no role yet (roles = []) and chooses one on the welcome screen
 * (chooseFirstRole).
 */
export async function findOrCreateUser(db: Db, input: { phone: string; email?: string | null; role?: Role | null; uiLocale: Locale }) {
  const now = new Date()
  const [existing] = await db.select().from(users).where(eq(users.phone, input.phone)).limit(1)
  if (existing) {
    // Logging back in within the 30-day window restores a soft-deleted account (spec §12)
    if (existing.deletedAt) {
      await db.update(users).set({ deletedAt: null }).where(eq(users.id, existing.id))
      existing.deletedAt = null
    }
    return { user: existing, isNew: false }
  }
  const role = input.role ?? null
  const [user] = await db
    .insert(users)
    .values({
      // Not chosen yet: stored as student with no roles until the welcome screen
      role: role ?? 'student',
      roles: role ? [role] : [],
      prefs: { sound: role === 'teacher' ? 'off' : 'normal' },
      phone: input.phone,
      email: input.email ?? null,
      uiLocale: input.uiLocale,
      lastActiveAt: now,
    })
    .onConflictDoNothing()
    .returning()
  // Lost a race with a concurrent sign-in for the same key (or, rarely, the email: then without it)
  if (!user) {
    const [raced] = await db.select().from(users).where(eq(users.phone, input.phone)).limit(1)
    if (raced) return { user: raced, isNew: false }
    return findOrCreateUser(db, { ...input, email: null })
  }
  if (role === 'teacher') await db.insert(teacherProfiles).values({ userId: user.id })
  else if (role === 'student') await giveVipGift(db, user.id, now)
  return { user, isNew: true }
}

/**
 * The account a Google account or an Apple ID opens: the one it is linked to; else the account with the same verified
 * email (the same person signed in the other way before: Google on the website, Apple in the iOS app); else a new one
 * whose phone column is `google:<id>` / `apple:<id>`. The email is kept on the account, for owners and staff.
 */
export async function accountForSignIn(
  db: Db,
  input: { provider: 'google' | 'apple'; sub: string; email: string | null; role?: Role | null; uiLocale: Locale },
): Promise<{ user: User; isNew: boolean }> {
  const links = input.provider === 'google' ? googleAccounts : appleAccounts
  const email = input.email?.trim().toLowerCase() || null
  const [link] = await db.select({ userId: links.userId }).from(links).where(eq(links.sub, input.sub)).limit(1)
  let [user] = link ? await db.select().from(users).where(eq(users.id, link.userId)).limit(1) : []
  let isNew = false
  if (!user && email) {
    const [same] = await db.select().from(users).where(eq(users.email, email)).limit(1)
    // One Google account and one Apple ID per account: a second one with the same email starts its own
    const [taken] = same ? await db.select({ sub: links.sub }).from(links).where(eq(links.userId, same.id)).limit(1) : []
    if (same && !taken && !same.phone.startsWith('deleted:')) {
      await db.insert(links).values({ userId: same.id, sub: input.sub }).onConflictDoNothing()
      user = same
    }
  }
  if (user) {
    // Signing in within 30 days of deleting the account restores it (spec §12)
    if (user.deletedAt) await db.update(users).set({ deletedAt: null }).where(eq(users.id, user.id))
    user = { ...user, deletedAt: null }
    if (email && user.email !== email) {
      const [free] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1)
      if (!free) {
        await db.update(users).set({ email }).where(eq(users.id, user.id))
        user.email = email
      }
    }
  } else {
    const phone = input.provider === 'google' ? googlePhone(input.sub) : applePhone(input.sub)
    ;({ user, isNew } = await findOrCreateUser(db, { phone, email, role: input.role, uiLocale: input.uiLocale }))
    await db.insert(links).values({ userId: user.id, sub: input.sub }).onConflictDoNothing()
  }
  return { user, isNew }
}

/** A new account that hasn't said yet whether it teaches or learns */
export const needsRoleChoice = (u: { roles: readonly string[] }) => u.roles.length === 0

/** The welcome screen's answer: the account's first role (only while it has none) */
export async function chooseFirstRole(db: Db, userId: string, role: Role) {
  const [updated] = await db
    .update(users)
    .set({ role, roles: [role], prefs: { sound: role === 'teacher' ? 'off' : 'normal' } })
    .where(and(eq(users.id, userId), sql`cardinality(${users.roles}) = 0`))
    .returning()
  if (!updated) return null
  if (role === 'teacher') await db.insert(teacherProfiles).values({ userId }).onConflictDoNothing()
  else await giveVipGift(db, userId)
  return updated
}

/**
 * Which role a new sign-in opens in: the one asked for if the account has it (a homework link asks for student),
 * else the one used last, else the account's first role.
 */
export async function signInRole(db: Db, user: { id: string; role: Role | 'admin'; roles: string[] }, asked?: Role | null): Promise<Role | null> {
  const roles = user.roles.length ? user.roles : [user.role]
  if (asked && roles.includes(asked)) return asked
  if (roles.length < 2) return null
  const [last] = await db
    .select({ role: sessions.activeRole })
    .from(sessions)
    .where(and(eq(sessions.userId, user.id), isNotNull(sessions.activeRole)))
    .orderBy(desc(sessions.createdAt))
    .limit(1)
  return last?.role === 'teacher' || last?.role === 'student' ? last.role : null
}

/** Adds a role the person asked for (Profile → also teach; doing a homework after saying yes). Never on sign-in. */
export async function addRole(db: Db, user: typeof users.$inferSelect, role: Role) {
  const roles = user.roles.length ? user.roles : [user.role]
  if (roles.includes(role)) return { ...user, roles }
  const [updated] = await db
    .update(users)
    .set({ roles: sql`array_append(${users.roles}, ${role})` })
    .where(eq(users.id, user.id))
    .returning()
  if (role === 'teacher') await db.insert(teacherProfiles).values({ userId: user.id }).onConflictDoNothing()
  // Becoming a student for the first time brings the welcome gift too
  else await giveVipGift(db, user.id)
  return updated!
}

/** No name yet, or (a new account) no role chosen yet: the welcome screen comes first */
export const needsOnboarding = (u: { fullName: string | null; roleChosen?: boolean }) => !u.fullName?.trim() || u.roleChosen === false
