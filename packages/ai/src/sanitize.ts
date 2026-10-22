/**
 * The AI boundary (§6, §16). Nothing reaches an external model without passing through here.
 *
 * Learning content only: student/teacher names, phone numbers, resident registration numbers, ids, emails,
 * handles and card numbers are replaced with opaque tokens (`[[P1]]`, `[[N2]]`…). `restore()` maps model output
 * back so the teacher still sees real names where the model echoed a token.
 *
 * `assertNoPII()` is the last-line check the Claude client runs on every outgoing payload; it
 * throws instead of sending.
 */

export type SanitizeOptions = {
  /** Names known to belong to real people in this context (students of the group, the teacher). */
  knownNames?: string[]
}

export type SanitizeResult = {
  text: string
  /** token → original */
  tokens: Record<string, string>
  restore: (modelOutput: string) => string
}

export class PIIError extends Error {
  constructor(public readonly kinds: string[]) {
    super(`Refusing to send PII to an external model: ${kinds.join(', ')}`)
    this.name = 'PIIError'
  }
}

type Detector = { kind: string; prefix: string; re: RegExp }

// Order matters: more specific patterns first so a card number isn't eaten as a phone.
const DETECTORS: Detector[] = [
  { kind: 'email', prefix: 'E', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  // 16-digit payment cards, with optional separators
  { kind: 'card', prefix: 'C', re: /\b(?:\d{4}[ -]?){3}\d{4}\b/g },
  // Resident registration numbers (주민등록번호): YYMMDD-NNNNNNN
  { kind: 'rrn', prefix: 'R', re: /(?<!\d)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])[\s-]?[1-8]\d{6}(?!\d)/g },
  // Korean mobiles in any common formatting: 010-1234-5678, 01012345678, +82 10 1234 5678
  { kind: 'phone', prefix: 'P', re: /(?<![\d+])(?:\+?82[\s-]?0?|0)1[016789][\s-]?\d{3,4}[\s-]?\d{4}(?!\d)/g },
  // Korean landlines: 02-123-4567, 031-123-4567
  { kind: 'phone', prefix: 'P', re: /(?<![\d+])0(?:2|[3-6][1-5])[\s-]?\d{3,4}[\s-]?\d{4}(?!\d)/g },
  // Any other international-looking number with 10+ digits
  { kind: 'phone', prefix: 'P', re: /\+\d[\d\s()-]{8,}\d/g },
  // ULIDs — our user/attempt ids
  { kind: 'id', prefix: 'I', re: /\b[0-9A-HJKMNP-TV-Z]{26}\b/g },
  // Telegram handles
  { kind: 'handle', prefix: 'H', re: /(?<![\w.])@[A-Za-z][A-Za-z0-9_]{4,31}\b/g },
]

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const HANGUL = /\p{Script=Hangul}/u

/** Apostrophe variants are equivalent in Latin-script names (O'Brien / O’Brien). */
function namePattern(name: string): string {
  return escapeRe(name.trim()).replace(/['ʻʼ’‘`]/g, "['ʻʼ’‘`]").replace(/\s+/g, '\\s+')
}

export function sanitizeForLLM(input: string, opts: SanitizeOptions = {}): SanitizeResult {
  const tokens: Record<string, string> = {}
  const seen = new Map<string, string>() // original → token, so repeats get the same token
  const counters: Record<string, number> = {}
  let text = input

  const tokenFor = (prefix: string, original: string) => {
    const key = `${prefix}:${original}`
    let tok = seen.get(key)
    if (!tok) {
      counters[prefix] = (counters[prefix] ?? 0) + 1
      tok = `[[${prefix}${counters[prefix]}]]`
      seen.set(key, tok)
      tokens[tok] = original
    }
    return tok
  }

  // Names first (longest first, so "김지은" wins over "지은")
  const names = [...new Set((opts.knownNames ?? []).flatMap(expandName))]
    .filter((n) => n.length >= 2)
    .sort((a, b) => b.length - a.length)
  for (const name of names) {
    // Korean particles attach straight to a name (지은이는, 김지은의): a Hangul name may be followed by any letter
    const re = HANGUL.test(name)
      ? new RegExp(`(?<![\\p{Script=Hangul}])${namePattern(name)}`, 'gu')
      : new RegExp(`(?<![\\p{L}])${namePattern(name)}(?![\\p{L}])`, 'giu')
    text = text.replace(re, (m) => tokenFor('N', m))
  }

  for (const d of DETECTORS) {
    text = text.replace(d.re, (m) => {
      // Don't re-tokenise our own tokens, and ignore short digit runs that are clearly not phones
      if (/^\[\[/.test(m)) return m
      if (d.kind === 'phone' && m.replace(/\D/g, '').length < 9) return m
      return tokenFor(d.prefix, m)
    })
  }

  const restore = (out: string) => out.replace(/\[\[[A-Z]\d+\]\]/g, (tok) => tokens[tok] ?? tok)
  return { text, tokens, restore }
}

/**
 * Full name plus each part ≥3 letters, so "Anna" alone is caught when "Anna Kim" is known. A Korean name written
 * together (김지은) also gives the given name without the one-syllable family name (지은), which is how people are called.
 */
function expandName(full: string): string[] {
  const name = full.trim()
  const parts = name.split(/\s+/).filter((p) => p.length >= 3 || (HANGUL.test(p) && p.length >= 2))
  const given = /^\p{Script=Hangul}{3,4}$/u.test(name) ? [name.slice(1)] : []
  return [name, ...parts, ...given]
}

/**
 * Throws if the payload still contains anything that looks like PII.
 * Run on the serialized request body immediately before it leaves the server.
 */
export function assertNoPII(payload: string, opts: SanitizeOptions = {}): void {
  const { tokens } = sanitizeForLLM(payload, opts)
  const kinds = new Set<string>()
  for (const tok of Object.keys(tokens)) {
    const prefix = tok.slice(2, 3)
    kinds.add(
      { E: 'email', C: 'card', R: 'rrn', P: 'phone', I: 'id', H: 'handle', N: 'name' }[prefix] ?? 'unknown',
    )
  }
  if (kinds.size) throw new PIIError([...kinds])
}
