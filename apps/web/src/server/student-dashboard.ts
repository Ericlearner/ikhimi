/**
 * A student's own results, once, for both places that show them: My work's short "Natijalarim" card and the full
 * analytics in Profile (tiles, skill map, trend line, group rankings).
 */
import type { Db } from '@ikhimi/db'
import type { Actor } from './policy'
import { studentAnalytics } from './analytics'
import { learnerProgress } from './profiles'
import { studentRankings } from './ranking'
import { MIN_ANSWERS, studentResults } from './student-results'

/** The trend line shows this many of the latest homework */
export const TREND_N = 10

const mean = (xs: number[]) => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : null)

export async function studentDashboard(db: Db, viewer: Actor & { id: string }) {
  const [progress, analytics, results, rankings] = await Promise.all([
    learnerProgress(db, viewer, viewer.id),
    studentAnalytics(db, viewer, viewer.id),
    studentResults(db, viewer.id),
    studentRankings(db, viewer.id),
  ])
  const timeline = analytics?.timeline ?? []
  // Scored homework only (not those waiting for the teacher): the latest few, their average, and the latest five
  // against the five before
  const scored = timeline.filter((x) => !x.pending)
  const latest = scored.slice(-TREND_N).map((x) => ({ id: x.attemptId, title: x.title, slug: x.slug, percent: x.percent, at: x.submittedAt }))
  const average = mean(latest.map((x) => x.percent))
  const recent = scored.slice(-5).map((x) => x.percent)
  const before = scored.slice(-10, -5).map((x) => x.percent)
  const change = recent.length >= 3 && before.length >= 3 ? mean(recent)! - mean(before)! : null

  // The best skill and the one to work on (enough answers only; the weak one only when it isn't strong already)
  const known = results.skills.filter((s) => s.total >= MIN_ANSWERS)
  const best = known.length ? known.reduce((a, b) => (b.percent > a.percent ? b : a)) : null
  const weakest = known.length > 1 ? known.reduce((a, b) => (b.percent < a.percent ? b : a)) : null
  const weak = weakest && weakest.percent < 80 && weakest.skill !== best?.skill ? weakest : null

  // My place in each group whose teacher shows the ranking
  const places = rankings.flatMap((g) => {
    const me = g.rows.find((r) => r.me)
    return me && me.place !== null ? [{ groupId: g.groupId, groupName: g.groupName, place: me.place, of: g.rows.length }] : []
  })

  return { progress, timeline, results, rankings, trend: { latest, average, change }, best, weak, places }
}
export type StudentDashboard = Awaited<ReturnType<typeof studentDashboard>>
