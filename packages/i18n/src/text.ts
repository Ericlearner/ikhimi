/** All apostrophe forms users actually type, normalised to ASCII `'` (don’t ≡ don't when checking answers). */
const APOSTROPHES = /[ʻʼ’‘`´]/g

export function normalizeApostrophes(s: string): string {
  return s.replace(APOSTROPHES, "'")
}
