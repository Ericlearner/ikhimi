import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb } from '@ikhimi/db'
import { ownedCourse, setCourseGroups } from '@/server/courses'
import { HttpError, requireSession, route } from '@/server/request'

/** Linked groups' students get the course free. */
export const PUT = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const { user } = await requireSession()
  const c = await ownedCourse(getDb(), user.id, (await ctx.params).id)
  if (!c) throw new HttpError(404, 'not_found')
  const { groupIds } = z.object({ groupIds: z.array(z.string().max(40)).max(50) }).parse(await req.json())
  await setCourseGroups(getDb(), c, groupIds)
  return NextResponse.json({ ok: true })
})
