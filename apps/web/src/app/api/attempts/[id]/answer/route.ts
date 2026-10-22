import { NextResponse } from 'next/server'
import { z } from 'zod'
import { attempts, eq, getDb } from '@ikhimi/db'
import { saveAnswer } from '@/server/assignments'
import { ownAttempt } from '@/server/attempt-access'
import { requireSession, route } from '@/server/request'

const answer = z.object({
  exerciseId: z.string().max(40),
  value: z.unknown(),
  revision: z.number().int().min(1),
  timeSpentSec: z.number().int().min(0).max(36000).optional(),
})
// A batch lets an offline phone flush its whole queue in one request
const body = z.object({ answers: z.array(answer).max(100), activeSeconds: z.number().int().min(0).max(36000).optional() })

export const POST = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const { user } = await requireSession()
  const at = await ownAttempt(user, (await ctx.params).id)
  const input = body.parse(await req.json())
  const db = getDb()
  const results = []
  for (const [i, a] of input.answers.entries()) {
    const size = JSON.stringify(a.value ?? null).length
    if (size > 4000) {
      results.push({ exerciseId: a.exerciseId, ok: false })
      continue
    }
    const r = await saveAnswer(db, at, { ...a, activeSeconds: i === input.answers.length - 1 ? input.activeSeconds : undefined })
    results.push({ exerciseId: a.exerciseId, ok: r.ok })
  }
  // Heartbeat with no new answers still records engaged time
  if (!input.answers.length && input.activeSeconds !== undefined && at.status === 'in_progress' && input.activeSeconds > at.activeSeconds) {
    await db.update(attempts).set({ activeSeconds: input.activeSeconds }).where(eq(attempts.id, at.id))
  }
  return NextResponse.json({ results, status: at.status })
})
