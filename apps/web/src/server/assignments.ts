/**
 * Assignment lifecycle: draft → publish; attempts → autosave → submit → grade; report.
 * Pure data functions over a Db so they are testable against PGlite.
 */
import {
  and,
  asc,
  assignments,
  attempts,
  CONFIG,
  enrollments,
  eq,
  exercises,
  groups,
  inArray,
  isNull,
  lt,
  newJoinCode,
  newShareSlug,
  notificationLog,
  responses,
  sql,
  users,
  type Db,
} from '@ikhimi/db'
import {
  addTry,
  assessPronunciation,
  describeAnswer,
  gapVerdicts,
  describeResponse,
  keyAsResponse,
  gradeExercise,
  isAiGraded,
  keySchemas,
  isStudentPlan,
  itemPlan,
  planAllows,
  splitByPlan,
  type DraftAssignment,
  type DraftExercise,
  type ExerciseKind,
  type GenerateResult,
  type InstructionLocale,
  type LlmProvider,
  type ShadowValue,
} from '@ikhimi/ai'
import {
  aiGrade,
  finalizeAttempt,
  parseEssayFeedback,
  parseWritingFeedback,
  studentNames,
  teacherGrades,
  type EssayFeedback,
  type WritingFeedback,
} from './writing'
import { endOfDayAfter, studentDue } from './deadline'
import { homeworkPlan, inPublishedCourse } from './course-plans'
import './chinese'

export type AssignmentRow = typeof assignments.$inferSelect

/** Per-assignment settings, prefilled from the teacher's defaults (design spec §12). */
export type AssignmentSettings = { showAnswersAfter?: 'submit' | 'never'; typoTolerance?: boolean }

/** Typo tolerance: the global default [DECIDE #9], unless this assignment turned it off. */
export const gradeOptionsFor = (a: Pick<AssignmentRow, 'settings' | 'contentLanguage'>) => ({
  typoToleranceMinLength: (a.settings as AssignmentSettings | null)?.typoTolerance === false ? null : CONFIG.gapFillTypoToleranceMinWordLength,
  // Korean spacing, Chinese scripts, Arabic vowel marks… (answer-lang.ts)
  language: a.contentLanguage,
})
export type ExerciseRow = typeof exercises.$inferSelect

/** audioIds: attached audio file name → material id, so listening items link to their recording */
const exerciseValues = (assignmentId: string, e: DraftExercise, orderIndex: number, audioIds: Record<string, string> = {}) => ({
  assignmentId,
  orderIndex,
  kind: e.kind,
  points: e.points,
  prompt: { text: e.prompt },
  payload: e.payload,
  answerKey: e.answerKey,
  // Per-item note for the teacher: why the reviewer flagged it (DECISIONS.md AO)
  rationale: e.reviewNote ?? null,
  explanation: e.explanation,
  gradingMode: teacherGrades(e) ? ('manual' as const) : isAiGraded(e.kind) ? ('ai' as const) : ('auto' as const),
  skillTags: [e.skill],
  sourceRef: e.sourceRef,
  aiConfidence: e.aiConfidence,
  verifyFlags: e.flags,
  answerSource: e.answerSource ?? null,
  audioLabel: e.audioLabel ?? null,
  audioMaterialId: e.audioFile ? (audioIds[e.audioFile] ?? null) : null,
})

/** Digitize mode's list of book exercises that couldn't be made interactive, kept for the draft screen */
const draftExtras = (d: DraftAssignment) => (d.skipped?.length ? { skipped: d.skipped } : {})

const totalPoints = (d: DraftAssignment) => d.exercises.reduce((s, e) => s + e.points, 0)

export async function createDraft(
  db: Db,
  input: {
    teacherId: string
    conversationId: string | null
    instructionLocale: InstructionLocale
    difficulty: number
    result: GenerateResult
    settings?: AssignmentSettings
    audioIds?: Record<string, string>
  },
) {
  const { draft, meta } = input.result
  let shareSlug = newShareSlug()
  // Collisions are astronomically unlikely; retry once anyway.
  const [clash] = await db.select({ id: assignments.id }).from(assignments).where(eq(assignments.shareSlug, shareSlug)).limit(1)
  if (clash) shareSlug = newShareSlug()
  const [a] = await db
    .insert(assignments)
    .values({
      conversationId: input.conversationId,
      teacherId: input.teacherId,
      title: draft.title,
      instructions: draft.instructions,
      instructionLocale: input.instructionLocale,
      contentLanguage: draft.contentLanguage,
      cefrLevel: draft.cefrLevel,
      difficulty: input.difficulty,
      estimatedMinutes: draft.estimatedMinutes,
      totalPoints: totalPoints(draft),
      shareSlug,
      settings: { showAnswersAfter: 'submit', typoTolerance: true, ...input.settings },
      generationMeta: { ...stripRaw(meta), ...draftExtras(draft), rationale: draft.rationale, history: [stripRaw(meta)] },
    })
    .returning()
  await db.insert(exercises).values(draft.exercises.map((e, i) => exerciseValues(a!.id, e, i, input.audioIds)))
  return a!
}

/** Keep raw model output out of the main record (it can be large); counts only. */
function stripRaw(meta: GenerateResult['meta']) {
  const { raw: _raw, ...rest } = meta
  return rest
}

export async function replaceDraft(db: Db, assignment: AssignmentRow, result: GenerateResult, audioIds: Record<string, string> = {}) {
  const { draft, meta } = result
  const prevMeta = (assignment.generationMeta ?? {}) as { history?: unknown[] }
  // A revision keeps recordings the teacher already attached (matched by the book's audio label)
  const before = await loadExercises(db, assignment.id)
  const linked = new Map(before.filter((r) => r.audioLabel && r.audioMaterialId).map((r) => [r.audioLabel!, r.audioMaterialId!]))
  // …and where an unchanged item's answer came from: a revision is written without the book's answer pages, so the
  // model would call every answer its own
  const sourced = new Map(before.filter((r) => r.answerSource === 'answer_key' || r.answerSource === 'audio').map((r) => [sameItem(r.prompt, r.answerKey), r.answerSource!]))
  await db.delete(exercises).where(eq(exercises.assignmentId, assignment.id))
  await db.insert(exercises).values(
    draft.exercises.map((e, i) => {
      let v = exerciseValues(assignment.id, e, i, audioIds)
      const source = sourced.get(sameItem({ text: e.prompt }, e.answerKey))
      if (source) v = { ...v, answerSource: source, verifyFlags: v.verifyFlags.filter((f) => f !== 'answer_ai_inferred') }
      const keep = !v.audioMaterialId && v.audioLabel ? linked.get(v.audioLabel) : undefined
      return keep ? { ...v, audioMaterialId: keep, verifyFlags: v.verifyFlags.filter((f) => f !== 'needs_audio') } : v
    }),
  )
  await db
    .update(assignments)
    .set({
      title: draft.title,
      instructions: draft.instructions,
      contentLanguage: draft.contentLanguage,
      cefrLevel: draft.cefrLevel,
      estimatedMinutes: draft.estimatedMinutes,
      totalPoints: totalPoints(draft),
      generationMeta: { ...stripRaw(meta), ...draftExtras(draft), rationale: draft.rationale, history: [...(prevMeta.history ?? []), stripRaw(meta)] },
    })
    .where(eq(assignments.id, assignment.id))
}

/** The same question with the same answer (a revision that left the item alone); key order doesn't matter (jsonb) */
const sameItem = (prompt: unknown, key: unknown) => JSON.stringify([((prompt ?? {}) as { text?: string }).text?.trim() ?? '', sorted(key)])
const sorted = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sorted(x)])) : v

export async function loadExercises(db: Db, assignmentId: string) {
  return db.select().from(exercises).where(eq(exercises.assignmentId, assignmentId)).orderBy(asc(exercises.orderIndex))
}

/** DB rows → the pipeline's draft shape (for refine / regenerate context). */
export function toDraft(a: AssignmentRow, rows: ExerciseRow[]): DraftAssignment {
  return {
    title: a.title,
    instructions: a.instructions ?? '',
    rationale: ((a.generationMeta ?? {}) as { rationale?: string }).rationale ?? '',
    contentLanguage: a.contentLanguage,
    cefrLevel: a.cefrLevel,
    estimatedMinutes: a.estimatedMinutes ?? 0,
    exercises: rows.map((r) => ({
      kind: r.kind as ExerciseKind,
      prompt: (r.prompt as { text?: string }).text ?? '',
      payload: r.payload as Record<string, unknown>,
      answerKey: r.answerKey as Record<string, unknown>,
      points: r.points,
      skill: (r.skillTags[0] ?? 'grammar') as DraftExercise['skill'],
      explanation: r.explanation ?? '',
      sourceRef: r.sourceRef,
      estimatedSeconds: 60,
      flags: r.verifyFlags,
      aiConfidence: r.aiConfidence ?? 0.5,
      audioLabel: r.audioLabel,
      audioFile: null,
      answerSource: r.answerSource,
    })),
  }
}

export async function recomputeTotals(db: Db, assignmentId: string) {
  const rows = await loadExercises(db, assignmentId)
  await db
    .update(assignments)
    .set({ totalPoints: rows.reduce((s, r) => s + r.points, 0) })
    .where(eq(assignments.id, assignmentId))
}

export async function replaceExercise(db: Db, row: ExerciseRow, e: DraftExercise, audioIds: Record<string, string> = {}) {
  let v = exerciseValues(row.assignmentId, e, row.orderIndex, audioIds)
  // Regenerating a listening item keeps its recording
  if (v.audioLabel && row.audioMaterialId) v = { ...v, audioMaterialId: row.audioMaterialId, verifyFlags: v.verifyFlags.filter((f) => f !== 'needs_audio') }
  await db.update(exercises).set({ ...v, teacherEdited: false }).where(eq(exercises.id, row.id))
  await recomputeTotals(db, row.assignmentId)
}

/** Organisation details a teacher enters for a group. Never reaches the AI. */
export type GroupDetails = {
  name: string
  cefrLevel?: string | null
  startDate?: string | null
  expectedStudents?: number | null
  description?: string | null
}

export async function publishAssignment(
  db: Db,
  a: AssignmentRow,
  input: { groupId?: string | null; newGroupName?: string | null; newGroup?: GroupDetails | null; dueDays?: number | null },
) {
  // A listening item without its recording can't be done by students
  if ((await loadExercises(db, a.id)).some((r) => r.audioLabel && !r.audioMaterialId)) throw new Error('needs_audio')
  let groupId = input.groupId ?? null
  const details: GroupDetails | null = input.newGroup ?? (input.newGroupName?.trim() ? { name: input.newGroupName } : null)
  if (!groupId && details?.name.trim()) {
    const [g] = await db
      .insert(groups)
      .values({
        teacherId: a.teacherId,
        name: details.name.trim().slice(0, 60),
        subject: a.subject ?? 'english',
        contentLanguage: a.contentLanguage,
        cefrLevel: details.cefrLevel || a.cefrLevel,
        startDate: details.startDate || null,
        expectedStudents: details.expectedStudents ?? null,
        description: details.description?.trim() || null,
        joinCode: newJoinCode(),
        studentsSeeLeaderboard: CONFIG.studentLeaderboardDefault,
      })
      .returning()
    groupId = g!.id
  }
  if (groupId) {
    const [g] = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1)
    if (!g || g.teacherId !== a.teacherId) throw new Error('group_not_owned')
  }
  const publishedAt = a.publishedAt ?? new Date()
  const dueDays = input.dueDays || null
  const [updated] = await db
    .update(assignments)
    .set({ status: 'published', publishedAt, groupId, dueDays, dueAt: dueDays ? endOfDayAfter(publishedAt, dueDays) : null })
    .where(eq(assignments.id, a.id))
    .returning()
  return updated!
}

/**
 * The same homework for another of the teacher's groups: a published copy with its own link and results. Nothing is
 * generated again; the copy's items point at the same pictures and recordings (the teacher's own materials).
 */
export async function copyToGroup(db: Db, a: AssignmentRow, input: { groupId?: string | null; newGroup?: GroupDetails | null; dueDays?: number | null }) {
  if (a.status === 'draft') throw new Error('not_published')
  if (input.groupId) {
    if (input.groupId === a.groupId) throw new Error('same_group')
    const [g] = await db.select({ teacherId: groups.teacherId }).from(groups).where(eq(groups.id, input.groupId)).limit(1)
    if (!g || g.teacherId !== a.teacherId) throw new Error('group_not_owned')
  } else if (!input.newGroup?.name.trim()) throw new Error('group_required')
  const rows = await loadExercises(db, a.id)
  const [copy] = await db
    .insert(assignments)
    .values({
      conversationId: a.conversationId,
      teacherId: a.teacherId,
      courseId: a.courseId,
      title: a.title,
      instructions: a.instructions,
      instructionLocale: a.instructionLocale,
      contentLanguage: a.contentLanguage,
      subject: a.subject,
      cefrLevel: a.cefrLevel,
      difficulty: a.difficulty,
      estimatedMinutes: a.estimatedMinutes,
      totalPoints: a.totalPoints,
      shareSlug: newShareSlug(),
      settings: a.settings,
      generationMeta: { ...((a.generationMeta ?? {}) as Record<string, unknown>), copiedFrom: a.id },
    })
    .returning()
  if (rows.length) {
    await db.insert(exercises).values(rows.map(({ id: _id, createdAt: _c, updatedAt: _u, blockId: _b, ...r }) => ({ ...r, assignmentId: copy!.id })))
  }
  return publishAssignment(db, copy!, { groupId: input.groupId ?? null, newGroup: input.groupId ? null : input.newGroup, dueDays: input.dueDays })
}

/**
 * The teacher changes or removes a published homework's duration (DECISIONS.md BK). Who was on time is worked out on
 * every read, so results follow on their own; the "due tomorrow" reminder may go again before the new deadline.
 */
export async function setDueDays(db: Db, a: AssignmentRow, dueDays: number | null) {
  if (a.status === 'draft' || !a.publishedAt) throw new Error('not_published')
  const [row] = await db
    .update(assignments)
    .set({ dueDays: dueDays || null, dueAt: dueDays ? endOfDayAfter(a.publishedAt, dueDays) : null })
    .where(eq(assignments.id, a.id))
    .returning()
  await db.delete(notificationLog).where(sql`${notificationLog.key} like ${`due:${a.id}:%`}`)
  return row!
}

// ─── students ───────────────────────────────────────────────────────────────

/** What a student may see of an exercise — never the key or the explanation before submit. */
export function publicExercise(r: ExerciseRow) {
  return {
    id: r.id,
    kind: r.kind as ExerciseKind,
    prompt: (r.prompt as { text?: string }).text ?? '',
    payload: r.payload as Record<string, unknown>,
    points: r.points,
    audioUrl: r.audioMaterialId ? `/api/audio/${r.id}` : null,
    imageUrl: (r.payload as { imageId?: string }).imageId ? `/api/pictures/${r.id}` : null,
  }
}

export async function startAttempt(db: Db, a: AssignmentRow, studentId: string) {
  const [existing] = await db
    .select()
    .from(attempts)
    .where(and(eq(attempts.assignmentId, a.id), eq(attempts.studentId, studentId)))
    .limit(1)
  if (existing) return existing
  // Opening a homework link adds the student to its class, except a lesson of a published course (course-plans.ts)
  if (a.groupId && !(await inPublishedCourse(db, a.id))) {
    await db.insert(enrollments).values({ groupId: a.groupId, studentId }).onConflictDoNothing()
  }
  const [created] = await db
    .insert(attempts)
    .values({ assignmentId: a.id, studentId, maxScore: a.totalPoints ?? 0 })
    .onConflictDoNothing()
    .returning()
  if (created) return created
  const [raced] = await db.select().from(attempts).where(and(eq(attempts.assignmentId, a.id), eq(attempts.studentId, studentId))).limit(1)
  return raced!
}

/** Autosave one answer. Last write wins by revision (§16 offline reconciliation). */
export async function saveAnswer(
  db: Db,
  attempt: typeof attempts.$inferSelect,
  input: { exerciseId: string; value: unknown; revision: number; timeSpentSec?: number; activeSeconds?: number },
) {
  if (attempt.status !== 'in_progress') return { ok: false as const, reason: 'submitted' }
  const [ex] = await db
    .select({ id: exercises.id, kind: exercises.kind })
    .from(exercises)
    .where(and(eq(exercises.id, input.exerciseId), eq(exercises.assignmentId, attempt.assignmentId)))
    .limit(1)
  if (!ex) return { ok: false as const, reason: 'not_found' }
  // Shadowing scores are written by the server after each check (checkPronunciation), never by the browser.
  // The browser may only say "practised" (true) when there is no microphone and nothing was checked yet.
  if (ex.kind === 'shadowing' && input.value !== true) return { ok: true as const, stale: true }

  const [prev] = await db
    .select()
    .from(responses)
    .where(and(eq(responses.attemptId, attempt.id), eq(responses.exerciseId, input.exerciseId)))
    .limit(1)
  if (prev?.checkedAt) return { ok: false as const, reason: 'locked' } // feedback already shown
  if (ex.kind === 'shadowing' && prev?.value && prev.value !== true) return { ok: true as const, stale: true }
  if (prev && prev.revisionCount >= input.revision) return { ok: true as const, stale: true }
  if (prev) {
    await db
      .update(responses)
      .set({ value: input.value, revisionCount: input.revision, timeSpentSec: Math.max(prev.timeSpentSec, input.timeSpentSec ?? 0) })
      .where(eq(responses.id, prev.id))
  } else {
    const [made] = await db
      .insert(responses)
      .values({
        attemptId: attempt.id,
        exerciseId: input.exerciseId,
        value: input.value,
        firstAnswerValue: input.value,
        revisionCount: input.revision,
        timeSpentSec: input.timeSpentSec ?? 0,
      })
      .onConflictDoNothing({ target: [responses.attemptId, responses.exerciseId] })
      .returning({ id: responses.id })
    // Two saves of a new answer at the same moment (the autosave and the heartbeat): the other one made it just now,
    // so this one updates it, if it is newer and the answer isn't locked
    if (!made)
      await db
        .update(responses)
        .set({ value: input.value, revisionCount: input.revision, timeSpentSec: sql`greatest(${responses.timeSpentSec}, ${input.timeSpentSec ?? 0})` })
        .where(and(eq(responses.attemptId, attempt.id), eq(responses.exerciseId, input.exerciseId), lt(responses.revisionCount, input.revision), isNull(responses.checkedAt)))
  }
  if (input.activeSeconds !== undefined && input.activeSeconds > attempt.activeSeconds) {
    await db.update(attempts).set({ activeSeconds: Math.min(input.activeSeconds, 6 * 3600) }).where(eq(attempts.id, attempt.id))
  }
  return { ok: true as const, stale: false }
}

/**
 * Instant feedback (§9): grade one item now and lock it. Returns what the student may see:
 * correct/incorrect always; the correct answer + explanation unless the teacher chose "never".
 */
export async function checkAnswer(
  db: Db,
  attempt: typeof attempts.$inferSelect,
  a: AssignmentRow,
  input: { exerciseId: string; value: unknown; revision: number; timeSpentSec?: number },
  deps: { llm?: LlmProvider | null } = {},
) {
  const [ex] = await db
    .select()
    .from(exercises)
    .where(and(eq(exercises.id, input.exerciseId), eq(exercises.assignmentId, attempt.assignmentId)))
    .limit(1)
  if (!ex) return { ok: false as const, reason: 'not_found' }
  // An item above the student's plan (for this homework) was never shown to them
  if (!planAllows((await homeworkPlan(db, attempt.studentId, a)).plan, itemPlan(ex))) return { ok: false as const, reason: 'plan' }
  const [prev] = await db
    .select()
    .from(responses)
    .where(and(eq(responses.attemptId, attempt.id), eq(responses.exerciseId, ex.id)))
    .limit(1)
  // Already checked: return the locked result (idempotent retries from a flaky connection). Shadowing: the scores
  // the server stored, whatever the browser sends
  const value = prev?.checkedAt || (ex.kind === 'shadowing' && prev?.value) ? prev!.value : input.value
  if (!prev?.checkedAt) {
    const saved = await saveAnswer(db, attempt, input)
    if (!saved.ok) return saved
  }
  const kind = ex.kind as ExerciseKind
  const reveal = ((a.settings ?? {}) as { showAnswersAfter?: string }).showAnswersAfter !== 'never'

  // Open writing: the AI reads the sentences. If it can't right now, the answer stays saved and unlocked
  // (graded at submit, or by the teacher) — never a guessed score.
  if (isAiGraded(kind)) {
    // An essay the teacher grades by hand: saved, nothing to show until they do
    if (teacherGrades(ex)) return { ok: false as const, reason: 'teacher_grades' }
    let result: { isCorrect: boolean; fraction: number; feedback: WritingFeedback | EssayFeedback }
    const stored = kind === 'essay' ? parseEssayFeedback(prev?.aiFeedback) : parseWritingFeedback(prev?.aiFeedback)
    if (prev?.checkedAt && stored) {
      result = { isCorrect: !!prev.isCorrect, fraction: (prev.pointsAwarded ?? 0) / Math.max(1, ex.points), feedback: stored }
    } else {
      if (!deps.llm) return { ok: false as const, reason: 'ai_unavailable' }
      try {
        const g = await aiGrade(deps.llm, a, ex, value, await studentNames(db, attempt.studentId))
        await db
          .update(responses)
          .set({ isCorrect: g.isCorrect, pointsAwarded: g.points, aiFeedback: JSON.stringify(g.feedback), checkedAt: new Date() })
          .where(and(eq(responses.attemptId, attempt.id), eq(responses.exerciseId, ex.id)))
        result = g
      } catch (e) {
        console.warn('[check] writing grade failed', e)
        return { ok: false as const, reason: 'ai_unavailable' }
      }
    }
    const f = result.feedback
    return {
      ok: true as const,
      isCorrect: result.isCorrect,
      fraction: result.fraction,
      correctValue: null,
      parts: 'lines' in f ? f.lines.map((l) => l.ok) : null,
      correctText: null,
      explanation: reveal ? ex.explanation : null,
      writing: 'lines' in f ? writingForStudent(f, reveal) : null,
      essay: 'lines' in f ? null : essayForStudent(f, reveal),
    }
  }

  const g = gradeExercise(kind, ex.payload, ex.answerKey, value, gradeOptionsFor(a))
  const points = Math.round(g.fraction * ex.points * 100) / 100
  if (!prev?.checkedAt) {
    await db
      .update(responses)
      .set({ isCorrect: g.isCorrect, pointsAwarded: points, checkedAt: new Date() })
      .where(and(eq(responses.attemptId, attempt.id), eq(responses.exerciseId, ex.id)))
  }
  return {
    ok: true as const,
    isCorrect: g.isCorrect,
    fraction: g.fraction,
    correctValue: reveal ? keyAsResponse(kind, ex.answerKey) : null,
    /** gap_fill: one verdict per blank */
    parts: kind === 'gap_fill' ? gapVerdicts(ex.payload, ex.answerKey, value, gradeOptionsFor(a)) : null,
    correctText: reveal ? describeAnswer(kind, ex.payload, ex.answerKey) : null,
    explanation: reveal ? ex.explanation : null,
  }
}

/**
 * Grade everything and close the attempt. Writing answers the AI hasn't graded yet are graded now, in
 * parallel; any the AI can't grade stay pending (pointsAwarded null) and the attempt waits in "submitted"
 * until the AI or the teacher grades them (finalizeAttempt).
 */
export async function submitAttempt(db: Db, attempt: typeof attempts.$inferSelect, deps: { llm?: LlmProvider | null } = {}) {
  if (attempt.status !== 'in_progress') return attempt
  const [a] = await db.select().from(assignments).where(eq(assignments.id, attempt.assignmentId)).limit(1)
  // The student is scored on the items of their plan for this homework, as it is now
  const plan = a ? (await homeworkPlan(db, attempt.studentId, a)).plan : 'free'
  // Claim the attempt first so a double tap can't grade (and bill the AI) twice
  const [claimed] = await db
    .update(attempts)
    .set({ status: 'submitted', submittedAt: new Date(), plan })
    .where(and(eq(attempts.id, attempt.id), eq(attempts.status, 'in_progress')))
    .returning()
  if (!claimed) return attempt

  const exRows = splitByPlan(await loadExercises(db, attempt.assignmentId), plan).shown
  const resp = await db.select().from(responses).where(eq(responses.attemptId, attempt.id))
  const opts = gradeOptionsFor(a ?? { settings: {}, contentLanguage: '' })
  const names = exRows.some((e) => isAiGraded(e.kind)) ? await studentNames(db, attempt.studentId) : []
  let auto = 0
  let ai = 0

  await Promise.all(
    exRows.map(async (ex) => {
      let r = resp.find((x) => x.exerciseId === ex.id)
      if (!r) {
        ;[r] = await db.insert(responses).values({ attemptId: attempt.id, exerciseId: ex.id, value: null }).onConflictDoNothing({ target: [responses.attemptId, responses.exerciseId] }).returning()
        // A save that started before the hand-in made it a moment ago
        r ??= (await db.select().from(responses).where(and(eq(responses.attemptId, attempt.id), eq(responses.exerciseId, ex.id))).limit(1))[0]
      }
      if (isAiGraded(ex.kind)) {
        ai++
        if (r!.pointsAwarded !== null && r!.aiFeedback) return // graded at check time
        const v = r!.value
        const written = typeof v === 'string' ? !!v.trim() : Array.isArray(v) && (v as unknown[]).some((x) => typeof x === 'string' && x.trim())
        if (!written) {
          await db.update(responses).set({ isCorrect: false, pointsAwarded: 0 }).where(eq(responses.id, r!.id))
          return
        }
        if (teacherGrades(ex)) return // waits for the teacher
        if (!deps.llm || !a) return // stays pending
        try {
          const g = await aiGrade(deps.llm, a, ex, r!.value, names)
          await db.update(responses).set({ isCorrect: g.isCorrect, pointsAwarded: g.points, aiFeedback: JSON.stringify(g.feedback) }).where(eq(responses.id, r!.id))
        } catch (e) {
          console.warn('[submit] writing grade failed; left for the teacher', e)
        }
        return
      }
      auto++
      const g = gradeExercise(ex.kind as ExerciseKind, ex.payload, ex.answerKey, r!.value ?? null, opts)
      await db
        .update(responses)
        .set({ isCorrect: g.isCorrect, pointsAwarded: Math.round(g.fraction * ex.points * 100) / 100 })
        .where(eq(responses.id, r!.id))
    }),
  )
  await db.update(attempts).set({ autoGradedCount: auto, aiGradedCount: ai }).where(eq(attempts.id, attempt.id))
  return (await finalizeAttempt(db, attempt.id)) ?? attempt
}

/** What the student may see of the AI's verdicts (corrections hidden when the teacher hides answers) */
/** An essay's grade as the student sees it (corrections hidden when the teacher hides answers) */
export function essayForStudent(f: EssayFeedback, reveal: boolean) {
  return {
    criteria: f.criteria.map((c) => ({ name: c.name, score: c.score, max: c.max, feedback: c.feedback })),
    overallLabel: f.overallLabel,
    overall: f.overall,
    overallMax: f.overallMax,
    levelEstimate: f.levelEstimate,
    strengths: f.strengths,
    improvements: f.improvements,
    corrections: reveal ? f.corrections : [],
    summary: f.summary,
    length: f.length,
    byTeacher: f.gradedBy === 'teacher',
  }
}

export function writingForStudent(f: WritingFeedback, reveal: boolean) {
  return {
    lines: f.lines.map((l) => ({ ok: l.ok, feedback: l.feedback, correction: reveal && !l.ok ? l.correction : null })),
    summary: f.summary,
    byTeacher: f.gradedBy === 'teacher',
  }
}

// ─── report (§10.5) ─────────────────────────────────────────────────────────

export async function buildReport(db: Db, a: AssignmentRow) {
  const exRows = await loadExercises(db, a.id)
  const atts = await db
    .select({ attempt: attempts, name: users.fullName })
    .from(attempts)
    .innerJoin(users, eq(users.id, attempts.studentId))
    .where(eq(attempts.assignmentId, a.id))
  const resp = atts.length
    ? await db.select().from(responses).where(inArray(responses.attemptId, atts.map((x) => x.attempt.id)))
    : []

  // Enrolled students who never opened it
  let notStarted: { id: string; name: string }[] = []
  const joined = new Map<string, Date>()
  if (a.groupId) {
    const members = await db
      .select({ id: users.id, name: users.fullName, joinedAt: enrollments.joinedAt })
      .from(enrollments)
      .innerJoin(users, eq(users.id, enrollments.studentId))
      .where(and(eq(enrollments.groupId, a.groupId), eq(enrollments.status, 'active')))
    for (const m of members) joined.set(m.id, m.joinedAt)
    const started = new Set(atts.map((x) => x.attempt.studentId))
    notStarted = members.filter((m) => !started.has(m.id)).map((m) => ({ id: m.id, name: m.name ?? '—' }))
  }

  // Submitted with writing still waiting for a grade counts as done; its percent is provisional
  const graded = atts.filter((x) => x.attempt.status !== 'in_progress')
  const percents = graded.map((x) => x.attempt.percent ?? 0)
  const minutes = graded.map((x) => Math.round((x.attempt.activeSeconds ?? 0) / 60))
  const median = (xs: number[]) => {
    if (!xs.length) return null
    const s = [...xs].sort((p, q) => p - q)
    const m = Math.floor(s.length / 2)
    return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2)
  }
  const expected = Math.max(1, a.estimatedMinutes ?? 1)

  const students = atts
    .map(({ attempt, name }) => {
      const done = attempt.status !== 'in_progress'
      const engaged = Math.min(1, (attempt.activeSeconds ?? 0) / 60 / expected)
      const due = studentDue(a, joined.get(attempt.studentId) ?? attempt.startedAt)
      const onTime = !due || (attempt.submittedAt && attempt.submittedAt <= due) ? 1 : 0
      const firstTry = resp.filter((r) => r.attemptId === attempt.id)
      const firstAcc = firstTry.length ? firstTry.filter((r) => r.isCorrect).length / firstTry.length : 0
      // Engagement index (§10.5): 0.35 completion + 0.25 on-time + 0.20 engaged time + 0.20 accuracy
      const effort = Math.round(100 * (0.35 * (done ? 1 : 0.3) + 0.25 * (done ? onTime : 0) + 0.2 * engaged + 0.2 * (done ? firstAcc : 0)))
      return {
        attemptId: attempt.id,
        studentId: attempt.studentId,
        name: name ?? '—',
        status: attempt.status,
        percent: done ? (attempt.percent ?? 0) : null,
        minutes: Math.round((attempt.activeSeconds ?? 0) / 60),
        effort,
        rushed: done && (attempt.activeSeconds ?? 0) < expected * 60 * 0.25,
        /** Answers waiting for the AI or the teacher */
        pending: attempt.status === 'submitted' ? attempt.manualPendingCount : 0,
        /** The student's plan: they saw and were scored on its items only (null = all, before plans) */
        plan: isStudentPlan(attempt.plan) ? attempt.plan : null,
      }
    })
    .sort((p, q) => (q.percent ?? -1) - (p.percent ?? -1))

  const hardest = exRows
    .map((ex) => {
      const rs = resp.filter((r) => r.exerciseId === ex.id && graded.some((g) => g.attempt.id === r.attemptId))
      const wrong = rs.filter((r) => r.isCorrect === false)
      const counts = new Map<string, number>()
      for (const r of wrong) {
        const d = describeResponse(ex.kind as ExerciseKind, ex.payload, r.value)
        counts.set(d, (counts.get(d) ?? 0) + 1)
      }
      // Shadowing: the words the class kept getting wrong (e.g. "think, three"), not one student's results
      if (ex.kind === 'shadowing') {
        counts.clear()
        for (const r of wrong) {
          const v = r.value as ShadowValue | true | null
          if (v && v !== true) for (const l of v.lines) for (const w of l?.missed ?? []) counts.set(w.toLowerCase(), (counts.get(w.toLowerCase()) ?? 0) + 1)
        }
        const top = [...counts.entries()].sort((p, q) => q[1] - p[1]).slice(0, 4).map(([w]) => w)
        counts.clear()
        if (top.length) counts.set(top.join(', '), 1)
      }
      // Everyone's own sentences differ: no "common wrong answer" for writing
      const common = isAiGraded(ex.kind) ? undefined : [...counts.entries()].sort((p, q) => q[1] - p[1])[0]
      return {
        exerciseId: ex.id,
        n: ex.orderIndex + 1,
        prompt: (ex.prompt as { text?: string }).text ?? '',
        kind: ex.kind,
        wrong: wrong.length,
        total: rs.length,
        commonWrong: common && common[0] !== '—' ? common[0] : null,
      }
    })
    .filter((h) => h.wrong > 0)
    .sort((p, q) => q.wrong / Math.max(1, q.total) - p.wrong / Math.max(1, p.total))
    .slice(0, 3)

  const inProgress = atts.filter((x) => x.attempt.status === 'in_progress')
  return {
    counts: {
      opened: atts.length,
      inProgress: inProgress.length,
      submitted: graded.length,
      notStarted: notStarted.length,
      audience: atts.length + notStarted.length,
    },
    averagePercent: percents.length ? Math.round(percents.reduce((s, x) => s + x, 0) / percents.length) : null,
    medianMinutes: median(minutes),
    expectedMinutes: expected,
    top: students.filter((s) => s.percent !== null && s.percent >= 80),
    needsHelp: students.filter((s) => s.percent !== null && s.percent < 50),
    passive: [
      ...students.filter((s) => s.status === 'in_progress' || s.rushed).map((s) => ({ id: s.studentId, name: s.name })),
      ...notStarted,
    ],
    hardest,
    students,
  }
}

export type Report = Awaited<ReturnType<typeof buildReport>>

// ─── pronunciation (shadowing, read aloud) ──────────────────────────────────

/**
 * One try at one sentence: the student's voice is checked by the AI and only the result is kept on their answer
 * (best score, tries, passed, wrong words). The audio itself is never stored: it lives only in this call.
 */
export async function checkPronunciation(
  db: Db,
  attempt: typeof attempts.$inferSelect,
  a: AssignmentRow,
  input: { exerciseId: string; line: number; audio: { mimeType: string; dataBase64: string } },
  llm: LlmProvider,
) {
  if (attempt.status !== 'in_progress') return { ok: false as const, reason: 'submitted' }
  const [ex] = await db
    .select()
    .from(exercises)
    .where(and(eq(exercises.id, input.exerciseId), eq(exercises.assignmentId, attempt.assignmentId)))
    .limit(1)
  const lines = (ex?.payload as { lines?: { text: string }[] } | undefined)?.lines ?? []
  if (!ex || ex.kind !== 'shadowing' || !lines[input.line]) return { ok: false as const, reason: 'not_found' }
  if (!planAllows((await homeworkPlan(db, attempt.studentId, a)).plan, itemPlan(ex))) return { ok: false as const, reason: 'plan' }
  const [prev] = await db
    .select()
    .from(responses)
    .where(and(eq(responses.attemptId, attempt.id), eq(responses.exerciseId, ex.id)))
    .limit(1)
  if (prev?.checkedAt) return { ok: false as const, reason: 'locked' }

  const t = await assessPronunciation(llm, { audio: input.audio, text: lines[input.line]!.text, language: a.contentLanguage, locale: a.instructionLocale as InstructionLocale })
  const withTry = (value: unknown): ShadowValue => {
    const old = value && value !== true ? (value as ShadowValue) : { lines: [] }
    const next: ShadowValue = { lines: Array.from({ length: lines.length }, (_, i) => old.lines[i] ?? null) }
    next.lines[input.line] = addTry(old.lines[input.line], t)
    return next
  }
  let next = withTry(prev?.value)
  if (prev) await db.update(responses).set({ value: next }).where(eq(responses.id, prev.id))
  else {
    const [made] = await db
      .insert(responses)
      .values({ attemptId: attempt.id, exerciseId: ex.id, value: next, firstAnswerValue: next, revisionCount: 0 })
      .onConflictDoNothing({ target: [responses.attemptId, responses.exerciseId] })
      .returning({ id: responses.id })
    if (!made) {
      // Another sentence was checked at the same moment and made the answer: add this try to it
      const [now] = await db.select().from(responses).where(and(eq(responses.attemptId, attempt.id), eq(responses.exerciseId, ex.id))).limit(1)
      next = withTry(now?.value)
      if (now) await db.update(responses).set({ value: next }).where(eq(responses.id, now.id))
    }
  }
  return { ok: true as const, line: next.lines[input.line]!, score: t.score, value: next }
}

/**
 * The teacher accepts a student's typed answer as correct ("teacher accepts it", DECISIONS.md AW): it joins the
 * item's accepted answers (for one blank of a gap fill), every student's answer to that item is checked again,
 * and the scores of handed-in work follow. Answers the teacher graded by hand keep the teacher's grade.
 */
export async function acceptAnswer(db: Db, a: AssignmentRow, exerciseId: string, input: { text: string; blank: number | null }) {
  const [ex] = await db
    .select()
    .from(exercises)
    .where(and(eq(exercises.id, exerciseId), eq(exercises.assignmentId, a.id)))
    .limit(1)
  if (!ex || (ex.kind !== 'short_answer' && ex.kind !== 'gap_fill')) return { ok: false as const, reason: 'not_found' }
  const text = input.text.trim().slice(0, 300)
  if (!text) return { ok: false as const, reason: 'empty' }
  let key: Record<string, unknown>
  if (ex.kind === 'short_answer') {
    const k = keySchemas.short_answer.parse(ex.answerKey)
    key = { ...k, accepted: k.accepted.includes(text) ? k.accepted : [...k.accepted, text] }
  } else {
    const k = keySchemas.gap_fill.parse(ex.answerKey)
    if (input.blank === null || !k.blanks[input.blank]) return { ok: false as const, reason: 'not_found' }
    key = { ...k, blanks: k.blanks.map((b, i) => (i === input.blank && !b.includes(text) ? [...b, text] : b)) }
  }
  await db.update(exercises).set({ answerKey: key, teacherEdited: true }).where(eq(exercises.id, ex.id))

  // Every checked or handed-in answer to this item, graded again with the new key
  const rows = await db
    .select({ r: responses, at: attempts })
    .from(responses)
    .innerJoin(attempts, eq(attempts.id, responses.attemptId))
    .where(eq(responses.exerciseId, ex.id))
  const opts = gradeOptionsFor(a)
  let nowRight = 0
  const touched = new Set<string>()
  for (const { r, at } of rows) {
    if (r.teacherOverrode || (!r.checkedAt && at.status === 'in_progress')) continue
    const g = gradeExercise(ex.kind as ExerciseKind, ex.payload, key, r.value, opts)
    const points = Math.round(g.fraction * ex.points * 100) / 100
    if (points === r.pointsAwarded && g.isCorrect === r.isCorrect) continue
    if (g.isCorrect && !r.isCorrect) nowRight++
    await db.update(responses).set({ isCorrect: g.isCorrect, pointsAwarded: points }).where(eq(responses.id, r.id))
    if (at.status !== 'in_progress') touched.add(at.id)
  }
  for (const id of touched) await finalizeAttempt(db, id)
  return { ok: true as const, nowRight }
}
