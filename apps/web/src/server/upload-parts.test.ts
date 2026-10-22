import { beforeEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { createTestDb } from '@ikhimi/db/testing'
import { eq, materialBlobs, materials, users, type Db } from '@ikhimi/db'
import { DIRECT_FILE_MAX_BYTES, DIRECT_UPLOAD_MAX_BYTES, storeDirectPart } from './materials'

let db: Db
let teacherId: string
beforeEach(async () => {
  db = await createTestDb()
  const [t] = await db.insert(users).values({ role: 'teacher', phone: '+998900000001' }).returning()
  teacherId = t!.id
})

async function pending(bytes: number) {
  const [m] = await db.insert(materials).values({ teacherId, kind: 'pdf', originalFilename: 'exam.pdf', mimeType: 'application/pdf', bytes, processingStatus: 'pending_upload' }).returning()
  return m!
}

describe('a file bigger than one request goes to Postgres in parts', () => {
  it('joins the parts in order, accepts a part sent twice, refuses a gap, and is ready at the end', async () => {
    const file = Buffer.from(Array.from({ length: 9_000_000 }, (_, i) => i % 251))
    const P = 3.5 * 1024 * 1024
    const parts = [0, P, 2 * P].map((at) => ({ at, data: file.subarray(at, at + P) }))
    const m = await pending(file.length)

    expect(await storeDirectPart(db, m, parts[0]!.at, parts[0]!.data)).toEqual({ ok: true, status: 'partial' })
    // The third before the second: refused (the browser sends them in order)
    expect(await storeDirectPart(db, m, parts[2]!.at, parts[2]!.data)).toEqual({ ok: false, reason: 'out_of_order' })
    expect(await storeDirectPart(db, m, parts[1]!.at, parts[1]!.data)).toEqual({ ok: true, status: 'partial' })
    // A retry of a part that already arrived isn't added twice
    expect(await storeDirectPart(db, m, parts[1]!.at, parts[1]!.data)).toEqual({ ok: true, status: 'partial' })
    expect(await storeDirectPart(db, m, parts[2]!.at, parts[2]!.data)).toEqual({ ok: true, status: 'ready' })

    const [blob] = await db.select().from(materialBlobs).where(eq(materialBlobs.materialId, m.id))
    expect(Buffer.from(blob!.data).equals(file)).toBe(true)
    const [row] = await db.select().from(materials).where(eq(materials.id, m.id))
    expect(row).toMatchObject({ processingStatus: 'ready', bytes: file.length, contentHash: createHash('sha256').update(file).digest('hex') })
  })

  it('a small file is one part; a part over the request limit, or past the file’s size, is refused', async () => {
    const small = await pending(1000)
    expect(await storeDirectPart(db, small, 0, Buffer.alloc(1000, 1))).toEqual({ ok: true, status: 'ready' })
    const big = await pending(DIRECT_FILE_MAX_BYTES)
    expect(await storeDirectPart(db, big, 0, Buffer.alloc(DIRECT_UPLOAD_MAX_BYTES + 1))).toEqual({ ok: false, reason: 'too_large' })
    const short = await pending(100)
    expect(await storeDirectPart(db, short, 0, Buffer.alloc(200))).toEqual({ ok: false, reason: 'too_large' })
  })
})
