/**
 * Telegram messages through the 익히미 bot (free). Students hear about new homework and, the evening before, about
 * homework due soon that they haven't handed in; a teacher can remind the ones who haven't done it; the owner hears
 * when something breaks. Only accounts whose Telegram is linked (they signed in with it), and each student's switches
 * in Profile → Notifications are kept. Students with the iOS app get the same as a notification there (push.ts).
 * Every message goes out once: its key is claimed in notification_log first.
 *
 * No website link is sent until the owner turns links on (Admin → Health → Telegram): until then a message says where
 * to find the homework in 익히미.
 */
import {
  and,
  appSettings,
  assignments,
  attempts,
  count,
  enrollments,
  eq,
  gt,
  inArray,
  isNull,
  lte,
  ne,
  notificationLog,
  sql,
  users,
  type Db,
} from '@ikhimi/db'
import { getTranslator, isLocale, type Locale } from '@ikhimi/i18n'
import { ownerPhones } from './admin/staff'
import { studentDue } from './deadline'
import { pushSender, pushUserIds, type PushMessage, type Pusher } from './push'
import { TelegramBotApi, type BotApi, type ReplyMarkup } from './telegram/api'

type Assignment = typeof assignments.$inferSelect
type Bot = Pick<BotApi, 'sendMessage'>
export type NotifyDeps = { bot?: Bot | null; push?: Pusher | null }

/** The bot, or null when TELEGRAM_BOT_TOKEN isn't set (local dev): nothing is sent then */
export function notifyBot(): Bot | null {
  const token = process.env.TELEGRAM_BOT_TOKEN
  return token ? new TelegramBotApi(token) : null
}
const botOf = (deps: NotifyDeps) => (deps.bot === undefined ? notifyBot() : deps.bot)
/** The iOS app's notifications (push.ts), or null when the Apple key isn't set */
const pushOf = (deps: NotifyDeps) => (deps.push === undefined ? pushSender() : deps.push)

/** Who of these students can be reached: Telegram linked (and a bot), or the iOS app with notifications on */
async function reach(db: Db, list: Member[], bot: Bot | null, push: Pusher | null) {
  const app = push ? await pushUserIds(db, list.map((m) => m.id)) : new Set<string>()
  return (m: Member) => ({ chat: bot && m.chatId ? m.chatId : null, app: app.has(m.id) })
}

/** Telegram messages and app notifications together; the count is the messages delivered */
async function deliver(db: Db, bot: Bot | null, push: Pusher | null, jobs: { chatId: string; text: string; markup?: ReplyMarkup }[], pushes: PushMessage[]) {
  const [viaTelegram, viaApp] = await Promise.all([
    bot && jobs.length ? sendAll(bot, jobs) : 0,
    push && pushes.length ? push.send(db, pushes).catch((e) => (console.warn('[push] failed', String(e).slice(0, 200)), 0)) : 0,
  ])
  return viaTelegram + viaApp
}

/** True the first time a key is claimed, false ever after: a message is sent at most once */
export async function claim(db: Db, key: string): Promise<boolean> {
  const rows = await db.insert(notificationLog).values({ key }).onConflictDoNothing().returning({ key: notificationLog.key })
  return rows.length > 0
}

// ─── settings ───────────────────────────────────────────────────────────────

const SETTINGS_KEY = 'telegram'
export type TelegramSettings = { links: boolean }

export async function getTelegramSettings(db: Db): Promise<TelegramSettings> {
  const [row] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, SETTINGS_KEY))
    .limit(1)
    .catch(() => [])
  return { links: row?.value?.links === true }
}

export async function saveTelegramSettings(db: Db, value: TelegramSettings, actorId: string) {
  await db
    .insert(appSettings)
    .values({ key: SETTINGS_KEY, value, updatedBy: actorId, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedBy: actorId, updatedAt: new Date() } })
}

// ─── students ───────────────────────────────────────────────────────────────

type Member = { id: string; chatId: string | null; locale: Locale; notifications: Record<string, boolean>; joinedAt: Date }

/** A group's active students (not deleted or blocked), with or without Telegram */
async function members(db: Db, groupId: string): Promise<Member[]> {
  const rows = await db
    .select({ id: users.id, chatId: users.telegramChatId, locale: users.uiLocale, prefs: users.prefs, joinedAt: enrollments.joinedAt })
    .from(enrollments)
    .innerJoin(users, eq(users.id, enrollments.studentId))
    .where(and(eq(enrollments.groupId, groupId), eq(enrollments.status, 'active'), isNull(users.deletedAt), isNull(users.blockedAt)))
  return rows.map((r) => ({ id: r.id, chatId: r.chatId, locale: isLocale(r.locale) ? r.locale : 'ko', notifications: r.prefs?.notifications ?? {}, joinedAt: r.joinedAt }))
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

/** The homework message: its text, and a button to open it once links are on (else where to find it) */
function homeworkMessage(locale: Locale, body: string, slug: string, links: boolean): { text: string; markup?: ReplyMarkup } {
  const t = getTranslator(locale)
  if (!links) return { text: `${body}\n\n${t('tg.notify.where')}` }
  const origin = (process.env.PUBLIC_ORIGIN ?? 'https://ikhimi.kr').replace(/\/$/, '')
  return { text: body, markup: { inline_keyboard: [[{ text: t('tg.notify.open'), url: `${origin}/t/${slug}` }]] } }
}

/** Send to many chats, a few at a time (Telegram allows about 30 messages a second); failures are only counted */
async function sendAll(bot: Bot, jobs: { chatId: string; text: string; markup?: ReplyMarkup }[]) {
  let sent = 0
  for (let i = 0; i < jobs.length; i += 10) {
    const batch = jobs.slice(i, i + 10)
    const ok = await Promise.all(
      batch.map((j) =>
        bot.sendMessage(j.chatId, j.text, j.markup).then(
          () => true,
          (e) => {
            // A student who blocked the bot, or a chat that's gone: nothing to do
            console.warn('[notify] not delivered', String(e).slice(0, 200))
            return false
          },
        ),
      ),
    )
    sent += ok.filter(Boolean).length
  }
  return sent
}

/** A homework was published (or copied) into a group: tell its students who have Telegram */
export async function notifyNewHomework(db: Db, a: Assignment, deps: NotifyDeps = {}) {
  const bot = botOf(deps)
  const push = pushOf(deps)
  if ((!bot && !push) || !a.groupId || a.status !== 'published') return { sent: 0 }
  const [list, teacher, { links }] = await Promise.all([members(db, a.groupId), teacherName(db, a.teacherId), getTelegramSettings(db)])
  const via = await reach(db, list, bot, push)
  const jobs = []
  const pushes: PushMessage[] = []
  for (const m of list) {
    const { chat, app } = via(m)
    if ((!chat && !app) || m.notifications.newAssignment === false) continue
    if (!(await claim(db, `new:${a.id}:${m.id}`))) continue
    const t = getTranslator(m.locale)
    const due = studentDue(a, m.joinedAt)
    const body = [t('tg.notify.new', { title: a.title, teacher }), due ? t('tg.notify.dueLine', { when: whenText(due) }) : ''].filter(Boolean).join('\n')
    if (chat) jobs.push({ chatId: chat, ...homeworkMessage(m.locale, body, a.shareSlug, links) })
    if (app) pushes.push({ userId: m.id, body, url: `/t/${a.shareSlug}` })
  }
  return { sent: await deliver(db, bot, push, jobs, pushes) }
}

/**
 * The daily job (evening, Seoul): homework due within the next 30 hours that a student hasn't handed in gets one
 * reminder. Each student's deadline is their own (the duration from when the homework reached them), so this looks
 * at students, not at homework. Capped per run so a big day never floods the bot.
 */
export async function remindDueSoon(db: Db, now = new Date(), deps: NotifyDeps & { max?: number } = {}) {
  const bot = botOf(deps)
  const push = pushOf(deps)
  if (!bot && !push) return { sent: 0 }
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
  const { links } = await getTelegramSettings(db)
  const max = deps.max ?? 2000
  const jobs = []
  const pushes: PushMessage[] = []
  for (const { a, students } of soon.values()) {
    if (!a.groupId) continue
    const [all, done, teacher] = await Promise.all([members(db, a.groupId), handedIn(db, a.id), teacherName(db, a.teacherId)])
    const list = all.filter((m) => students.has(m.id))
    const via = await reach(db, list, bot, push)
    for (const m of list) {
      if (jobs.length + pushes.length >= max) break
      const { chat, app } = via(m)
      const due = studentDue(a, m.joinedAt)
      if (!due || due <= now || due > horizon) continue
      if ((!chat && !app) || done.has(m.id) || m.notifications.dueSoon === false) continue
      if (!(await claim(db, `due:${a.id}:${m.id}`))) continue
      const body = getTranslator(m.locale)('tg.notify.dueSoon', { title: a.title, teacher, when: whenText(due) })
      if (chat) jobs.push({ chatId: chat, ...homeworkMessage(m.locale, body, a.shareSlug, links) })
      if (app) pushes.push({ userId: m.id, body, url: `/t/${a.shareSlug}` })
    }
  }
  return { sent: await deliver(db, bot, push, jobs, pushes) }
}

/**
 * The teacher's "remind them" button on the report: every student of the group who hasn't handed it in, once a day
 * each. Returns who was reached and who can't be (no Telegram linked, or reminders turned off).
 */
export async function remindNotDone(db: Db, a: Assignment, now = new Date(), deps: NotifyDeps = {}) {
  if (!a.groupId || a.status !== 'published') return { sent: 0, already: 0, unreachable: 0, pending: 0 }
  const [list, done, teacher, { links }] = await Promise.all([members(db, a.groupId), handedIn(db, a.id), teacherName(db, a.teacherId), getTelegramSettings(db)])
  const pending = list.filter((m) => !done.has(m.id))
  const bot = botOf(deps)
  const push = pushOf(deps)
  if (!bot && !push) return { sent: 0, already: 0, unreachable: pending.length, pending: pending.length }
  const via = await reach(db, pending, bot, push)
  const reachable = pending.filter((m) => (via(m).chat || via(m).app) && m.notifications.dueSoon !== false)
  const jobs = []
  const pushes: PushMessage[] = []
  let already = 0
  for (const m of reachable) {
    if (!(await claim(db, `nudge:${a.id}:${m.id}:${seoulDay(now)}`))) {
      already++
      continue
    }
    const t = getTranslator(m.locale)
    const due = studentDue(a, m.joinedAt)
    const body = [t('tg.notify.nudge', { title: a.title, teacher }), due ? t('tg.notify.dueLine', { when: whenText(due) }) : ''].filter(Boolean).join('\n')
    const { chat, app } = via(m)
    if (chat) jobs.push({ chatId: chat, ...homeworkMessage(m.locale, body, a.shareSlug, links) })
    if (app) pushes.push({ userId: m.id, body, url: `/t/${a.shareSlug}` })
  }
  return { sent: await deliver(db, bot, push, jobs, pushes), already, unreachable: pending.length - reachable.length, pending: pending.length }
}

/** The teacher finished grading what was waiting (an essay): the student hears their result */
export async function notifyGraded(db: Db, attemptId: string, deps: NotifyDeps = {}) {
  const bot = botOf(deps)
  const push = pushOf(deps)
  if (!bot && !push) return
  const [row] = await db
    .select({ attempt: attempts, title: assignments.title, slug: assignments.shareSlug, studentId: attempts.studentId, chatId: users.telegramChatId, locale: users.uiLocale, prefs: users.prefs })
    .from(attempts)
    .innerJoin(assignments, eq(assignments.id, attempts.assignmentId))
    .innerJoin(users, eq(users.id, attempts.studentId))
    .where(eq(attempts.id, attemptId))
    .limit(1)
  if (!row || row.attempt.status !== 'graded' || row.prefs?.notifications?.graded === false) return
  const chat = bot && row.chatId ? row.chatId : null
  const app = push ? (await pushUserIds(db, [row.studentId])).has(row.studentId) : false
  if (!chat && !app) return
  if (!(await claim(db, `graded:${attemptId}`))) return
  const locale = isLocale(row.locale) ? row.locale : 'ko'
  const body = getTranslator(locale)('tg.notify.graded', { title: row.title, percent: Math.round(row.attempt.percent ?? 0) })
  const { links } = await getTelegramSettings(db)
  const m = homeworkMessage(locale, body, row.slug, links)
  await deliver(db, bot, push, chat ? [{ chatId: chat, ...m }] : [], app ? [{ userId: row.studentId, body, url: `/t/${row.slug}/result` }] : [])
}

// ─── teachers ───────────────────────────────────────────────────────────────

/**
 * A homework the teacher stopped watching (locked the phone, left the app) is ready: they hear it once, in the iOS
 * app and in Telegram. Without website links on, the Telegram message says where to find the draft.
 */
export async function notifyDraftReady(db: Db, input: { teacherId: string; runId: string; assignmentId: string; title: string }, deps: NotifyDeps = {}) {
  const bot = botOf(deps)
  const push = pushOf(deps)
  if (!bot && !push) return { sent: 0 }
  const [teacher] = await db.select({ chatId: users.telegramChatId, locale: users.uiLocale }).from(users).where(eq(users.id, input.teacherId)).limit(1)
  if (!teacher) return { sent: 0 }
  const chat = bot && teacher.chatId ? teacher.chatId : null
  const app = push ? (await pushUserIds(db, [input.teacherId])).has(input.teacherId) : false
  if (!chat && !app) return { sent: 0 }
  if (!(await claim(db, `ready:${input.runId}`))) return { sent: 0 }
  const locale = isLocale(teacher.locale) ? teacher.locale : 'ko'
  const t = getTranslator(locale)
  const body = t('tg.notify.draftReady', { title: input.title })
  const { links } = await getTelegramSettings(db)
  const origin = (process.env.PUBLIC_ORIGIN ?? 'https://ikhimi.kr').replace(/\/$/, '')
  const message = links
    ? { text: body, markup: { inline_keyboard: [[{ text: t('tg.notify.open'), url: `${origin}/app/a/${input.assignmentId}` }]] } }
    : { text: `${body}\n\n${t('tg.notify.draftWhere')}` }
  return {
    sent: await deliver(db, bot, push, chat ? [{ chatId: chat, ...message }] : [], app ? [{ userId: input.teacherId, body, url: `/app/a/${input.assignmentId}` }] : []),
  }
}

/** The admin approved or returned a teacher's course (DECISIONS.md BL): the teacher hears it, with the note */
export async function notifyCourseReview(
  db: Db,
  input: { teacherId: string; courseId: string; title: string; decision: 'approve' | 'return'; note: string | null },
  deps: NotifyDeps & { now?: Date } = {},
) {
  const bot = botOf(deps)
  const push = pushOf(deps)
  if (!bot && !push) return { sent: 0 }
  const [teacher] = await db.select({ chatId: users.telegramChatId, locale: users.uiLocale }).from(users).where(eq(users.id, input.teacherId)).limit(1)
  if (!teacher) return { sent: 0 }
  const chat = bot && teacher.chatId ? teacher.chatId : null
  const app = push ? (await pushUserIds(db, [input.teacherId])).has(input.teacherId) : false
  if (!chat && !app) return { sent: 0 }
  const t = getTranslator(isLocale(teacher.locale) ? teacher.locale : 'ko')
  const body =
    input.decision === 'approve'
      ? t('tg.notify.courseApproved', { title: input.title })
      : input.note
        ? t('tg.notify.courseReturnedNote', { title: input.title, note: input.note })
        : t('tg.notify.courseReturned', { title: input.title })
  const url = `/app/courses/${input.courseId}`
  return { sent: await deliver(db, bot, push, chat ? [{ chatId: chat, text: body }] : [], app ? [{ userId: input.teacherId, body, url }] : []) }
}

// ─── the owner ──────────────────────────────────────────────────────────────

/** Something for the owner to do (not a breakage): once per key, to the same chats as alerts */
export async function tellOwner(db: Db, key: string, text: string, deps: NotifyDeps = {}) {
  try {
    const bot = botOf(deps)
    if (!bot || !(await claim(db, `owner:${key.slice(0, 200)}`))) return false
    const chats = await alertChats(db)
    for (const c of chats) await bot.sendMessage(c, text.slice(0, 3500)).catch(() => {})
    return chats.length > 0
  } catch (e) {
    console.warn('[owner] could not tell the owner', e)
    return false
  }
}

/** Where alerts go: ALERT_CHAT_ID, else the owners' own linked chats, else the support admin chat */
async function alertChats(db: Db): Promise<string[]> {
  if (process.env.ALERT_CHAT_ID) return [process.env.ALERT_CHAT_ID]
  const phones = ownerPhones()
  const owners = phones.length
    ? await db.select({ chatId: users.telegramChatId }).from(users).where(and(inArray(users.phone, phones), isNull(users.deletedAt)))
    : []
  const chats = owners.map((o) => o.chatId).filter((c): c is string => !!c)
  if (chats.length) return chats
  return process.env.SUPPORT_ADMIN_CHAT_ID ? [process.env.SUPPORT_ADMIN_CHAT_ID] : []
}

/**
 * Something broke: tell the owner in Telegram. At most one message per topic an hour, so a crash loop is one message,
 * not hundreds. Never throws: an alert must not break the request that reported it.
 */
export async function alertOwner(db: Db, topic: string, text: string, deps: NotifyDeps & { now?: Date } = {}) {
  try {
    const bot = botOf(deps)
    if (!bot) return false
    const hour = (deps.now ?? new Date()).toISOString().slice(0, 13)
    if (!(await claim(db, `alert:${topic.slice(0, 200)}:${hour}`))) return false
    const chats = await alertChats(db)
    for (const c of chats) await bot.sendMessage(c, `⚠️ 익히미: ${text}`.slice(0, 3500)).catch(() => {})
    return chats.length > 0
  } catch (e) {
    console.warn('[alert] could not alert the owner', e)
    return false
  }
}

/** Old message keys are only needed to stop repeats: keep 60 days */
export async function pruneNotificationLog(db: Db, now = new Date()) {
  await db.delete(notificationLog).where(lte(notificationLog.createdAt, new Date(now.getTime() - 60 * 86400_000)))
}

/** Admin → Health: how many students the bot can reach, and what it sent in the last 7 days */
export async function telegramStats(db: Db, now = new Date()) {
  const [reach] = await db
    .select({ students: count(), linked: sql<number>`count(${users.telegramChatId})`.mapWith(Number) })
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
    linked: reach?.linked ?? 0,
    sent: { new: by.new ?? 0, due: by.due ?? 0, nudge: by.nudge ?? 0, graded: by.graded ?? 0, alert: by.alert ?? 0 },
    bot: !!process.env.TELEGRAM_BOT_TOKEN,
    cron: !!process.env.CRON_SECRET,
    alerts: process.env.ALERT_CHAT_ID ? ('chat' as const) : ownerPhones().length ? ('owners' as const) : process.env.SUPPORT_ADMIN_CHAT_ID ? ('support' as const) : ('none' as const),
  }
}
