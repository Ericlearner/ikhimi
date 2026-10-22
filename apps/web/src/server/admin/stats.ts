/**
 * Numbers for the admin panel. Read-only, computed when a staff member opens a page (only staff do, so the
 * load is negligible). Days are Seoul days (UTC+9). Money is integer won; AI cost is an estimate in USD.
 */
import {
  adminAudit,
  aiCalls,
  and,
  assignments,
  attempts,
  courseLessons,
  courses,
  desc,
  enrollments,
  eq,
  exercises,
  generationRuns,
  groups,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  or,
  payments,
  sql,
  staffMembers,
  staffRoles,
  planPackages,
  subscriptions,
  teacherProfiles,
  users,
  type Db,
} from '@ikhimi/db'
import { costUsd } from '../ai-usage'

const DAY = 24 * 3600_000
/** A run still "running" after this long was killed by the server's time limit */
export const RUN_TIMEOUT_MS = 6 * 60_000
/** A moment inside raw SQL: postgres-js can't send a Date there, so it goes as an ISO timestamp */
const at = (d: Date) => sql`${d.toISOString()}::timestamptz`
const seoulDay = (col: unknown) => sql<string>`to_char((${col} at time zone 'UTC') + interval '9 hours', 'YYYY-MM-DD')`

/** The last `days` Seoul dates, oldest first */
export function lastDays(days: number, now = Date.now()): string[] {
  return Array.from({ length: days }, (_, i) => new Date(now + 9 * 3600_000 - (days - 1 - i) * DAY).toISOString().slice(0, 10))
}

// ─── health ─────────────────────────────────────────────────────────────────

export async function healthStats(db: Db, days = 14) {
  const since = new Date(Date.now() - days * DAY)
  const timedOut = new Date(Date.now() - RUN_TIMEOUT_MS)
  const perDay = await db
    .select({
      day: seoulDay(generationRuns.createdAt),
      total: sql<number>`count(*)::int`,
      ok: sql<number>`count(*) filter (where ${generationRuns.status} = 'ok')::int`,
      failed: sql<number>`count(*) filter (where ${generationRuns.status} = 'failed' or (${generationRuns.status} = 'running' and ${generationRuns.createdAt} < ${at(timedOut)}))::int`,
      avgMs: sql<number | null>`(avg(${generationRuns.durationMs}) filter (where ${generationRuns.status} = 'ok'))::int`,
      p90Ms: sql<number | null>`(percentile_cont(0.9) within group (order by ${generationRuns.durationMs}) filter (where ${generationRuns.status} = 'ok'))::int`,
      reviewSkipped: sql<number>`count(*) filter (where ${generationRuns.review} = 'skipped_slow')::int`,
      reviewFailed: sql<number>`count(*) filter (where ${generationRuns.review} = 'failed')::int`,
      picPointed: sql<number>`coalesce(sum(${generationRuns.picturesPointed}), 0)::int`,
      picLocated: sql<number>`coalesce(sum(${generationRuns.picturesLocated}), 0)::int`,
      picAttached: sql<number>`coalesce(sum(${generationRuns.picturesAttached}), 0)::int`,
      picRemoved: sql<number>`coalesce(sum(${generationRuns.picturesRemoved}), 0)::int`,
    })
    .from(generationRuns)
    .where(gte(generationRuns.createdAt, since))
    .groupBy(seoulDay(generationRuns.createdAt))

  const failures = await db
    .select({ run: generationRuns, teacherName: users.fullName })
    .from(generationRuns)
    .innerJoin(users, eq(users.id, generationRuns.teacherId))
    .where(and(gte(generationRuns.createdAt, since), or(eq(generationRuns.status, 'failed'), and(eq(generationRuns.status, 'running'), lt(generationRuns.createdAt, timedOut)))))
    .orderBy(desc(generationRuns.createdAt))
    .limit(30)

  const errorCodes = await db
    .select({ code: sql<string>`coalesce(${generationRuns.errorCode}, 'timeout')`, n: sql<number>`count(*)::int` })
    .from(generationRuns)
    .where(and(gte(generationRuns.createdAt, since), or(eq(generationRuns.status, 'failed'), and(eq(generationRuns.status, 'running'), lt(generationRuns.createdAt, timedOut)))))
    .groupBy(sql`1`)

  const byDay = new Map(perDay.map((d) => [d.day, d]))
  const rows = lastDays(days).map((day) => {
    const d = byDay.get(day)
    return {
      day,
      total: d?.total ?? 0,
      ok: d?.ok ?? 0,
      failed: d?.failed ?? 0,
      avgMs: d?.avgMs ?? null,
      p90Ms: d?.p90Ms ?? null,
      reviewSkipped: d?.reviewSkipped ?? 0,
      reviewFailed: d?.reviewFailed ?? 0,
      pictures: { pointed: d?.picPointed ?? 0, located: d?.picLocated ?? 0, attached: d?.picAttached ?? 0, removed: d?.picRemoved ?? 0 },
    }
  })
  return {
    days: rows,
    failures: failures.map((f) => ({ ...f.run, status: f.run.status === 'running' ? ('timeout' as const) : f.run.status, teacherName: f.teacherName })),
    errorCodes: errorCodes.sort((a, b) => b.n - a.n),
    ai: await aiCost(db, days),
  }
}

/** AI cost per day and per purpose, plus the teachers whose homework cost most */
export async function aiCost(db: Db, days = 30) {
  const since = new Date(Date.now() - days * DAY)
  const rows = await db
    .select({
      day: seoulDay(aiCalls.createdAt),
      purpose: aiCalls.purpose,
      model: aiCalls.model,
      calls: sql<number>`count(*)::int`,
      failed: sql<number>`count(*) filter (where not ${aiCalls.ok})::int`,
      inputTokens: sql<number>`coalesce(sum(${aiCalls.inputTokens}), 0)::bigint`,
      outputTokens: sql<number>`coalesce(sum(${aiCalls.outputTokens}), 0)::bigint`,
      thoughtsTokens: sql<number>`coalesce(sum(${aiCalls.thoughtsTokens}), 0)::bigint`,
    })
    .from(aiCalls)
    .where(gte(aiCalls.createdAt, since))
    .groupBy(seoulDay(aiCalls.createdAt), aiCalls.purpose, aiCalls.model)
  const n = (v: number | string) => Number(v)
  const priced = rows.map((r) => ({ ...r, usd: costUsd({ model: r.model, inputTokens: n(r.inputTokens), outputTokens: n(r.outputTokens), thoughtsTokens: n(r.thoughtsTokens) }) }))
  const sum = (xs: typeof priced) => xs.reduce((s, x) => s + x.usd, 0)
  const purposes = [...new Set(priced.map((r) => r.purpose))]
  const models = [...new Set(priced.map((r) => r.model))]

  const top = await db
    .select({
      userId: aiCalls.userId,
      name: users.fullName,
      model: aiCalls.model,
      calls: sql<number>`count(*)::int`,
      inputTokens: sql<number>`coalesce(sum(${aiCalls.inputTokens}), 0)::bigint`,
      outputTokens: sql<number>`coalesce(sum(${aiCalls.outputTokens}), 0)::bigint`,
      thoughtsTokens: sql<number>`coalesce(sum(${aiCalls.thoughtsTokens}), 0)::bigint`,
    })
    .from(aiCalls)
    .leftJoin(users, eq(users.id, aiCalls.userId))
    .where(gte(aiCalls.createdAt, since))
    .groupBy(aiCalls.userId, users.fullName, aiCalls.model)
  const perUser = new Map<string, { userId: string; name: string | null; calls: number; usd: number }>()
  for (const t of top) {
    if (!t.userId) continue
    const u = perUser.get(t.userId) ?? { userId: t.userId, name: t.name, calls: 0, usd: 0 }
    u.calls += t.calls
    u.usd += costUsd({ model: t.model, inputTokens: n(t.inputTokens), outputTokens: n(t.outputTokens), thoughtsTokens: n(t.thoughtsTokens) })
    perUser.set(t.userId, u)
  }
  const [gens] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(generationRuns)
    .where(and(gte(generationRuns.createdAt, since), eq(generationRuns.status, 'ok')))

  return {
    totalUsd: sum(priced),
    calls: priced.reduce((s, r) => s + r.calls, 0),
    failedCalls: priced.reduce((s, r) => s + r.failed, 0),
    perHomeworkUsd: gens?.n ? sum(priced.filter((r) => r.purpose === 'generate' || r.purpose === 'refine')) / gens.n : null,
    byDay: lastDays(days).map((day) => ({ day, usd: sum(priced.filter((r) => r.day === day)) })),
    byPurpose: purposes.map((p) => ({ purpose: p, usd: sum(priced.filter((r) => r.purpose === p)), calls: priced.filter((r) => r.purpose === p).reduce((s, r) => s + r.calls, 0) })).sort((a, b) => b.usd - a.usd),
    byModel: models.map((m) => ({ model: m, usd: sum(priced.filter((r) => r.model === m)), calls: priced.filter((r) => r.model === m).reduce((s, r) => s + r.calls, 0) })).sort((a, b) => b.usd - a.usd),
    topUsers: [...perUser.values()].sort((a, b) => b.usd - a.usd).slice(0, 10),
  }
}

// ─── business ───────────────────────────────────────────────────────────────

export async function businessStats(db: Db, days = 30) {
  const now = Date.now()
  const week = new Date(now - 7 * DAY)
  const since = new Date(now - days * DAY)
  const hasRole = (r: string) => sql`(${users.role} = ${r} or ${r} = any(${users.roles}))`
  const [u] = await db
    .select({
      teachers: sql<number>`count(*) filter (where ${hasRole('teacher')})::int`,
      students: sql<number>`count(*) filter (where ${hasRole('student')})::int`,
      newTeachersWeek: sql<number>`count(*) filter (where ${hasRole('teacher')} and ${users.createdAt} >= ${at(week)})::int`,
      newStudentsWeek: sql<number>`count(*) filter (where ${hasRole('student')} and ${users.createdAt} >= ${at(week)})::int`,
      activeTeachersWeek: sql<number>`count(*) filter (where ${hasRole('teacher')} and ${users.lastActiveAt} >= ${at(week)})::int`,
      activeStudentsWeek: sql<number>`count(*) filter (where ${hasRole('student')} and ${users.lastActiveAt} >= ${at(week)})::int`,
      blocked: sql<number>`count(*) filter (where ${users.blockedAt} is not null)::int`,
    })
    .from(users)
    .where(isNull(users.deletedAt))
  const [a] = await db
    .select({
      created: sql<number>`count(*) filter (where ${assignments.createdAt} >= ${at(since)})::int`,
      createdWeek: sql<number>`count(*) filter (where ${assignments.createdAt} >= ${at(week)})::int`,
      published: sql<number>`count(*) filter (where ${assignments.publishedAt} >= ${at(since)})::int`,
      total: sql<number>`count(*)::int`,
    })
    .from(assignments)
    .where(isNull(assignments.deletedAt))
  const [t] = await db
    .select({
      submitted: sql<number>`count(*)::int`,
      submittedWeek: sql<number>`count(*) filter (where ${attempts.submittedAt} >= ${at(week)})::int`,
      avgPercent: sql<number | null>`round(avg(${attempts.percent}))::int`,
    })
    .from(attempts)
    .where(gte(attempts.submittedAt, since))
  const [g] = await db.select({ n: sql<number>`count(*)::int` }).from(groups).where(isNull(groups.archivedAt))
  const daily = async <T extends typeof users.createdAt | typeof assignments.createdAt | typeof attempts.submittedAt>(col: T, table: typeof users | typeof assignments | typeof attempts) => {
    const rows = await db
      .select({ day: seoulDay(col), n: sql<number>`count(*)::int` })
      .from(table)
      .where(gte(col, since))
      .groupBy(seoulDay(col))
    const m = new Map(rows.map((r) => [r.day, r.n]))
    return lastDays(days).map((day) => ({ day, n: m.get(day) ?? 0 }))
  }
  return {
    users: u!,
    homework: a!,
    attempts: t!,
    groups: g?.n ?? 0,
    newUsersByDay: await daily(users.createdAt, users),
    homeworkByDay: await daily(assignments.createdAt, assignments),
    submissionsByDay: await daily(attempts.submittedAt, attempts),
  }
}

export async function moneyStats(db: Db, days = 30) {
  const since = new Date(Date.now() - days * DAY)
  const byProvider = await db
    .select({ provider: payments.provider, n: sql<number>`count(*)::int`, sum: sql<number>`coalesce(sum(${payments.amountKrw}), 0)::bigint` })
    .from(payments)
    .where(and(eq(payments.status, 'paid'), gte(payments.createdAt, since)))
    .groupBy(payments.provider)
  const [subs] = await db
    .select({ active: sql<number>`count(*) filter (where ${subscriptions.status} = 'active')::int`, paidActive: sql<number>`count(*) filter (where ${subscriptions.status} = 'active' and ${subscriptions.priceKrw} > 0)::int` })
    .from(subscriptions)
  const recent = await db
    .select({ p: payments, name: users.fullName })
    .from(payments)
    .leftJoin(subscriptions, eq(subscriptions.id, payments.subscriptionId))
    .leftJoin(planPackages, eq(planPackages.id, payments.packageId))
    // The student who bought, or the teacher who bought a package
    .innerJoin(users, eq(users.id, sql`coalesce(${subscriptions.studentId}, ${planPackages.teacherId})`))
    .orderBy(desc(payments.createdAt))
    .limit(20)
  return {
    revenueKrw: byProvider.reduce((s, r) => s + Number(r.sum), 0),
    byProvider: byProvider.map((r) => ({ ...r, sum: Number(r.sum) })),
    subscriptions: subs!,
    recent: recent.map((r) => ({ id: r.p.id, at: r.p.createdAt, amountKrw: r.p.amountKrw, status: r.p.status, provider: r.p.provider, name: r.name })),
  }
}

/**
 * What each teacher has earned from their students' own plan purchases (paid, real money only), all time and in
 * the current month. Paid out by hand; biggest first.
 */
export async function teacherCommissions(db: Db, now = new Date()) {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const rows = await db
    .select({
      teacherId: payments.commissionTeacherId,
      name: users.fullName,
      total: sql<number>`coalesce(sum(${payments.commissionKrw}), 0)::bigint`,
      month: sql<number>`coalesce(sum(${payments.commissionKrw}) filter (where ${payments.createdAt} >= ${monthStart.toISOString()}::timestamptz), 0)::bigint`,
      n: sql<number>`count(*)::int`,
    })
    .from(payments)
    .innerJoin(users, eq(users.id, payments.commissionTeacherId))
    .where(and(eq(payments.status, 'paid'), ne(payments.provider, 'test'), isNotNull(payments.commissionTeacherId)))
    .groupBy(payments.commissionTeacherId, users.fullName)
    .orderBy(desc(sql`sum(${payments.commissionKrw})`))
    .limit(100)
  return rows.map((r) => ({ teacherId: r.teacherId!, name: r.name, totalKrw: Number(r.total), monthKrw: Number(r.month), payments: r.n }))
}

// ─── users ──────────────────────────────────────────────────────────────────

/** Search by name or by any part of the phone number */
export async function searchUsers(db: Db, q: string, limit = 50) {
  const digits = q.replace(/\D/g, '')
  const name = q.trim()
  const where = !name
    ? isNull(users.deletedAt)
    : and(isNull(users.deletedAt), or(ilike(users.fullName, `%${name.replace(/[%_]/g, '')}%`), digits.length >= 3 ? ilike(users.phone, `%${digits}%`) : sql`false`))
  return db.select().from(users).where(where).orderBy(desc(users.lastActiveAt), desc(users.createdAt)).limit(limit)
}

export async function userDetail(db: Db, id: string) {
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1)
  if (!user) return null
  const [profile] = await db.select().from(teacherProfiles).where(eq(teacherProfiles.userId, id)).limit(1)
  const since = new Date(Date.now() - 30 * DAY)
  const [counts] = await db
    .select({
      homework: sql<number>`(select count(*) from ${assignments} where ${assignments.teacherId} = ${id} and ${assignments.deletedAt} is null)::int`,
      groups: sql<number>`(select count(*) from ${groups} where ${groups.teacherId} = ${id} and ${groups.archivedAt} is null)::int`,
      attempts: sql<number>`(select count(*) from ${attempts} where ${attempts.studentId} = ${id} and ${attempts.submittedAt} is not null)::int`,
      avgPercent: sql<number | null>`(select round(avg(${attempts.percent}))::int from ${attempts} where ${attempts.studentId} = ${id} and ${attempts.submittedAt} is not null)`,
    })
    .from(sql`(select 1) as one`)
  const [students] = await db
    .select({ n: sql<number>`count(distinct ${enrollments.studentId})::int` })
    .from(enrollments)
    .innerJoin(groups, eq(groups.id, enrollments.groupId))
    .where(and(eq(groups.teacherId, id), eq(enrollments.status, 'active')))
  const runs = await db.select().from(generationRuns).where(eq(generationRuns.teacherId, id)).orderBy(desc(generationRuns.createdAt)).limit(15)
  const calls = await db
    .select({
      model: aiCalls.model,
      calls: sql<number>`count(*)::int`,
      inputTokens: sql<number>`coalesce(sum(${aiCalls.inputTokens}), 0)::bigint`,
      outputTokens: sql<number>`coalesce(sum(${aiCalls.outputTokens}), 0)::bigint`,
      thoughtsTokens: sql<number>`coalesce(sum(${aiCalls.thoughtsTokens}), 0)::bigint`,
    })
    .from(aiCalls)
    .where(and(eq(aiCalls.userId, id), gte(aiCalls.createdAt, since)))
    .groupBy(aiCalls.model)
  const aiUsd30 = calls.reduce((s, c) => s + costUsd({ model: c.model, inputTokens: Number(c.inputTokens), outputTokens: Number(c.outputTokens), thoughtsTokens: Number(c.thoughtsTokens) }), 0)
  const dayAgo = new Date(Date.now() - DAY)
  const capSince = profile?.capResetAt && profile.capResetAt > dayAgo ? profile.capResetAt : dayAgo
  const [today] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(assignments)
    .where(and(eq(assignments.teacherId, id), gte(assignments.createdAt, capSince)))
  const subs = await db.select().from(subscriptions).where(eq(subscriptions.studentId, id)).orderBy(desc(subscriptions.createdAt)).limit(20)
  return { user, profile: profile ?? null, counts: { ...counts!, students: students?.n ?? 0 }, runs, aiUsd30, aiCalls30: calls.reduce((s, c) => s + c.calls, 0), generationsToday: today?.n ?? 0, subscriptions: subs }
}

// ─── content ────────────────────────────────────────────────────────────────

export async function recentHomework(db: Db, opts: { q?: string; limit?: number } = {}) {
  const q = opts.q?.trim().replace(/[%_]/g, '')
  return db
    .select({ a: assignments, teacherName: users.fullName, items: sql<number>`(select count(*) from ${exercises} where ${exercises.assignmentId} = ${assignments.id})::int` })
    .from(assignments)
    .innerJoin(users, eq(users.id, assignments.teacherId))
    .where(and(isNull(assignments.deletedAt), q ? or(ilike(assignments.title, `%${q}%`), ilike(users.fullName, `%${q}%`)) : undefined))
    .orderBy(desc(assignments.createdAt))
    .limit(opts.limit ?? 50)
}

/** The admin homework page first lists the teachers who made homework, the most recently active first */
export async function homeworkTeachers(db: Db, limit = 300) {
  const rows = await db
    .select({
      id: users.id,
      name: users.fullName,
      total: sql<number>`count(*)::int`,
      published: sql<number>`count(*) filter (where ${assignments.status} <> 'draft')::int`,
      last: sql<Date>`max(${assignments.createdAt})`.mapWith((v) => new Date(v)),
    })
    .from(assignments)
    .innerJoin(users, eq(users.id, assignments.teacherId))
    .where(isNull(assignments.deletedAt))
    .groupBy(users.id)
    .orderBy(desc(sql`max(${assignments.createdAt})`))
    .limit(limit)
  return rows
}

/** One teacher's homework, group by group (drafts and homework without a group last) */
export async function teacherHomework(db: Db, teacherId: string) {
  const [teacher] = await db.select({ id: users.id, name: users.fullName }).from(users).where(eq(users.id, teacherId)).limit(1)
  if (!teacher) return null
  const rows = await db
    .select({
      a: assignments,
      groupName: groups.name,
      items: sql<number>`(select count(*) from ${exercises} where ${exercises.assignmentId} = ${assignments.id})::int`,
      submitted: sql<number>`(select count(*) from ${attempts} where ${attempts.assignmentId} = ${assignments.id} and ${attempts.submittedAt} is not null)::int`,
    })
    .from(assignments)
    .leftJoin(groups, eq(groups.id, assignments.groupId))
    .where(and(eq(assignments.teacherId, teacherId), isNull(assignments.deletedAt)))
    .orderBy(desc(assignments.createdAt))
  const byGroup = new Map<string, { id: string | null; name: string | null; rows: typeof rows; last: number }>()
  for (const r of rows) {
    const key = r.a.groupId ?? ''
    const g = byGroup.get(key) ?? { id: r.a.groupId, name: r.groupName, rows: [], last: 0 }
    g.rows.push(r)
    g.last = Math.max(g.last, r.a.createdAt.getTime())
    byGroup.set(key, g)
  }
  // Groups with the newest homework first; homework without a group (drafts) at the end
  const sections = [...byGroup.values()].sort((p, q) => (p.id ? 0 : 1) - (q.id ? 0 : 1) || q.last - p.last)
  return { teacher, total: rows.length, sections }
}

/** Admin → Kurslar: courses meant for others, waiting for approval first, then returned, then published */
export async function reviewCourses(db: Db) {
  const rows = await db
    .select({ c: courses, teacherName: users.fullName })
    .from(courses)
    .innerJoin(users, eq(users.id, courses.teacherId))
    .where(and(isNull(courses.deletedAt), or(ne(courses.visibility, 'private'), ne(courses.reviewStatus, 'draft'))))
    .orderBy(desc(courses.submittedAt), desc(courses.updatedAt))
    .limit(300)
  const order = { pending: 0, returned: 1, approved: 2, draft: 3 } as const
  return rows.sort((p, q) => order[p.c.reviewStatus] - order[q.c.reviewStatus])
}

/** One course as the admin checks it: details, lessons with their video and homework, and sales */
export async function reviewCourseDetail(db: Db, id: string) {
  const [row] = await db.select({ c: courses, teacherName: users.fullName }).from(courses).innerJoin(users, eq(users.id, courses.teacherId)).where(eq(courses.id, id)).limit(1)
  if (!row) return null
  const lessons = await db
    .select({ l: courseLessons, homework: assignments.title, items: sql<number>`(select count(*) from ${exercises} where ${exercises.assignmentId} = ${courseLessons.assignmentTemplateId})::int` })
    .from(courseLessons)
    .leftJoin(assignments, eq(assignments.id, courseLessons.assignmentTemplateId))
    .where(eq(courseLessons.courseId, id))
    .orderBy(courseLessons.orderIndex)
  const [sales] = await db
    .select({ n: sql<number>`count(*)::int`, sum: sql<number>`coalesce(sum(${payments.amountKrw}), 0)::bigint` })
    .from(payments)
    .innerJoin(subscriptions, eq(subscriptions.id, payments.subscriptionId))
    .where(and(eq(subscriptions.courseId, id), eq(payments.status, 'paid'), ne(payments.provider, 'test')))
  return { ...row, lessons, sales: { n: sales?.n ?? 0, sumKrw: Number(sales?.sum ?? 0) } }
}

export async function homeworkDetail(db: Db, id: string) {
  const [row] = await db
    .select({ a: assignments, teacherName: users.fullName })
    .from(assignments)
    .innerJoin(users, eq(users.id, assignments.teacherId))
    .where(eq(assignments.id, id))
    .limit(1)
  if (!row) return null
  const items = await db.select().from(exercises).where(eq(exercises.assignmentId, id)).orderBy(exercises.orderIndex)
  const results = await db
    .select({ at: attempts, name: users.fullName })
    .from(attempts)
    .innerJoin(users, eq(users.id, attempts.studentId))
    .where(and(eq(attempts.assignmentId, id), isNotNull(attempts.submittedAt)))
    .orderBy(desc(attempts.submittedAt))
  const runs = await db.select().from(generationRuns).where(eq(generationRuns.assignmentId, id)).orderBy(desc(generationRuns.createdAt))
  return { ...row, items, results, runs }
}

// ─── staff & audit ──────────────────────────────────────────────────────────

export async function staffOverview(db: Db) {
  const roles = await db.select().from(staffRoles).orderBy(staffRoles.name)
  const members = await db
    .select({ m: staffMembers, roleName: staffRoles.name, user: { id: users.id, fullName: users.fullName } })
    .from(staffMembers)
    .innerJoin(staffRoles, eq(staffRoles.id, staffMembers.roleId))
    .leftJoin(users, eq(users.phone, staffMembers.phone))
    .where(isNull(staffMembers.revokedAt))
    .orderBy(desc(staffMembers.createdAt))
  return { roles, members }
}

export async function auditLog(db: Db, limit = 200) {
  const rows = await db
    .select({ e: adminAudit, actorName: users.fullName })
    .from(adminAudit)
    .innerJoin(users, eq(users.id, adminAudit.actorId))
    .orderBy(desc(adminAudit.createdAt))
    .limit(limit)
  // Names for user targets, so the log reads "blocked Aziz" rather than an id
  const ids = [...new Set(rows.filter((r) => r.e.targetType === 'user' && r.e.targetId).map((r) => r.e.targetId!))]
  const names = ids.length ? await db.select({ id: users.id, fullName: users.fullName }).from(users).where(inArray(users.id, ids)) : []
  const byId = new Map(names.map((n) => [n.id, n.fullName]))
  return rows.map((r) => ({ ...r.e, actorName: r.actorName, targetName: r.e.targetId ? (byId.get(r.e.targetId) ?? null) : null }))
}
