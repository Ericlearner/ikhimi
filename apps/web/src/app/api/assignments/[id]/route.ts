import { NextResponse } from 'next/server'
import { z } from 'zod'
import { assignments, eq, getDb } from '@ikhimi/db'
import { ownedAssignment } from '@/server/assignment-access'
import { requireSession, route } from '@/server/request'

const body = z.object({ title: z.string().trim().min(1).max(160) })

/** The teacher names the homework to fit their curriculum ("12과: Past Simple"). Allowed before and after publishing. */
export const PATCH = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const { user } = await requireSession()
  const a = await ownedAssignment(user, (await ctx.params).id)
  const { title } = body.parse(await req.json())
  await getDb().update(assignments).set({ title }).where(eq(assignments.id, a.id))
  return NextResponse.json({ ok: true, title })
})
