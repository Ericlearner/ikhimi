import { CONFIG, eq, exercises, type Db } from '@ikhimi/db'
import { describeAnswer, KEYED_KINDS, keysFromAnswerPages, type ExerciseKind, type InstructionLocale, type LlmProvider } from '@ikhimi/ai'
import { loadExercises, type AssignmentRow } from './assignments'
import { dropAnswerFiles, loadMaterialsForLlm } from './materials'

export type AnswerPagesResult = {
  /** How many exercises took their answers from the pages */
  found: number
  /** Where the book's answer differs from the one the exercise had (the AI's guess, or the recording's) */
  changed: { n: number; ref: string | null; before: string; after: string }[]
}

const answerText = (kind: ExerciseKind, payload: unknown, key: unknown) => {
  try {
    return describeAnswer(kind, payload, key)
  } catch {
    return ''
  }
}

/**
 * A copied homework's answers from the book's answer pages, added on the draft after copying (DECISIONS.md BM).
 * Up to CONFIG.maxAnswerPages pages are read once; an exercise the pages cover takes the book's answer, the others
 * keep theirs. The pages are removed afterwards: only the answers are kept.
 */
export async function applyAnswerPages(
  db: Db,
  llm: LlmProvider,
  a: AssignmentRow,
  input: { materialIds: string[]; pdfPages?: string | null; instructionLocale: InstructionLocale },
): Promise<AnswerPagesResult> {
  // MaterialError (too many pages, a long PDF without its pages) goes back to the teacher as it is
  const pages = (await loadMaterialsForLlm(db, a.teacherId, input.materialIds, { pdfPages: input.pdfPages, maxPages: CONFIG.maxAnswerPages })).filter((m) => m.kind === 'page')
  const all = await loadExercises(db, a.id)
  const rows = all.filter((r) => KEYED_KINDS.includes(r.kind as ExerciseKind))
  const res = await keysFromAnswerPages(llm, {
    pages,
    instructionLocale: input.instructionLocale,
    items: rows.map((r) => ({ kind: r.kind as ExerciseKind, prompt: (r.prompt as { text?: string }).text ?? '', payload: r.payload as Record<string, unknown>, audioLabel: r.audioLabel, sourceRef: r.sourceRef })),
  })

  const changed: AnswerPagesResult['changed'] = []
  let found = 0
  for (const [i, r] of rows.entries()) {
    const key = res.keys[i]
    if (!key) continue
    found++
    const before = answerText(r.kind as ExerciseKind, r.payload, r.answerKey)
    const after = answerText(r.kind as ExerciseKind, r.payload, key)
    const differs = before !== after
    if (differs) changed.push({ n: all.findIndex((x) => x.id === r.id) + 1, ref: r.sourceRef, before, after })
    await db
      .update(exercises)
      .set({
        answerKey: key,
        answerSource: 'answer_key',
        // The AI's explanation was for its own answer: a different book answer gets the book's reason
        ...(differs && res.explanations[i] && { explanation: res.explanations[i] }),
        verifyFlags: r.verifyFlags.filter((f) => f !== 'answer_ai_inferred' && f !== 'audio_answer_missing' && f !== 'solve_back_disagrees'),
      })
      .where(eq(exercises.id, r.id))
  }
  await dropAnswerFiles(db, a.teacherId, input.materialIds)
  return { found, changed }
}
