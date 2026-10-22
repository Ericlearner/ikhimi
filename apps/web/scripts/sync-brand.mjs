// Copies the committed brand assets into public/ (never edits them) and builds the app-icon tile:
// orange cap mark on a navy rounded square, corner radius 22% (§4).
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../../brand/', import.meta.url))
const out = fileURLToPath(new URL('../public/brand/', import.meta.url))
mkdirSync(out, { recursive: true })
// The quill lockup is archived — deliberately not published.
for (const f of ['ikhimi-logo-primary.svg', 'ikhimi-logo-inverse.svg', 'ikhimi-mark.svg', 'ikhimi-mark-inverse.svg']) {
  copyFileSync(root + f, out + f)
}

const mark = readFileSync(root + 'ikhimi-mark-inverse.svg', 'utf8')
const viewBox = /viewBox="([^"]+)"/.exec(mark)[1]
const inner = mark.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')
const size = 512
const pad = size * 0.14
const tile = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
<rect width="${size}" height="${size}" rx="${size * 0.22}" fill="#2C3E50"/>
<svg x="${pad}" y="${pad}" width="${size - 2 * pad}" height="${size - 2 * pad}" viewBox="${viewBox}">${inner}</svg>
</svg>
`
writeFileSync(out + 'app-icon.svg', tile)
console.log('brand assets synced')
