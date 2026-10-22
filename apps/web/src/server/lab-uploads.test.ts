import { beforeEach, describe, expect, it } from 'vitest'
import { createTestDb } from '@ikhimi/db/testing'
import { labUploads, users, type Db } from '@ikhimi/db'
import { GeminiFiles, type LlmProvider, type LlmRequest } from '@ikhimi/ai'
import { examMethodology, labSend } from './lab'
import { labUploadPart, pruneLabUploads, startLabUpload } from './lab-uploads'

let db: Db
let owner: string
beforeEach(async () => {
  db = await createTestDb()
  const [u] = await db.insert(users).values({ role: 'teacher', phone: '+998900000001' }).returning()
  owner = u!.id
})

const G = 8 * 1024 * 1024
const PART = 3.5 * 1024 * 1024

/** Google's Files API, faked over fetch: what was started, uploaded (offset, size, finalize) and removed */
function google() {
  const log: string[] = []
  const got: Buffer[] = []
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const h = new Headers(init?.headers)
    if (url.endsWith('/upload/v1beta/files')) {
      log.push(`start ${h.get('X-Goog-Upload-Header-Content-Length')} ${h.get('X-Goog-Upload-Header-Content-Type')}`)
      return new Response('{}', { headers: { 'x-goog-upload-url': 'https://upload.example/u1', 'x-goog-upload-chunk-granularity': String(G) } })
    }
    if (url === 'https://upload.example/u1') {
      const body = Buffer.from(init!.body as Uint8Array)
      got.push(body)
      log.push(`${h.get('X-Goog-Upload-Command')} @${h.get('X-Goog-Upload-Offset')} ${body.length}`)
      return h.get('X-Goog-Upload-Command')!.includes('finalize')
        ? Response.json({ file: { name: 'files/abc', uri: 'https://generativelanguage.googleapis.com/v1beta/files/abc', mimeType: 'application/pdf', state: 'PROCESSING' } })
        : new Response('')
    }
    if (init?.method === 'DELETE') {
      log.push(`delete ${url.split('/v1beta/')[1]}`)
      return new Response('{}')
    }
    // GET the file: processed by now
    return Response.json({ name: 'files/abc', uri: 'https://generativelanguage.googleapis.com/v1beta/files/abc', mimeType: 'application/pdf', state: 'ACTIVE' })
  }) as typeof fetch
  return { files: new GeminiFiles('key', fetchImpl), log, got }
}

describe('a whole book for the Lab goes to Google, not our database', () => {
  it('passes the browser’s parts on in Google’s part size, finishes with the rest, and accepts a retry', async () => {
    const g = google()
    const book = Buffer.from(Array.from({ length: 20 * 1024 * 1024 }, (_, i) => i % 253))
    const r = await startLabUpload(db, g.files, { ownerId: owner, filename: 'topik.pdf', mimeType: 'application/pdf', bytes: book.length })
    if (!r.ok) throw new Error(r.reason)
    const statuses: string[] = []
    for (let at = 0; at < book.length; at += PART) {
      const part = book.subarray(at, at + PART)
      const s = await labUploadPart(db, g.files, { ownerId: owner, id: r.id, offset: at, part })
      statuses.push(s.ok ? s.status : s.reason)
      // A retry of the same part changes nothing
      if (at === PART) expect(await labUploadPart(db, g.files, { ownerId: owner, id: r.id, offset: at, part })).toEqual({ ok: true, status: 'partial' })
    }
    expect(statuses.at(-1)).toBe('ready')
    expect(g.log).toEqual([`start ${book.length} application/pdf`, `upload @0 ${G}`, `upload @${G} ${G}`, `upload, finalize @${2 * G} ${book.length - 2 * G}`])
    expect(Buffer.concat(g.got).equals(book)).toBe(true)
    // Nothing of the book is left waiting in our database
    const [row] = await db.select().from(labUploads)
    expect(row).toMatchObject({ sent: book.length, fileName: 'files/abc' })
    expect(row!.buffer.length).toBe(0)
  })

  it('refuses what isn’t a PDF, what is over 100 MB, and parts out of order', async () => {
    const g = google()
    expect(await startLabUpload(db, g.files, { ownerId: owner, filename: 'a.docx', mimeType: 'application/msword', bytes: 10 })).toEqual({ ok: false, reason: 'file_type' })
    expect(await startLabUpload(db, g.files, { ownerId: owner, filename: 'a.pdf', mimeType: 'application/pdf', bytes: 101 * 1024 * 1024 })).toEqual({ ok: false, reason: 'file_too_large' })
    const r = await startLabUpload(db, g.files, { ownerId: owner, filename: 'a.pdf', mimeType: 'application/pdf', bytes: 2 * PART })
    if (!r.ok) throw new Error()
    expect(await labUploadPart(db, g.files, { ownerId: owner, id: r.id, offset: PART, part: Buffer.alloc(PART) })).toEqual({ ok: false, reason: 'out_of_order' })
    // Someone else's upload is not found
    const [other] = await db.insert(users).values({ role: 'teacher', phone: '+998900000002' }).returning()
    expect(await labUploadPart(db, g.files, { ownerId: other!.id, id: r.id, offset: 0, part: Buffer.alloc(10) })).toEqual({ ok: false, reason: 'not_found' })
  })

  it('the Lab reads the book by reference, then removes it from Google and from us; old ones are cleaned up daily', async () => {
    const g = google()
    const r = await startLabUpload(db, g.files, { ownerId: owner, filename: 'topik.pdf', mimeType: 'application/pdf', bytes: 1000 })
    if (!r.ok) throw new Error()
    await labUploadPart(db, g.files, { ownerId: owner, id: r.id, offset: 0, part: Buffer.alloc(1000, 7) })
    const requests: LlmRequest[] = []
    const llm: LlmProvider = {
      name: 'fake',
      async generateJson(req) {
        requests.push(req)
        return { json: { reply: 'Read the book.', changes: [] }, usage: { inputTokens: 1, outputTokens: 1 }, model: 'fake' }
      },
    }
    const m = (await examMethodology(db, 'topik'))!
    expect(await labSend(db, llm, { ownerId: owner, methodologyId: m.id, text: 'A good book', materialIds: [], uploads: [r.id] }, { files: g.files })).toMatchObject({ ok: true })
    expect(requests[0]!.parts).toContainEqual({ mimeType: 'application/pdf', fileUri: 'https://generativelanguage.googleapis.com/v1beta/files/abc' })
    expect(requests[0]!.parts).toContainEqual({ text: 'File «topik.pdf»:' })
    expect(g.log.at(-1)).toBe('delete files/abc')
    expect(await db.select().from(labUploads)).toEqual([])

    // One left behind a day ago goes with the daily job
    const old = await startLabUpload(db, g.files, { ownerId: owner, filename: 'b.pdf', mimeType: 'application/pdf', bytes: 10 })
    if (!old.ok) throw new Error()
    expect(await pruneLabUploads(db, g.files, new Date(Date.now() + 2 * 86400_000))).toBe(1)
    expect(await db.select().from(labUploads)).toEqual([])
  })
})
