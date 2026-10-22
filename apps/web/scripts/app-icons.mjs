// Renders the PNG app icons Android and the stores need (public/icons/) from the brand mark: orange cap mark on navy.
// "any": the rounded tile; "maskable": full-bleed navy with the mark inside the 80% safe zone, so any launcher shape
// crops only background. Also the iOS app's icon and launch logo (apps/ios). Run once after the mark changes:
// node scripts/app-icons.mjs (on a Mac: the iOS icon goes through `sips`)
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createCanvas, loadImage } from '@napi-rs/canvas'

const brand = fileURLToPath(new URL('../../../brand/', import.meta.url))
const out = fileURLToPath(new URL('../public/icons/', import.meta.url))
mkdirSync(out, { recursive: true })
const mark = readFileSync(brand + 'ikhimi-mark-inverse.svg', 'utf8')
const viewBox = /viewBox="([^"]+)"/.exec(mark)[1]
const inner = mark.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')

const svg = (size, { radius, pad }) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
<rect width="${size}" height="${size}" rx="${radius}" fill="#2C3E50"/>
<svg x="${pad}" y="${pad}" width="${size - 2 * pad}" height="${size - 2 * pad}" viewBox="${viewBox}">${inner}</svg>
</svg>`

async function render(name, size, opts) {
  const img = await loadImage(Buffer.from(svg(size, opts)))
  const c = createCanvas(size, size)
  c.getContext('2d').drawImage(img, 0, 0, size, size)
  writeFileSync(out + name, c.toBuffer('image/png'))
}

await render('icon-512.png', 512, { radius: 512 * 0.22, pad: 512 * 0.14 })
await render('icon-192.png', 192, { radius: 192 * 0.22, pad: 192 * 0.14 })
await render('maskable-512.png', 512, { radius: 0, pad: 512 * 0.24 })
// The Play Store listing icon: 512×512, full square (Play rounds the corners itself)
await render('play-icon-512.png', 512, { radius: 0, pad: 512 * 0.16 })
console.log('icons written to public/icons')

// iOS: a full square (iOS rounds the corners) with no transparency at all, which the App Store requires: drawn as a
// JPEG, then turned into a PNG without an alpha channel
const assets = fileURLToPath(new URL('../../ios/Ikhimi/Assets.xcassets/', import.meta.url))
{
  const img = await loadImage(Buffer.from(svg(1024, { radius: 0, pad: 1024 * 0.16 })))
  const c = createCanvas(1024, 1024)
  c.getContext('2d').drawImage(img, 0, 0, 1024, 1024)
  const jpg = assets + 'AppIcon.appiconset/icon.jpg'
  writeFileSync(jpg, c.toBuffer('image/jpeg', 100))
  execFileSync('sips', ['-s', 'format', 'png', jpg, '--out', assets + 'AppIcon.appiconset/icon-1024.png'], { stdio: 'ignore' })
  rmSync(jpg)
}
// The launch screen's logo: the mark alone (the screen itself is navy), 96pt
const markOnly = (size) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${size}" height="${size}">${inner}</svg>`
for (const scale of [1, 2, 3]) {
  const size = 96 * scale
  const img = await loadImage(Buffer.from(markOnly(size)))
  const c = createCanvas(size, size)
  c.getContext('2d').drawImage(img, 0, 0, size, size)
  writeFileSync(assets + `LaunchLogo.imageset/launch-logo@${scale}x.png`, c.toBuffer('image/png'))
}
console.log('iOS icon and launch logo written to apps/ios')
