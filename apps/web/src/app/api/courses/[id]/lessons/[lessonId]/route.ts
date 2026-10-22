import { NextResponse } from 'next/server'
import { getDb } from '@ikhimi/db'
import { deleteLesson, lessonSchema, ownedCourse, updateLesson } from '@/server/courses'
import { HttpError, requireSession, route } from '@/server/request'

type Ctx = { params: Promise<{ id: string; lessonId: string }> }

export const PATCH = route(async (req, ctx: Ctx) => {
  const { user } = await requireSession()
  const { id, lessonId } = await ctx.params
  const c = await ownedCourse(getDb(), user.id, id)
  if (!c) throw new HttpError(404, 'not_found')
  try {
    const l = await updateLesson(getDb(), c, lessonId, lessonSchema.partial().parse(await req.json()))
    if (!l) throw new HttpError(404, 'not_found')
    return NextResponse.json({ ok: true })
  } catch (e) {
    if (e instanceof Error && e.message === 'bad_assignment') throw new HttpError(400, 'bad_assignment')
    throw e
  }
})

export const DELETE = route(async (_req, ctx: Ctx) => {
  const { user } = await requireSession()
  const { id, lessonId } = await ctx.params
  const c = await ownedCourse(getDb(), user.id, id)
  if (!c) throw new HttpError(404, 'not_found')
  await deleteLesson(getDb(), c, lessonId)
  return NextResponse.json({ ok: true })
})
