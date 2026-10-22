import { NextResponse } from 'next/server'
import { getDb } from '@ikhimi/db'
import { courseDetailsSchema, createCourse } from '@/server/courses'
import { HttpError, requireSession, route } from '@/server/request'

export const POST = route(async (req) => {
  const { user } = await requireSession()
  if (user.role !== 'teacher') throw new HttpError(403, 'forbidden')
  const c = await createCourse(getDb(), user.id, courseDetailsSchema.parse(await req.json()))
  return NextResponse.json({ id: c.id, slug: c.slug })
})
