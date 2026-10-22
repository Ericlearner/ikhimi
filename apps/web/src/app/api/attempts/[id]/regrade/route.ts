import { after, NextResponse } from 'next/server'
import { assignments, attempts, eq, getDb } from '@ikhimi/db'
import { getMeteredLlm } from '@/server/llm'
import { notifyGraded } from '@/server/notify'
import { authorize } from '@/server/policy'
import { HttpError, requireSession, route } from '@/server/request'
import { regradePending } from '@/server/writing'

export const maxDuration = 60

/** Teacher: try the AI again on an attempt's ungraded writing answers. */
export const POST = route(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const { user } = await requireSession()
  const db = getDb()
  const [row] = await db
    .select({ teacherId: assignments.teacherId, status: attempts.status })
    .from(attempts)
    .innerJoin(assignments, eq(assignments.id, attempts.assignmentId))
    .where(eq(attempts.id, (await ctx.params).id))
    .limit(1)
  if (!row) throw new HttpError(404, 'not_found')
  authorize(user, 'assignment:update', { teacherId: row.teacherId })
  const r = await regradePending(db, getMeteredLlm({ userId: user.id, purpose: 'regrade', refId: (await ctx.params).id }), (await ctx.params).id)
  if (!r) throw new HttpError(409, 'not_submitted')
  const graded = r.attempt
  if (row.status === 'submitted' && graded?.status === 'graded') after(() => notifyGraded(getDb(), graded.id).catch((e) => console.warn('[notify] graded', e)))
  return NextResponse.json({ status: r.attempt?.status, percent: r.attempt?.percent, failed: r.failed })
})
