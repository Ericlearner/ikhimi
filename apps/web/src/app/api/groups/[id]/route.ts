import { NextResponse } from 'next/server'
import { getDb } from '@ikhimi/db'
import { groupDetailsSchema, updateGroup } from '@/server/groups'
import { HttpError, requireSession, route } from '@/server/request'

/** Edit a group's organisation details (name, level, start date, planned size, note). */
export const PATCH = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const { user } = await requireSession()
  const input = groupDetailsSchema.partial().parse(await req.json())
  const g = await updateGroup(getDb(), user.id, (await ctx.params).id, input)
  if (!g) throw new HttpError(404, 'not_found')
  return NextResponse.json({ ok: true })
})
