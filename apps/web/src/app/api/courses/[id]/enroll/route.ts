import { NextResponse } from 'next/server'
import { courses, eq, getDb } from '@ikhimi/db'
import { canView, courseAccess, enrollFree } from '@/server/courses'
import { HttpError, requireSession, route } from '@/server/request'

/** Start a course */
export const POST = route(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const { user } = await requireSession()
  const db = getDb()
  const [c] = await db.select().from(courses).where(eq(courses.id, (await ctx.params).id)).limit(1)
  if (!c || c.deletedAt) throw new HttpError(404, 'not_found')
  const access = await courseAccess(db, c, user.id)
  if (!canView(c, access)) throw new HttpError(404, 'not_found')
  if (access === 'open') await enrollFree(db, c, user.id)
  return NextResponse.json({ ok: true })
})
