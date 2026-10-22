/**
 * WCAG contrast check computed from tokens.css (design spec §16). Fails CI below 4.5:1 for text pairs,
 * in both themes.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const css = readFileSync(fileURLToPath(new URL('../src/tokens.css', import.meta.url)), 'utf8')

function block(selectorStart: string): Record<string, string> {
  const i = css.indexOf(selectorStart)
  if (i < 0) throw new Error(`selector not found: ${selectorStart}`)
  const open = css.indexOf('{', i)
  let depth = 0
  let j = open
  for (; j < css.length; j++) {
    if (css[j] === '{') depth++
    if (css[j] === '}' && --depth === 0) break
  }
  const out: Record<string, string> = {}
  for (const m of css.slice(open + 1, j).matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\b/g)) out[m[1]!] = m[2]!
  return out
}

const light = block(':root {')
const dark = { ...light, ...block(":root[data-theme='dark']") }

const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!
}
export const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x! + 0.05) / (y! + 0.05)
}

// [foreground, background, what it is]
const PAIRS: [string, string, string][] = [
  ['--ink-700', '--paper-100', 'body text'],
  ['--ink-700', '--paper-50', 'text on cards'],
  ['--ink-500', '--paper-100', 'secondary text'],
  ['--ink-400', '--paper-100', 'muted text'],
  ['--ink-400', '--paper-50', 'muted text on cards'],
  ['--ink-400', '--paper-200', 'muted text on chips'],
  ['--on-orange', '--orange-500', 'primary button label'],
  ['--orange-700', '--paper-100', 'small orange emphasis'],
  ['--orange-700', '--orange-100', 'orange text on orange tint'],
  ['--success-600', '--success-100', 'correct answer'],
  ['--warn-600', '--warn-100', 'verification warning'],
  ['--error-600', '--error-100', 'incorrect answer'],
  ['--error-600', '--paper-100', 'error text'],
  ['--success-600', '--paper-50', 'success text on card'],
  ['--warn-600', '--paper-50', 'warning text on card'],
  ['--paper-50', '--ink-700', 'avatar initials (navy)'],
  ['--paper-50', '--orange-700', 'avatar initials (orange)'],
  ['--paper-50', '--gold-avatar', 'avatar initials (gold)'],
  ['--paper-50', '--success-600', 'avatar initials (green)'],
  ['--paper-50', '--teal-avatar', 'avatar initials (teal)'],
  ['--paper-50', '--plum-avatar', 'avatar initials (plum)'],
  ['--vip-text', '--vip-bg', 'VIP card text'],
  ['--vip-soft', '--vip-bg', 'VIP card soft text'],
  ['--vip-gold', '--vip-bg', 'VIP card gold text'],
]

let failed = false
for (const [name, t] of [['light', light], ['dark', dark]] as const) {
  for (const [fg, bg, what] of PAIRS) {
    const a = t[fg]
    const b = t[bg]
    if (!a || !b) {
      console.log(`✗ ${name}: ${fg} / ${bg} — token missing`)
      failed = true
      continue
    }
    const r = ratio(a, b)
    const ok = r >= 4.5
    if (!ok) failed = true
    console.log(`${ok ? '✓' : '✗'} ${name.padEnd(5)} ${r.toFixed(2).padStart(5)}:1  ${fg} on ${bg}  (${what})`)
  }
}

// For the record: the spec's original values that were adjusted
const SPEC_ORIGINALS: [string, string, string][] = [
  ['#6B7A88', light['--paper-100']!, 'spec --ink-400 on paper-100'],
  ['#C96A2A', light['--paper-100']!, 'spec --orange-700 on paper-100'],
  ['#C87A22', light['--warn-100']!, 'spec --warn-600 on warn-100'],
  ['#8B98A4', dark['--paper-50']!, 'spec dark --ink-400 on paper-50'],
]
console.log('\nSpec originals (for reference):')
for (const [a, b, what] of SPEC_ORIGINALS) console.log(`  ${ratio(a, b).toFixed(2)}:1  ${what}`)

if (failed) {
  console.error('\nContrast check failed (WCAG AA 4.5:1 for text).')
  process.exit(1)
}
