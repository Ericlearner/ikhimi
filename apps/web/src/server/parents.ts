/**
 * A progress page for a student's parents (/parent/<token>): read-only, no sign-in, made by one of the student's
 * teachers and showing only that teacher's homework. The teacher sends the link (it's private: anyone with it can
 * see the page) and can turn it off or make a new one at any time. No ranks and no classmates: the class average only.
 */
import { randomBytes } from 'node:crypto'
import { and, enrollments, eq, groups, isNull, parentLinks, users, type Db } from '@ikhimi/db'
import { studentAnalytics } from './analytics'

/** Does this teacher teach this student (active in one of their groups)? */
async function teaches(db: Db, teacherId: string, studentId: string) {
  const [row] = await db
    .select({ id: enrollments.id })
    .from(enrollments)
    .innerJoin(groups, eq(groups.id, enrollments.groupId))
    .where(and(eq(enrollments.studentId, studentId), eq(enrollments.status, 'active'), eq(groups.teacherId, teacherId), isNull(groups.deletedAt)))
    .limit(1)
  return !!row
}

export async function activeParentLink(db: Db, teacherId: string, studentId: string) {
  const [row] = await db
    .select()
    .from(parentLinks)
    .where(and(eq(parentLinks.teacherId, teacherId), eq(parentLinks.studentId, studentId), isNull(parentLinks.revokedAt)))
    .limit(1)
  return row ?? null
}

/** A new link (any earlier one stops working) */
export async function createParentLink(db: Db, teacherId: string, studentId: string) {
  if (!(await teaches(db, teacherId, studentId))) return null
  await revokeParentLink(db, teacherId, studentId)
  const [row] = await db.insert(parentLinks).values({ token: randomBytes(18).toString('base64url'), teacherId, studentId }).returning()
  return row!
}

export async function revokeParentLink(db: Db, teacherId: string, studentId: string) {
  await db
    .update(parentLinks)
    .set({ revokedAt: new Date() })
    .where(and(eq(parentLinks.teacherId, teacherId), eq(parentLinks.studentId, studentId), isNull(parentLinks.revokedAt)))
}

export const parentUrl = (token: string) => `${(process.env.PUBLIC_ORIGIN ?? 'https://ikhimi.kr').replace(/\/$/, '')}/parent/${token}`

/** What the parent page shows, or null for a link that's off, unknown, or whose student or teacher has gone */
export async function parentView(db: Db, token: string) {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null
  const [link] = await db
    .select()
    .from(parentLinks)
    .where(and(eq(parentLinks.token, token), isNull(parentLinks.revokedAt)))
    .limit(1)
  if (!link) return null
  const [teacher] = await db.select({ name: users.fullName, deletedAt: users.deletedAt }).from(users).where(eq(users.id, link.teacherId)).limit(1)
  const [student] = await db.select({ deletedAt: users.deletedAt }).from(users).where(eq(users.id, link.studentId)).limit(1)
  if (!teacher || teacher.deletedAt || !student || student.deletedAt) return null
  // Seen through the teacher's eyes: only their groups and their homework
  const data = await studentAnalytics(db, { id: link.teacherId, role: 'teacher' }, link.studentId)
  if (!data || !data.groups.length) return null
  await db.update(parentLinks).set({ lastViewedAt: new Date() }).where(eq(parentLinks.id, link.id))
  return {
    teacherName: teacher.name ?? '—',
    // First name only: the page can be forwarded
    studentName: data.student.name.split(/\s+/)[0] ?? data.student.name,
    groups: data.groups.map((g) => g.name),
    average: data.average,
    classAverage: data.classAverage,
    completed: data.completed,
    assigned: data.assigned,
    onTimeRate: data.onTimeRate,
    trend: data.trend,
    totalMinutes: data.totalMinutes,
    missing: data.missing.map((m) => ({ title: m.title, dueAt: m.dueAt })),
    recent: [...data.timeline].reverse().slice(0, 12).map((x) => ({ title: x.title, submittedAt: x.submittedAt, percent: x.percent, classAverage: x.classAverage, late: x.late, pending: x.pending })),
    skills: data.skills.map((s) => ({ skill: s.skill, accuracy: s.accuracy, classAccuracy: s.classAccuracy })),
  }
}
