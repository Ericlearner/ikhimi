/**
 * Pictures inside exercises, in both Create and Digitize: when an item needs a picture from the materials ("What is
 * in picture 3?", "Match the words to the pictures"), the model says where it is and we cut that part out here like
 * a screenshot, store it as the teacher's own image material, and link it from the item (payload.imageId). Students
 * then see the picture above the question. Only the pictures the chosen items use are ever cut.
 */
import sharp from 'sharp'
import { materialBlobs, materials, type Db } from '@ikhimi/db'
import { WHOLE_PAGE, type DraftExercise, type ImageRef, type Material } from '@ikhimi/ai'
import { renderPdfPage } from './pdf-pages'

/**
 * Cut a 0–1000 box ([ymin, xmin, ymax, xmax]) out of an image like a screenshot: a generous margin so a rough box
 * still holds the whole picture, then plain white edges trimmed off. JPEG, at most 1200 px.
 */
export async function cropBox(image: Buffer, box: [number, number, number, number]): Promise<Buffer> {
  // Orientation from EXIF is applied first, as the model saw the photo upright
  const upright = await sharp(image).rotate().toBuffer({ resolveWithObject: true })
  const { width, height } = upright.info
  const pad = 0.04
  const [y0, x0, y1, x1] = box.map((v) => v / 1000)
  const left = Math.max(0, Math.floor((x0! - pad) * width))
  const top = Math.max(0, Math.floor((y0! - pad) * height))
  const right = Math.min(width, Math.ceil((x1! + pad) * width))
  const bottom = Math.min(height, Math.ceil((y1! + pad) * height))
  const cut = await sharp(upright.data)
    .extract({ left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) })
    .toBuffer()
  return sharp(await trimWhite(cut))
    .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 85 })
    .toBuffer()
}

/** Remove plain white borders (page margins); anything else, or a trim that fails, keeps the cut as it is */
async function trimWhite(img: Buffer): Promise<Buffer> {
  try {
    const { data, info } = await sharp(img).trim({ background: '#ffffff', threshold: 25 }).toBuffer({ resolveWithObject: true })
    return info.width >= 24 && info.height >= 24 ? data : img
  } catch {
    return img
  }
}

/**
 * The photo, PDF page or Word picture an item's picture is on, as an image we can cut. Only this one PDF page is
 * drawn; a Word picture is already a picture of its own.
 */
async function pageImage(ref: ImageRef, sources: Material[]): Promise<Buffer> {
  const src = sources[ref.material - 1]
  if (src?.pictures) {
    const pic = ref.picture ? src.pictures[ref.picture - 1] : undefined
    if (!pic) throw new Error(`no picture ${ref.picture}`)
    return Buffer.from(pic.dataBase64, 'base64')
  }
  if (src?.mimeType.startsWith('image/')) return Buffer.from(src.dataBase64, 'base64')
  if (src?.mimeType === 'application/pdf') return renderPdfPage(Buffer.from(src.dataBase64, 'base64'), ref.page ?? 1)
  throw new Error('no page image')
}

/**
 * For every item that points at a picture: cut it out, store it, and set payload.imageId. The same box on the
 * same page is stored once. A box that won't cut falls back to the whole page; an item we still can't serve is
 * flagged image_missing, and settlePictures takes it out of the homework.
 */
export async function attachPictures(db: Db, teacherId: string, exercises: DraftExercise[], sources: Material[]) {
  const done = new Map<string, string>()
  const pages = new Map<string, Promise<Buffer>>()
  for (const e of exercises) {
    const ref = e.imageRef
    if (!ref) continue
    const pageKey = `${ref.material}:${ref.page ?? 1}:${ref.picture ?? 0}`
    const key = `${pageKey}:${ref.box.join(',')}`
    try {
      let id = done.get(key)
      if (!id) {
        if (!pages.has(pageKey)) pages.set(pageKey, pageImage(ref, sources))
        const page = await pages.get(pageKey)!
        const jpeg = await cropBox(page, ref.box).catch(() => cropBox(page, WHOLE_PAGE))
        const [m] = await db
          .insert(materials)
          .values({ teacherId, kind: 'image', originalFilename: `picture-${ref.material}${ref.page ? `-p${ref.page}` : ''}${ref.picture ? `-${ref.picture}` : ''}.jpg`, mimeType: 'image/jpeg', bytes: jpeg.length, processingStatus: 'ready' })
          .returning({ id: materials.id })
        await db.insert(materialBlobs).values({ materialId: m!.id, data: jpeg })
        id = m!.id
        done.set(key, id)
      }
      e.payload = { ...e.payload, imageId: id }
    } catch (err) {
      console.warn('[pictures] crop failed', err)
      if (!e.flags.includes('image_missing')) e.flags.push('image_missing')
    }
  }
}
