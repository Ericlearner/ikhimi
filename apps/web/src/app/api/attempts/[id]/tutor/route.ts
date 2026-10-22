import { NextResponse } from 'next/server'
import { z } from 'zod'
import { assignments, eq, getDb } from '@ikhimi/db'
import { ownAttempt } from '@/server/attempt-access'
import { getMeteredLlm } from '@/server/llm'
import { HttpError, requireSession, route } from '@/server/request'
import { checkPractice, tutorNotes } from '@/server/tutor'

const body = z.object({
  exerciseId: z.string().max(40),
  /** A button the student pressed; none for the first explanation */
  mode: z.enum(['simpler', 'example', 'practice']).optional(),
  /** The student's answer to the tutor's practice item at `index` (no AI call) */
  practice: z.object({ index: z.number().int().min(0).max(20), value: z.union([z.number().int(), z.string().max(200)]) }).optional(),
})

export const maxDuration = 30

/** The AI tutor on one wrong answer (VIP): its replies, a button the student pressed, or their practice answer. */
export const POST = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const { user } = await requireSession()
  const at = await ownAttempt(user, (await ctx.params).id)
  const input = body.parse(await req.json())
  if (input.practice) {
    const [a] = await getDb().select().from(assignments).where(eq(assignments.id, at.assignmentId)).limit(1)
    const r = await checkPractice(getDb(), at, a!, { exerciseId: input.exerciseId, ...input.practice })
    if (!r.ok) throw new HttpError(r.reason === 'not_vip' ? 403 : r.reason === 'not_found' ? 404 : 409, r.reason)
    return NextResponse.json(r)
  }
  const llm = getMeteredLlm({ userId: user.id, purpose: 'tutor', refId: at.id })
  if (!llm) throw new HttpError(503, 'ai_not_configured')
  const [a] = await getDb().select().from(assignments).where(eq(assignments.id, at.assignmentId)).limit(1)
  try {
    const r = await tutorNotes(getDb(), at, a!, { exerciseId: input.exerciseId, mode: input.mode }, llm)
    if (!r.ok) throw new HttpError(r.reason === 'not_vip' ? 403 : r.reason === 'not_found' ? 404 : 409, r.reason)
    return NextResponse.json(r)
  } catch (e) {
    if (e instanceof HttpError) throw e
    console.warn('[tutor] explanation failed', e)
    throw new HttpError(503, 'ai_busy')
  }
})
