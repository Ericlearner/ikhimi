/**
 * Draw ONE page of a PDF as an image, on the server, so a picture on it can be cut out (pictures.ts). Only pages
 * that hold a picture a chosen exercise needs are ever drawn: usually one to three per homework, about a second
 * each. pdf.js (Mozilla, Apache-2.0) reads the PDF; @napi-rs/canvas draws it. Both are loaded only when needed.
 */
import { createRequire } from 'node:module'
import path from 'node:path'

/** Longest side of the drawn page: small labels in book pictures stay readable after cropping */
const PAGE_PX = 2000

/** pdf.js reads its fonts, character maps and image decoders from files next to it */
function assetDirs() {
  const require = createRequire(path.join(process.cwd(), 'package.json'))
  const root = path.dirname(require.resolve('pdfjs-dist/package.json'))
  return {
    standardFontDataUrl: path.join(root, 'standard_fonts') + path.sep,
    cMapUrl: path.join(root, 'cmaps') + path.sep,
    wasmUrl: path.join(root, 'wasm') + path.sep,
  }
}

export async function renderPdfPage(pdfBytes: Buffer, pageNumber: number): Promise<Buffer> {
  const [pdfjs, { createCanvas }] = await Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('@napi-rs/canvas'),
    // The parser runs in this thread (no worker threads on the server); importing it here also ships it
    import('pdfjs-dist/legacy/build/pdf.worker.mjs'),
  ])
  const task = pdfjs.getDocument({
    data: new Uint8Array(pdfBytes),
    disableFontFace: true,
    cMapPacked: true,
    ...assetDirs(),
  })
  try {
    const pdf = await task.promise
    if (pageNumber < 1 || pageNumber > pdf.numPages) throw new Error(`no page ${pageNumber} (of ${pdf.numPages})`)
    const page = await pdf.getPage(pageNumber)
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: PAGE_PX / Math.max(base.width, base.height) })
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
    const ctx = canvas.getContext('2d')
    // Pages without a background are transparent; a book page is white
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    // pdf.js types expect the browser canvas; @napi-rs/canvas implements the same drawing API
    await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, canvas: canvas as unknown as HTMLCanvasElement, viewport }).promise
    return canvas.encode('jpeg', 92)
  } finally {
    await task.destroy()
  }
}
