import { after, NextResponse } from 'next/server'
import { z } from 'zod'
import { assignments, eq, getDb } from '@ikhimi/db'
import { publishAssignment, type AssignmentSettings } from '@/server/assignments'
import { ownedAssignment } from '@/server/assignment-access'
import { dueDaysOf, MAX_DUE_DAYS } from '@/server/deadline'
import { HttpError, requireSession, route } from '@/server/request'
import { groupDetailsSchema } from '@/server/groups'
import { notifyNewHomework } from '@/server/notify'

const body = z.object({
  groupId: z.string().max(40).nullable().optional(),
  newGroupName: z.string().max(60).nullable().optional(),
  newGroup: groupDetailsSchema.nullable().optional(),
  dueDays: z.number().int().min(1).max(MAX_DUE_DAYS).nullable().optional(),
  /** An older page sends a date: it becomes the days from now */
  dueAt: z.string().datetime().nullable().optional(),
  showAnswersAfter: z.enum(['submit', 'never']).optional(),
})

export const POST = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const { user } = await requireSession()
  const a = await ownedAssignment(user, (await ctx.params).id)
  const input = body.parse(await req.json())
  const db = getDb()
  if (input.showAnswersAfter) {
    const settings: AssignmentSettings = { ...((a.settings ?? {}) as AssignmentSettings), showAnswersAfter: input.showAnswersAfter }
    await db.update(assignments).set({ settings }).where(eq(assignments.id, a.id))
    a.settings = settings
  }
  try {
    const pub = await publishAssignment(db, a, {
      groupId: input.groupId,
      newGroupName: input.newGroupName,
      newGroup: input.newGroup,
      dueDays: dueDaysOf(input),
    })
    // Students of the group hear about it in the iOS app (once each), after the teacher has their answer
    after(() => notifyNewHomework(getDb(), pub).catch((e) => console.warn('[notify] new homework', e)))
    return NextResponse.json({ shareSlug: pub.shareSlug })
  } catch (e) {
    if (e instanceof Error && e.message === 'group_not_owned') throw new HttpError(403, 'forbidden')
    if (e instanceof Error && e.message === 'needs_audio') throw new HttpError(409, 'needs_audio')
    throw e
  }
})
