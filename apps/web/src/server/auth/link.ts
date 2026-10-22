/**
 * One person, one account (DECISIONS.md BE). Sign in with Apple or Google makes its own account, with no phone number.
 * Linking Telegram (Profile) gives it the person's number. If that number already has an account (they used 익히미
 * with Telegram or a code before), the Apple ID / Google account moves to that account and the new, empty one is closed,
 * so all their homework and results stay in one place. Two accounts that both have work in them are not merged here:
 * support does.
 */
import { and, appleAccounts, assignments, googleAccounts, attempts, courses, enrollments, eq, gt, groups, pushDevices, sessions, subscriptions, users, type Db } from '@ikhimi/db'
import { APPLE_PHONE_PREFIX } from '../apple'
import { GOOGLE_PHONE_PREFIX } from '../google'

export type LinkResult =
  /** This account now has the number and Telegram */
  | { status: 'linked' }
  /** The number's own account: the Apple ID / Google account moved there, this one is closed */
  | { status: 'switched'; userId: string }
  | { status: 'both_have_work' }
  /** The number's account already has another Apple ID / Google account */
  | { status: 'other_apple' }
  | { status: 'other_google' }
  | { status: 'blocked' }
  /** Only an account made with Apple or Google takes a number this way */
  | { status: 'has_number' }

/** Anything that would be lost by closing the account: homework, answers, classes, courses, a paid plan */
export async function hasWork(db: Db, userId: string): Promise<boolean> {
  const found = await Promise.all([
    db.select({ id: assignments.id }).from(assignments).where(eq(assignments.teacherId, userId)).limit(1),
    db.select({ id: attempts.id }).from(attempts).where(eq(attempts.studentId, userId)).limit(1),
    db.select({ id: enrollments.id }).from(enrollments).where(eq(enrollments.studentId, userId)).limit(1),
    db.select({ id: groups.id }).from(groups).where(eq(groups.teacherId, userId)).limit(1),
    db.select({ id: courses.id }).from(courses).where(eq(courses.teacherId, userId)).limit(1),
    // The free welcome gift doesn't count; a paid plan does
    db.select({ id: subscriptions.id }).from(subscriptions).where(and(eq(subscriptions.studentId, userId), gt(subscriptions.priceKrw, 0))).limit(1),
  ])
  return found.some((rows) => rows.length > 0)
}

/** The Telegram the person just confirmed in the bot (telegram/login.ts), for the signed-in account */
export async function linkTelegram(
  db: Db,
  user: { id: string; phone: string },
  telegram: { phone: string; telegramChatId: string },
  now = new Date(),
): Promise<LinkResult> {
  // Already this account's number: only the chat changes
  if (user.phone === telegram.phone) {
    await db.update(users).set({ telegramChatId: telegram.telegramChatId }).where(eq(users.id, user.id))
    return { status: 'linked' }
  }
  const provider = user.phone.startsWith(APPLE_PHONE_PREFIX) ? 'apple' : user.phone.startsWith(GOOGLE_PHONE_PREFIX) ? 'google' : null
  if (!provider) return { status: 'has_number' }
  return provider === 'apple' ? linkApple(db, user, telegram, now) : linkGoogle(db, user, telegram, now)
}

async function linkApple(db: Db, user: { id: string; phone: string }, telegram: { phone: string; telegramChatId: string }, now: Date): Promise<LinkResult> {
  const sub = user.phone.slice(APPLE_PHONE_PREFIX.length)
  const [other] = await db.select().from(users).where(eq(users.phone, telegram.phone)).limit(1)

  if (!other) {
    // A number nobody uses yet: this account takes it; Apple still opens it (by its Apple ID, not the phone column)
    await db.transaction(async (tx) => {
      await tx.update(users).set({ phone: telegram.phone, phoneVerifiedAt: now, telegramChatId: telegram.telegramChatId }).where(eq(users.id, user.id))
      await tx.insert(appleAccounts).values({ userId: user.id, sub }).onConflictDoNothing()
    })
    return { status: 'linked' }
  }

  if (other.blockedAt) return { status: 'blocked' }
  if (await hasWork(db, user.id)) return { status: 'both_have_work' }
  const [theirs] = await db.select({ sub: appleAccounts.sub }).from(appleAccounts).where(eq(appleAccounts.userId, other.id)).limit(1)
  if (theirs && theirs.sub !== sub) return { status: 'other_apple' }

  await db.transaction(async (tx) => {
    // The Apple ID now opens the number's account
    const [mine] = await tx.delete(appleAccounts).where(eq(appleAccounts.userId, user.id)).returning()
    if (!theirs) await tx.insert(appleAccounts).values({ userId: other.id, sub, refreshToken: mine?.refreshToken ?? null })
    await closeInto(tx, user.id, other, telegram, now)
  })
  return { status: 'switched', userId: other.id }
}

async function linkGoogle(db: Db, user: { id: string; phone: string }, telegram: { phone: string; telegramChatId: string }, now: Date): Promise<LinkResult> {
  const sub = user.phone.slice(GOOGLE_PHONE_PREFIX.length)
  const [other] = await db.select().from(users).where(eq(users.phone, telegram.phone)).limit(1)

  if (!other) {
    // Google still opens it, by its Google id (google_accounts), not the phone column
    await db.update(users).set({ phone: telegram.phone, phoneVerifiedAt: now, telegramChatId: telegram.telegramChatId }).where(eq(users.id, user.id))
    return { status: 'linked' }
  }

  if (other.blockedAt) return { status: 'blocked' }
  if (await hasWork(db, user.id)) return { status: 'both_have_work' }
  const [theirs] = await db.select({ sub: googleAccounts.sub }).from(googleAccounts).where(eq(googleAccounts.userId, other.id)).limit(1)
  if (theirs && theirs.sub !== sub) return { status: 'other_google' }

  await db.transaction(async (tx) => {
    // The Google account now opens the number's account
    const [mine] = await tx.delete(googleAccounts).where(eq(googleAccounts.userId, user.id)).returning()
    if (!theirs) await tx.insert(googleAccounts).values({ userId: other.id, sub, email: mine?.email ?? null })
    await closeInto(tx, user.id, other, telegram, now)
  })
  return { status: 'switched', userId: other.id }
}

/** The number's account takes over: it gets the Telegram chat, and the new, empty account closes */
async function closeInto(
  tx: Parameters<Parameters<Db['transaction']>[0]>[0],
  emptyId: string,
  other: typeof users.$inferSelect,
  telegram: { telegramChatId: string },
  now: Date,
) {
  // Signing in again restores an account deleted within 30 days; so does this
  await tx.update(users).set({ telegramChatId: telegram.telegramChatId, deletedAt: null, phoneVerifiedAt: other.phoneVerifiedAt ?? now }).where(eq(users.id, other.id))
  // The empty account closes (erased after 30 days like any deleted account)
  await tx.update(users).set({ deletedAt: now }).where(eq(users.id, emptyId))
  await tx.delete(sessions).where(eq(sessions.userId, emptyId))
  await tx.delete(pushDevices).where(eq(pushDevices.userId, emptyId))
}
