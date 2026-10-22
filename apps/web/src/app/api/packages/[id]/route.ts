import { NextResponse } from 'next/server'
import { z } from 'zod'
import { and, eq, getDb, groups, planPackages } from '@ikhimi/db'
import { HttpError, requireSession, route } from '@/server/request'

/** The teacher picks (or changes) the class whose students take the package's seats. Seats already taken stay. */
export const PATCH = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const { user } = await requireSession()
  if (user.role !== 'teacher') throw new HttpError(403, 'forbidden')
  const { groupId } = z.object({ groupId: z.string().max(40) }).parse(await req.json())
  const db = getDb()
  const id = (await ctx.params).id
  const [pkg] = await db.select().from(planPackages).where(and(eq(planPackages.id, id), eq(planPackages.teacherId, user.id))).limit(1)
  if (!pkg) throw new HttpError(404, 'not_found')
  const [g] = await db.select({ id: groups.id }).from(groups).where(and(eq(groups.id, groupId), eq(groups.teacherId, user.id))).limit(1)
  if (!g) throw new HttpError(404, 'group_not_found')
  await db.update(planPackages).set({ groupId }).where(eq(planPackages.id, id))
  return NextResponse.json({ ok: true })
})
