import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb } from '@ikhimi/db'
import { acceptAnswer } from '@/server/assignments'
import { ownedAssignment } from '@/server/assignment-access'
import { HttpError, requireSession, route } from '@/server/request'

const body = z.object({ text: z.string().min(1).max(300), blank: z.number().int().min(0).max(100).nullable() })

/** The teacher accepts a student's answer as correct: it's added to the item and everyone is re-scored. */
export const POST = route(async (req, ctx: { params: Promise<{ id: string; exId: string }> }) => {
  const { user } = await requireSession()
  const { id, exId } = await ctx.params
  const a = await ownedAssignment(user, id)
  const r = await acceptAnswer(getDb(), a, exId, body.parse(await req.json()))
  if (!r.ok) throw new HttpError(r.reason === 'not_found' ? 404 : 400, r.reason)
  return NextResponse.json(r)
})
