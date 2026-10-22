import { Document, ImageRun, Packer, Paragraph, Table, TableCell, TableRow, TextRun } from 'docx'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { createTestDb } from '@ikhimi/db/testing'
import { eq, materialBlobs, materials, users } from '@ikhimi/db'
import type { DraftExercise } from '@ikhimi/ai'
import { loadMaterialsForLlm, MaterialError } from './materials'
import { attachPictures } from './pictures'
import { DOC_MIME, DOCX_MIME, readWord } from './word'

const square = (size: number, rgb: { r: number; g: number; b: number }) =>
  sharp({ create: { width: size, height: size, channels: 3, background: rgb } }).png().toBuffer()

/** A worksheet: an exercise, a 16 px icon (decoration), a red picture, a table, a blue picture */
async function worksheet() {
  const image = async (size: number, rgb: { r: number; g: number; b: number }) =>
    new ImageRun({ type: 'png', data: await square(size, rgb), transformation: { width: size, height: size } })
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ children: [new TextRun({ text: '4. Look at the pictures and answer.', bold: true })] }),
          new Paragraph({ children: [await image(16, { r: 0, g: 200, b: 0 })] }),
          new Paragraph({ children: [await image(200, { r: 255, g: 0, b: 0 })] }),
          new Paragraph('a) What colour is picture A?'),
          new Table({ rows: [new TableRow({ children: [new TableCell({ children: [new Paragraph('apple')] }), new TableCell({ children: [new Paragraph('sky')] })] })] }),
          new Paragraph({ children: [await image(150, { r: 0, g: 0, b: 255 })] }),
        ],
      },
    ],
  })
  return Packer.toBuffer(doc)
}

const item = (imageRef: DraftExercise['imageRef']): DraftExercise => ({
  kind: 'short_answer',
  prompt: 'What colour is picture A?',
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

describe('Word documents', () => {
  it('reads the text and tables, and numbers the pictures where they stand, leaving icons out', async () => {
    const doc = await readWord(await worksheet())
    expect(doc.html).toContain('Look at the pictures and answer.')
    expect(doc.html).toContain('<table>')
    expect(doc.html).toContain('<td><p>apple</p></td>')
    expect(doc.pictures).toHaveLength(2)
    expect(doc.html.indexOf('[Picture 1]')).toBeLessThan(doc.html.indexOf('What colour'))
    expect(doc.html.indexOf('[Picture 2]')).toBeGreaterThan(doc.html.indexOf('apple'))
    expect(doc.html).not.toContain('<img')
    expect((await sharp(Buffer.from(doc.pictures[0]!.dataBase64, 'base64')).stats()).dominant.r).toBeGreaterThan(200)
  })

  it('goes to the model as text plus pictures, and the item gets the picture it names', async () => {
    const db = await createTestDb()
    const [t] = await db.insert(users).values({ role: 'teacher', phone: '+998900000003', fullName: 'T' }).returning()
    const [m] = await db
      .insert(materials)
      .values({ teacherId: t!.id, kind: 'doc', originalFilename: 'sheet.docx', mimeType: DOCX_MIME, processingStatus: 'ready' })
      .returning()
    await db.insert(materialBlobs).values({ materialId: m!.id, data: await worksheet() })
    const loaded = await loadMaterialsForLlm(db, t!.id, [m!.id])
    expect(loaded[0]!.text).toContain('[Picture 2]')
    expect(loaded[0]!.pictures).toHaveLength(2)
    expect(loaded[0]!.dataBase64).toBe('')

    const items = [item({ material: 1, picture: 2, box: [0, 0, 1000, 1000] }), item({ material: 1, picture: 7, box: [0, 0, 1000, 1000] })]
    await attachPictures(db, t!.id, items, loaded)
    const [blob] = await db.select().from(materialBlobs).where(eq(materialBlobs.materialId, items[0]!.payload.imageId as string))
    expect((await sharp(Buffer.from(blob!.data)).stats()).dominant.b).toBeGreaterThan(200)
    expect(items[1]!.flags).toContain('image_missing')
  })

  it('an old .doc file is refused with a clear reason', async () => {
    const db = await createTestDb()
    const [t] = await db.insert(users).values({ role: 'teacher', phone: '+998900000004', fullName: 'T' }).returning()
    const [m] = await db
      .insert(materials)
      .values({ teacherId: t!.id, kind: 'doc', originalFilename: 'old.doc', mimeType: DOC_MIME, processingStatus: 'ready' })
      .returning()
    await expect(loadMaterialsForLlm(db, t!.id, [m!.id])).rejects.toEqual(new MaterialError('doc_old'))
  })
})
