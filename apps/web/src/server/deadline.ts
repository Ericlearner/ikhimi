/**
 * Deadlines are durations (DECISIONS.md BK): the teacher gives "2 days" or "a week", not a date, and every student gets
 * all of it from when the homework reached them: when it was published, or when they joined the group, if later (by
 * its code, or by opening one of its links). It ends at the end of the last day in Seoul, so a new student is never
 * late for homework given before they came, and reusing a homework later never needs a new date.
 */

/** Seoul is UTC+9 all year (no summer time) */
const SEOUL = 9 * 3600_000
const DAY = 86_400_000

/** Up to this many days (a little over a semester) */
export const MAX_DUE_DAYS = 180

/** 23:59 in Seoul on the day `days` days after `start` */
export function endOfDayAfter(start: Date, days: number): Date {
  const day = Math.floor((start.getTime() + SEOUL) / DAY) + days
  return new Date((day + 1) * DAY - SEOUL - 60_000)
}

/** Whole Seoul days from `from` to `to` (at least 1): an old date-based deadline as a duration */
export function daysBetween(from: Date, to: Date): number {
  const day = (d: Date) => Math.floor((d.getTime() + SEOUL) / DAY)
  return Math.min(MAX_DUE_DAYS, Math.max(1, day(to) - day(from)))
}

/** A publish request's duration; an older page sends a date instead, which becomes the days from now */
export const dueDaysOf = (input: { dueDays?: number | null; dueAt?: string | null }, now = new Date()) =>
  input.dueDays ?? (input.dueAt ? daysBetween(now, new Date(input.dueAt)) : null)

/**
 * One student's deadline for a homework: `dueDays` from when it reached them. `joinedAt` is when they joined its
 * group (or opened it, for homework outside any group they're in); null for the group's own deadline.
 */
export function studentDue(h: { publishedAt: Date | null; dueDays: number | null }, joinedAt?: Date | null): Date | null {
  if (!h.dueDays || !h.publishedAt) return null
  return endOfDayAfter(joinedAt && joinedAt > h.publishedAt ? joinedAt : h.publishedAt, h.dueDays)
}
