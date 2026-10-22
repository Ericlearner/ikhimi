import { NextResponse } from 'next/server'
import { z } from 'zod'
import { eq, getDb, materials, UPLOAD_LIMITS, uploadKindForMime } from '@ikhimi/db'
import { extForMime, getStorage, materialObjectKey, sanitizeFilename } from '@ikhimi/db/storage'
import { authorizeUpload, DIRECT_FILE_MAX_BYTES, s3Configured } from '@/server/materials'
import { HttpError, requireSession, route } from '@/server/request'

const body = z.object({
  filename: z.string().max(500),
  mimeType: z.string().max(120),
  bytes: z.number().int().positive(),
  /** A book's answer pages: read once and then removed (DECISIONS.md BM) */
  purpose: z.enum(['answers']).optional(),
})

/** Step 1 of an upload: create the material row and hand back a presigned POST. */
export const POST = route(async (req) => {
  const { user } = await requireSession()
  authorizeUpload(user)
  const input = body.parse(await req.json())

  const kind = uploadKindForMime(input.mimeType)
  if (!kind) throw new HttpError(415, 'file_type')
  const direct = !s3Configured()
  // Into Postgres a file goes in parts (lib/upload.ts), up to its own limit
  const maxBytes = direct ? Math.min(UPLOAD_LIMITS[kind].maxBytes, DIRECT_FILE_MAX_BYTES) : UPLOAD_LIMITS[kind].maxBytes
  if (input.bytes > maxBytes) throw new HttpError(413, 'file_too_large', { maxMb: Math.round(maxBytes / 1024 / 1024) })

  const db = getDb()
  const [m] = await db
    .insert(materials)
    .values({
      teacherId: user.id,
      kind,
      originalFilename: sanitizeFilename(input.filename),
      mimeType: input.mimeType,
      bytes: input.bytes,
      processingStatus: 'pending_upload',
      purpose: input.purpose ?? null,
    })
    .returning({ id: materials.id })

  // No object store (e.g. Vercel): the browser posts the bytes to us and they go into Postgres.
  if (direct) return NextResponse.json({ materialId: m!.id, kind, direct: true })

  const key = materialObjectKey(user.id, m!.id, extForMime(input.mimeType))
  const { url, fields } = await getStorage().presignUpload(key, input.mimeType, maxBytes)
  await db.update(materials).set({ storageKey: key }).where(eq(materials.id, m!.id))
  return NextResponse.json({ materialId: m!.id, kind, upload: { url, fields } })
})
