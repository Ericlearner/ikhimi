import { NextResponse } from 'next/server'
import { courses, eq, getDb } from '@ikhimi/db'
import { courseDetailsSchema, ownedCourse, updateCourse } from '@/server/courses'
import { HttpError, requireSession, route } from '@/server/request'

type Ctx = { params: Promise<{ id: string }> }

export const PATCH = route(async (req, ctx: Ctx) => {
  const { user } = await requireSession()
  const c = await ownedCourse(getDb(), user.id, (await ctx.params).id)
  if (!c) throw new HttpError(404, 'not_found')
  await updateCourse(getDb(), c, courseDetailsSchema.partial().parse(await req.json()))
  return NextResponse.json({ ok: true })
})

export const DELETE = route(async (_req, ctx: Ctx) => {
  const { user } = await requireSession()
  const c = await ownedCourse(getDb(), user.id, (await ctx.params).id)
  if (!c) throw new HttpError(404, 'not_found')
  // Soft delete: buyers' payment records stay intact
  await getDb().update(courses).set({ deletedAt: new Date(), visibility: 'private' }).where(eq(courses.id, c.id))
  return NextResponse.json({ ok: true })
})
