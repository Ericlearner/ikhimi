import { beforeEach, describe, expect, it } from 'vitest'
import { createTestDb } from '@ikhimi/db/testing'
import { eq, materialBlobs, materials, users, type Db } from '@ikhimi/db'
import { pcmToWav } from '@ikhimi/ai'
import { compressOldSpeech, storageUsage } from './storage-usage'

let db: Db
let teacherId: string

beforeEach(async () => {
  db = await createTestDb()
  const [t] = await db.insert(users).values({ role: 'teacher', phone: '+998900000001' }).returning()
  teacherId = t!.id
})

async function file(name: string, kind: 'audio' | 'image', mimeType: string, data: Buffer) {
  const [m] = await db.insert(materials).values({ teacherId, kind, originalFilename: name, mimeType, bytes: data.length, processingStatus: 'ready' }).returning()
  await db.insert(materialBlobs).values({ materialId: m!.id, data })
  return m!.id
}

const speech = () => {
  const pcm = Buffer.alloc(24000 * 2)
  for (let i = 0; i < 24000; i++) pcm.writeInt16LE(Math.round(Math.sin(i / 10) * 5000), i * 2)
  return pcmToWav(pcm, 24000)
}

describe('storage', () => {
  it('shows how full the database is and what takes the space', async () => {
    await file('say-1.wav', 'audio', 'audio/wav', speech())
    await file('picture-1.jpg', 'image', 'image/jpeg', Buffer.alloc(5000))
    await file('page.jpg', 'image', 'image/jpeg', Buffer.alloc(3000))
    const u = await storageUsage(db)
    expect(u.total).toBeGreaterThan(0)
    expect(u.limit).toBe(512 * 1024 * 1024)
    expect(u.files.map((f) => [f.kind, f.n, f.bytes])).toEqual([
      ['speech', 1, speech().length],
      ['pictures', 1, 5000],
      ['image', 1, 3000],
    ])
    expect(u.oldWav).toBe(1)
    expect(u.tables.length).toBeGreaterThan(0)
  })

  it('turns old WAV speech into MP3 in batches, keeping the material and its links', async () => {
    const id = await file('say-1.wav', 'audio', 'audio/wav', speech())
    await file('say-2.wav', 'audio', 'audio/wav', speech())
    // A teacher's own WAV recording is left alone
    const own = await file('lesson.wav', 'audio', 'audio/wav', speech())
    expect(await compressOldSpeech(db, 1)).toMatchObject({ converted: 1 })
    const r = await compressOldSpeech(db)
    expect(r.converted).toBe(1)
    expect(r.savedBytes).toBeGreaterThan(30_000)
    expect(await compressOldSpeech(db)).toEqual({ converted: 0, savedBytes: 0 })
    const [m] = await db.select().from(materials).where(eq(materials.id, id))
    expect(m).toMatchObject({ mimeType: 'audio/mpeg', originalFilename: 'say-1.wav' })
    const [b] = await db.select().from(materialBlobs).where(eq(materialBlobs.materialId, id))
    expect(m!.bytes).toBe(b!.data.length)
    expect((await db.select().from(materials).where(eq(materials.id, own)))[0]!.mimeType).toBe('audio/wav')
  })
})
