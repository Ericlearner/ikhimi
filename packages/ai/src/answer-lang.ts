/**
 * Language-aware comparison of typed answers (DECISIONS.md AW). What a teacher would accept as the same answer:
 *
 *   Korean    spacing doesn't count (학교에 가요 = 학교에가요); punctuation doesn't count
 *   Chinese   traditional = simplified (學習 = 学习); spaces and full-width punctuation don't count;
 *             pinyin with tone marks = tone numbers (nǐ hǎo = ni3hao3)
 *   Japanese  full-width = half-width (ｶﾀｶﾅ = カタカナ); hiragana = katakana; spaces don't count
 *   Arabic    vowel marks and the stretching line don't count (كَتَبَ = كتب); أ/إ/آ = ا, ة = ه, ى = ي; ٣ = 3
 *
 * One mistyped character is never forgiven in Korean, Chinese or Japanese: one character there is a syllable or
 * a word, often the very grammar form being tested (갔어요 / 갈어요).
 */

export type AnswerLanguage = 'ko' | 'zh' | 'ja' | 'ar'

/** The homework's language as far as answer checking cares (null = the default rules) */
export function answerLanguage(code: string | null | undefined): AnswerLanguage | null {
  const c = (code ?? '').slice(0, 2).toLowerCase()
  return c === 'ko' || c === 'zh' || c === 'ja' || c === 'ar' ? c : null
}

/** Whether a one-character typo may be forgiven in this language */
export const typoAllowed = (lang: AnswerLanguage | null) => lang !== 'ko' && lang !== 'zh' && lang !== 'ja'

/**
 * Traditional → simplified Chinese. The table is large, so the server plugs it in (setChineseConverter) and the
 * browser never loads it; without it, Chinese is still compared, just not across the two scripts.
 */
let toSimplified: ((s: string) => string) | null = null
export function setChineseConverter(fn: ((s: string) => string) | null) {
  toSimplified = fn
}

const SPACES_AND_PUNCT = /[\s\p{P}]+/gu
const HAN = /\p{Script=Han}/u
const LATIN = /[a-z]/i

/** Pinyin as letters + the tones in order: nǐ hǎo, ni3 hao3 and Ni3hao3 all become "nihao|33"; ü = v */
export function pinyinKey(s: string): string {
  const TONE: Record<string, string> = { '\u0304': '1', '\u0301': '2', '\u030C': '3', '\u0300': '4' }
  let letters = ''
  let tones = ''
  for (const ch of s.normalize('NFD').toLowerCase().replace(/u:/g, 'v')) {
    if (TONE[ch]) tones += TONE[ch]
    else if (ch === '\u0308') letters = letters.replace(/u$/, 'v') // ü
    else if (ch >= '1' && ch <= '4') tones += ch
    else if (/[a-z]/.test(ch)) letters += ch
    // spaces, apostrophes (xi'an), hyphens, neutral tones 5/0 and anything else don't count
  }
  return `${letters}|${tones}`
}

const ARABIC_MARKS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g

/** The language's own normal form of an answer (callers have already NFC-ed, lowercased and trimmed it) */
export function normalizeForLanguage(s: string, lang: AnswerLanguage): string {
  switch (lang) {
    case 'ko':
      return s.normalize('NFKC').replace(SPACES_AND_PUNCT, '')
    case 'ja':
      return s
        .normalize('NFKC')
        .replace(/[\u30A1-\u30F6]/g, (k) => String.fromCharCode(k.charCodeAt(0) - 0x60)) // katakana → hiragana
        .replace(SPACES_AND_PUNCT, '')
    case 'zh': {
      const t = s.normalize('NFKC')
      // An answer in pinyin (Latin letters, no characters) is compared as pinyin
      if (!HAN.test(t) && LATIN.test(t)) return pinyinKey(t)
      return (toSimplified ? toSimplified(t) : t).replace(SPACES_AND_PUNCT, '').toLowerCase()
    }
    case 'ar':
      return s
        .normalize('NFKC')
        .replace(ARABIC_MARKS, '')
        .replace(/[\u0622\u0623\u0625\u0671]/g, '\u0627')
        .replace(/\u0629/g, '\u0647')
        .replace(/\u0649/g, '\u064A')
        .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
        .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
        .replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, '')
        .replace(/\s+/g, ' ')
  }
}
