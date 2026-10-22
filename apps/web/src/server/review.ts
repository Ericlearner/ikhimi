/**
 * "Xatolar ustida ishlash": the items a student got wrong come back a few days later, the same item, never scored and
 * never seen by the teacher as a result. No AI: only auto-graded items (choices, gaps, matching, ordering, short
 * answers), checked with the homework's own answer rules. A right answer moves the item further out (3 → 7 → 21
 * days), then it's learned; a wrong one brings it back in 2 days. Only items of the student's plan, from homework
 * still live.
 */
import {
  and,
  asc,
  assignments,
  attempts,
  count,
  eq,
  exercises,
  gt,
  inArray,
  isNull,
  lte,
  ne,
  responses,
  reviewItems,
  sql,
  type Db,
} from '@ikhimi/db'
import { describeAnswer, gapVerdicts, gradeExercise, itemPlan, keyAsResponse, planAllows, type ExerciseKind } from '@ikhimi/ai'
import { gradeOptionsFor, publicExercise } from './assignments'
import { homeworkPlan, homeworkPlans } from './course-plans'

const DAY = 86400_000
/** First comes back this long after the homework was handed in */
export const FIRST_GAP_DAYS = 3
/** After a right answer at step 0, 1, 2: the next review; after the last, the item is learned */
export const RIGHT_GAPS_DAYS = [7, 21] as const
export const WRONG_GAP_DAYS = 2
/** Mistakes older than this aren't brought back the first time */
const LOOKBACK_DAYS = 60
/** Items per review session */
export const SESSION_SIZE = 10

/** Kinds a review can check on its own: a fixed key, no voice, no AI */
const REVIEW_KINDS: ExerciseKind[] = ['mcq_single', 'mcq_multi', 'true_false', 'gap_fill', 'matching', 'ordering', 'short_answer']

/**
 * Adds the student's new mistakes to their review list (once each). Cheap: one query for wrong answers not yet on the
 * list, run when they open My work or the review.
 */
export async function syncReview(db: Db, studentId: string, now = new Date()) {
  const rows = await db
    .select({ exerciseId: responses.exerciseId, submittedAt: attempts.submittedAt })
    .from(responses)
    .innerJoin(attempts, eq(attempts.id, responses.attemptId))
    .innerJoin(exercises, eq(exercises.id, responses.exerciseId))
    .innerJoin(assignments, eq(assignments.id, exercises.assignmentId))
    .leftJoin(reviewItems, and(eq(reviewItems.studentId, studentId), eq(reviewItems.exerciseId, responses.exerciseId)))
    .where(
      and(
        eq(attempts.studentId, studentId),
        ne(attempts.status, 'in_progress'),
        gt(attempts.submittedAt, new Date(now.getTime() - LOOKBACK_DAYS * DAY)),
        eq(responses.isCorrect, false),
        inArray(exercises.kind, REVIEW_KINDS),
        isNull(assignments.deletedAt),
        isNull(reviewItems.id),
      ),
    )
    .limit(200)
  if (!rows.length) return 0
  await db
    .insert(reviewItems)
    .values(rows.map((r) => ({ studentId, exerciseId: r.exerciseId, dueAt: new Date((r.submittedAt ?? now).getTime() + FIRST_GAP_DAYS * DAY) })))
    .onConflictDoNothing()
  return rows.length
}

/** Due items whose homework still exists, oldest first, with what decides the plan they need */
async function dueRows(db: Db, studentId: string, now: Date) {
  return db
    .select({ id: reviewItems.id, kind: exercises.kind, skillTags: exercises.skillTags, assignmentId: assignments.id, groupId: assignments.groupId })
    .from(reviewItems)
    .innerJoin(exercises, eq(exercises.id, reviewItems.exerciseId))
    .innerJoin(assignments, eq(assignments.id, exercises.assignmentId))
    .where(and(eq(reviewItems.studentId, studentId), isNull(reviewItems.doneAt), lte(reviewItems.dueAt, now), isNull(assignments.deletedAt)))
    .orderBy(asc(reviewItems.dueAt))
}

/** The plan for each due item's homework (a paid course's homework is the course's to give: course-plans.ts) */
const rowPlans = (db: Db, studentId: string, rows: { assignmentId: string; groupId: string | null }[]) =>
  homeworkPlans(db, studentId, [...new Map(rows.map((r) => [r.assignmentId, { id: r.assignmentId, groupId: r.groupId }])).values()])

/**
 * What's on the list: due now (only what the student can open: its homework exists and their plan covers it, the
 * same rule as the review itself, so "33" never opens an empty review), how many more wait for a better plan, when
 * the next one comes, and how many are learned.
 */
export async function reviewSummary(db: Db, studentId: string, now = new Date()) {
  const rows = await dueRows(db, studentId, now)
  const plans = await rowPlans(db, studentId, rows)
  const locked = { pro: 0, vip: 0 }
  let due = 0
  for (const r of rows) {
    const need = itemPlan(r)
    if (planAllows(plans.get(r.assignmentId)!.plan, need)) due++
    else if (need === 'pro' || need === 'vip') locked[need]++
  }
  const [next] = await db
    .select({ at: sql<Date | null>`min(${reviewItems.dueAt})`.mapWith((v) => (v ? new Date(v) : null)) })
    .from(reviewItems)
    .where(and(eq(reviewItems.studentId, studentId), isNull(reviewItems.doneAt), gt(reviewItems.dueAt, now)))
  const [learned] = await db
    .select({ n: count() })
    .from(reviewItems)
    .where(and(eq(reviewItems.studentId, studentId), sql`${reviewItems.doneAt} is not null`))
  return { due, locked, next: next?.at ?? null, learned: learned?.n ?? 0 }
}

/** The items due now that the student's plan opens, oldest first, as the student sees them (no key) */
export async function dueReview(db: Db, studentId: string, now = new Date(), limit = SESSION_SIZE) {
  const due = await dueRows(db, studentId, now)
  const plans = await rowPlans(db, studentId, due)
  // The plan decides first, then the session size: the oldest few being locked must not leave the session empty
  const open = due.filter((r) => planAllows(plans.get(r.assignmentId)!.plan, itemPlan(r))).slice(0, limit)
  if (!open.length) return []
  const rows = await db
    .select({ item: reviewItems, ex: exercises, title: assignments.title })
    .from(reviewItems)
    .innerJoin(exercises, eq(exercises.id, reviewItems.exerciseId))
    .innerJoin(assignments, eq(assignments.id, exercises.assignmentId))
    .where(inArray(reviewItems.id, open.map((r) => r.id)))
    .orderBy(asc(reviewItems.dueAt))
  return rows.map((r) => ({ itemId: r.item.id, homework: r.title, ex: publicExercise(r.ex) }))
}

/** One answer in the review: checked like the homework, and the item moves on its schedule */
export async function answerReview(db: Db, studentId: string, itemId: string, value: unknown, now = new Date()) {
  const [row] = await db
    .select({ item: reviewItems, ex: exercises, a: assignments })
    .from(reviewItems)
    .innerJoin(exercises, eq(exercises.id, reviewItems.exerciseId))
    .innerJoin(assignments, eq(assignments.id, exercises.assignmentId))
    .where(and(eq(reviewItems.id, itemId), eq(reviewItems.studentId, studentId)))
    .limit(1)
  if (!row || row.a.deletedAt) return { ok: false as const, reason: 'not_found' }
  if (row.item.doneAt || row.item.dueAt > now) return { ok: false as const, reason: 'not_due' }
  if (!planAllows((await homeworkPlan(db, studentId, row.a)).plan, itemPlan(row.ex))) return { ok: false as const, reason: 'plan' }

  const kind = row.ex.kind as ExerciseKind
  const opts = gradeOptionsFor(row.a)
  const g = gradeExercise(kind, row.ex.payload, row.ex.answerKey, value, opts)
  const step = g.isCorrect ? row.item.step + 1 : 0
  const learned = g.isCorrect && row.item.step >= RIGHT_GAPS_DAYS.length
  await db
    .update(reviewItems)
    .set({
      step: learned ? row.item.step : step,
      lastRight: g.isCorrect,
      dueAt: new Date(now.getTime() + (g.isCorrect ? (RIGHT_GAPS_DAYS[row.item.step] ?? 0) : WRONG_GAP_DAYS) * DAY),
      doneAt: learned ? now : null,
    })
    .where(eq(reviewItems.id, itemId))

  // The answer is shown as the homework would: not when the teacher chose to keep answers hidden
  const reveal = ((row.a.settings ?? {}) as { showAnswersAfter?: string }).showAnswersAfter !== 'never'
  return {
    ok: true as const,
    isCorrect: g.isCorrect,
    learned,
    correctValue: reveal ? keyAsResponse(kind, row.ex.answerKey) : null,
    parts: kind === 'gap_fill' ? gapVerdicts(row.ex.payload, row.ex.answerKey, value, opts) : null,
    correctText: reveal ? describeAnswer(kind, row.ex.payload, row.ex.answerKey) : null,
    explanation: reveal ? row.ex.explanation : null,
  }
}
