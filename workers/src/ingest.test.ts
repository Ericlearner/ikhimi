import { describe, expect, it } from 'vitest'
import { createTestDb } from '@ikhimi/db/testing'
import { eq, materials, users } from '@ikhimi/db'
import { ingestMaterial } from './ingest'

const fakeStorage = (files: Record<string, string>) => ({
  async getStream(key: string) {
    const body = files[key]
    if (body === undefined) throw new Error('NoSuchKey')
    return (async function* () {
      yield new TextEncoder().encode(body)
    })()
  },
})

describe('ingestMaterial', () => {
  it('hashes content, marks ready, and reuses a prior extraction for identical bytes', async () => {
    const db = await createTestDb()
    const [t] = await db.insert(users).values({ role: 'teacher', phone: '+998901234567' }).returning()
    const storage = fakeStorage({ a: 'track-10-bytes', b: 'track-10-bytes' })

    const [a] = await db.insert(materials).values({ teacherId: t!.id, kind: 'audio', storageKey: 'a', processingStatus: 'uploaded' }).returning()
    expect(await ingestMaterial({ db, storage }, a!.id)).toEqual({ status: 'ready', deduped: false })
    await db.update(materials).set({ extractedText: 'transcript…' }).where(eq(materials.id, a!.id))

    const [b] = await db.insert(materials).values({ teacherId: t!.id, kind: 'audio', storageKey: 'b', processingStatus: 'uploaded' }).returning()
    expect(await ingestMaterial({ db, storage }, b!.id)).toEqual({ status: 'ready', deduped: true })
    const [bRow] = await db.select().from(materials).where(eq(materials.id, b!.id))
    expect(bRow!.extractedText).toBe('transcript…')
    expect(bRow!.contentHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('marks the material failed when the object is missing', async () => {
    const db = await createTestDb()
    const [t] = await db.insert(users).values({ role: 'teacher', phone: '+998901234567' }).returning()
    const [m] = await db.insert(materials).values({ teacherId: t!.id, kind: 'image', storageKey: 'gone', processingStatus: 'uploaded' }).returning()
    await expect(ingestMaterial({ db, storage: fakeStorage({}) }, m!.id)).rejects.toThrow()
    const [row] = await db.select().from(materials).where(eq(materials.id, m!.id))
    expect(row!.processingStatus).toBe('failed')
  })
})
