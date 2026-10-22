/**
 * The teachers' help chat (DECISIONS.md BN): a question about using 익히미 is answered from the guide
 * (content/help-guide.ts); one row per question records only its topic, for the daily limit and Admin's most-asked
 * list. The conversation stays in the teacher's browser. "Write to the team" opens an email to SITE.supportEmail
 * with the conversation in it, from the teacher's own mail app (nothing passes through 익히미).
 */
import { z } from 'zod'
import { and, CONFIG, count, desc, eq, gte, helpQuestions, isNotNull, lte, ne, sql, users, type Db } from '@ikhimi/db'
import { answerHelp, HELP_MAX_QUESTION, HELP_OFF_TOPIC, HELP_UNKNOWN, type HelpTurn, type InstructionLocale, type LlmProvider, type Pricing } from '@ikhimi/ai'
import type { Locale } from '@ikhimi/i18n'
import { HELP_LINKS, helpGuide, helpPlace } from '@/content/help-guide'

/** What the chat sends: the question, the conversation so far (kept in the browser) and the page it was opened on */
export const helpRequest = z.object({
  question: z.string().trim().min(1).max(HELP_MAX_QUESTION),
  history: z.array(z.object({ role: z.enum(['teacher', 'assistant']), text: z.string().max(2000) })).max(8).default([]),
  path: z.string().max(200).default('/app'),
})

type Teacher = { id: string; fullName: string | null }

const dayAgo = (now: Date) => new Date(now.getTime() - 24 * 3600_000)

async function countToday(db: Db, userId: string, now: Date) {
  const [r] = await db
    .select({ n: count() })
    .from(helpQuestions)
    .where(and(eq(helpQuestions.userId, userId), gte(helpQuestions.createdAt, dayAgo(now))))
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
  const asked = await countToday(db, teacher.id, now)
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

/** Admin: the most asked guide topics and the most asked questions the guide doesn't answer, over `days` */
export async function mostAsked(db: Db, days = 30, now = new Date()) {
  const since = new Date(now.getTime() - days * 86400_000)
  const asked = gte(helpQuestions.createdAt, since)
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
      questions: count(),
      teachers: sql<number>`count(distinct ${helpQuestions.userId})`.mapWith(Number),
    })
    .from(helpQuestions)
    .where(gte(helpQuestions.createdAt, since))
  return { topics, unknown: unknown as { gist: string; n: number }[], totals: totals ?? { questions: 0, teachers: 0 } }
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
    .select({ id: users.id, fullName: users.fullName })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  return u ?? null
}
