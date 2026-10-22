import { NextResponse } from 'next/server'
import { and, assignments, eq, getDb } from '@ikhimi/db'
import { startAttempt } from '@/server/assignments'
import { HttpError, requireSession, route } from '@/server/request'

/** Viewing needs only the link; starting needs a signed-in user (§16 capability URL). */
export const POST = route(async (_req, ctx: { params: Promise<{ slug: string }> }) => {
  const { user } = await requireSession()
  const { slug } = await ctx.params
  const [a] = await getDb()
    .select()
    .from(assignments)
    .where(and(eq(assignments.shareSlug, slug), eq(assignments.status, 'published')))
    .limit(1)
  if (!a) throw new HttpError(404, 'not_found')
  if (a.teacherId === user.id) throw new HttpError(409, 'own_assignment')
  if (!user.roles.includes('student')) throw new HttpError(403, 'not_student')
  const at = await startAttempt(getDb(), a, user.id)
  return NextResponse.json({ attemptId: at.id, status: at.status })
})
