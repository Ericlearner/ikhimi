import { after } from 'next/server'
import { z } from 'zod'
import { and, assignments, CONFIG, conversations, courses, eq, generationRuns, getDb, isNull, messages, teacherProfiles } from '@ikhimi/db'
import {
  generateAssignment,
  LANGUAGE_CODES,
  learnPrefs,
  LlmError,
  normalizePlan,
  settlePictures,
  type DraftExercise,
  type GenerateResult,
  type InstructionLocale,
  type LanguageCode,
  type ProgressStage,
} from '@ikhimi/ai'
import { retrieveMethodology } from '@ikhimi/pedagogy'
import { metered } from '@/server/ai-usage'
import { createDraft, loadExercises, replaceDraft, toDraft } from '@/server/assignments'
import { env } from '@/server/env'
import { getEmbeddingProvider, getLlm } from '@/server/llm'
import { dropAnswerFiles, loadMaterialsForLlm, MaterialError, type LoadedMaterial } from '@/server/materials'
import { authorize } from '@/server/policy'
import { getLocale, getSession } from '@/server/request'
import { attachPictures } from '@/server/pictures'
import { capReached } from '@/server/generation-cap'
import { attachSpeech, dropSilent, getSpeech, isSpoken, plannedWords, relisten } from '@/server/speech'
import { countStyleUse, resolveStyle, type ChosenStyle, type ResolvedStyle } from '@/server/lab'
import { notifyDraftReady } from '@/server/notify'

// Generation takes 20–60 s; keep the function alive while we stream progress.
export const maxDuration = 300

const body = z.object({
  text: z.string().max(20000).default(''),
  /** Up to 6 book pages plus audio recordings */
  materialIds: z.array(z.string().max(40)).max(12).default([]),
  /** create = new homework; digitize = the book's own exercises, word for word */
  mode: z.enum(['create', 'digitize']).default('create'),
  /** Which pages of an attached PDF to use, e.g. "12-14" (PDF page numbers) */
  pdfPages: z.string().max(40).optional(),
  /** Digitize: the book's answer pages (up to CONFIG.maxAnswerPages), read for the answers only (DECISIONS.md BM) */
  answerMaterialIds: z.array(z.string().max(40)).max(8).default([]),
  /** …and which pages of an answer PDF, e.g. "142-143" */
  answerPages: z.string().max(40).optional(),
  minutes: z.number().int().min(5).max(90).default(20),
  difficulty: z.number().int().min(1).max(5).default(3),
  /** Optional skills focus from the composer's "+" chip */
  skills: z.array(z.enum(['grammar', 'vocabulary', 'reading', 'writing', 'listening', 'speaking', 'pronunciation'])).max(6).default([]),
  /** Follow-up message on an existing draft ("qiyinroq qil") */
  refineAssignmentId: z.string().max(40).optional(),
  /** Create mode: the language being taught (composer chip) */
  language: z.enum(LANGUAGE_CODES as [LanguageCode, ...LanguageCode[]]).nullable().optional(),
  /** Create mode: the style and level: a catalog exam (exams.ts) or the owner's own methodology (server/lab.ts) */
  exam: z.object({ id: z.string().max(40), level: z.string().max(40) }).nullable().optional(),
  /** Create mode: the plan the teacher confirmed on the card (checked again here), and the one first proposed */
  plan: z.unknown().optional(),
  proposedPlan: z.unknown().optional(),
  /** The course this homework is for: the teacher's choices on the card are remembered for it */
  courseId: z.string().max(40).nullable().optional(),
})


type StyleMeta = { mode?: 'create' | 'digitize'; exam?: ChosenStyle | null; language?: LanguageCode | null }

/** No style: Digitize, or a revision whose methodology the owner has since deleted */
const NO_STYLE: ResolvedStyle = { ok: true, exam: null, chosen: null, style: null, language: null, methodologyId: null }

/** Remember the mode (and style) in generationMeta so revisions and the draft screen know it */
const withMode = (r: GenerateResult, mode: 'create' | 'digitize', style: StyleMeta = {}): GenerateResult => ({
  ...r,
  meta: { ...r.meta, mode, ...(mode === 'create' && style.exam ? { exam: style.exam } : {}), ...(mode === 'create' && style.language ? { language: style.language } : {}) } as GenerateResult['meta'],
})

/** What the chat shows of an item while the rest is still being written */
const preview = (e: DraftExercise) => ({ kind: e.kind, skill: e.skill, prompt: e.prompt.slice(0, 200), vocab: !!e.vocab, picture: !!e.imageRef })

type Event =
  | { type: 'started'; runId: string }
  | { type: 'progress'; stage: ProgressStage }
  | { type: 'items'; items: ReturnType<typeof preview>[] }
  | { type: 'done'; assignmentId: string }
  | { type: 'error'; code: string; n?: number }

/**
 * POST → NDJSON stream of progress events, ending in `done` or `error`. The homework is made whether or not anyone is
 * still listening: a teacher who locks the phone or leaves the app gets the draft anyway (the screen checks
 * /api/generate/runs/<id> when it comes back), and a message that it's ready.
 */
export async function POST(req: Request) {
  const session = await getSession()
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { user } = session
  if (user.role !== 'teacher') return Response.json({ error: 'forbidden' }, { status: 403 })
  const parsed = body.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    console.warn('generate: bad request', JSON.stringify(parsed.error.issues))
    const tooLong = parsed.error.issues.some((i) => i.path[0] === 'text' && i.code === 'too_big')
    return Response.json({ error: tooLong ? 'text_too_long' : 'bad_request' }, { status: 400 })
  }
  const input = parsed.data
  const locale = (await getLocale()) as InstructionLocale
  const db = getDb()
  const style = await resolveStyle(db, input)
  if (!style.ok) return Response.json({ error: 'bad_request' }, { status: 400 })

  // The connection can drop at any moment (a locked phone): sending then does nothing instead of throwing, which
  // used to abort the homework halfway, retry its parts (paid twice) and save nothing
  let listening = true
  let finished: Promise<void> = Promise.resolve()
  const stream = new ReadableStream({
    cancel() {
      listening = false
    },
    start(controller) {
      const send = (e: Event) => {
        if (!listening) return
        try {
          controller.enqueue(new TextEncoder().encode(JSON.stringify(e) + '\n'))
        } catch {
          listening = false
        }
      }
      finished = (async () => {
        let runId: string | null = null
        const startedAt = Date.now()
        const endRun = async (fields: Partial<typeof generationRuns.$inferInsert>) => {
          if (runId) await db.update(generationRuns).set({ ...fields, durationMs: Date.now() - startedAt }).where(eq(generationRuns.id, runId))
        }
        try {
          const baseLlm = getLlm()
          if (!baseLlm) return send({ type: 'error', code: 'ai_not_configured' })
          if (input.mode === 'digitize' && input.materialIds.length === 0 && !input.refineAssignmentId) {
            return send({ type: 'error', code: 'digitize_needs_pages' })
          }
          if (!input.text.trim() && input.materialIds.length === 0 && !input.refineAssignmentId) {
            return send({ type: 'error', code: 'describe_first' })
          }

          // Fetched once, reused for the daily cap, methodology retrieval (subject) and teaching defaults below.
          const [profile] = await db.select().from(teacherProfiles).where(eq(teacherProfiles.userId, user.id)).limit(1)

          // Daily cap per teacher (§8.8, [DECIDE #8]); staff can raise it or reset today's count (admin panel)
          if (!input.refineAssignmentId) {
            const cap = await capReached(db, user.id, profile)
            if (cap !== null) return send({ type: 'error', code: 'daily_cap', n: cap })
          }

          // One record per generation for the admin health page: outcome, time, pictures, review
          const [run] = await db
            .insert(generationRuns)
            .values({ teacherId: user.id, mode: input.mode, kind: input.refineAssignmentId ? 'refine' : 'new', materials: input.materialIds.length })
            .returning({ id: generationRuns.id })
          runId = run!.id
          send({ type: 'started', runId })
          const llm = metered(baseLlm, { db, userId: user.id, purpose: input.refineAssignmentId ? 'refine' : 'generate', refId: runId })

          let refine: { row: typeof assignments.$inferSelect; conversationId: string | null; rows: Awaited<ReturnType<typeof loadExercises>> } | null = null
          if (input.refineAssignmentId) {
            const [a] = await db.select().from(assignments).where(eq(assignments.id, input.refineAssignmentId)).limit(1)
            if (!a) return send({ type: 'error', code: 'not_found' })
            authorize(user, 'assignment:update', { teacherId: a.teacherId })
            refine = { row: a, conversationId: a.conversationId, rows: await loadExercises(db, a.id) }
          }

          send({ type: 'progress', stage: input.materialIds.length ? 'reading' : 'writing' })
          let materials: LoadedMaterial[]
          try {
            materials = await loadMaterialsForLlm(db, user.id, input.materialIds, { pdfPages: input.pdfPages })
          } catch (e) {
            if (e instanceof MaterialError) {
              await endRun({ status: 'failed', errorCode: e.code })
              return send({ type: 'error', code: e.code, n: e.n })
            }
            throw e
          }
          // The answer pages have their own small limit, so a whole answer book is never read for one homework
          let answerPages: LoadedMaterial[] = []
          if (input.mode === 'digitize' && !refine && input.answerMaterialIds.length) {
            try {
              answerPages = (await loadMaterialsForLlm(db, user.id, input.answerMaterialIds, { pdfPages: input.answerPages, maxPages: CONFIG.maxAnswerPages })).filter((m) => m.kind === 'page')
            } catch (e) {
              if (e instanceof MaterialError) {
                const code = e.code === 'too_many_pages' || e.code === 'pdf_pages' ? `answers_${e.code}` : e.code
                await endRun({ status: 'failed', errorCode: code })
                return send({ type: 'error', code, n: e.n })
              }
              throw e
            }
          }
          const audioIds = Object.fromEntries(materials.filter((m) => m.kind === 'audio').map((m) => [m.label, m.id]))
          // A revision continues in the draft's own mode and style
          const stored = (refine?.row.generationMeta ?? {}) as StyleMeta
          const mode = refine ? (stored.mode ?? 'create') : input.mode
          const chosen =
            mode !== 'create'
              ? NO_STYLE
              : refine
                ? await resolveStyle(db, { language: stored.language ?? null, exam: stored.exam ? { id: stored.exam.id, level: stored.exam.level } : null }, { stored: true }).then((r) => (r.ok ? r : NO_STYLE))
                : style
          const exam = chosen.exam
          const language = mode === 'create' ? (refine ? (stored.language ?? null) : style.language) : null
          const knownNames = user.fullName ? [user.fullName] : []

          // §8.5: best-effort retrieval — no embedding key, a rate limit, or a DB hiccup here must
          // never block homework generation, so a failure just means the prompt gets no extra notes.
          let methodologyNotes: { title: string; body: string }[] = []
          try {
            const embedder = getEmbeddingProvider()
            // Digitizing copies the book, so teaching-method notes don't apply
            if (embedder && mode === 'create') {
              methodologyNotes = await retrieveMethodology(db, embedder, {
                subject: profile?.subjects?.[0] ?? 'language-learning',
                queryText: [input.text, ...input.skills, chosen.chosen?.name ?? ''].join(' '),
              })
            }
          } catch (e) {
            console.warn('[generate] methodology retrieval failed', e)
          }

          const reviewOn = env().AI_REVIEW === '1' && mode === 'create'
          // A new Create homework follows the plan the teacher confirmed; revisions and Digitize don't plan
          const plan = mode === 'create' && !refine ? normalizePlan(input.plan) : null
          const result = await generateAssignment(llm, {
            mode,
            teacherText: input.text,
            materials,
            answerPages,
            instructionLocale: locale,
            targetMinutes: refine ? (refine.row.estimatedMinutes ?? input.minutes) : input.minutes,
            difficulty: (refine ? (refine.row.difficulty ?? input.difficulty) : input.difficulty) as 1 | 2 | 3 | 4 | 5,
            knownNames,
            focusSkills: input.skills,
            methodologyNotes,
            language,
            exam,
            style: chosen.style,
            review: reviewOn,
            plan,
            speech: !!plan && !!getSpeech(),
            onItems: (items) => send({ type: 'items', items: items.map(preview) }),
            refine: refine ? { previous: toDraft(refine.row, refine.rows), feedback: input.text } : undefined,
            onProgress: (stage) => stage !== 'reading' && send({ type: 'progress', stage }),
          })

          // Pictures the items need are cut out of the materials and stored with the homework; an item whose
          // picture couldn't be cut is taken out (Digitize lists it as skipped), never shown without it
          await attachPictures(db, user.id, result.draft.exercises, materials)
          const removed = settlePictures(result.draft, mode, locale)
          const attached = result.draft.exercises.filter((e) => e.payload.imageId).length
          if (attached || removed) console.info(`[pictures] attached ${attached}, removed ${removed} without their picture`)
          // Vocabulary words students hear are spoken and stored like a recording; in a revision, an item that still
          // asks students to listen (a spoken item's prompt) gets its word spoken again
          if (refine) {
            const listen = new Set(refine.rows.filter(isSpoken).map((r) => ((r.prompt as { text?: string }).text ?? '').trim()))
            relisten(result.draft.exercises, (e) => listen.has(e.prompt.trim()))
          }
          const words = plan ?? (refine ? plannedWords(refine.row.generationMeta) : null)
          if (words) {
            Object.assign(audioIds, await attachSpeech(db, { teacherId: user.id, refId: runId, plan: words, locale }, result.draft.exercises))
            const silent = dropSilent(result.draft)
            if (silent) console.warn(`[speech] removed ${silent} items that could not be spoken`)
          }

          // The chat thread is the editing history (§10.3)
          let conversationId = refine?.conversationId ?? null
          if (!conversationId) {
            const [c] = await db
              .insert(conversations)
              .values({ teacherId: user.id, title: result.draft.title })
              .returning({ id: conversations.id })
            conversationId = c!.id
          }
          await db.insert(messages).values({ conversationId, role: 'teacher', body: input.text, attachments: input.materialIds })

          let assignmentId: string
          if (refine) {
            await replaceDraft(db, refine.row, withMode(result, mode, { exam: chosen.chosen, language }), audioIds)
            assignmentId = refine.row.id
          } else {
            const defaults = profile?.teachingDefaults ?? {}
            const a = await createDraft(db, {
              teacherId: user.id,
              conversationId,
              instructionLocale: locale,
              difficulty: input.difficulty,
              result: withMode(result, mode, { exam: chosen.chosen, language }),
              audioIds,
              settings: { showAnswersAfter: defaults.showAnswersAfter ?? 'submit', typoTolerance: defaults.typoTolerance ?? true },
            })
            assignmentId = a.id
          }
          await db.insert(messages).values({ conversationId, role: 'assistant', body: result.draft.title, generatedAssignmentId: assignmentId })
          if (!refine) await countStyleUse(db, chosen.methodologyId).catch(() => {})
          // The course remembers what the teacher changed on the card, for its next plan
          if (plan && input.courseId) await rememberChoices(db, user.id, input.courseId, normalizePlan(input.proposedPlan), plan)
          await endRun({
            status: 'ok',
            assignmentId,
            mode,
            items: result.draft.exercises.length,
            picturesPointed: result.meta.pictures?.pointed ?? 0,
            picturesLocated: result.meta.pictures?.located ?? 0,
            picturesAttached: attached,
            picturesRemoved: removed,
            review: !reviewOn ? 'off' : result.meta.review?.failed ? 'failed' : result.meta.reviewSkipped ? 'skipped_slow' : result.meta.review ? 'ran' : 'off',
          })
          // The answers are saved with the exercises; the answer pages aren't kept
          if (answerPages.length) await dropAnswerFiles(db, user.id, input.answerMaterialIds).catch((e) => console.warn('[generate] answer pages not removed', e))
          send({ type: 'done', assignmentId })
          // Nobody was watching any more: tell the teacher it's ready (push, Telegram)
          if (!listening) await notifyDraftReady(db, { teacherId: user.id, runId: runId!, assignmentId, title: result.draft.title }).catch((e) => console.warn('[generate] ready message failed', e))
        } catch (err) {
          console.error('[generate]', err)
          const code =
            err instanceof LlmError
              ? err.code === 'rate_limited' || err.code === 'unavailable'
                ? 'ai_busy'
                : err.code === 'config'
                  ? 'ai_rejected'
                  : err.code === 'too_long'
                    ? 'ai_too_long'
                    : err.code === 'bad_output'
                      ? 'ai_bad_output'
                      : 'generic'
              : 'generic'
          await endRun({ status: 'failed', errorCode: code, errorDetail: String(err).slice(0, 1000) }).catch(() => {})
          send({ type: 'error', code })
        } finally {
          try {
            controller.close()
          } catch {}
        }
      })()
    },
  })
  // Keeps the function running until the homework is saved, even after the response has ended
  after(() => finished)

  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' } })
}

async function rememberChoices(db: ReturnType<typeof getDb>, teacherId: string, courseId: string, proposed: ReturnType<typeof normalizePlan>, final: NonNullable<ReturnType<typeof normalizePlan>>) {
  try {
    const where = and(eq(courses.id, courseId), eq(courses.teacherId, teacherId), isNull(courses.deletedAt))
    const [c] = await db.select({ planPrefs: courses.planPrefs }).from(courses).where(where).limit(1)
    if (!c) return
    await db.update(courses).set({ planPrefs: learnPrefs(c.planPrefs, proposed, final) }).where(where)
  } catch (e) {
    // Remembering is a convenience; the homework is already saved
    console.warn('[generate] could not remember the course choices', e)
  }
}
