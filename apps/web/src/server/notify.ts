/**
 * Notifications in the iOS app (push.ts). Students hear about new homework and, the evening before, about homework due
 * soon that they haven't handed in; a teacher can remind the ones who haven't done it; the owner hears when something
 * breaks. Only people with the iOS app and notifications on are reached, and each student's switches in Profile →
 * Notifications are kept. Every message goes out once: its key is claimed in notification_log first.
 */
import { and, assignments, attempts, count, enrollments, eq, gt, inArray, isNull, lte, ne, notificationLog, pushDevices, sql, users, type Db } from '@ikhimi/db'
import { getTranslator, isLocale, type Locale } from '@ikhimi/i18n'
import { ownerEmails } from './admin/staff'
import { studentDue } from './deadline'
import { pushSender, pushUserIds, type PushMessage, type Pusher } from './push'

type Assignment = typeof assignments.$inferSelect
export type NotifyDeps = { push?: Pusher | null }

/** The iOS app's notifications (push.ts), or null when the Apple key isn't set: nothing is sent then */
const pushOf = (deps: NotifyDeps) => (deps.push === undefined ? pushSender() : deps.push)

/** Who of these people has the iOS app with notifications on */
async function reach(db: Db, list: { id: string }[], push: Pusher | null) {
  const app = push ? await pushUserIds(db, list.map((m) => m.id)) : new Set<string>()
  return (m: { id: string }) => app.has(m.id)
}

/** The count is the notifications delivered; a failure is only logged */
async function deliver(db: Db, push: Pusher | null, pushes: PushMessage[]) {
  if (!push || !pushes.length) return 0
  return push.send(db, pushes).catch((e) => (console.warn('[push] failed', String(e).slice(0, 200)), 0))
}

/** True the first time a key is claimed, false ever after: a message is sent at most once */
export async function claim(db: Db, key: string): Promise<boolean> {
  const rows = await db.insert(notificationLog).values({ key }).onConflictDoNothing().returning({ key: notificationLog.key })
  return rows.length > 0
}

// ─── students ───────────────────────────────────────────────────────────────

type Member = { id: string; locale: Locale; notifications: Record<string, boolean>; joinedAt: Date }

/** A group's active students (not deleted or blocked), with or without the app */
async function members(db: Db, groupId: string): Promise<Member[]> {
  const rows = await db
    .select({ id: users.id, locale: users.uiLocale, prefs: users.prefs, joinedAt: enrollments.joinedAt })
    .from(enrollments)
    .innerJoin(users, eq(users.id, enrollments.studentId))
    .where(and(eq(enrollments.groupId, groupId), eq(enrollments.status, 'active'), isNull(users.deletedAt), isNull(users.blockedAt)))
  return rows.map((r) => ({ id: r.id, locale: isLocale(r.locale) ? r.locale : 'ko', notifications: r.prefs?.notifications ?? {}, joinedAt: r.joinedAt }))
}

/** Students who have handed this homework in */
async function handedIn(db: Db, assignmentId: string): Promise<Set<string>> {
  const rows = await db
    .select({ id: attempts.studentId })
    .from(attempts)
    .where(and(eq(attempts.assignmentId, assignmentId), ne(attempts.status, 'in_progress')))
  return new Set(rows.map((r) => r.id))
}

async function teacherName(db: Db, teacherId: string) {
  const [u] = await db.select({ name: users.fullName }).from(users).where(eq(users.id, teacherId)).limit(1)
  return u?.name?.trim() || "익히미"
}

const SEOUL = 'Asia/Seoul'
/** "10월 9일 18:00" in Seoul time */
export function whenText(d: Date) {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: SEOUL, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d)
  const get = (k: string) => p.find((x) => x.type === k)?.value ?? ''
  return `${Number(get('month'))}월 ${Number(get('day'))}일 ${get('hour')}:${get('minute')}`
}
/** Seoul calendar day, for "once a day" keys */
const seoulDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: SEOUL }).format(d)

/** A homework was published (or copied) into a group: tell its students who have the app */
export async function notifyNewHomework(db: Db, a: Assignment, deps: NotifyDeps = {}) {
  const push = pushOf(deps)
  if (!push || !a.groupId || a.status !== 'published') return { sent: 0 }
  const [list, teacher] = await Promise.all([members(db, a.groupId), teacherName(db, a.teacherId)])
  const hasApp = await reach(db, list, push)
  const pushes: PushMessage[] = []
  for (const m of list) {
    if (!hasApp(m) || m.notifications.newAssignment === false) continue
    if (!(await claim(db, `new:${a.id}:${m.id}`))) continue
    const t = getTranslator(m.locale)
    const due = studentDue(a, m.joinedAt)
    const body = [t('notify.new', { title: a.title, teacher }), due ? t('notify.dueLine', { when: whenText(due) }) : ''].filter(Boolean).join('\n')
    pushes.push({ userId: m.id, body, url: `/t/${a.shareSlug}` })
  }
  return { sent: await deliver(db, push, pushes) }
}

/**
 * The daily job (evening, Seoul): homework due within the next 30 hours that a student hasn't handed in gets one
 * reminder. Each student's deadline is their own (the duration from when the homework reached them), so this looks
 * at students, not at homework. Capped per run so a big day never floods Apple's service.
 */
export async function remindDueSoon(db: Db, now = new Date(), deps: NotifyDeps & { max?: number } = {}) {
  const push = pushOf(deps)
  if (!push) return { sent: 0 }
  const horizon = new Date(now.getTime() + 30 * 3600_000)
  // A rough cut in SQL (the deadline is the end of the day `due_days` after the start), then exactly in code
  const end = sql`greatest(${assignments.publishedAt}, ${enrollments.joinedAt}) + ${assignments.dueDays} * interval '1 day'`
  const rows = await db
    .select({ a: assignments, studentId: enrollments.studentId })
    .from(assignments)
    .innerJoin(enrollments, and(eq(enrollments.groupId, assignments.groupId), eq(enrollments.status, 'active')))
    .where(
      and(
        eq(assignments.status, 'published'),
        isNull(assignments.deletedAt),
        sql`${assignments.dueDays} is not null`,
        sql`${end} > ${new Date(now.getTime() - 86400_000).toISOString()}::timestamptz`,
        sql`${end} <= ${horizon.toISOString()}::timestamptz`,
      ),
    )
  const soon = new Map<string, { a: Assignment; students: Set<string> }>()
  for (const r of rows) {
    const x = soon.get(r.a.id) ?? { a: r.a, students: new Set<string>() }
    x.students.add(r.studentId)
    soon.set(r.a.id, x)
  }
  const max = deps.max ?? 2000
  const pushes: PushMessage[] = []
  for (const { a, students } of soon.values()) {
    if (!a.groupId) continue
    const [all, done, teacher] = await Promise.all([members(db, a.groupId), handedIn(db, a.id), teacherName(db, a.teacherId)])
    const list = all.filter((m) => students.has(m.id))
    const hasApp = await reach(db, list, push)
    for (const m of list) {
      if (pushes.length >= max) break
      const due = studentDue(a, m.joinedAt)
      if (!due || due <= now || due > horizon) continue
      if (!hasApp(m) || done.has(m.id) || m.notifications.dueSoon === false) continue
      if (!(await claim(db, `due:${a.id}:${m.id}`))) continue
      const body = getTranslator(m.locale)('notify.dueSoon', { title: a.title, teacher, when: whenText(due) })
      pushes.push({ userId: m.id, body, url: `/t/${a.shareSlug}` })
    }
  }
  return { sent: await deliver(db, push, pushes) }
}

/**
 * The teacher's "remind them" button on the report: every student of the group who hasn't handed it in, once a day
 * each. Returns who was reached and who can't be (no iOS app with notifications, or reminders turned off).
 */
export async function remindNotDone(db: Db, a: Assignment, now = new Date(), deps: NotifyDeps = {}) {
  if (!a.groupId || a.status !== 'published') return { sent: 0, already: 0, unreachable: 0, pending: 0 }
  const [list, done, teacher] = await Promise.all([members(db, a.groupId), handedIn(db, a.id), teacherName(db, a.teacherId)])
  const pending = list.filter((m) => !done.has(m.id))
  const push = pushOf(deps)
  if (!push) return { sent: 0, already: 0, unreachable: pending.length, pending: pending.length }
  const hasApp = await reach(db, pending, push)
  const reachable = pending.filter((m) => hasApp(m) && m.notifications.dueSoon !== false)
  const pushes: PushMessage[] = []
  let already = 0
  for (const m of reachable) {
    if (!(await claim(db, `nudge:${a.id}:${m.id}:${seoulDay(now)}`))) {
      already++
      continue
    }
    const t = getTranslator(m.locale)
    const due = studentDue(a, m.joinedAt)
    const body = [t('notify.nudge', { title: a.title, teacher }), due ? t('notify.dueLine', { when: whenText(due) }) : ''].filter(Boolean).join('\n')
    pushes.push({ userId: m.id, body, url: `/t/${a.shareSlug}` })
  }
  return { sent: await deliver(db, push, pushes), already, unreachable: pending.length - reachable.length, pending: pending.length }
}

/** The teacher finished grading what was waiting (an essay): the student hears their result */
export async function notifyGraded(db: Db, attemptId: string, deps: NotifyDeps = {}) {
  const push = pushOf(deps)
  if (!push) return
  const [row] = await db
    .select({ attempt: attempts, title: assignments.title, slug: assignments.shareSlug, studentId: attempts.studentId, locale: users.uiLocale, prefs: users.prefs })
    .from(attempts)
    .innerJoin(assignments, eq(assignments.id, attempts.assignmentId))
    .innerJoin(users, eq(users.id, attempts.studentId))
    .where(eq(attempts.id, attemptId))
    .limit(1)
  if (!row || row.attempt.status !== 'graded' || row.prefs?.notifications?.graded === false) return
  if (!(await pushUserIds(db, [row.studentId])).has(row.studentId)) return
  if (!(await claim(db, `graded:${attemptId}`))) return
  const locale = isLocale(row.locale) ? row.locale : 'ko'
  const body = getTranslator(locale)('notify.graded', { title: row.title, percent: Math.round(row.attempt.percent ?? 0) })
  await deliver(db, push, [{ userId: row.studentId, body, url: `/t/${row.slug}/result` }])
}

// ─── teachers ───────────────────────────────────────────────────────────────

/** A homework the teacher stopped watching (locked the phone, left the app) is ready: they hear it once, in the iOS app */
export async function notifyDraftReady(db: Db, input: { teacherId: string; runId: string; assignmentId: string; title: string }, deps: NotifyDeps = {}) {
  const push = pushOf(deps)
  if (!push) return { sent: 0 }
  const [teacher] = await db.select({ locale: users.uiLocale }).from(users).where(eq(users.id, input.teacherId)).limit(1)
  if (!teacher || !(await pushUserIds(db, [input.teacherId])).has(input.teacherId)) return { sent: 0 }
  if (!(await claim(db, `ready:${input.runId}`))) return { sent: 0 }
  const body = getTranslator(isLocale(teacher.locale) ? teacher.locale : 'ko')('notify.draftReady', { title: input.title })
  return { sent: await deliver(db, push, [{ userId: input.teacherId, body, url: `/app/a/${input.assignmentId}` }]) }
}

/** The admin approved or returned a teacher's course (DECISIONS.md BL): the teacher hears it, with the note */
export async function notifyCourseReview(
  db: Db,
  input: { teacherId: string; courseId: string; title: string; decision: 'approve' | 'return'; note: string | null },
  deps: NotifyDeps & { now?: Date } = {},
) {
  const push = pushOf(deps)
  if (!push) return { sent: 0 }
  const [teacher] = await db.select({ locale: users.uiLocale }).from(users).where(eq(users.id, input.teacherId)).limit(1)
  if (!teacher || !(await pushUserIds(db, [input.teacherId])).has(input.teacherId)) return { sent: 0 }
  const t = getTranslator(isLocale(teacher.locale) ? teacher.locale : 'ko')
  const body =
    input.decision === 'approve'
      ? t('notify.courseApproved', { title: input.title })
      : input.note
        ? t('notify.courseReturnedNote', { title: input.title, note: input.note })
        : t('notify.courseReturned', { title: input.title })
  return { sent: await deliver(db, push, [{ userId: input.teacherId, body, url: `/app/courses/${input.courseId}` }]) }
}

// ─── the owner ──────────────────────────────────────────────────────────────

/** The owners' accounts (OWNER_EMAILS) that have the iOS app with notifications on */
async function ownerDevices(db: Db): Promise<string[]> {
  const emails = ownerEmails()
  if (!emails.length) return []
  const rows = await db
    .selectDistinct({ id: users.id })
    .from(users)
    .innerJoin(pushDevices, eq(pushDevices.userId, users.id))
    .where(and(inArray(users.email, emails), isNull(users.deletedAt)))
  return rows.map((r) => r.id)
}

/** Tell the owners in the iOS app; the text is always in the server log too (Vercel → Logs) */
async function toOwners(db: Db, text: string, url: string, deps: NotifyDeps) {
  console.warn(`[owner] ${text}`)
  const push = pushOf(deps)
  const owners = push ? await ownerDevices(db) : []
  if (!push || !owners.length) return false
  return (await deliver(db, push, owners.map((userId) => ({ userId, body: text.slice(0, 1000), url })))) > 0
}

/** Something for the owner to do (not a breakage): once per key */
export async function tellOwner(db: Db, key: string, text: string, deps: NotifyDeps & { url?: string } = {}) {
  try {
    if (!(await claim(db, `owner:${key.slice(0, 200)}`))) return false
    return await toOwners(db, text, deps.url ?? '/admin', deps)
  } catch (e) {
    console.warn('[owner] could not tell the owner', e)
    return false
  }
}

/**
 * Something broke: tell the owner. At most one message per topic an hour, so a crash loop is one message, not
 * hundreds. Never throws: an alert must not break the request that reported it.
 */
export async function alertOwner(db: Db, topic: string, text: string, deps: NotifyDeps & { now?: Date } = {}) {
  try {
    const hour = (deps.now ?? new Date()).toISOString().slice(0, 13)
    if (!(await claim(db, `alert:${topic.slice(0, 200)}:${hour}`))) return false
    return await toOwners(db, `⚠️ 익히미: ${text}`.slice(0, 3500), '/admin/health', deps)
  } catch (e) {
    console.warn('[alert] could not alert the owner', e)
    return false
  }
}

/** Old message keys are only needed to stop repeats: keep 60 days */
export async function pruneNotificationLog(db: Db, now = new Date()) {
  await db.delete(notificationLog).where(lte(notificationLog.createdAt, new Date(now.getTime() - 60 * 86400_000)))
}

/** Admin → Health: how many students notifications reach, and what was sent in the last 7 days */
export async function notificationStats(db: Db, now = new Date()) {
  const [reach] = await db
    .select({ students: count(), withApp: sql<number>`count(*) filter (where exists (select 1 from ${pushDevices} where ${pushDevices.userId} = ${users.id}))`.mapWith(Number) })
    .from(users)
    .where(and(sql`'student' = any(${users.roles})`, isNull(users.deletedAt)))
  const sent = await db
    .select({ kind: sql<string>`split_part(${notificationLog.key}, ':', 1)`, n: count() })
    .from(notificationLog)
    .where(gt(notificationLog.createdAt, new Date(now.getTime() - 7 * 86400_000)))
    .groupBy(sql`1`)
  const by = Object.fromEntries(sent.map((s) => [s.kind, s.n]))
  return {
    students: reach?.students ?? 0,
    withApp: reach?.withApp ?? 0,
    sent: { new: by.new ?? 0, due: by.due ?? 0, nudge: by.nudge ?? 0, graded: by.graded ?? 0, alert: by.alert ?? 0 },
    push: !!pushSender(),
    cron: !!process.env.CRON_SECRET,
    owners: ownerEmails().length > 0 && (await ownerDevices(db)).length > 0,
  }
}
