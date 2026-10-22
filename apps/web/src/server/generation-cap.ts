import { and, assignments, CONFIG, eq, gte, sql, type Db, type teacherProfiles } from '@ikhimi/db'

/**
 * Daily cap per teacher (§8.8, [DECIDE #8]); staff can raise it or reset today's count (admin panel).
 * Returns the cap when it is reached, null otherwise.
 */
export async function capReached(db: Db, teacherId: string, profile: typeof teacherProfiles.$inferSelect | undefined): Promise<number | null> {
  const cap = profile?.dailyCap ?? CONFIG.generationDailyCapPerTeacher
  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000)
  const since = profile?.capResetAt && profile.capResetAt > dayAgo ? profile.capResetAt : dayAgo
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(assignments)
    .where(and(eq(assignments.teacherId, teacherId), gte(assignments.createdAt, since)))
  return (row?.n ?? 0) >= cap ? cap : null
}
