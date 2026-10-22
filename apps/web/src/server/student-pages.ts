import 'server-only'
import { and, assignments, eq, getDb, groups, teacherProfiles, users } from '@ikhimi/db'

export async function loadPublishedBySlug(slug: string) {
  if (!/^[A-Z0-9]{6,12}$/.test(slug)) return null
  const [row] = await getDb()
    .select({ a: assignments, teacherName: users.fullName, teacherId: users.id, school: teacherProfiles.schoolName, subjects: teacherProfiles.subjects })
    .from(assignments)
    .innerJoin(users, eq(users.id, assignments.teacherId))
    .leftJoin(teacherProfiles, eq(teacherProfiles.userId, assignments.teacherId))
    .where(and(eq(assignments.shareSlug, slug), eq(assignments.status, 'published')))
    .limit(1)
  if (!row) return null
  let groupName: string | null = null
  if (row.a.groupId) {
    const [g] = await getDb().select({ name: groups.name }).from(groups).where(eq(groups.id, row.a.groupId)).limit(1)
    groupName = g?.name ?? null
  }
  // Public teacher card (design spec §12): avatar, name, school, subjects — nothing else.
  return {
    a: row.a,
    teacherName: row.teacherName,
    teacher: { id: row.teacherId, name: row.teacherName, school: row.school, subjects: row.subjects ?? [] },
    groupName,
  }
}

/** Only same-site relative paths are allowed as post-login destinations. */
export const safeNext = (v: string | undefined | null) => (v && /^\/(?!\/)[\w\-/]*$/.test(v) ? v : null)
