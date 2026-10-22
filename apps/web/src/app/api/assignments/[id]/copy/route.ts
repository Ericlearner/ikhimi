import { after, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb } from '@ikhimi/db'
import { copyToGroup } from '@/server/assignments'
import { ownedAssignment } from '@/server/assignment-access'
import { dueDaysOf, MAX_DUE_DAYS } from '@/server/deadline'
import { HttpError, requireSession, route } from '@/server/request'
import { groupDetailsSchema } from '@/server/groups'
import { notifyNewHomework } from '@/server/notify'

const body = z.object({
  groupId: z.string().max(40).nullable().optional(),
  newGroup: groupDetailsSchema.nullable().optional(),
  dueDays: z.number().int().min(1).max(MAX_DUE_DAYS).nullable().optional(),
  /** An older page sends a date: it becomes the days from now */
  dueAt: z.string().datetime().nullable().optional(),
})

/** The same homework for another group: a published copy with its own link (nothing is generated again) */
export const POST = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const { user } = await requireSession()
  const a = await ownedAssignment(user, (await ctx.params).id)
  const input = body.parse(await req.json())
  const db = getDb()
  try {
    const copy = await copyToGroup(db, a, { groupId: input.groupId, newGroup: input.newGroup, dueDays: dueDaysOf(input) })
    after(() => notifyNewHomework(getDb(), copy).catch((e) => console.warn('[notify] new homework', e)))
    return NextResponse.json({ id: copy.id })
  } catch (e) {
    const code = e instanceof Error ? e.message : ''
    if (code === 'group_not_owned') throw new HttpError(403, 'forbidden')
    if (code === 'same_group' || code === 'group_required' || code === 'not_published') throw new HttpError(400, code)
    throw e
  }
})
