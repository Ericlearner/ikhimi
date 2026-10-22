import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as OpenCC from 'opencc-js/t2cn'
import { pinyinKey, setChineseConverter } from './answer-lang'
import { textMatches } from './exercises'

const ok = (given: string, accepted: string[], language: string, typo: number | null = 4) => textMatches(given, accepted, false, { typoToleranceMinLength: typo, language })

beforeAll(() => setChineseConverter(OpenCC.Converter({ from: 't', to: 'cn' })))
afterAll(() => setChineseConverter(null))

describe('Korean', () => {
  it('spacing and punctuation do not count', () => {
    expect(ok('학교에가요', ['학교에 가요'], 'ko')).toBe(true)
    expect(ok('학교에  가요.', ['학교에 가요'], 'ko')).toBe(true)
    expect(ok('네 맞아요', ['네, 맞아요'], 'ko')).toBe(true)
  })
  it('a different syllable is a different answer, never a forgiven typo', () => {
    expect(ok('갈어요', ['갔어요'], 'ko')).toBe(false)
    expect(ok('어제 학교에 갈어요', ['어제 학교에 갔어요'], 'ko')).toBe(false)
  })
})

describe('Chinese', () => {
  it('traditional = simplified, spaces and full-width punctuation do not count', () => {
    expect(ok('學習', ['学习'], 'zh')).toBe(true)
    expect(ok('我 是 学生。', ['我是学生'], 'zh')).toBe(true)
    expect(ok('我是學生！', ['我是学生'], 'zh')).toBe(true)
  })
  it('pinyin: tone marks = tone numbers, spacing and case do not count, tones do', () => {
    expect(ok('ni3 hao3', ['nǐ hǎo'], 'zh')).toBe(true)
    expect(ok('Nǐhǎo', ['nǐ hǎo'], 'zh')).toBe(true)
    expect(ok('lv4', ['lǜ'], 'zh')).toBe(true)
    expect(ok('ni2 hao3', ['nǐ hǎo'], 'zh')).toBe(false)
    expect(ok('ni hao', ['nǐ hǎo'], 'zh')).toBe(false) // tones asked for, not given
    expect(pinyinKey("Xi'an")).toBe('xian|')
  })
  it('one wrong character is wrong', () => {
    expect(ok('我是老师', ['我是学生'], 'zh')).toBe(false)
    expect(ok('学刁', ['学习'], 'zh')).toBe(false)
  })
})

describe('Japanese', () => {
  it('full/half width and hiragana/katakana do not count', () => {
    expect(ok('ｶﾀｶﾅ', ['カタカナ'], 'ja')).toBe(true)
    expect(ok('かたかな', ['カタカナ'], 'ja')).toBe(true)
    expect(ok('わたし は がくせい です。', ['わたしはがくせいです'], 'ja')).toBe(true)
    expect(ok('わたしはせんせいです', ['わたしはがくせいです'], 'ja')).toBe(false)
  })
})

describe('Arabic', () => {
  it('vowel marks, the stretching line, letter variants and digits do not count', () => {
    expect(ok('كتب', ['كَتَبَ'], 'ar')).toBe(true)
    expect(ok('كـتـب', ['كتب'], 'ar')).toBe(true)
    expect(ok('احمد', ['أحمد'], 'ar')).toBe(true)
    expect(ok('مدرسه', ['مدرسة'], 'ar')).toBe(true)
    expect(ok('علي', ['على'], 'ar')).toBe(true)
    expect(ok('3 كتب', ['٣ كتب'], 'ar')).toBe(true)
    expect(ok('قلم', ['كتاب'], 'ar')).toBe(false)
  })
})

describe('other languages keep the old rules', () => {
  it('one typo in a long word is forgiven; extra spaces are fine', () => {
    expect(ok('beautifull', ['beautiful'], 'en')).toBe(true)
    expect(ok('went home', ['went  home'], 'en')).toBe(true)
  })
})
