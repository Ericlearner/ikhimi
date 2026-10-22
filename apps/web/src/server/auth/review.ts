/**
 * The app-store review login (Google Play, App Store): one made-up phone number with a fixed code, set in
 * REVIEW_LOGIN_PHONE and REVIEW_LOGIN_CODE. Nothing is ever sent to that number, and signing in with it gives a ready
 * account: a name, the teacher and student sides, and VIP. Unset = off. The code is given to the stores only.
 */
import { timingSafeEqual } from 'node:crypto'
import { eq, teacherProfiles, users, type Db } from '@ikhimi/db'
import { normalizePhone } from '@ikhimi/i18n'
import { grantPlan, studentPlan } from '../plans'

export const REVIEW_NAME = 'Google Review'

export function reviewLogin(): { phone: string; code: string } | null {
  const phone = normalizePhone(process.env.REVIEW_LOGIN_PHONE ?? '', 'UZ')
  const code = (process.env.REVIEW_LOGIN_CODE ?? '').trim()
  return phone && /^\d{6}$/.test(code) ? { phone, code } : null
}

export const isReviewPhone = (phone: string) => reviewLogin()?.phone === phone

export function reviewCodeMatches(phone: string, code: string) {
  const r = reviewLogin()
  if (!r || r.phone !== phone) return false
  const a = Buffer.from(code.trim().padEnd(6, ' ').slice(0, 6))
  return timingSafeEqual(a, Buffer.from(r.code))
}

/** Makes the review account ready to look at everything: name, both sides, VIP for a year (topped up each sign-in) */
export async function prepareReviewAccount(db: Db, userId: string) {
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  if (!u) return
  await db
    .update(users)
    .set({ fullName: u.fullName?.trim() ? u.fullName : REVIEW_NAME, role: u.roles.length ? u.role : 'teacher', roles: ['teacher', 'student'] })
    .where(eq(users.id, userId))
  await db.insert(teacherProfiles).values({ userId, subjects: ['english'], defaultContentLanguage: 'en', onboardedAt: new Date() }).onConflictDoNothing()
  if ((await studentPlan(db, userId)) !== 'vip') await grantPlan(db, userId, 'vip', 365)
}
