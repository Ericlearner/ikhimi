/**
 * A group's ranking (DECISIONS.md BC). Every student's score is their average over the group's homework that counts
 * for them, where homework they didn't hand in counts as 0 once it's closed: its due date has passed, or (no due date)
 * a newer homework was published in the group. Homework published before the student joined counts only if they did
 * it. Ties: more homework on time, then whoever finished their last one first. It is recalculated on every read, so
 * it moves with each homework; `change` is the places gained or lost since the latest homework.
 */
import { and, asc, assignments, attempts, enrollments, eq, groups, inArray, isNull, ne, users, type Db } from '@ikhimi/db'
import { studentDue } from './deadline'

type Homework = { id: string; publishedAt: Date | null; dueDays: number | null }
type Done = { assignmentId: string; studentId: string; percent: number | null; submittedAt: Date | null }
type Member = { id: string; name: string | null; joinedAt: Date }

export type RankRow = {
  studentId: string
  name: string
  /** 1 = best; ties share a place. null: nothing counts for them yet */
  place: number | null
  score: number | null
  done: number
  counted: number
  onTime: number
  /** Places gained (+) or lost (−) since the latest homework; null when there was no place before */
  change: number | null
}

/** Pure: the ranking from the group's homework, members and handed-in work, as of `now` */
export function rankStudents(homework: Homework[], members: Member[], done: Done[], now: Date): Omit<RankRow, 'change'>[] {
  const sorted = [...homework].sort((p, q) => (p.publishedAt?.getTime() ?? 0) - (q.publishedAt?.getTime() ?? 0))
  // Each student's own deadline (the time runs from when they joined, if after it was published)
  const closed = (due: Date | null, i: number) => (due ? due <= now : i < sorted.length - 1)
  const rows = members.map((m) => {
    const mine = new Map(done.filter((d) => d.studentId === m.id).map((d) => [d.assignmentId, d]))
    let sum = 0
    let counted = 0
    let onTime = 0
    let last = 0
    sorted.forEach((h, i) => {
      const d = mine.get(h.id)
      const due = studentDue(h, m.joinedAt)
      if (d) {
        counted++
        sum += d.percent ?? 0
        if (!due || (d.submittedAt && d.submittedAt <= due)) onTime++
        last = Math.max(last, d.submittedAt?.getTime() ?? 0)
      } else if (closed(due, i) && (h.publishedAt ?? now) >= m.joinedAt) counted++ // missed: 0
    })
    return { studentId: m.id, name: m.name ?? '—', score: counted ? Math.round(sum / counted) : null, done: mine.size, counted, onTime, last }
  })
  rows.sort((p, q) => (q.score ?? -1) - (p.score ?? -1) || q.onTime - p.onTime || (p.last || Infinity) - (q.last || Infinity))
  return rows.map((r) => {
    const { last: _last, ...row } = r
    const above = rows.filter((x) => x.score !== null && (x.score > r.score! || (x.score === r.score && (x.onTime > r.onTime || (x.onTime === r.onTime && (x.last || Infinity) < (r.last || Infinity))))))
    return { ...row, place: r.score === null ? null : above.length + 1 }
  })
}

/** The group's ranking now, with each student's move since the latest homework */
export async function groupRanking(db: Db, groupId: string, now = new Date()): Promise<RankRow[]> {
  const homework = await db
    .select({ id: assignments.id, publishedAt: assignments.publishedAt, dueDays: assignments.dueDays })
    .from(assignments)
    .where(and(eq(assignments.groupId, groupId), eq(assignments.status, 'published'), isNull(assignments.deletedAt)))
    .orderBy(asc(assignments.publishedAt))
  const members = await db
    .select({ id: users.id, name: users.fullName, joinedAt: enrollments.joinedAt })
    .from(enrollments)
    .innerJoin(users, eq(users.id, enrollments.studentId))
    .where(and(eq(enrollments.groupId, groupId), eq(enrollments.status, 'active'), isNull(users.deletedAt)))
  const done = homework.length
    ? await db
        .select({ assignmentId: attempts.assignmentId, studentId: attempts.studentId, percent: attempts.percent, submittedAt: attempts.submittedAt })
        .from(attempts)
        .where(and(inArray(attempts.assignmentId, homework.map((h) => h.id)), ne(attempts.status, 'in_progress')))
    : []
  const nowRows = rankStudents(homework, members, done, now)
  // Before the latest homework: without it and its results
  const latest = homework.at(-1)
  const before = latest
    ? new Map(rankStudents(homework.slice(0, -1), members, done.filter((d) => d.assignmentId !== latest.id), now).map((r) => [r.studentId, r.place]))
    : new Map<string, number | null>()
  return nowRows.map((r) => {
    const was = before.get(r.studentId)
    return { ...r, change: r.place !== null && was != null ? was - r.place : null }
  })
}

/** "Aziz Karimov" → "Aziz K.": what classmates see of each other */
export const shortName = (name: string) => {
  const [first, ...rest] = name.trim().split(/\s+/)
  return rest.length ? `${first} ${rest.at(-1)![0]}.` : (first ?? name)
}

/**
 * A student's view (My work): the full ranking of each of their groups whose teacher turned "show the ranking to
 * students" on. Classmates appear as first name + initial, with their place and score.
 */
export async function studentRankings(db: Db, studentId: string, now = new Date()) {
  const mine = await db
    .select({ id: groups.id, name: groups.name })
    .from(enrollments)
    .innerJoin(groups, eq(groups.id, enrollments.groupId))
    .where(and(eq(enrollments.studentId, studentId), eq(enrollments.status, 'active'), eq(groups.studentsSeeLeaderboard, true), isNull(groups.deletedAt)))
  return Promise.all(
    mine.map(async (g) => ({
      groupId: g.id,
      groupName: g.name,
      rows: (await groupRanking(db, g.id, now)).map((r) => ({ ...r, name: r.studentId === studentId ? r.name : shortName(r.name), me: r.studentId === studentId })),
    })),
  )
}
