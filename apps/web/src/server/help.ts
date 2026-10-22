/**
 * The teachers' help chat (DECISIONS.md BN): a question about using 익히미 is answered from the guide
 * (content/help-guide.ts); one row per question records only its topic, for the daily limit and Admin's most-asked
 * list. The conversation stays in the teacher's browser. "Send to the team" copies it into the support admin chat,
 * where a Reply reaches the teacher in Telegram, the same way as support messages (telegram/support.ts).
 */
import { z } from 'zod'
import { and, CONFIG, count, desc, eq, gte, helpQuestions, isNotNull, lte, ne, sql, supportThreads, users, type Db } from '@ikhimi/db'
import { answerHelp, HELP_MAX_QUESTION, HELP_OFF_TOPIC, HELP_UNKNOWN, type HelpTurn, type InstructionLocale, type LlmProvider, type Pricing } from '@ikhimi/ai'
import type { Locale } from '@ikhimi/i18n'
import { HELP_LINKS, helpGuide, helpPlace } from '@/content/help-guide'
import type { TelegramBotApi } from './telegram/api'

/** What the chat sends: the question, the conversation so far (kept in the browser) and the page it was opened on */
export const helpRequest = z.object({
  question: z.string().trim().min(1).max(HELP_MAX_QUESTION),
  history: z.array(z.object({ role: z.enum(['teacher', 'assistant']), text: z.string().max(2000) })).max(8).default([]),
  path: z.string().max(200).default('/app'),
})

type Teacher = { id: string; fullName: string | null; phone: string; telegramChatId: string | null }

const dayAgo = (now: Date) => new Date(now.getTime() - 24 * 3600_000)

async function countToday(db: Db, userId: string, handoff: boolean, now: Date) {
  const [r] = await db
    .select({ n: count() })
    .from(helpQuestions)
    .where(and(eq(helpQuestions.userId, userId), eq(helpQuestions.handoff, handoff), gte(helpQuestions.createdAt, dayAgo(now))))
  return r?.n ?? 0
}

export type HelpReply =
  | { ok: true; answer: string; topic: string; links: { href: string; label: string }[]; left: number }
  | { ok: false; reason: 'limit'; limit: number }

/** One question answered, or the day's limit reached. Throws when the AI fails (nothing is recorded then). */
export async function askHelp(
  db: Db,
  teacher: Teacher,
  input: { question: string; history: HelpTurn[]; path: string; locale: Locale; prices: Pricing; store: boolean },
  llm: LlmProvider,
  now = new Date(),
): Promise<HelpReply> {
  const limit = CONFIG.help.questionsPerDay
  const asked = await countToday(db, teacher.id, false, now)
  if (asked >= limit) return { ok: false, reason: 'limit', limit }
  const { topics, links } = helpGuide(input.locale, { prices: input.prices, store: input.store })
  const r = await answerHelp(llm, {
    topics,
    links,
    page: helpPlace(input.path).about,
    question: input.question,
    history: input.history,
    locale: input.locale as InstructionLocale,
    knownNames: teacher.fullName ? [teacher.fullName] : [],
  })
  await db.insert(helpQuestions).values({ userId: teacher.id, topic: r.topic, gist: r.gist })
  const label = new Map(links.map((l) => [l.id, l.label]))
  return {
    ok: true,
    answer: r.answer,
    topic: r.topic,
    links: r.links.map((id) => ({ href: HELP_LINKS[id]!.href, label: label.get(id)! })),
    left: limit - asked - 1,
  }
}

export type HandoffResult =
  | { ok: true; reach: 'telegram' | 'phone' }
  | { ok: false; reason: 'limit' | 'unavailable'; limit?: number }

/**
 * The conversation sent to the team: a header naming the teacher, then the conversation as a reply to it, in the
 * support admin chat. Replying to either reaches the teacher's Telegram. Without Telegram (or when the bot can't
 * write to them) the header gives their number, so the team can call.
 */
export async function handOff(
  db: Db,
  teacher: Teacher,
  input: { question: string; history: HelpTurn[]; path: string },
  deps: { bot: Pick<TelegramBotApi, 'call' | 'sendMessage'> | null; adminChatId: string | undefined },
  now = new Date(),
): Promise<HandoffResult> {
  if (!deps.bot || !deps.adminChatId) return { ok: false, reason: 'unavailable' }
  const limit = CONFIG.help.handoffsPerDay
  if ((await countToday(db, teacher.id, true, now)) >= limit) return { ok: false, reason: 'limit', limit }

  // Tell the teacher first: if the bot can write to them, the team's answer can reach them too
  let reach: 'telegram' | 'phone' = 'phone'
  if (teacher.telegramChatId) {
    try {
      await deps.bot.sendMessage(teacher.telegramChatId, '✅ 질문을 익히미 팀에 보냈어요. 답은 여기로 와요.')
      reach = 'telegram'
    } catch {
      // Never started this bot, or blocked it: the team calls instead
    }
  }
  const name = teacher.fullName?.trim() || '선생님'
  const header = `💬 도움말 채팅에서 · 👤 ${name} · 선생님 · ${reach === 'telegram' ? `id ${teacher.telegramChatId}` : `텔레그램 연락 불가 · ${teacher.phone}`}`
  const turns = [...input.history.slice(-8), { role: 'teacher' as const, text: input.question }]
  const body = [`페이지: ${input.path.slice(0, 120)}`, '', ...turns.map((t) => `${t.role === 'teacher' ? '👤' : '🤖'} ${t.text.slice(0, 800)}`)].join('\n').slice(0, 3800)
  const head = await deps.bot.call<{ message_id: number }>('sendMessage', { chat_id: deps.adminChatId, text: header })
  const copy = await deps.bot.call<{ message_id: number }>('sendMessage', {
    chat_id: deps.adminChatId,
    text: body,
    reply_parameters: { message_id: head.message_id },
  })
  if (reach === 'telegram')
    await db
      .insert(supportThreads)
      .values([
        { adminMessageId: head.message_id, userChatId: teacher.telegramChatId! },
        { adminMessageId: copy.message_id, userChatId: teacher.telegramChatId! },
      ])
      .onConflictDoNothing()
  await db.insert(helpQuestions).values({ userId: teacher.id, topic: 'handoff', handoff: true })
  return { ok: true, reach }
}

/** Admin: the most asked guide topics and the most asked questions the guide doesn't answer, over `days` */
export async function mostAsked(db: Db, days = 30, now = new Date()) {
  const since = new Date(now.getTime() - days * 86400_000)
  const asked = and(gte(helpQuestions.createdAt, since), eq(helpQuestions.handoff, false))
  const topics = await db
    .select({ topic: helpQuestions.topic, n: count() })
    .from(helpQuestions)
    .where(and(asked, ne(helpQuestions.topic, HELP_UNKNOWN), ne(helpQuestions.topic, HELP_OFF_TOPIC)))
    .groupBy(helpQuestions.topic)
    .orderBy(desc(count()))
    .limit(10)
  const unknown = await db
    .select({ gist: helpQuestions.gist, n: count() })
    .from(helpQuestions)
    .where(and(asked, eq(helpQuestions.topic, HELP_UNKNOWN), isNotNull(helpQuestions.gist)))
    .groupBy(helpQuestions.gist)
    .orderBy(desc(count()), desc(sql`max(${helpQuestions.createdAt})`))
    .limit(10)
  const [totals] = await db
    .select({
      questions: sql<number>`count(*) filter (where not ${helpQuestions.handoff})`.mapWith(Number),
      teachers: sql<number>`count(distinct ${helpQuestions.userId}) filter (where not ${helpQuestions.handoff})`.mapWith(Number),
      handoffs: sql<number>`count(*) filter (where ${helpQuestions.handoff})`.mapWith(Number),
    })
    .from(helpQuestions)
    .where(gte(helpQuestions.createdAt, since))
  return { topics, unknown: unknown as { gist: string; n: number }[], totals: totals ?? { questions: 0, teachers: 0, handoffs: 0 } }
}

/** Old rows go: the most-asked list looks at the last 30 days */
export async function pruneHelpQuestions(db: Db, now = new Date()) {
  const r = await db
    .delete(helpQuestions)
    .where(lte(helpQuestions.createdAt, new Date(now.getTime() - CONFIG.help.keepDays * 86400_000)))
    .returning({ id: helpQuestions.id })
  return r.length
}

/** The teacher as the help chat needs them */
export async function helpTeacher(db: Db, userId: string): Promise<Teacher | null> {
  const [u] = await db
    .select({ id: users.id, fullName: users.fullName, phone: users.phone, telegramChatId: users.telegramChatId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  return u ?? null
}
