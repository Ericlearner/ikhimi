import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb } from '@ikhimi/db'
import { HttpError, requireSession, route } from '@/server/request'
import { answerReview } from '@/server/review'

const body = z.object({ value: z.unknown() })

/** A student answers one of their old mistakes again ("Xatolar ustida ishlash"); never scored */
export const POST = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const { user } = await requireSession()
  const { value } = body.parse(await req.json())
  const r = await answerReview(getDb(), user.id, (await ctx.params).id, value)
  if (!r.ok) throw new HttpError(r.reason === 'not_found' ? 404 : 409, r.reason)
  return NextResponse.json(r)
})
