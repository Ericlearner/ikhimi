import { z } from 'zod'
import { and, assignments, attempts, desc, enrollments, eq, groups, inArray, isNull, sql, users, type Db } from '@ikhimi/db'

export const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const

/** What a teacher enters for a group (publish sheet and group page). Organisation only, never sent to the AI. */
export const groupDetailsSchema = z.object({
  name: z.string().trim().min(1).max(60),
  cefrLevel: z.enum(CEFR_LEVELS).nullable().optional(),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  expectedStudents: z.number().int().min(1).max(500).nullable().optional(),
  description: z.string().max(500).nullable().optional(),
  /** [DECIDE #4] Students see their own place in the class (off by default) */
  studentsSeeLeaderboard: z.boolean().optional(),
})

export async function ownedGroup(db: Db, teacherId: string, groupId: string) {
  const [g] = await db
    .select()
    .from(groups)
    .where(and(eq(groups.id, groupId), eq(groups.teacherId, teacherId), isNull(groups.deletedAt)))
    .limit(1)
  return g ?? null
}

export async function updateGroup(db: Db, teacherId: string, groupId: string, input: Partial<z.infer<typeof groupDetailsSchema>>) {
  const g = await ownedGroup(db, teacherId, groupId)
  if (!g) return null
  const [row] = await db
    .update(groups)
    .set({
      ...(input.name !== undefined && { name: input.name.trim() }),
      ...(input.cefrLevel !== undefined && { cefrLevel: input.cefrLevel }),
      ...(input.startDate !== undefined && { startDate: input.startDate }),
      ...(input.expectedStudents !== undefined && { expectedStudents: input.expectedStudents }),
      ...(input.description !== undefined && { description: input.description?.trim() || null }),
      ...(input.studentsSeeLeaderboard !== undefined && { studentsSeeLeaderboard: input.studentsSeeLeaderboard }),
    })
    .where(eq(groups.id, groupId))
    .returning()
  return row!
}

/** Everything the group page shows: details, all its homework with results, and its students. */
export async function groupOverview(db: Db, teacherId: string, groupId: string) {
  const g = await ownedGroup(db, teacherId, groupId)
  if (!g) return null

  const work = await db
    .select({
      id: assignments.id,
      title: assignments.title,
      status: assignments.status,
      publishedAt: assignments.publishedAt,
      dueAt: assignments.dueAt,
      submitted: sql<number>`count(${attempts.id}) filter (where ${attempts.status} = 'graded')::int`,
      average: sql<number | null>`round(avg(${attempts.percent}) filter (where ${attempts.status} = 'graded'))::int`,
    })
    .from(assignments)
    .leftJoin(attempts, eq(attempts.assignmentId, assignments.id))
    .where(and(eq(assignments.groupId, g.id), isNull(assignments.deletedAt)))
    .groupBy(assignments.id)
    .orderBy(desc(assignments.publishedAt))

  const members = await db
    .select({ id: users.id, name: users.fullName, joinedAt: enrollments.createdAt })
    .from(enrollments)
    .innerJoin(users, eq(users.id, enrollments.studentId))
    .where(and(eq(enrollments.groupId, g.id), eq(enrollments.status, 'active')))
    .orderBy(users.fullName)

  const workIds = work.map((w) => w.id)
  const perStudent = workIds.length && members.length
    ? await db
        .select({
          studentId: attempts.studentId,
          done: sql<number>`count(*) filter (where ${attempts.status} = 'graded')::int`,
          average: sql<number | null>`round(avg(${attempts.percent}) filter (where ${attempts.status} = 'graded'))::int`,
        })
        .from(attempts)
        .where(and(inArray(attempts.assignmentId, workIds), inArray(attempts.studentId, members.map((m) => m.id))))
        .groupBy(attempts.studentId)
    : []

  const published = work.filter((w) => w.status !== 'draft').length
  const students = members.map((m) => {
    const s = perStudent.find((p) => p.studentId === m.id)
    return { id: m.id, name: m.name ?? '—', done: s?.done ?? 0, average: s?.average ?? null }
  })
  const graded = students.filter((s) => s.average !== null)
  return {
    group: g,
    work,
    students,
    published,
    average: graded.length ? Math.round(graded.reduce((n, s) => n + s.average!, 0) / graded.length) : null,
  }
}

/** A group code as a student types it: case, spaces and dashes don't matter */
export const normalizeJoinCode = (s: string) => s.toUpperCase().replace(/[\s-]/g, '')
/** Six characters from the share-slug alphabet (no 0/O, 1/I/L) */
const JOIN_CODE = /^[2-9A-HJKMNP-Z]{6}$/

type JoinFail = { ok: false; reason: 'invalid_code' | 'code_not_found' | 'own_group' | 'removed' }

/**
 * A student joins a group with the code the teacher gave them (group page, "반 코드"): from then on they see all
 * of its homework in My work, like a student who opened one of its links. Joining again changes nothing.
 */
export async function joinGroupByCode(
  db: Db,
  studentId: string,
  input: string,
  now = new Date(),
): Promise<{ ok: true; already: boolean; group: { id: string; name: string; teacherName: string | null } } | JoinFail> {
  const code = normalizeJoinCode(input)
  if (!JOIN_CODE.test(code)) return { ok: false, reason: 'invalid_code' }

  const [g] = await db
    .select({ id: groups.id, name: groups.name, teacherId: groups.teacherId, teacherName: users.fullName })
    .from(groups)
    .innerJoin(users, eq(users.id, groups.teacherId))
    .where(and(eq(groups.joinCode, code), isNull(groups.deletedAt), isNull(groups.archivedAt)))
    .limit(1)
  // A wrong code just gives nothing
  if (!g) return { ok: false, reason: 'code_not_found' }
  // The teacher looks at their own homework as a preview, never as a student of their own group
  if (g.teacherId === studentId) return { ok: false, reason: 'own_group' }
  const group = { id: g.id, name: g.name, teacherName: g.teacherName }

  const [e] = await db.select().from(enrollments).where(and(eq(enrollments.groupId, g.id), eq(enrollments.studentId, studentId))).limit(1)
  if (e?.status === 'active') return { ok: true, already: true, group }
  // Taken out by the teacher: only the teacher can bring them back
  if (e?.status === 'removed') return { ok: false, reason: 'removed' }
  if (e) await db.update(enrollments).set({ status: 'active', joinedAt: now }).where(eq(enrollments.id, e.id))
  else await db.insert(enrollments).values({ groupId: g.id, studentId, joinedAt: now }).onConflictDoNothing()
  return { ok: true, already: false, group }
}
