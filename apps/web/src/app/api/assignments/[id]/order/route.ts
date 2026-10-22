import { NextResponse } from 'next/server'
import { z } from 'zod'
import { and, eq, exercises, getDb } from '@ikhimi/db'
import { loadExercises } from '@/server/assignments'
import { ownedAssignment } from '@/server/assignment-access'
import { HttpError, requireSession, route } from '@/server/request'

const body = z.object({ ids: z.array(z.string().max(40)).max(200) })

/** Reorder a draft's items (⠿). The id list must be exactly the assignment's items. */
export const POST = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const { user } = await requireSession()
  const a = await ownedAssignment(user, (await ctx.params).id)
  if (a.status !== 'draft') throw new HttpError(409, 'already_published')
  const { ids } = body.parse(await req.json())
  const db = getDb()
  const current = await loadExercises(db, a.id)
  if (ids.length !== current.length || new Set(ids).size !== ids.length || !ids.every((id) => current.some((c) => c.id === id))) {
    throw new HttpError(400, 'bad_order')
  }
  for (const [i, id] of ids.entries()) {
    await db.update(exercises).set({ orderIndex: i }).where(and(eq(exercises.id, id), eq(exercises.assignmentId, a.id)))
  }
  return NextResponse.json({ ok: true })
})
