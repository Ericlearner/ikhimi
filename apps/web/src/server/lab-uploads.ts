/**
 * Whole books for the owner's Lab (DECISIONS.md BJ): a PDF up to 100 MB goes to the Gemini Files API instead of our
 * database. Vercel refuses a request over 4.5 MB, so the browser sends it in parts; Google wants parts that are a
 * multiple of its granularity (usually 8 MB), so what arrives waits in `buffer` until there is enough to pass on.
 * At most one Google part sits in the database at a time, and the row goes once the Lab has read the book.
 */
import { and, eq, labUploads, lt, type Db } from '@ikhimi/db'
import type { GeminiFiles } from '@ikhimi/ai'
import { DIRECT_UPLOAD_MAX_BYTES } from './materials'

export const LAB_BOOK_MAX_BYTES = 100 * 1024 * 1024
export const LAB_BOOK_TYPES = ['application/pdf']

type Fail = { ok: false; reason: 'file_type' | 'file_too_large' | 'not_found' | 'out_of_order' }

export async function startLabUpload(db: Db, files: GeminiFiles, input: { ownerId: string; filename: string; mimeType: string; bytes: number }): Promise<{ ok: true; id: string } | Fail> {
  if (!LAB_BOOK_TYPES.includes(input.mimeType)) return { ok: false, reason: 'file_type' }
  if (input.bytes <= 0 || input.bytes > LAB_BOOK_MAX_BYTES) return { ok: false, reason: 'file_too_large' }
  const { uploadUrl, granularity } = await files.start({ bytes: input.bytes, mimeType: input.mimeType, displayName: input.filename })
  const [row] = await db
    .insert(labUploads)
    .values({ ownerId: input.ownerId, filename: input.filename.slice(0, 300), mimeType: input.mimeType, bytes: input.bytes, uploadUrl, granularity, buffer: Buffer.alloc(0) })
    .returning({ id: labUploads.id })
  return { ok: true, id: row!.id }
}

/** One part at `offset`. Parts come in order; one sent again (a retry) is accepted and not added twice. */
export async function labUploadPart(db: Db, files: GeminiFiles, input: { ownerId: string; id: string; offset: number; part: Buffer }): Promise<{ ok: true; status: 'partial' | 'ready' } | Fail> {
  const [row] = await db.select().from(labUploads).where(and(eq(labUploads.id, input.id), eq(labUploads.ownerId, input.ownerId))).limit(1)
  if (!row) return { ok: false, reason: 'not_found' }
  if (row.fileUri) return { ok: true, status: 'ready' }
  const { offset, part } = input
  if (!part.length || part.length > DIRECT_UPLOAD_MAX_BYTES || offset < 0 || offset + part.length > row.bytes) return { ok: false, reason: 'file_too_large' }
  const have = row.sent + row.buffer.length
  if (offset + part.length <= have) return { ok: true, status: 'partial' }
  if (offset !== have) return { ok: false, reason: 'out_of_order' }

  let buffer = Buffer.concat([Buffer.from(row.buffer), part])
  if (offset + part.length === row.bytes) {
    const file = await files.upload(row.uploadUrl, row.sent, buffer, true)
    await db.update(labUploads).set({ sent: row.bytes, buffer: Buffer.alloc(0), fileName: file!.name, fileUri: file!.uri }).where(eq(labUploads.id, row.id))
    return { ok: true, status: 'ready' }
  }
  // Pass on whole Google parts; keep the rest for the next one
  const whole = Math.floor(buffer.length / row.granularity) * row.granularity
  let sent = row.sent
  if (whole > 0) {
    await files.upload(row.uploadUrl, sent, buffer.subarray(0, whole), false)
    sent += whole
    buffer = buffer.subarray(whole)
  }
  await db.update(labUploads).set({ sent, buffer }).where(eq(labUploads.id, row.id))
  return { ok: true, status: 'partial' }
}

/** The owner's uploaded books, ready to read */
export async function readyLabUploads(db: Db, ownerId: string, ids: string[]) {
  if (!ids.length) return []
  const rows = await db.select().from(labUploads).where(eq(labUploads.ownerId, ownerId))
  return ids.map((id) => rows.find((r) => r.id === id)).filter((r): r is NonNullable<typeof r> => !!r?.fileUri && !!r.fileName)
}

/** Read or not, a book is gone from Google and from us afterwards */
export async function dropLabUploads(db: Db, files: GeminiFiles | null, rows: { id: string; fileName: string | null }[]) {
  for (const r of rows) {
    if (r.fileName && files) await files.remove(r.fileName)
    await db.delete(labUploads).where(eq(labUploads.id, r.id))
  }
}

/** The daily job: books left behind (a closed tab, a read that failed) older than a day */
export async function pruneLabUploads(db: Db, files: GeminiFiles | null, now = new Date()) {
  const old = await db.select({ id: labUploads.id, fileName: labUploads.fileName }).from(labUploads).where(lt(labUploads.createdAt, new Date(now.getTime() - 86400_000)))
  await dropLabUploads(db, files, old)
  return old.length
}
