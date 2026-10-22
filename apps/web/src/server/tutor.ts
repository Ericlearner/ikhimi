/**
 * The AI tutor in homework (the student's VIP plan, DECISIONS.md AU/AV). After a wrong answer the student gets a personal explanation of
 * their mistake; then buttons, no typing: "I don't get it", "another example", "let me practise" (CONFIG.tutorNotesPerAnswer
 * replies in all). Replies are kept on the response, so a reload costs nothing. A practice item is checked here with the
 * homework's own answer rules and never scored; its answer leaves the server only after the student has tried.
 */
import { and, CONFIG, eq, exercises, responses, type Db } from '@ikhimi/db'
import {
  describeAnswer,
  describeResponse,
  explainMistake,
  gapVerdicts,
  PLAN_FEATURES,
  planAllows,
  TUTOR_KINDS,
  type ExerciseKind,
  type InstructionLocale,
  publicTutorNotes,
  textMatches,
  type LlmProvider,
  type PublicTutorNote,
  type TutorMode,
} from '@ikhimi/ai'
import { gradeOptionsFor, type AssignmentRow, type ExerciseRow } from './assignments'
import { homeworkPlan } from './course-plans'
import { studentNames } from './writing'

export const tutorKind = (kind: string) => TUTOR_KINDS.includes(kind as ExerciseKind)

/** The item as the student saw it, as plain text for the tutor */
function itemText(ex: ExerciseRow): string {
  const p = ex.payload as { passage?: string; options?: string[]; text?: string; left?: string[]; right?: string[]; items?: string[] }
  return [
    p.passage ? `Text:\n${p.passage}` : '',
    (ex.prompt as { text?: string }).text ?? '',
    p.text ?? '',
    p.options ? `Options: ${p.options.join(' | ')}` : '',
    p.left && p.right ? `Match: ${p.left.join(' | ')}  WITH  ${p.right.join(' | ')}` : '',
    p.items ? `Put in order: ${p.items.join(' | ')}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

/** What the student answered; for a gap fill, each blank with whether it was right */
function studentAnswer(ex: ExerciseRow, a: AssignmentRow, value: unknown): string {
  const kind = ex.kind as ExerciseKind
  if (kind !== 'gap_fill') return describeResponse(kind, ex.payload, value)
  const parts = gapVerdicts(ex.payload, ex.answerKey, value, gradeOptionsFor(a)) ?? []
  const vals = Array.isArray(value) ? (value as unknown[]) : []
  return vals.map((v, i) => `blank ${i + 1}: "${String(v ?? '')}" ${parts[i] ? '(right)' : '(wrong)'}`).join('; ')
}

export type TutorResult =
  | { ok: true; notes: PublicTutorNote[] }
  | { ok: false; reason: 'not_found' | 'not_wrong' | 'no_more' | 'not_vip' | 'not_practice' }

type Attempt = { id: string; studentId: string }

/** The exercise and the student's checked, wrong response to it, or why the tutor may not help */
async function wrongAnswer(db: Db, attempt: Attempt, a: AssignmentRow, exerciseId: string) {
  // The tutor is a VIP feature, on this homework's plan (a bought course gives VIP for its homework)
  if (!planAllows((await homeworkPlan(db, attempt.studentId, a)).plan, PLAN_FEATURES.tutor)) return { ok: false as const, reason: 'not_vip' as const }
  const [ex] = await db
    .select()
    .from(exercises)
    .where(and(eq(exercises.id, exerciseId), eq(exercises.assignmentId, a.id)))
    .limit(1)
  if (!ex || !tutorKind(ex.kind)) return { ok: false as const, reason: 'not_found' as const }
  const [r] = await db
    .select()
    .from(responses)
    .where(and(eq(responses.attemptId, attempt.id), eq(responses.exerciseId, ex.id)))
    .limit(1)
  if (!r?.checkedAt || r.isCorrect !== false) return { ok: false as const, reason: 'not_wrong' as const }
  return { ok: true as const, ex, r }
}

/**
 * The tutor's replies to one checked, wrong answer. No `mode`: the first explanation (or what is already there).
 * A `mode`: the student pressed a button (up to CONFIG.tutorNotesPerAnswer replies in all). Throws when the AI
 * fails, leaving what was there.
 */
export async function tutorNotes(
  db: Db,
  attempt: Attempt,
  a: AssignmentRow,
  input: { exerciseId: string; mode?: Exclude<TutorMode, 'explain'> },
  llm: LlmProvider,
): Promise<TutorResult> {
  const w = await wrongAnswer(db, attempt, a, input.exerciseId)
  if (!w.ok) return w
  const { ex, r } = w
  const notes = r.tutor ?? []
  if (notes.length && !input.mode) return { ok: true, notes: publicTutorNotes(notes) }
  if (notes.length >= CONFIG.tutorNotesPerAnswer) return { ok: false, reason: 'no_more' }

  const kind = ex.kind as ExerciseKind
  const note = await explainMistake(llm, {
    kind,
    item: itemText(ex),
    studentAnswer: studentAnswer(ex, a, r.value),
    correctAnswer: describeAnswer(kind, ex.payload, ex.answerKey),
    reveal: ((a.settings ?? {}) as { showAnswersAfter?: string }).showAnswersAfter !== 'never',
    teacherNote: ex.explanation ?? '',
    heard: !!ex.audioMaterialId,
    picture: !!(ex.payload as { imageId?: string }).imageId,
    locale: a.instructionLocale as InstructionLocale,
    language: a.contentLanguage,
    level: a.cefrLevel,
    mode: notes.length ? input.mode : 'explain',
    previous: notes,
    knownNames: await studentNames(db, attempt.studentId),
  })
  const next = [...notes, { text: note.text, example: note.example, mode: note.mode, ...(note.practice && { practice: note.practice }) }]
  await db.update(responses).set({ tutor: next }).where(eq(responses.id, r.id))
  return { ok: true, notes: publicTutorNotes(next) }
}

/**
 * The student's answer to the tutor's practice item `index`: an option's index, or what they wrote in the blank.
 * One try: answered once, it keeps its result (the answer and why are shown, and the student moves on). Never scored.
 */
export async function checkPractice(
  db: Db,
  attempt: Attempt,
  a: AssignmentRow,
  input: { exerciseId: string; index: number; value: number | string },
): Promise<TutorResult> {
  const w = await wrongAnswer(db, attempt, a, input.exerciseId)
  if (!w.ok) return w
  const notes = w.r.tutor ?? []
  const p = notes[input.index]?.practice
  if (!p) return { ok: false, reason: 'not_practice' }
  if (p.given !== undefined) return { ok: true, notes: publicTutorNotes(notes) }
  let given: string
  let right: boolean
  if (p.options) {
    const i = Number(input.value)
    if (!Number.isInteger(i) || !p.options[i]) return { ok: false, reason: 'not_practice' }
    given = p.options[i]!
    right = given === p.answers[0]
  } else {
    given = String(input.value).trim().slice(0, 200)
    if (!given) return { ok: false, reason: 'not_practice' }
    right = textMatches(given, p.answers, false, gradeOptionsFor(a))
  }
  const next = notes.map((n, i) => (i === input.index ? { ...n, practice: { ...p, given, right } } : n))
  await db.update(responses).set({ tutor: next }).where(eq(responses.id, w.r.id))
  return { ok: true, notes: publicTutorNotes(next) }
}
