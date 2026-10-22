import { NextResponse } from 'next/server'
import { getDb } from '@ikhimi/db'
import { ownedAssignment } from '@/server/assignment-access'
import { remindNotDone } from '@/server/notify'
import { requireSession, route } from '@/server/request'

/** The report's "remind them" button: a Telegram reminder to each student who hasn't handed it in (once a day each) */
export const POST = route(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const { user } = await requireSession()
  const a = await ownedAssignment(user, (await ctx.params).id)
  return NextResponse.json(await remindNotDone(getDb(), a))
})
