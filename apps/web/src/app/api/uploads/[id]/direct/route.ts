import { NextResponse } from 'next/server'
import { eq, getDb, materials } from '@ikhimi/db'
import { authorizeUpload, storeDirectPart } from '@/server/materials'
import { HttpError, requireSession, route } from '@/server/request'

/** Upload without S3: raw bytes in the body (one part of the file at `?offset=`), stored in Postgres */
export const POST = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const { user } = await requireSession()
  const { id } = await ctx.params
  const db = getDb()
  const [m] = await db.select().from(materials).where(eq(materials.id, id)).limit(1)
  if (!m || m.deletedAt) throw new HttpError(404, 'not_found')
  authorizeUpload(user, m.teacherId)
  if (m.processingStatus !== 'pending_upload') return NextResponse.json({ status: m.processingStatus })
  const contentType = req.headers.get('content-type') ?? ''
  if (m.mimeType && contentType && contentType !== m.mimeType) throw new HttpError(415, 'file_type')

  const offset = Number(new URL(req.url).searchParams.get('offset') ?? 0)
  const r = await storeDirectPart(db, m, Number.isInteger(offset) ? offset : -1, Buffer.from(await req.arrayBuffer()))
  if (!r.ok) throw r.reason === 'too_large' ? new HttpError(413, 'file_too_large', { maxMb: 15 }) : new HttpError(409, 'out_of_order')
  return NextResponse.json({ status: r.status })
})
