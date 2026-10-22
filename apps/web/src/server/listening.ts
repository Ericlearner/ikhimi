import { and, eq, exercises, isNull, materials, type Db } from '@ikhimi/db'
import { audioNameMatches, completeListening, type ExerciseKind, type InstructionLocale, type LlmProvider } from '@ikhimi/ai'
import { loadExercises, type AssignmentRow } from './assignments'
import { loadMaterialsForLlm } from './materials'

export type AttachAudioResult =
  | { ok: true; exerciseIds: string[] }
  /** The file name doesn't point at any waiting exercise: the teacher must choose */
  | { ok: false; code: 'no_match'; waiting: { id: string; label: string | null; sourceRef: string | null }[] }
  /** The model listened and the recording isn't for these exercises (the teacher may attach it anyway) */
  | { ok: false; code: 'mismatch'; reason: string; exerciseIds: string[] }
  | { ok: false; code: 'not_audio' }

/**
 * Attach a teacher's recording to listening exercises. Without explicit ids, the file name picks the
 * exercises (same book label, e.g. "Track 1.12.mp3" → every item labelled "Track 1.12"). The model then
 * confirms the recording fits and writes the answer keys from what is said; an answer from the book's answer
 * pages stays as it is (DECISIONS.md BM). The model listens once, to this file only: it never searches through
 * recordings to find the right one.
 * `force`: the teacher attaches it although the model said it doesn't fit (the model can be wrong too). Nothing
 * is listened to then; answers the AI worked out itself are marked for checking.
 */
export async function attachAudio(
  db: Db,
  llm: LlmProvider | null,
  a: AssignmentRow,
  input: { materialId: string; exerciseIds?: string[]; instructionLocale: InstructionLocale; force?: boolean },
): Promise<AttachAudioResult> {
  const [audio] = await loadMaterialsForLlm(db, a.teacherId, [input.materialId])
  if (!audio || audio.kind !== 'audio') return { ok: false, code: 'not_audio' }

  const rows = await loadExercises(db, a.id)
  const listening = rows.filter((r) => r.audioLabel)
  let targets = input.exerciseIds?.length
    ? listening.filter((r) => input.exerciseIds!.includes(r.id))
    : listening.filter((r) => !r.audioMaterialId && audioNameMatches(audio.label, r.audioLabel, r.sourceRef))
  // Everything sharing a matched label goes together (one recording, several items)
  const labels = new Set(targets.map((r) => r.audioLabel))
  targets = listening.filter((r) => targets.includes(r) || (!input.exerciseIds?.length && !r.audioMaterialId && labels.has(r.audioLabel)))
  if (!targets.length) {
    return {
      ok: false,
      code: 'no_match',
      waiting: listening.filter((r) => !r.audioMaterialId).map((r) => ({ id: r.id, label: r.audioLabel, sourceRef: r.sourceRef })),
    }
  }

  if (input.force) {
    if (!input.exerciseIds?.length) return { ok: false, code: 'no_match', waiting: [] }
    for (const r of targets) {
      const flags = r.verifyFlags.filter((f) => f !== 'needs_audio' && f !== 'audio_answer_missing')
      await db
        .update(exercises)
        .set({ audioMaterialId: audio.id, verifyFlags: r.answerSource === 'answer_key' || flags.includes('answer_ai_inferred') ? flags : [...flags, 'answer_ai_inferred'] })
        .where(eq(exercises.id, r.id))
    }
    return { ok: true, exerciseIds: targets.map((r) => r.id) }
  }
  if (!llm) throw new Error('attachAudio: no model')
  const res = await completeListening(llm, {
    audio,
    instructionLocale: input.instructionLocale,
    items: targets.map((r) => ({
      kind: r.kind as ExerciseKind,
      prompt: (r.prompt as { text?: string }).text ?? '',
      payload: r.payload as Record<string, unknown>,
      audioLabel: r.audioLabel,
      sourceRef: r.sourceRef,
    })),
  })
  if (!res.matches) return { ok: false, code: 'mismatch', reason: res.reason, exerciseIds: targets.map((r) => r.id) }

  for (const [i, r] of targets.entries()) {
    const flags = r.verifyFlags.filter((f) => f !== 'needs_audio' && f !== 'audio_answer_missing')
    // The book's own answer stays; the recording only confirmed it's the right track
    if (r.answerSource === 'answer_key') {
      await db.update(exercises).set({ audioMaterialId: audio.id, verifyFlags: flags }).where(eq(exercises.id, r.id))
      continue
    }
    const key = res.keys[i]
    await db
      .update(exercises)
      .set({
        audioMaterialId: audio.id,
        ...(key && { answerKey: key, answerSource: 'audio' as const }),
        ...(res.explanations[i] && { explanation: res.explanations[i] }),
        // Couldn't read an answer for this item from the recording: the teacher fills it in
        verifyFlags: key ? flags.filter((f) => f !== 'answer_ai_inferred') : [...flags, 'audio_answer_missing'],
      })
      .where(eq(exercises.id, r.id))
  }
  return { ok: true, exerciseIds: targets.map((r) => r.id) }
}

/** Remove a recording from exercises (they go back to "needs audio"). */
export async function detachAudio(db: Db, a: AssignmentRow, exerciseId: string) {
  const [r] = await db.select().from(exercises).where(and(eq(exercises.id, exerciseId), eq(exercises.assignmentId, a.id))).limit(1)
  if (!r?.audioMaterialId) return
  await db
    .update(exercises)
    .set({ audioMaterialId: null, verifyFlags: [...new Set([...r.verifyFlags, 'needs_audio'])] })
    .where(and(eq(exercises.assignmentId, a.id), eq(exercises.audioMaterialId, r.audioMaterialId)))
}

/** For the audio stream route: the material behind an exercise's recording, if any. */
export async function exerciseAudio(db: Db, exerciseId: string) {
  const [row] = await db
    .select({ ex: exercises, m: materials })
    .from(exercises)
    .innerJoin(materials, eq(materials.id, exercises.audioMaterialId))
    .where(and(eq(exercises.id, exerciseId), isNull(materials.deletedAt)))
    .limit(1)
  return row ?? null
}
