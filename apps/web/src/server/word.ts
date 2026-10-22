/**
 * Word documents (.docx) for the AI. Gemini can't read Word files, so we open them ourselves with mammoth (free,
 * BSD-2): the text and tables go to the model as simple HTML, and each picture in the document is sent as its own
 * image, marked in the text where it stands ("[Picture 3]"). An exercise that needs a picture then points at it
 * by number and the picture is attached as it is: nothing has to be cut out of a page. Text costs far fewer
 * tokens than a page image, so a Word file is cheaper for the AI than the same pages as a PDF.
 */
import mammoth from 'mammoth'
import sharp from 'sharp'

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
/** Old binary Word (97–2003): no free, reliable reader; the teacher is asked to save it as .docx or PDF */
export const DOC_MIME = 'application/msword'

/** Icons, bullets and decorations are not exercise pictures and would only cost tokens */
const MIN_PICTURE_PX = 64
/** Pictures sent per document; each costs about as much as a page */
export const MAX_DOC_PICTURES = 24
/** Pictures are sent at most this size: enough to read labels, fewer tokens */
const PICTURE_PX = 1024
/** Characters of text counted as one page toward the per-request page limit */
export const CHARS_PER_PAGE = 3500

export type WordDoc = {
  /** The document as simple HTML (headings, paragraphs, lists, tables), pictures replaced by [Picture N] */
  html: string
  /** Characters of plain text, for the page limit */
  textLength: number
  pictures: { mimeType: 'image/jpeg'; dataBase64: string }[]
}

export class WordError extends Error {}

export async function readWord(data: Buffer): Promise<WordDoc> {
  const pictures: WordDoc['pictures'] = []
  let result: { value: string }
  try {
    result = await mammoth.convertToHtml(
      { buffer: data },
      {
        convertImage: mammoth.images.imgElement(async (image) => {
          if (pictures.length >= MAX_DOC_PICTURES) return { src: '' }
          try {
            const img = sharp(await image.readAsBuffer())
            const meta = await img.metadata()
            if ((meta.width ?? 0) < MIN_PICTURE_PX || (meta.height ?? 0) < MIN_PICTURE_PX) return { src: '' }
            // Pictures in a document can be transparent PNGs: put them on white, as they look on the page
            const jpeg = await img
              .rotate()
              .resize({ width: PICTURE_PX, height: PICTURE_PX, fit: 'inside', withoutEnlargement: true })
              .flatten({ background: '#ffffff' })
              .jpeg({ quality: 85 })
              .toBuffer()
            pictures.push({ mimeType: 'image/jpeg', dataBase64: jpeg.toString('base64') })
            return { src: `picture:${pictures.length}` }
          } catch {
            // A format sharp can't open (EMF/WMF drawings): left out
            return { src: '' }
          }
        }),
      },
    )
  } catch {
    throw new WordError('unreadable')
  }
  const html = result.value
    .replace(/<img[^>]*src="picture:(\d+)"[^>]*>/g, ' [Picture $1] ')
    .replace(/<img[^>]*>/g, '')
    // Word's empty paragraphs and anchors add nothing
    .replace(/<a id="[^"]*"><\/a>/g, '')
    .replace(/<p><\/p>/g, '')
  const textLength = html.replace(/<[^>]+>/g, '').trim().length
  return { html, textLength, pictures }
}
