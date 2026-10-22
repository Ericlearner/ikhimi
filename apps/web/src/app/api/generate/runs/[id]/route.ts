import { NextResponse } from 'next/server'
import { eq, generationRuns, getDb } from '@ikhimi/db'
import { HttpError, requireSession, route } from '@/server/request'

/**
 * Where a homework being made stands: the Create screen asks when its connection dropped (a locked phone, the app in
 * the background), and opens the draft once it's saved. Only the teacher who started it.
 */
export const GET = route(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const { user } = await requireSession()
  const [run] = await getDb()
    .select({ teacherId: generationRuns.teacherId, status: generationRuns.status, assignmentId: generationRuns.assignmentId, errorCode: generationRuns.errorCode })
    .from(generationRuns)
    .where(eq(generationRuns.id, (await ctx.params).id))
    .limit(1)
  if (!run || run.teacherId !== user.id) throw new HttpError(404, 'not_found')
  return NextResponse.json({ status: run.status, assignmentId: run.assignmentId, errorCode: run.errorCode })
})
