import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb } from '@ikhimi/db'
import { setDueDays } from '@/server/assignments'
import { ownedAssignment } from '@/server/assignment-access'
import { MAX_DUE_DAYS } from '@/server/deadline'
import { HttpError, requireSession, route } from '@/server/request'

const body = z.object({ dueDays: z.number().int().min(1).max(MAX_DUE_DAYS).nullable() })

/** The teacher changes or removes a published homework's duration */
export const PATCH = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const { user } = await requireSession()
  const a = await ownedAssignment(user, (await ctx.params).id)
  const { dueDays } = body.parse(await req.json())
  if (a.status === 'draft') throw new HttpError(400, 'not_published')
  const row = await setDueDays(getDb(), a, dueDays)
  return NextResponse.json({ ok: true, dueDays: row.dueDays })
})
