import { NextResponse } from 'next/server'
import { getDb } from '@ikhimi/db'
import { apiStaff } from '@/server/admin/guard'
import { labUploadPart } from '@/server/lab-uploads'
import { getGeminiFiles } from '@/server/llm'
import { HttpError, route } from '@/server/request'

// Passing a part on to Google takes a few seconds on a slow line
export const maxDuration = 60

/** One part of a Lab book (raw bytes, `?offset=`), passed on to Google in the sizes it asks for */
export const POST = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const db = getDb()
  const { session } = await apiStaff(db, 'staff')
  const files = getGeminiFiles()
  if (!files) throw new HttpError(503, 'ai_not_configured')
  const offset = Number(new URL(req.url).searchParams.get('offset') ?? -1)
  const r = await labUploadPart(db, files, { ownerId: session.user.id, id: (await ctx.params).id, offset: Number.isInteger(offset) ? offset : -1, part: Buffer.from(await req.arrayBuffer()) })
  if (!r.ok) throw new HttpError(r.reason === 'not_found' ? 404 : r.reason === 'out_of_order' ? 409 : 413, r.reason)
  return NextResponse.json({ status: r.status })
})
