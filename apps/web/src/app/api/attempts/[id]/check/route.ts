import { NextResponse } from 'next/server'
import { z } from 'zod'
import { assignments, eq, getDb } from '@ikhimi/db'
import { checkAnswer } from '@/server/assignments'
import { ownAttempt } from '@/server/attempt-access'
import { getMeteredLlm } from '@/server/llm'
import { HttpError, requireSession, route } from '@/server/request'

const body = z.object({
  exerciseId: z.string().max(40),
  value: z.unknown(),
  revision: z.number().int().min(1),
  timeSpentSec: z.number().int().min(0).max(36000).optional(),
})

// Writing answers are read by the AI (a few seconds)
export const maxDuration = 60

/** Instant feedback for one item (design spec §9). */
export const POST = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const { user } = await requireSession()
  const at = await ownAttempt(user, (await ctx.params).id)
  if (at.status !== 'in_progress') throw new HttpError(409, 'submitted')
  const input = body.parse(await req.json())
  if (JSON.stringify(input.value ?? null).length > 4000) throw new HttpError(413, 'too_large')
  const [a] = await getDb().select().from(assignments).where(eq(assignments.id, at.assignmentId)).limit(1)
  const r = await checkAnswer(getDb(), at, a!, input, { llm: getMeteredLlm({ userId: user.id, purpose: 'check', refId: at.id }) })
  // ai_unavailable: the answer is saved; the player tells the student it will be graded later
  if (!r.ok) throw new HttpError(r.reason === 'not_found' ? 404 : r.reason === 'plan' ? 403 : r.reason === 'ai_unavailable' ? 503 : 409, r.reason)
  return NextResponse.json(r)
})
