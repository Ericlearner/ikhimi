/**
 * Accounts deleted more than 30 days ago are erased, as the privacy policy promises (§7; until then, signing in again
 * restores them). Who the person was goes: name, email, settings, profile details and sign-in traces (the Google and Apple links too). A
 * student's answers go too. Payment records stay, as the law requires, and so does a teacher's published homework,
 * which other students did, without the teacher's name. Runs in the daily job (app/api/cron/daily).
 */
import {
  and,
  appleAccounts,
  assignments,
  attempts,
  conversations,
  enrollments,
  eq,
  googleAccounts,
  helpQuestions,
  inArray,
  lte,
  messages,
  or,
  parentLinks,
  pushDevices,
  reviewItems,
  sessions,
  sql,
  studentProfiles,
  teacherProfiles,
  users,
  type Db,
} from '@ikhimi/db'

export const PURGE_AFTER_DAYS = 30
/** The sign-in key (phone column) of an erased account: nothing anyone can sign in with, and still unique */
const ERASED = 'deleted:'

export async function purgeDeletedAccounts(db: Db, now = new Date(), limit = 50) {
  const cutoff = new Date(now.getTime() - PURGE_AFTER_DAYS * 86400_000)
  const due = await db
    .select({ id: users.id, phone: users.phone })
    .from(users)
    .where(and(lte(users.deletedAt, cutoff), sql`${users.phone} not like ${ERASED + '%'}`))
    .limit(limit)
  for (const u of due) await eraseAccount(db, u)
  return due.length
}

async function eraseAccount(db: Db, u: { id: string; phone: string }) {
  // A student's own work (their answers go with the attempts)
  const mine = await db.select({ id: attempts.id }).from(attempts).where(eq(attempts.studentId, u.id))
  if (mine.length) await db.delete(attempts).where(inArray(attempts.id, mine.map((a) => a.id)))
  await db.delete(reviewItems).where(eq(reviewItems.studentId, u.id))
  await db.delete(enrollments).where(eq(enrollments.studentId, u.id))
  await db.delete(parentLinks).where(or(eq(parentLinks.studentId, u.id), eq(parentLinks.teacherId, u.id)))

  // A teacher's own words to the AI; the homework it made stays
  const chats = (await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.teacherId, u.id))).map((c) => c.id)
  if (chats.length) {
    await db.update(assignments).set({ conversationId: null }).where(inArray(assignments.conversationId, chats))
    await db.delete(messages).where(inArray(messages.conversationId, chats))
    await db.delete(conversations).where(inArray(conversations.id, chats))
  }
  // What they asked the help chat
  await db.delete(helpQuestions).where(eq(helpQuestions.userId, u.id))

  // Sign-in traces and profile details
  await db.delete(sessions).where(eq(sessions.userId, u.id))
  await db.delete(pushDevices).where(eq(pushDevices.userId, u.id))
  await db.delete(appleAccounts).where(eq(appleAccounts.userId, u.id))
  await db.delete(googleAccounts).where(eq(googleAccounts.userId, u.id))
  await db.delete(studentProfiles).where(eq(studentProfiles.userId, u.id))
  await db.delete(teacherProfiles).where(eq(teacherProfiles.userId, u.id))

  // The account row stays (payments point at it), with nothing left that says who it was
  await db
    .update(users)
    .set({ phone: `${ERASED}${u.id}`, email: null, fullName: null, avatarUrl: null, prefs: {}, blockedReason: null })
    .where(eq(users.id, u.id))
}
