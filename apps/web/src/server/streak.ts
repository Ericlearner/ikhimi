/**
 * A student's active days (My work: 🔥 and the week's dots): a day counts when they answered homework or reviewed an
 * old mistake. Days are Seoul calendar days. Read from what's already saved (answers and review items); nothing new
 * is stored.
 */
import { and, attempts, eq, gt, isNotNull, responses, reviewItems, sql, type Db } from '@ikhimi/db'

const TZ_OFFSET_MS = 9 * 3600 * 1000 // Asia/Seoul, UTC+9 all year
const DAY = 24 * 3600 * 1000
/** Looks back this far; a longer streak still shows, counted up to here */
const WINDOW_DAYS = 120

/** Seoul calendar day as YYYY-MM-DD */
export const seoulDay = (d: Date) => new Date(d.getTime() + TZ_OFFSET_MS).toISOString().slice(0, 10)

/** Monday 00:00 of this Seoul week, as an instant */
export function seoulWeekStart(now = new Date()) {
  const local = new Date(now.getTime() + TZ_OFFSET_MS)
  const fromMonday = (local.getUTCDay() + 6) % 7
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - fromMonday) - TZ_OFFSET_MS)
}

export type Streak = {
  /** Days in a row up to today, or up to yesterday while today isn't done yet */
  days: number
  /** Today counted already */
  today: boolean
  /** Monday → Sunday of this week: active, and whether it's today / still ahead */
  week: { day: string; active: boolean; isToday: boolean; future: boolean }[]
}

export function streakFrom(activeDays: Set<string>, now = new Date()): Streak {
  const today = seoulDay(now)
  let cursor = activeDays.has(today) ? now.getTime() : now.getTime() - DAY
  let days = 0
  while (activeDays.has(seoulDay(new Date(cursor)))) {
    days++
    cursor -= DAY
  }
  // Monday of this Seoul week
  const local = new Date(now.getTime() + TZ_OFFSET_MS)
  const fromMonday = (local.getUTCDay() + 6) % 7
  const week = Array.from({ length: 7 }, (_, i) => {
    const day = seoulDay(new Date(now.getTime() + (i - fromMonday) * DAY))
    return { day, active: activeDays.has(day), isToday: day === today, future: day > today }
  })
  return { days, today: activeDays.has(today), week }
}

export async function studentStreak(db: Db, studentId: string, now = new Date()): Promise<Streak> {
  const since = new Date(now.getTime() - WINDOW_DAYS * DAY)
  // Whatever the database's own time zone: to UTC, then Seoul's +9
  const dayOf = (col: unknown) => sql<string>`to_char((${col} at time zone 'UTC') + interval '9 hours', 'YYYY-MM-DD')`
  const answered = await db
    .selectDistinct({ day: dayOf(responses.updatedAt) })
    .from(responses)
    .innerJoin(attempts, eq(attempts.id, responses.attemptId))
    .where(and(eq(attempts.studentId, studentId), gt(responses.updatedAt, since)))
  const reviewed = await db
    .selectDistinct({ day: dayOf(reviewItems.updatedAt) })
    .from(reviewItems)
    // Answered in review at least once (new items are added with no answer yet)
    .where(and(eq(reviewItems.studentId, studentId), isNotNull(reviewItems.lastRight), gt(reviewItems.updatedAt, since)))
  return streakFrom(new Set([...answered, ...reviewed].map((r) => r.day)), now)
}
