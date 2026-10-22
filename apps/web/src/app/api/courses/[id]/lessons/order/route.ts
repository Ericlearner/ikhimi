import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb } from '@ikhimi/db'
import { ownedCourse, reorderLessons } from '@/server/courses'
import { HttpError, requireSession, route } from '@/server/request'

export const POST = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const { user } = await requireSession()
  const c = await ownedCourse(getDb(), user.id, (await ctx.params).id)
  if (!c) throw new HttpError(404, 'not_found')
  const { ids } = z.object({ ids: z.array(z.string().max(40)).max(500) }).parse(await req.json())
  try {
    await reorderLessons(getDb(), c, ids)
  } catch {
    throw new HttpError(409, 'stale_order')
  }
  return NextResponse.json({ ok: true })
})
