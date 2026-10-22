import { PDFDocument, rgb } from 'pdf-lib'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { createTestDb } from '@ikhimi/db/testing'
import { eq, materialBlobs, users } from '@ikhimi/db'
import type { DraftExercise } from '@ikhimi/ai'
import { attachPictures, cropBox } from './pictures'

/** 1000×500 white photo with a red square at x 600–800, y 100–300 */
async function photo() {
  const red = await sharp({ create: { width: 200, height: 200, channels: 3, background: { r: 255, g: 0, b: 0 } } }).png().toBuffer()
  return sharp({ create: { width: 1000, height: 500, channels: 3, background: { r: 255, g: 255, b: 255 } } })
    .composite([{ input: red, left: 600, top: 100 }])
    .jpeg()
    .toBuffer()
}

const item = (imageRef: DraftExercise['imageRef']): DraftExercise => ({
  kind: 'short_answer',
  prompt: 'What colour is it?',
  payload: { exactSpelling: false },
  answerKey: { accepted: ['red'] },
  points: 1,
  skill: 'vocabulary',
  explanation: '',
  sourceRef: null,
  estimatedSeconds: 30,
  flags: [],
  aiConfidence: 0.9,
  imageRef,
})

describe('pictures', () => {
  it('cuts the boxed area (0–1000 coordinates) and trims the white margin', async () => {
    // y 100–300 of 500 → 200–600; x 600–800 of 1000 → 600–800
    const out = await cropBox(await photo(), [200, 600, 600, 800])
    const meta = await sharp(out).metadata()
    expect(meta.width).toBeGreaterThanOrEqual(195)
    expect(meta.width).toBeLessThan(215)
    const { dominant } = await sharp(out).stats()
    expect(dominant.r).toBeGreaterThan(200)
    expect(dominant.g).toBeLessThan(80)
  })

  it('a rough box still holds the whole picture', async () => {
    // Box cuts 20 px off the square's right side; the margin brings it back
    const out = await cropBox(await photo(), [200, 600, 600, 780])
    expect((await sharp(out).metadata()).width).toBeGreaterThanOrEqual(195)
  })

  it('stores each picture once, links it from every item that uses it, and flags items it cannot serve', async () => {
    const db = await createTestDb()
    const [t] = await db.insert(users).values({ role: 'teacher', phone: '+998900000001', fullName: 'T' }).returning()
    const src = { label: 'p.jpg', mimeType: 'image/jpeg', dataBase64: (await photo()).toString('base64') }
    const pdf = { label: 'b.pdf', mimeType: 'application/pdf', dataBase64: 'JVBERi0=' }
    const box: [number, number, number, number] = [200, 600, 600, 800]
    const items = [item({ material: 1, box }), item({ material: 1, box }), item({ material: 2, box }), item(null)]
    await attachPictures(db, t!.id, items, [src, pdf])
    expect(items[0]!.payload.imageId).toBeTruthy()
    expect(items[1]!.payload.imageId).toBe(items[0]!.payload.imageId)
    expect(items[2]!.flags).toContain('image_missing')
    expect(items[3]!.payload.imageId).toBeUndefined()
    const [blob] = await db.select().from(materialBlobs).where(eq(materialBlobs.materialId, items[0]!.payload.imageId as string))
    expect((await sharp(Buffer.from(blob!.data)).metadata()).format).toBe('jpeg')
  })

  it('cuts a picture out of one page of a PDF, drawing only that page', async () => {
    // A4-ish page 2 of 2: red square at x 300–500, y 200–400 from the top of an 600×800 page
    const doc = await PDFDocument.create()
    doc.addPage([600, 800]).drawText('Page one', { x: 50, y: 700, size: 30 })
    const page2 = doc.addPage([600, 800])
    page2.drawText('4. Look at the picture', { x: 50, y: 700, size: 24 })
    page2.drawRectangle({ x: 300, y: 400, width: 200, height: 200, color: rgb(1, 0, 0) })
    const pdf = { label: 'book.pdf', mimeType: 'application/pdf', dataBase64: Buffer.from(await doc.save()).toString('base64'), pages: 2 }
    const db = await createTestDb()
    const [t] = await db.insert(users).values({ role: 'teacher', phone: '+998900000002', fullName: 'T' }).returning()
    // y 200–400 of 800 → 250–500; x 300–500 of 600 → 500–833
    const items = [item({ material: 1, page: 2, box: [250, 500, 500, 833] }), item({ material: 1, page: 9, box: [250, 500, 500, 833] })]
    await attachPictures(db, t!.id, items, [pdf])
    const [blob] = await db.select().from(materialBlobs).where(eq(materialBlobs.materialId, items[0]!.payload.imageId as string))
    const { dominant } = await sharp(Buffer.from(blob!.data)).stats()
    expect(dominant.r).toBeGreaterThan(200)
    expect(dominant.g).toBeLessThan(80)
    // A page that isn't in the file: flagged, and settlePictures takes the item out
    expect(items[1]!.flags).toContain('image_missing')
  })
})
