import { NextResponse } from 'next/server'
import { getDb } from '@ikhimi/db'
import { submitAttempt } from '@/server/assignments'
import { ownAttempt } from '@/server/attempt-access'
import { getMeteredLlm } from '@/server/llm'
import { requireSession, route } from '@/server/request'

// Writing answers not yet checked are graded by the AI here
export const maxDuration = 60

export const POST = route(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const { user } = await requireSession()
  const at = await ownAttempt(user, (await ctx.params).id)
  const graded = await submitAttempt(getDb(), at, { llm: getMeteredLlm({ userId: user.id, purpose: 'grade', refId: at.id }) })
  return NextResponse.json({ status: graded.status, percent: graded.percent })
})
