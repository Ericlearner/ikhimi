import { PDFDocument } from 'pdf-lib'
import { createHash } from 'node:crypto'
import { and, eq, inArray, isNull, lt, materialBlobs, materials, sql, type Db, CONFIG } from '@ikhimi/db'
import type { Material } from '@ikhimi/ai'
import { ownerPhones } from './admin/staff'
import { authorize, type Actor } from './policy'
import { CHARS_PER_PAGE, DOC_MIME, DOCX_MIME, readWord, WordError } from './word'

/**
 * Teachers upload materials. The owner also uploads the Lab's resources, whichever side of their account is open
 * (the Lab is theirs, not a teacher's): their own uploads only.
 */
export function authorizeUpload(user: Actor & { phone: string; blockedAt?: Date | null }, teacherId?: string) {
  if (!user.blockedAt && ownerPhones().includes(user.phone) && (teacherId === undefined || teacherId === user.id)) return
  if (teacherId === undefined) authorize(user, 'material:create', null)
  else authorize(user, 'material:update', { teacherId })
}

/** S3 is used when configured; otherwise file bytes live in Postgres (Vercel without storage). */
export const s3Configured = () => !!(process.env.S3_ENDPOINT && process.env.S3_ACCESS_KEY && process.env.S3_SECRET_KEY)

/**
 * Direct-to-Postgres uploads: Vercel refuses a request over 4.5 MB, so the browser sends a bigger file in parts of
 * at most this size, joined here in order (storeDirectPart).
 */
export const DIRECT_UPLOAD_MAX_BYTES = 4 * 1024 * 1024
/** …and a whole file may be this big: a full exam paper fits, and the AI reads up to about 13 MB at once */
export const DIRECT_FILE_MAX_BYTES = 15 * 1024 * 1024

/**
 * One part of a direct upload, at `offset` in the file. Parts come in order; a part sent again (a retry after a
 * dropped connection) is accepted without being added twice. The file is ready once all of it has arrived.
 */
export async function storeDirectPart(db: Db, m: typeof materials.$inferSelect, offset: number, part: Buffer): Promise<{ ok: true; status: 'ready' | 'partial' } | { ok: false; reason: 'too_large' | 'out_of_order' }> {
  if (!part.length || part.length > DIRECT_UPLOAD_MAX_BYTES || offset < 0 || offset + part.length > (m.bytes ?? 0) || offset + part.length > DIRECT_FILE_MAX_BYTES) return { ok: false, reason: 'too_large' }
  const [cur] = await db.select({ n: sql<number>`octet_length(${materialBlobs.data})::int` }).from(materialBlobs).where(eq(materialBlobs.materialId, m.id)).limit(1)
  const have = cur ? Number(cur.n) : null
  if (have === null && offset === 0) await db.insert(materialBlobs).values({ materialId: m.id, data: part }).onConflictDoNothing()
  else if (have === offset) await db.update(materialBlobs).set({ data: sql`${materialBlobs.data} || ${part}` }).where(eq(materialBlobs.materialId, m.id))
  else if (have === null || have < offset + part.length) return { ok: false, reason: 'out_of_order' }
  if (offset + part.length < (m.bytes ?? 0)) return { ok: true, status: 'partial' }
  const [blob] = await db.select().from(materialBlobs).where(eq(materialBlobs.materialId, m.id)).limit(1)
  const data = Buffer.from(blob!.data)
  await db.update(materials).set({ processingStatus: 'ready', bytes: data.length, contentHash: createHash('sha256').update(data).digest('hex') }).where(eq(materials.id, m.id))
  return { ok: true, status: 'ready' }
}

/** At most this many book pages go to the model per request (photos + PDF pages). */
export const MAX_PAGES = CONFIG.maxMaterialPages

export class MaterialError extends Error {
  constructor(
    public readonly code: 'too_many_pages' | 'pdf_pages' | 'pdf_unreadable' | 'doc_old' | 'doc_unreadable',
    public readonly n?: number,
  ) {
    super(code)
  }
}

async function readS3(key: string): Promise<Buffer> {
  const { getStorage } = await import('@ikhimi/db/storage')
  const chunks: Uint8Array[] = []
  for await (const c of await getStorage().getStream(key)) chunks.push(c)
  return Buffer.concat(chunks)
}

export async function materialBytes(db: Db, m: typeof materials.$inferSelect): Promise<Buffer | null> {
  const [blob] = await db.select().from(materialBlobs).where(eq(materialBlobs.materialId, m.id)).limit(1)
  if (blob) return Buffer.from(blob.data)
  if (m.storageKey && s3Configured()) return readS3(m.storageKey)
  return null
}

/** "12-14", "3, 5", "7" → 1-based page numbers (sorted, unique). Invalid parts are ignored. */
export function parsePageRange(spec: string | undefined | null): number[] {
  const out = new Set<number>()
  for (const part of (spec ?? '').split(/[,;\s]+/)) {
    const m = part.match(/^(\d{1,4})(?:[-–—](\d{1,4}))?$/)
    if (!m) continue
    const a = Number(m[1])
    const b = m[2] ? Number(m[2]) : a
    for (let p = Math.min(a, b); p <= Math.max(a, b) && out.size < 200; p++) if (p > 0) out.add(p)
  }
  return [...out].sort((x, y) => x - y)
}

/** Keep only the chosen pages of a PDF (or the whole file when it has at most `max` pages). */
async function slicePdf(data: Buffer, pages: number[], max: number): Promise<{ data: Buffer; pageCount: number; pageNumbers?: number[] }> {
  let src: PDFDocument
  try {
    src = await PDFDocument.load(data, { ignoreEncryption: true })
  } catch {
    throw new MaterialError('pdf_unreadable')
  }
  const total = src.getPageCount()
  if (!pages.length) {
    if (total > max) throw new MaterialError('pdf_pages', total)
    return { data, pageCount: total }
  }
  const wanted = pages.filter((p) => p <= total).map((p) => p - 1)
  if (!wanted.length) throw new MaterialError('pdf_pages', total)
  const out = await PDFDocument.create()
  for (const page of await out.copyPages(src, wanted)) out.addPage(page)
  return { data: Buffer.from(await out.save()), pageCount: wanted.length, pageNumbers: wanted.map((p) => p + 1) }
}

export type LoadedMaterial = Material & { id: string; kind: 'page' | 'audio' }

/**
 * Load a teacher's ready materials as inline parts for the model: photos, PDFs (optionally cut to `pdfPages`),
 * Word documents (as text plus their pictures, word.ts) and audio. Book pages are capped at MAX_PAGES in total
 * (`maxPages` for the Lab's longer resources); a Word document counts one page per CHARS_PER_PAGE of text and one per four pictures. Labels are unique so
 * audio can be linked by name.
 */
export async function loadMaterialsForLlm(db: Db, teacherId: string, ids: string[], opts: { pdfPages?: string | null; maxPages?: number } = {}): Promise<LoadedMaterial[]> {
  if (!ids.length) return []
  const rows = await db
    .select()
    .from(materials)
    .where(and(eq(materials.teacherId, teacherId), inArray(materials.id, ids)))
  const out: LoadedMaterial[] = []
  const pages = parsePageRange(opts.pdfPages)
  let pageCount = 0
  const labels = new Set<string>()
  for (const id of ids) {
    const m = rows.find((r) => r.id === id)
    if (!m || m.processingStatus === 'failed' || m.deletedAt) continue
    const mime = m.mimeType ?? ''
    const isAudio = mime.startsWith('audio/')
    // Old binary Word: we can't read it, and saying so beats ignoring it
    if (mime === DOC_MIME) throw new MaterialError('doc_old')
    if (!(mime.startsWith('image/') || mime === 'application/pdf' || mime === DOCX_MIME || isAudio)) continue
    let data = await materialBytes(db, m)
    if (!data) continue
    let extra: Pick<Material, 'pages' | 'pageNumbers' | 'text' | 'pictures'> = {}
    if (mime === DOCX_MIME) {
      let doc
      try {
        doc = await readWord(data)
      } catch (e) {
        if (e instanceof WordError) throw new MaterialError('doc_unreadable')
        throw e
      }
      pageCount += Math.max(1, Math.ceil(doc.textLength / CHARS_PER_PAGE)) + Math.ceil(doc.pictures.length / 4)
      extra = { text: doc.html, pictures: doc.pictures }
      // The file itself isn't sent: the model gets its text and pictures
      data = Buffer.alloc(0)
    } else if (mime === 'application/pdf') {
      // The Lab's longer resources have their own cap, a whole PDF included
      const sliced = await slicePdf(data, pages, opts.maxPages ?? MAX_PAGES)
      data = sliced.data
      pageCount += sliced.pageCount
      extra = { pages: sliced.pageCount, ...(sliced.pageNumbers ? { pageNumbers: sliced.pageNumbers } : {}) }
    } else if (!isAudio) pageCount++
    const max = opts.maxPages ?? MAX_PAGES
    if (pageCount > max) throw new MaterialError('too_many_pages', max)
    let label = m.originalFilename ?? `material ${out.length + 1}`
    for (let n = 2; labels.has(label); n++) label = `${n}-${m.originalFilename ?? 'material'}`
    labels.add(label)
    out.push({ id: m.id, kind: isAudio ? 'audio' : 'page', label, mimeType: isAudio && mime === 'audio/mp3' ? 'audio/mpeg' : mime, dataBase64: data.toString('base64'), ...extra })
  }
  return out
}

/**
 * A book's answer pages are read once, for the answer keys, and not kept (DECISIONS.md BM): the answers are saved as
 * text with the exercises, and our database is the tighter limit. Removed as soon as they've been read…
 */
export async function dropAnswerFiles(db: Db, teacherId: string, ids: string[]) {
  if (!ids.length) return
  const own = await db
    .select({ id: materials.id })
    .from(materials)
    .where(and(inArray(materials.id, ids), eq(materials.teacherId, teacherId), eq(materials.purpose, 'answers')))
  if (!own.length) return
  await db.delete(materialBlobs).where(inArray(materialBlobs.materialId, own.map((x) => x.id)))
  await db.update(materials).set({ deletedAt: new Date() }).where(inArray(materials.id, own.map((x) => x.id)))
}

/** …or by the daily job a day after upload, when the copy was never made (the teacher left, or it failed) */
export async function pruneAnswerFiles(db: Db, now = new Date()) {
  const old = await db
    .select({ id: materials.id })
    .from(materials)
    .where(and(eq(materials.purpose, 'answers'), isNull(materials.deletedAt), lt(materials.createdAt, new Date(now.getTime() - 24 * 3600_000))))
    .limit(500)
  if (!old.length) return 0
  await db.delete(materialBlobs).where(inArray(materialBlobs.materialId, old.map((x) => x.id)))
  await db.update(materials).set({ deletedAt: now }).where(inArray(materials.id, old.map((x) => x.id)))
  return old.length
}
