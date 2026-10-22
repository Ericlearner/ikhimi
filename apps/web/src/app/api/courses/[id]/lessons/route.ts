import { NextResponse } from 'next/server'
import { getDb } from '@ikhimi/db'
import { addLesson, lessonSchema, ownedCourse } from '@/server/courses'
import { HttpError, requireSession, route } from '@/server/request'

export const POST = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const { user } = await requireSession()
  const c = await ownedCourse(getDb(), user.id, (await ctx.params).id)
  if (!c) throw new HttpError(404, 'not_found')
  try {
    const l = await addLesson(getDb(), c, lessonSchema.parse(await req.json()))
    return NextResponse.json({ id: l.id })
  } catch (e) {
    if (e instanceof Error && e.message === 'bad_assignment') throw new HttpError(400, 'bad_assignment')
    throw e
  }
})
