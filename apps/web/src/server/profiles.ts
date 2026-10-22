/**
 * Profile data (design spec §12). Pure queries over a Db so they're testable against PGlite.
 */
import {
  and,
  assignments,
  attempts,
  desc,
  enrollments,
  eq,
  exercises,
  groups,
  inArray,
  isNull,
  responses,
  sql,
  users,
  type Db,
} from '@ikhimi/db'
import { studentDue } from './deadline'
import { can, type Actor } from './policy'

/** Minutes of teacher time one generated assignment replaces — the product's promise, as an estimate. */
export const MINUTES_SAVED_PER_ASSIGNMENT = 45

export async function teacherImpact(db: Db, teacherId: string) {
  const [created] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(assignments)
    .where(and(eq(assignments.teacherId, teacherId), isNull(assignments.deletedAt)))
  const [students] = await db
    .select({ n: sql<number>`count(distinct ${enrollments.studentId})::int` })
    .from(enrollments)
    .innerJoin(groups, eq(groups.id, enrollments.groupId))
    .where(eq(groups.teacherId, teacherId))
  const [avg] = await db
    .select({ v: sql<number | null>`round(avg(${attempts.percent}))::int` })
    .from(attempts)
    .innerJoin(assignments, eq(assignments.id, attempts.assignmentId))
    .where(and(eq(assignments.teacherId, teacherId), eq(attempts.status, 'graded')))
  const n = created?.n ?? 0
  return {
    assignmentsCreated: n,
    studentsTaught: students?.n ?? 0,
    averageClassScore: avg?.v ?? null,
    hoursSaved: Math.round((n * MINUTES_SAVED_PER_ASSIGNMENT) / 6) / 10,
  }
}

export async function teacherGroups(db: Db, teacherId: string) {
  const rows = await db
    .select()
    .from(groups)
    .where(and(eq(groups.teacherId, teacherId), isNull(groups.archivedAt), isNull(groups.deletedAt)))
    .orderBy(desc(groups.createdAt))
  const out = []
  for (const g of rows) {
    const [count] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(enrollments)
      .where(and(eq(enrollments.groupId, g.id), eq(enrollments.status, 'active')))
    const [last] = await db
      .select({ id: assignments.id, title: assignments.title })
      .from(assignments)
      .where(and(eq(assignments.groupId, g.id), eq(assignments.status, 'published')))
      .orderBy(desc(assignments.publishedAt))
      .limit(1)
    const [avg] = await db
      .select({ v: sql<number | null>`round(avg(${attempts.percent}))::int` })
      .from(attempts)
      .innerJoin(assignments, eq(assignments.id, attempts.assignmentId))
      .where(and(eq(assignments.groupId, g.id), eq(attempts.status, 'graded')))
    const [work] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(assignments)
      .where(and(eq(assignments.groupId, g.id), eq(assignments.status, 'published'), isNull(assignments.deletedAt)))
    out.push({
      id: g.id,
      name: g.name,
      joinCode: g.joinCode,
      cefrLevel: g.cefrLevel,
      startDate: g.startDate,
      expectedStudents: g.expectedStudents,
      students: count?.n ?? 0,
      homework: work?.n ?? 0,
      lastAssignment: last ?? null,
      average: avg?.v ?? null,
    })
  }
  return out
}

/**
 * A learner's own progress. `viewer` must pass the results:read policy for this student —
 * the student, their groups' teachers, or a guardian. Nobody else (spec §12 privacy stance).
 */
export async function learnerProgress(db: Db, viewer: Actor, studentId: string) {
  const memberships = await db
    .select({ groupId: groups.id, groupName: groups.name, teacherId: groups.teacherId, teacherName: users.fullName, joinedAt: enrollments.joinedAt })
    .from(enrollments)
    .innerJoin(groups, eq(groups.id, enrollments.groupId))
    .innerJoin(users, eq(users.id, groups.teacherId))
    .where(and(eq(enrollments.studentId, studentId), eq(enrollments.status, 'active')))
  if (!can(viewer, 'results:read', { studentId, teacherIdsOfEnrolledGroups: memberships.map((m) => m.teacherId) })) return null

  const mine = await db
    .select({ attempt: attempts, title: assignments.title, slug: assignments.shareSlug })
    .from(attempts)
    .innerJoin(assignments, eq(assignments.id, attempts.assignmentId))
    .where(eq(attempts.studentId, studentId))
    .orderBy(desc(attempts.startedAt))
  const graded = mine.filter((m) => m.attempt.status === 'graded')

  // Assigned = published into a group they belong to (plus anything they opened from a link)
  const groupIds = memberships.map((m) => m.groupId)
  const assigned = groupIds.length
    ? await db
        .select({ id: assignments.id, title: assignments.title, slug: assignments.shareSlug, dueDays: assignments.dueDays, publishedAt: assignments.publishedAt, groupId: assignments.groupId })
        .from(assignments)
        .where(and(inArray(assignments.groupId, groupIds), eq(assignments.status, 'published')))
        .orderBy(desc(assignments.publishedAt))
    : []
  const doneIds = new Set(graded.map((g) => g.attempt.assignmentId))
  const pending = [
    ...assigned
      .filter((a) => !doneIds.has(a.id))
      .map((a) => ({ id: a.id, title: a.title, slug: a.slug, publishedAt: a.publishedAt, groupId: a.groupId, dueAt: studentDue(a, memberships.find((m) => m.groupId === a.groupId)?.joinedAt) })),
    ...mine.filter((m) => m.attempt.status === 'in_progress' && !assigned.some((a) => a.id === m.attempt.assignmentId)).map((m) => ({ id: m.attempt.assignmentId, title: m.title, slug: m.slug, dueAt: null, publishedAt: null, groupId: null as string | null })),
  ]

  // Per-skill accuracy from responses joined on exercises.skillTags
  const skillRows = graded.length
    ? await db
        .select({ skills: exercises.skillTags, isCorrect: responses.isCorrect })
        .from(responses)
        .innerJoin(exercises, eq(exercises.id, responses.exerciseId))
        .where(inArray(responses.attemptId, graded.map((g) => g.attempt.id)))
    : []
  const bySkill = new Map<string, { right: number; total: number }>()
  for (const r of skillRows) {
    for (const s of r.skills) {
      const cur = bySkill.get(s) ?? { right: 0, total: 0 }
      cur.total++
      if (r.isCorrect) cur.right++
      bySkill.set(s, cur)
    }
  }

  const percents = graded.map((g) => g.attempt.percent ?? 0)
  return {
    groups: memberships.map((m) => ({ id: m.groupId, name: m.groupName, teacherName: m.teacherName })),
    completed: graded.length,
    assigned: Math.max(assigned.length, graded.length + pending.length),
    averagePercent: percents.length ? Math.round(percents.reduce((s, x) => s + x, 0) / percents.length) : null,
    totalMinutes: Math.round(mine.reduce((s, m) => s + (m.attempt.activeSeconds ?? 0), 0) / 60),
    skills: [...bySkill.entries()].map(([skill, v]) => ({ skill, accuracy: Math.round((v.right / v.total) * 100), total: v.total })).sort((p, q) => q.total - p.total),
    recent: graded.slice(0, 10).map((g) => ({ slug: g.slug, title: g.title, percent: g.attempt.percent ?? 0, submittedAt: g.attempt.submittedAt })),
    pending,
  }
}

export type LearnerProgress = NonNullable<Awaited<ReturnType<typeof learnerProgress>>>

/**
 * A student's homework, course by course (a "course" to them is a group they're in, e.g. "IELTS 6.5 kechki").
 * Each course lists every published homework with this student's status and score; homework opened from a
 * link outside their courses comes last. The student sees only their own results.
 */
export async function studentHomeworkByCourse(db: Db, studentId: string) {
  const memberships = await db
    .select({ id: groups.id, name: groups.name, teacherName: users.fullName, joinedAt: enrollments.joinedAt })
    .from(enrollments)
    .innerJoin(groups, eq(groups.id, enrollments.groupId))
    .innerJoin(users, eq(users.id, groups.teacherId))
    .where(and(eq(enrollments.studentId, studentId), eq(enrollments.status, 'active'), isNull(groups.deletedAt)))
  const groupIds = memberships.map((m) => m.id)
  const work = groupIds.length
    ? await db
        .select({ id: assignments.id, title: assignments.title, slug: assignments.shareSlug, dueDays: assignments.dueDays, publishedAt: assignments.publishedAt, groupId: assignments.groupId })
        .from(assignments)
        .where(and(inArray(assignments.groupId, groupIds), eq(assignments.status, 'published'), isNull(assignments.deletedAt)))
        .orderBy(desc(assignments.publishedAt))
    : []
  const mine = await db
    .select({ attempt: attempts, title: assignments.title, slug: assignments.shareSlug, groupId: assignments.groupId, publishedAt: assignments.publishedAt, dueDays: assignments.dueDays })
    .from(attempts)
    .innerJoin(assignments, eq(assignments.id, attempts.assignmentId))
    .where(and(eq(attempts.studentId, studentId), isNull(assignments.deletedAt)))
  const attemptOf = new Map(mine.map((m) => [m.attempt.assignmentId, m.attempt]))

  type Item = { id: string; title: string; slug: string; dueAt: Date | null; status: 'new' | 'in_progress' | 'done'; percent: number | null; pending: boolean }
  const item = (w: { id: string; title: string; slug: string; dueAt: Date | null }): Item => {
    const at = attemptOf.get(w.id)
    const status = !at ? 'new' : at.status === 'in_progress' ? 'in_progress' : 'done'
    return { ...w, status, percent: status === 'done' ? Math.round(at!.percent ?? 0) : null, pending: at?.status === 'submitted' }
  }
  // To do first (oldest due first), then done (newest first)
  const order = (xs: Item[]) => [...xs.filter((x) => x.status !== 'done'), ...xs.filter((x) => x.status === 'done')]

  const courses = memberships
    .map((m) => {
      const items = order(work.filter((w) => w.groupId === m.id).map((w) => item({ id: w.id, title: w.title, slug: w.slug, dueAt: studentDue(w, m.joinedAt) })))
      const done = items.filter((x) => x.status === 'done')
      return {
        id: m.id,
        name: m.name,
        teacherName: m.teacherName,
        items,
        todo: items.length - done.length,
        done: done.length,
        average: done.length ? Math.round(done.reduce((s, x) => s + (x.percent ?? 0), 0) / done.length) : null,
        lastActivity: Math.max(m.joinedAt.getTime(), ...work.filter((w) => w.groupId === m.id).map((w) => w.publishedAt?.getTime() ?? 0)),
      }
    })
    // Courses with work to do first, then the most recently active
    .sort((a, b) => (b.todo > 0 ? 1 : 0) - (a.todo > 0 ? 1 : 0) || b.lastActivity - a.lastActivity)

  const outside = order(
    // Outside their groups, the time runs from when they opened it
    mine.filter((m) => !m.groupId || !groupIds.includes(m.groupId)).map((m) => item({ id: m.attempt.assignmentId, title: m.title, slug: m.slug, dueAt: studentDue(m, m.attempt.startedAt) })),
  )
  return { courses, outside }
}

export type StudentCourses = Awaited<ReturnType<typeof studentHomeworkByCourse>>
