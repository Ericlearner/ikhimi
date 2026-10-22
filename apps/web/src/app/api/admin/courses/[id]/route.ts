import { after, NextResponse } from 'next/server'
import { z } from 'zod'
import { courses, eq, getDb } from '@ikhimi/db'
import { apiStaff } from '@/server/admin/guard'
import { audit } from '@/server/admin/staff'
import { reviewCourse } from '@/server/courses'
import { notifyCourseReview } from '@/server/notify'
import { HttpError, route } from '@/server/request'

const body = z.object({ decision: z.enum(['approve', 'return']), note: z.string().max(2000).nullable().optional() })

/** The admin approves a course (it opens to everyone it's meant for) or returns it with a note (DECISIONS.md BL) */
export const POST = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const db = getDb()
  const { session } = await apiStaff(db, 'content')
  const { decision, note } = body.parse(await req.json())
  const [c] = await db.select().from(courses).where(eq(courses.id, (await ctx.params).id)).limit(1)
  if (!c || c.deletedAt) throw new HttpError(404, 'not_found')
  const row = await reviewCourse(db, c, session.user.id, decision, note ?? null)
  await audit(db, session.user.id, decision === 'approve' ? 'course.approve' : 'course.return', { type: 'course', id: c.id }, { note: note ?? null })
  after(() => notifyCourseReview(getDb(), { teacherId: c.teacherId, courseId: c.id, title: c.title, decision, note: row.reviewNote }).catch((e) => console.warn('[notify] course review', e)))
  return NextResponse.json({ ok: true, reviewStatus: row.reviewStatus })
})
