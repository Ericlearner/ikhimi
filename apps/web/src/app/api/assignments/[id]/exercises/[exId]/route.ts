import { NextResponse } from 'next/server'
import { z } from 'zod'
import { eq, exercises, getDb } from '@ikhimi/db'
import { countBlanks, isAiGraded, keySchemas, payloadSchemas, type ExerciseKind } from '@ikhimi/ai'
import { recomputeTotals } from '@/server/assignments'
import { editableExercise } from '@/server/assignment-access'
import { HttpError, requireSession, route } from '@/server/request'

type Ctx = { params: Promise<{ id: string; exId: string }> }

const body = z.object({
  prompt: z.string().max(2000),
  payload: z.record(z.string(), z.unknown()),
  answerKey: z.record(z.string(), z.unknown()),
})

/** ✎ Teacher edits an item. Payload/key are re-validated against the kind's schema. */
export const PATCH = route(async (req, ctx: Ctx) => {
  const { user } = await requireSession()
  const { id, exId } = await ctx.params
  const { ex } = await editableExercise(user, id, exId)
  const input = body.parse(await req.json())
  const kind = ex.kind as ExerciseKind
  const payload = payloadSchemas[kind].parse(input.payload) as Record<string, unknown>
  const key = keySchemas[kind].parse(input.answerKey) as Record<string, unknown>

  // Cross-field consistency the per-field schemas can't express
  const opts = (payload as { options?: string[] }).options
  if (opts && kind === 'mcq_single' && (key as { correct: number }).correct >= opts.length) throw new HttpError(400, 'bad_key')
  if (opts && kind === 'mcq_multi' && (key as { correct: number[] }).correct.some((i) => i >= opts.length)) throw new HttpError(400, 'bad_key')
  if (kind === 'gap_fill' && countBlanks((payload as { text: string }).text) !== (key as { blanks: unknown[] }).blanks.length) {
    throw new HttpError(400, 'bad_key')
  }

  // The teacher's edit settles every warning except a missing recording
  const points =
    kind === 'gap_fill'
      ? countBlanks((payload as { text: string }).text)
      : kind === 'open_writing'
        ? Math.min(10, (payload as { lines: number }).lines)
        : ex.points
  // An essay the teacher will grade by hand is "manual"; the other judged kinds are the AI's
  const gradingMode = kind === 'essay' && (payload as { grader?: string }).grader === 'teacher' ? 'manual' : isAiGraded(kind) ? 'ai' : 'auto'
  await getDb()
    .update(exercises)
    .set({ prompt: { text: input.prompt.trim() }, payload, answerKey: key, points, gradingMode, teacherEdited: true, rationale: null, verifyFlags: ex.audioLabel && !ex.audioMaterialId ? ['needs_audio'] : [] })
    .where(eq(exercises.id, ex.id))
  await recomputeTotals(getDb(), ex.assignmentId)
  return NextResponse.json({ ok: true })
})

/** ✕ Delete an item. */
export const DELETE = route(async (_req, ctx: Ctx) => {
  const { user } = await requireSession()
  const { id, exId } = await ctx.params
  const { ex } = await editableExercise(user, id, exId)
  await getDb().delete(exercises).where(eq(exercises.id, ex.id))
  await recomputeTotals(getDb(), ex.assignmentId)
  return NextResponse.json({ ok: true })
})
