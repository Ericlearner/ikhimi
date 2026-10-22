import { after, NextResponse } from 'next/server'
import { z } from 'zod'
import { assignments, attempts, eq, getDb, responses } from '@ikhimi/db'
import { notifyGraded } from '@/server/notify'
import { authorize } from '@/server/policy'
import { HttpError, requireSession, route } from '@/server/request'
import { overrideResponse } from '@/server/writing'

const body = z.object({
  points: z.number().min(0).max(1000),
  teacherFeedback: z.string().max(1000).nullable().optional(),
  /** Writing: the teacher's verdict per sentence */
  lines: z.array(z.boolean()).max(20).optional(),
  /** Essay: the teacher's score per criterion (points then follow from the exam's scale) */
  criteria: z.record(z.string().max(40), z.number().min(0).max(100)).optional(),
})

/** Teacher: set the grade for one answer (overrides the AI or the auto-grader). */
export const PATCH = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const { user } = await requireSession()
  const id = (await ctx.params).id
  const db = getDb()
  const [row] = await db
    .select({ teacherId: assignments.teacherId, status: attempts.status })
    .from(responses)
    .innerJoin(attempts, eq(attempts.id, responses.attemptId))
    .innerJoin(assignments, eq(assignments.id, attempts.assignmentId))
    .where(eq(responses.id, id))
    .limit(1)
  if (!row) throw new HttpError(404, 'not_found')
  authorize(user, 'assignment:update', { teacherId: row.teacherId })
  if (row.status === 'in_progress') throw new HttpError(409, 'not_submitted')
  const at = await overrideResponse(db, id, body.parse(await req.json()))
  // The last answer that was waiting is graded: the student hears their result in the iOS app
  if (row.status === 'submitted' && at?.status === 'graded') after(() => notifyGraded(getDb(), at.id).catch((e) => console.warn('[notify] graded', e)))
  return NextResponse.json({ status: at?.status, percent: at?.percent })
})
