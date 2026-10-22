import { NextResponse } from 'next/server'
import { getDb } from '@ikhimi/db'
import { createParentLink, parentUrl, revokeParentLink } from '@/server/parents'
import { HttpError, requireSession, route } from '@/server/request'

async function teacher() {
  const { user } = await requireSession()
  if (user.role !== 'teacher') throw new HttpError(403, 'forbidden')
  return user
}

/** A new parent link for one of the teacher's students (the old one stops working) */
export const POST = route(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const user = await teacher()
  const link = await createParentLink(getDb(), user.id, (await ctx.params).id)
  if (!link) throw new HttpError(404, 'not_found')
  return NextResponse.json({ url: parentUrl(link.token) })
})

/** Turn the parent link off */
export const DELETE = route(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const user = await teacher()
  await revokeParentLink(getDb(), user.id, (await ctx.params).id)
  return NextResponse.json({ ok: true })
})
