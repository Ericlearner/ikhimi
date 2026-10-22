import { NextResponse } from 'next/server'
import { eq, getDb, materials, UPLOAD_LIMITS } from '@ikhimi/db'
import { enqueue, QUEUES } from '@ikhimi/db/jobs'
import { getStorage } from '@ikhimi/db/storage'
import { authorizeUpload } from '@/server/materials'
import { authorize } from '@/server/policy'
import { HttpError, requireSession, route } from '@/server/request'

/** Step 2: the browser finished the direct upload. Verify it really landed, then queue ingestion. */
export const POST = route(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const { user } = await requireSession()
  const { id } = await ctx.params
  const db = getDb()
  const [m] = await db.select().from(materials).where(eq(materials.id, id)).limit(1)
  if (!m || m.deletedAt) throw new HttpError(404, 'not_found')
  authorizeUpload(user, m.teacherId)
  if (m.processingStatus !== 'pending_upload') return NextResponse.json({ status: m.processingStatus })

  const head = await getStorage()
    .head(m.storageKey!)
    .catch(() => null)
  const limit = m.kind in UPLOAD_LIMITS ? UPLOAD_LIMITS[m.kind as keyof typeof UPLOAD_LIMITS].maxBytes : 0
  if (!head || head.bytes === 0 || head.bytes > limit) {
    await db.update(materials).set({ processingStatus: 'failed', processingError: 'upload_missing' }).where(eq(materials.id, id))
    throw new HttpError(400, 'upload_missing')
  }

  await db.update(materials).set({ processingStatus: 'uploaded', bytes: head.bytes }).where(eq(materials.id, id))
  await enqueue(QUEUES.materialIngest, { materialId: id })
  return NextResponse.json({ status: 'uploaded' })
})

export const GET = route(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const { user } = await requireSession()
  const { id } = await ctx.params
  const [m] = await getDb().select().from(materials).where(eq(materials.id, id)).limit(1)
  if (!m) throw new HttpError(404, 'not_found')
  authorize(user, 'material:read', { teacherId: m.teacherId })
  return NextResponse.json({ status: m.processingStatus, contentHash: m.contentHash })
})
