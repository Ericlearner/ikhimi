/**
 * A teacher's earnings (DECISIONS.md AZ, BL): their share of what their own students paid for a plan themselves, and
 * of every sale of their paid courses. Real paid payments only; a refund takes the payment (and the share) out.
 * 익히미 pays it out.
 */
import { and, courses, desc, eq, ne, payments, sql, subscriptions, users, type Db } from '@ikhimi/db'

export async function teacherEarnings(db: Db, teacherId: string, now = new Date()) {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const mine = and(eq(payments.commissionTeacherId, teacherId), eq(payments.status, 'paid'), ne(payments.provider, 'test'))
  const [totals] = await db
    .select({
      total: sql<number>`coalesce(sum(${payments.commissionKrw}), 0)::bigint`,
      // A text timestamp: the Postgres driver can't bind a Date inside sql``
      month: sql<number>`coalesce(sum(${payments.commissionKrw}) filter (where ${payments.createdAt} >= ${monthStart.toISOString()}::timestamptz), 0)::bigint`,
      students: sql<number>`count(distinct ${subscriptions.studentId})::int`,
    })
    .from(payments)
    .innerJoin(subscriptions, eq(subscriptions.id, payments.subscriptionId))
    .where(mine)
  const recent = await db
    .select({
      id: payments.id,
      at: payments.createdAt,
      amountKrw: payments.amountKrw,
      commissionKrw: payments.commissionKrw,
      plan: subscriptions.plan,
      months: subscriptions.months,
      student: users.fullName,
      course: courses.title,
    })
    .from(payments)
    .innerJoin(subscriptions, eq(subscriptions.id, payments.subscriptionId))
    .innerJoin(users, eq(users.id, subscriptions.studentId))
    .leftJoin(courses, eq(courses.id, subscriptions.courseId))
    .where(mine)
    .orderBy(desc(payments.createdAt))
    .limit(50)
  return {
    totalKrw: Number(totals?.total ?? 0),
    monthKrw: Number(totals?.month ?? 0),
    students: totals?.students ?? 0,
    recent: recent.map((r) => ({ ...r, commissionKrw: r.commissionKrw ?? 0 })),
  }
}
