import { z } from 'zod'
import { and, courses, eq, getDb, isNull, teacherProfiles } from '@ikhimi/db'
import { LANGUAGE_CODES, LlmError, normalizePlan, planHomework, planMinutes, vocabCounts, type InstructionLocale, type LanguageCode } from '@ikhimi/ai'
import { capReached } from '@/server/generation-cap'
import { getMeteredLlm } from '@/server/llm'
import { loadMaterialsForLlm, MaterialError } from '@/server/materials'
import { resolveStyle } from '@/server/lab'
import { getLocale, getSession } from '@/server/request'

// Reading a few pages and planning takes 5–20 s
export const maxDuration = 120

const body = z.object({
  text: z.string().max(20000).default(''),
  materialIds: z.array(z.string().max(40)).max(12).default([]),
  minutes: z.number().int().min(5).max(90).default(20),
  difficulty: z.number().int().min(1).max(5).default(3),
  skills: z.array(z.enum(['grammar', 'vocabulary', 'reading', 'writing', 'listening', 'speaking', 'pronunciation'])).max(6).default([]),
  language: z.enum(LANGUAGE_CODES as [LanguageCode, ...LanguageCode[]]).nullable().optional(),
  exam: z.object({ id: z.string().max(40), level: z.string().max(40) }).nullable().optional(),
  /** The course this homework is for: its remembered choices shape the plan */
  courseId: z.string().max(40).nullable().optional(),
  /** The teacher answered a plan in the chat: change it */
  revise: z.object({ previous: z.unknown(), feedback: z.string().max(2000) }).optional(),
})

/**
 * POST → { plan, minutes, vocab } — Create mode's plan card (plan.ts). Nothing is written or counted against the
 * daily cap here; the teacher confirms the plan and /api/generate writes it.
 */
export async function POST(req: Request) {
  const session = await getSession()
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { user } = session
  if (user.role !== 'teacher') return Response.json({ error: 'forbidden' }, { status: 403 })
  const parsed = body.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    const tooLong = parsed.error.issues.some((i) => i.path[0] === 'text' && i.code === 'too_big')
    return Response.json({ error: tooLong ? 'text_too_long' : 'bad_request' }, { status: 400 })
  }
  const input = parsed.data
  if (!input.text.trim() && !input.materialIds.length) return Response.json({ error: 'describe_first' }, { status: 400 })
  const previous = input.revise ? normalizePlan(input.revise.previous) : null
  if (input.revise && !previous) return Response.json({ error: 'bad_request' }, { status: 400 })

  const db = getDb()
  // A catalog exam or the owner's own methodology, with what the Lab knows about it
  const style = await resolveStyle(db, input)
  if (!style.ok) return Response.json({ error: 'bad_request' }, { status: 400 })
  const [profile] = await db.select().from(teacherProfiles).where(eq(teacherProfiles.userId, user.id)).limit(1)
  const cap = await capReached(db, user.id, profile)
  if (cap !== null) return Response.json({ error: 'daily_cap', n: cap }, { status: 429 })

  const llm = getMeteredLlm({ userId: user.id, purpose: 'plan' })
  if (!llm) return Response.json({ error: 'ai_not_configured' }, { status: 503 })

  let prefs = null
  if (input.courseId) {
    const [c] = await db
      .select({ planPrefs: courses.planPrefs })
      .from(courses)
      .where(and(eq(courses.id, input.courseId), eq(courses.teacherId, user.id), isNull(courses.deletedAt)))
      .limit(1)
    prefs = c?.planPrefs ?? null
  }

  try {
    const materials = await loadMaterialsForLlm(db, user.id, input.materialIds)
    const { plan } = await planHomework(llm, {
      teacherText: input.text,
      materials,
      instructionLocale: (await getLocale()) as InstructionLocale,
      targetMinutes: input.minutes,
      difficulty: input.difficulty as 1 | 2 | 3 | 4 | 5,
      focusSkills: input.skills,
      knownNames: user.fullName ? [user.fullName] : [],
      language: style.language,
      exam: style.exam,
      style: style.style,
      prefs,
      revise: previous ? { previous, feedback: input.revise!.feedback } : undefined,
    })
    return Response.json({ plan, minutes: planMinutes(plan), vocab: vocabCounts(plan) })
  } catch (e) {
    if (e instanceof MaterialError) return Response.json({ error: e.code, n: e.n }, { status: 400 })
    console.error('[plan]', e)
    const code = e instanceof LlmError ? (e.code === 'rate_limited' || e.code === 'unavailable' ? 'ai_busy' : e.code === 'config' ? 'ai_rejected' : 'generic') : 'generic'
    return Response.json({ error: code }, { status: 502 })
  }
}
