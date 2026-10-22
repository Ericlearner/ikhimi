/**
 * Items graded by judgement rather than a key — open_writing (own sentences) and essay — on the server:
 * grade with the model (or leave for the teacher), store the verdicts, and let the teacher override.
 * The verdicts live in responses.aiFeedback as JSON, so the report, the student's result page and the
 * teacher's student page all read the same record.
 */
import { and, assignments, attempts, CONFIG, eq, exercises, responses, users, type Db } from '@ikhimi/db'
import {
  gradeEssay,
  gradeExercise,
  gradeWriting,
  isAiGraded,
  keySchemas,
  overallMax,
  overallScore,
  formatOverall,
  isStudentPlan,
  payloadSchemas,
  splitByPlan,
  textLength,
  type EssayCriterionScore,
  type ExerciseKind,
  type LlmProvider,
  type WritingVerdict,
} from '@ikhimi/ai'
import type { AssignmentRow, ExerciseRow } from './assignments'
import './chinese'

/** A writing answer counts as "right" (for streaks, per-skill accuracy) when most sentences are acceptable */
export const WRITING_PASS = 0.8
/** An essay counts as "right" at 60 % of the scale (IELTS 5.5+, Cambridge 12/20, TOPIK 30/50) */
export const ESSAY_PASS = 0.6
const passFor = (kind: string) => (kind === 'essay' ? ESSAY_PASS : kind === 'open_writing' ? WRITING_PASS : 0.999)

/** An essay the teacher chose to grade by hand: never sent to the AI */
export const teacherGrades = (ex: Pick<ExerciseRow, 'kind' | 'payload'>) => ex.kind === 'essay' && (ex.payload as { grader?: string }).grader === 'teacher'

export type EssayFeedback = {
  type: 'essay'
  criteria: EssayCriterionScore[]
  overall: number
  overallMax: number
  overallLabel: string
  levelEstimate: string
  strengths: string[]
  improvements: string[]
  corrections: { original: string; corrected: string; why: string }[]
  summary: string
  length: number
  gradedBy: 'ai' | 'teacher'
  model?: string
}

export function parseEssayFeedback(raw: string | null | undefined): EssayFeedback | null {
  if (!raw) return null
  try {
    const f = JSON.parse(raw) as EssayFeedback
    return f.type === 'essay' && Array.isArray(f.criteria) ? f : null
  } catch {
    return null
  }
}

export type WritingFeedback = {
  lines: WritingVerdict[]
  summary: string
  gradedBy: 'ai' | 'teacher'
  model?: string
}

export function parseWritingFeedback(raw: string | null | undefined): WritingFeedback | null {
  if (!raw) return null
  try {
    const f = JSON.parse(raw) as WritingFeedback
    return Array.isArray(f.lines) ? f : null
  } catch {
    return null
  }
}

export type AiGrade = { fraction: number; isCorrect: boolean; points: number; feedback: WritingFeedback | EssayFeedback }

/** Grade one open_writing or essay answer. Throws when the model is unavailable or its answer is unusable. */
export async function aiGrade(llm: LlmProvider, a: Pick<AssignmentRow, 'instructionLocale' | 'contentLanguage'>, ex: ExerciseRow, value: unknown, knownNames: string[] = []): Promise<AiGrade> {
  if (ex.kind === 'essay') {
    const p = payloadSchemas.essay.parse(ex.payload)
    const k = keySchemas.essay.parse(ex.answerKey)
    const g = await gradeEssay(llm, {
      task: (ex.prompt as { text?: string }).text ?? '',
      taskLabel: p.taskLabel,
      exam: p.exam,
      rubric: k.rubric,
      scale: p.scale,
      min: p.min,
      max: p.max,
      text: typeof value === 'string' ? value : '',
      passage: p.passage,
      instructionLocale: a.instructionLocale,
      contentLanguage: a.contentLanguage,
      knownNames,
    })
    const { usage: _u, fraction, model, ...rest } = g
    void _u
    return {
      fraction,
      isCorrect: fraction >= ESSAY_PASS,
      points: Math.round(fraction * ex.points * 100) / 100,
      feedback: { type: 'essay', ...rest, gradedBy: 'ai', model },
    }
  }
  const p = payloadSchemas.open_writing.parse(ex.payload)
  const k = keySchemas.open_writing.parse(ex.answerKey)
  const answers = Array.isArray(value) ? value.map((x) => (typeof x === 'string' ? x : '')) : []
  const g = await gradeWriting(llm, {
    task: (ex.prompt as { text?: string }).text ?? '',
    checklist: p.checklist,
    rubric: k.rubric,
    examples: k.examples,
    lines: p.lines,
    answers,
    passage: p.passage,
    instructionLocale: a.instructionLocale,
    contentLanguage: a.contentLanguage,
    knownNames,
  })
  return {
    fraction: g.fraction,
    isCorrect: g.fraction >= WRITING_PASS,
    points: Math.round(g.fraction * ex.points * 100) / 100,
    feedback: { lines: g.lines, summary: g.summary, gradedBy: 'ai', model: g.model },
  }
}

/** The student's own name is stripped before their sentences leave the server */
export async function studentNames(db: Db, studentId: string) {
  const [u] = await db.select({ name: users.fullName }).from(users).where(eq(users.id, studentId)).limit(1)
  return u?.name ? [u.name] : []
}

/** Recompute an attempt's score from its responses; it becomes "graded" once nothing is pending. */
export async function finalizeAttempt(db: Db, attemptId: string) {
  const [at] = await db.select().from(attempts).where(eq(attempts.id, attemptId)).limit(1)
  if (!at || at.status === 'in_progress') return at ?? null
  // Only the items of the student's plan count (all of them for attempts from before plans)
  const rows = splitByPlan(
    await db
      .select({ points: exercises.points, awarded: responses.pointsAwarded, kind: exercises.kind, skillTags: exercises.skillTags })
      .from(exercises)
      .leftJoin(responses, and(eq(responses.exerciseId, exercises.id), eq(responses.attemptId, attemptId)))
      .where(eq(exercises.assignmentId, at.assignmentId)),
    isStudentPlan(at.plan) ? at.plan : null,
  ).shown
  const max = rows.reduce((s, r) => s + r.points, 0)
  const score = rows.reduce((s, r) => s + (r.awarded ?? 0), 0)
  const pending = rows.filter((r) => r.awarded === null).length
  const [updated] = await db
    .update(attempts)
    .set({
      score,
      maxScore: max,
      percent: max ? Math.round((score / max) * 1000) / 10 : 0,
      manualPendingCount: pending,
      status: pending ? 'submitted' : 'graded',
      gradedAt: pending ? null : (at.gradedAt ?? new Date()),
    })
    .where(eq(attempts.id, attemptId))
    .returning()
  return updated!
}

/** Retry grading for an attempt's pending answers (teacher's "grade again", or a submit cut short). */
export async function regradePending(db: Db, llm: LlmProvider | null, attemptId: string) {
  const [at] = await db.select().from(attempts).where(eq(attempts.id, attemptId)).limit(1)
  if (!at || at.status === 'in_progress') return null
  const [a] = await db.select().from(assignments).where(eq(assignments.id, at.assignmentId)).limit(1)
  const rows = await db
    .select({ r: responses, ex: exercises })
    .from(responses)
    .innerJoin(exercises, eq(exercises.id, responses.exerciseId))
    .where(eq(responses.attemptId, attemptId))
  const names = await studentNames(db, at.studentId)
  const typo = (a?.settings as { typoTolerance?: boolean } | null)?.typoTolerance === false ? null : CONFIG.gapFillTypoToleranceMinWordLength
  let failed = 0
  await Promise.all(
    rows
      .filter(({ r }) => r.pointsAwarded === null)
      .map(async ({ r, ex }) => {
        if (!isAiGraded(ex.kind)) {
          const g = gradeExercise(ex.kind as ExerciseKind, ex.payload, ex.answerKey, r.value, { typoToleranceMinLength: typo, language: a?.contentLanguage })
          await db.update(responses).set({ isCorrect: g.isCorrect, pointsAwarded: Math.round(g.fraction * ex.points * 100) / 100 }).where(eq(responses.id, r.id))
          return
        }
        if (teacherGrades(ex)) return // waits for the teacher, not a failure
        if (!llm) return void failed++
        try {
          const g = await aiGrade(llm, a!, ex, r.value, names)
          await db.update(responses).set({ isCorrect: g.isCorrect, pointsAwarded: g.points, aiFeedback: JSON.stringify(g.feedback) }).where(eq(responses.id, r.id))
        } catch (e) {
          console.warn('[writing] regrade failed', e)
          failed++
        }
      }),
  )
  return { attempt: await finalizeAttempt(db, attemptId), failed }
}

/**
 * The teacher's word is final: set the points for one answer (any kind), optionally with a note to the
 * student. For writing, per-sentence verdicts can be flipped too.
 */
export async function overrideResponse(
  db: Db,
  responseId: string,
  input: { points: number; teacherFeedback?: string | null; lines?: boolean[]; criteria?: Record<string, number> },
) {
  const [row] = await db
    .select({ r: responses, ex: exercises })
    .from(responses)
    .innerJoin(exercises, eq(exercises.id, responses.exerciseId))
    .where(eq(responses.id, responseId))
    .limit(1)
  if (!row) return null
  let points = Math.max(0, Math.min(row.ex.points, Math.round(input.points * 100) / 100))
  let aiFeedback = row.r.aiFeedback
  // Essay: the teacher scores each criterion; the overall and the points follow from the exam's scale
  if (input.criteria && row.ex.kind === 'essay') {
    const p = payloadSchemas.essay.parse(row.ex.payload)
    const prev = parseEssayFeedback(aiFeedback)
    const scores = Object.fromEntries(p.scale.criteria.map((c) => [c.id, Math.max(0, Math.min(c.max, Math.round(input.criteria![c.id] ?? 0)))]))
    const overall = overallScore(p.scale, scores)
    const max = overallMax(p.scale)
    const f: EssayFeedback = {
      type: 'essay',
      criteria: p.scale.criteria.map((c) => ({ id: c.id, name: c.name, max: c.max, score: scores[c.id]!, feedback: prev?.criteria.find((x) => x.id === c.id)?.feedback ?? '' })),
      overall,
      overallMax: max,
      overallLabel: formatOverall(p.scale, overall),
      levelEstimate: prev?.levelEstimate ?? '',
      strengths: prev?.strengths ?? [],
      improvements: prev?.improvements ?? [],
      corrections: prev?.corrections ?? [],
      summary: prev?.summary ?? '',
      length: prev?.length ?? textLength(typeof row.r.value === 'string' ? row.r.value : '', p.scale.unit),
      gradedBy: 'teacher',
    }
    aiFeedback = JSON.stringify(f)
    points = Math.round((max ? overall / max : 0) * row.ex.points * 100) / 100
  }
  if (input.lines) {
    const f = parseWritingFeedback(aiFeedback) ?? { lines: [], summary: '', gradedBy: 'teacher' as const }
    f.lines = input.lines.map((ok, i) => ({ ...(f.lines[i] ?? { correction: '', feedback: '' }), ok }))
    f.gradedBy = 'teacher'
    aiFeedback = JSON.stringify(f)
  }
  await db
    .update(responses)
    .set({
      pointsAwarded: points,
      isCorrect: points >= row.ex.points * passFor(row.ex.kind),
      teacherOverrode: true,
      ...(input.teacherFeedback !== undefined && { teacherFeedback: input.teacherFeedback?.trim() || null }),
      aiFeedback,
    })
    .where(eq(responses.id, responseId))
  return finalizeAttempt(db, row.r.attemptId)
}
