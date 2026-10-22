/**
 * Glyph check (design spec §3). Opens the actual woff2 files the app ships and asserts every required code point maps
 * to a real glyph (not .notdef / tofu). Fails the build otherwise. Hangul is not in these fonts on purpose: it comes
 * from the device's Korean font (base.css).
 * If Literata ever fails, the spec's fallback is PT Serif.
 */
import { createRequire } from 'node:module'
import * as fontkit from 'fontkit'

const require = createRequire(import.meta.url)

const REQUIRED = {
  'Russian Cyrillic': 'АаБбЁёЖжЩщЫыЭэЮюЯя',
  'Latin': 'AaGgOoQqXx',
}

const FONTS: { name: string; pkg: string; files: string[] }[] = [
  {
    // Literata was the first choice but has no Ҳ/ҳ (checked 2026-09); PT Serif is the spec's fallback.
    name: 'PT Serif (display)',
    pkg: '@fontsource/pt-serif',
    files: ['latin', 'latin-ext', 'cyrillic', 'cyrillic-ext'].map((s) => `files/pt-serif-${s}-700-normal.woff2`),
  },
  {
    name: 'Inter (UI)',
    pkg: '@fontsource-variable/inter',
    files: ['latin', 'latin-ext', 'cyrillic', 'cyrillic-ext'].map((s) => `files/inter-${s}-wght-normal.woff2`),
  },
  {
    // The AI tutor's voice: rounded and friendly, in italics
    name: 'Nunito Italic (tutor)',
    pkg: '@fontsource-variable/nunito',
    files: ['latin', 'latin-ext', 'cyrillic', 'cyrillic-ext'].map((s) => `files/nunito-${s}-wght-italic.woff2`),
  },
]

// Fonts are used as stacks: display text falls back per glyph to Inter (already loaded, zero extra bytes).
const STACKS: Record<string, string[]> = {
  'Display stack (PT Serif → Inter)': ['PT Serif (display)', 'Inter (UI)'],
  'UI stack (Inter)': ['Inter (UI)'],
  'Tutor stack (Nunito Italic → Inter)': ['Nunito Italic (tutor)', 'Inter (UI)'],
}

const loaded = new Map<string, fontkit.Font[]>()
for (const font of FONTS) {
  const base = require.resolve(`${font.pkg}/package.json`).replace(/package\.json$/, '')
  loaded.set(font.name, font.files.map((f) => fontkit.openSync(base + f) as fontkit.Font))
}
const has = (faces: fontkit.Font[], cp: number) => faces.some((f) => f.hasGlyphForCodePoint(cp) && f.glyphForCodePoint(cp).id !== 0)

let failed = false
for (const [stackName, members] of Object.entries(STACKS)) {
  for (const [label, chars] of Object.entries(REQUIRED)) {
    const notes: string[] = []
    const missing = [...chars].filter((ch) => {
      const cp = ch.codePointAt(0)!
      const idx = members.findIndex((m) => has(loaded.get(m)!, cp))
      if (idx > 0) notes.push(`${ch} from ${members[idx]}`)
      return idx === -1
    })
    if (missing.length) failed = true
    console.log(
      `${missing.length ? '✗' : '✓'} ${stackName} — ${label}` +
        (missing.length ? `: MISSING ${missing.join(' ')}` : notes.length ? ` (fallback: ${notes.join(', ')})` : ''),
    )
  }
}
if (failed) {
  console.error('\nGlyph check failed. Do not ship a font that tofu-boxes on the languages taught (spec §3).')
  process.exit(1)
}
