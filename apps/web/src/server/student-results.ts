/**
 * What My work's results draw (the skill map, a skill's strongest and weakest topics, ⭐): the student's own answers,
 * read once. A topic is a homework; its score for a skill counts only that skill's items.
 */
import { and, assignments, attempts, eq, exercises, isNotNull, isNull, responses, type Db } from '@ikhimi/db'
import { seoulWeekStart } from './streak'

/** A skill or a topic shows a score only from this many answers */
export const MIN_ANSWERS = 5
const TOPIC_MIN_ANSWERS = 2
/** "Change": the latest homework with the skill against the ones before, this many each side */
const CHANGE_WINDOW = 3

export type Topic = { id: string; title: string; slug: string; percent: number; total: number }
export type SkillResult = {
  skill: string
  percent: number
  total: number
  /** Points up or down: latest homework against the ones before; null until there are enough */
  change: number | null
  /** Up to three best topics (60% and up), and up to three to work on (below 80%), never the same one twice */
  strengths: Topic[]
  attention: Topic[]
}

const pct = (right: number, total: number) => Math.round((right / total) * 100)

export async function studentResults(db: Db, studentId: string, now = new Date()) {
  const rows = await db
    .select({
      isCorrect: responses.isCorrect,
      updatedAt: responses.updatedAt,
      skills: exercises.skillTags,
      status: attempts.status,
      submittedAt: attempts.submittedAt,
      assignmentId: assignments.id,
      title: assignments.title,
      slug: assignments.shareSlug,
    })
    .from(responses)
    .innerJoin(attempts, eq(attempts.id, responses.attemptId))
    .innerJoin(exercises, eq(exercises.id, responses.exerciseId))
    .innerJoin(assignments, eq(assignments.id, attempts.assignmentId))
    .where(and(eq(attempts.studentId, studentId), isNotNull(responses.isCorrect), isNull(assignments.deletedAt)))

  // ⭐ every right answer ever, and how many came this week
  const weekStart = seoulWeekStart(now)
  const right = rows.filter((r) => r.isCorrect)
  const stars = { total: right.length, thisWeek: right.filter((r) => r.updatedAt >= weekStart).length }

  // Scores count handed-in homework only
  const handedIn = rows.filter((r) => r.status !== 'in_progress')
  const accuracy = handedIn.length ? pct(handedIn.filter((r) => r.isCorrect).length, handedIn.length) : null

  type Acc = { right: number; total: number }
  const bySkill = new Map<string, { all: Acc; topics: Map<string, Acc & { title: string; slug: string; at: number }> }>()
  for (const r of handedIn) {
    for (const s of r.skills) {
      const cur = bySkill.get(s) ?? { all: { right: 0, total: 0 }, topics: new Map() }
      cur.all.total++
      if (r.isCorrect) cur.all.right++
      const tp = cur.topics.get(r.assignmentId) ?? { right: 0, total: 0, title: r.title, slug: r.slug, at: r.submittedAt?.getTime() ?? 0 }
      tp.total++
      if (r.isCorrect) tp.right++
      cur.topics.set(r.assignmentId, tp)
      bySkill.set(s, cur)
    }
  }

  const skills: SkillResult[] = [...bySkill.entries()]
    .map(([skill, v]) => {
      const topics = [...v.topics.entries()].map(([id, x]) => ({ id, title: x.title, slug: x.slug, percent: pct(x.right, x.total), total: x.total, at: x.at }))
      const scored = topics.filter((x) => x.total >= TOPIC_MIN_ANSWERS)
      const strengths = scored.filter((x) => x.percent >= 60).sort((a, b) => b.percent - a.percent || b.at - a.at).slice(0, 3)
      const attention = scored
        .filter((x) => x.percent < 80 && !strengths.some((s) => s.id === x.id))
        .sort((a, b) => a.percent - b.percent || b.at - a.at)
        .slice(0, 3)
      // Change: the latest few homework with this skill against the few before
      const byTime = [...topics].sort((a, b) => a.at - b.at)
      const sum = (xs: typeof topics) => xs.reduce((s, x) => ({ right: s.right + (x.percent * x.total) / 100, total: s.total + x.total }), { right: 0, total: 0 })
      const recent = sum(byTime.slice(-CHANGE_WINDOW))
      const before = sum(byTime.slice(-2 * CHANGE_WINDOW, -CHANGE_WINDOW))
      const change = byTime.length >= 2 * CHANGE_WINDOW && recent.total >= 3 && before.total >= 3 ? pct(recent.right, recent.total) - pct(before.right, before.total) : null
      const strip = ({ at: _at, ...t }: (typeof topics)[number]): Topic => t
      return { skill, percent: pct(v.all.right, v.all.total), total: v.all.total, change, strengths: strengths.map(strip), attention: attention.map(strip) }
    })
    .sort((a, b) => b.total - a.total)

  return { stars, accuracy, skills }
}
