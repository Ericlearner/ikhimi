import { describe, expect, it } from 'vitest'
import { EXAMS, examsFor, examWriting, examById, formatOverall, guessLanguage, overallMax, overallScore, SUBJECTS, LANGUAGE_CODES } from './exams'

describe('exam catalog', () => {
  it('every exam belongs to a known language, has a valid default level and unique id', () => {
    expect(new Set(EXAMS.map((e) => e.id)).size).toBe(EXAMS.length)
    for (const e of EXAMS) {
      expect(LANGUAGE_CODES).toContain(e.language)
      expect(e.levels).toContain(e.defaultLevel)
      for (const l of e.noWritingLevels ?? []) expect(e.levels).toContain(l)
    }
  })

  it('offers only the chosen language’s exams: never Arabic styles for English', () => {
    expect(examsFor('en').map((e) => e.id)).toEqual(['csat_english', 'toeic', 'ielts_academic', 'ielts_general', 'toefl_ibt', 'cambridge'])
    expect(examsFor('en').some((e) => e.language === 'ar')).toBe(false)
    expect(examsFor('ar').map((e) => e.id)).toEqual(['arabic_cefr'])
    expect(examsFor(null)).toEqual([])
  })

  it('knows which exams and levels have no writing', () => {
    expect(examWriting(examById('jlpt'), 'N3')).toBeNull()
    expect(examWriting(examById('topik'), 'TOPIK I (1–2급)')).toBeNull()
    expect(examWriting(examById('topik'), 'TOPIK II (3–4급)')?.scale.unit).toBe('chars')
  })

  it('subjects cover every language plus maths and other', () => {
    expect(SUBJECTS).toEqual(expect.arrayContaining(['english', 'korean', 'arabic', 'math', 'other']))
  })
})

describe('guessLanguage', () => {
  it("the teacher's words win", () => {
    expect(guessLanguage({ text: '오늘 IELTS 리딩을 했어요', subjects: ['russian'] })).toBe('en')
    expect(guessLanguage({ text: '외국인 대상 한국어 수업 3과' })).toBe('ko')
    expect(guessLanguage({ text: '수능 영어 빈칸 추론 연습' })).toBe('en')
    // Teachers write in Korean: Hangul alone is not a guess
    expect(guessLanguage({ text: '오늘은 과일 단어를 배웠어요' })).toBeNull()
    expect(guessLanguage({ text: 'ひらがなの練習' })).toBe('ja')
    expect(guessLanguage({ text: '我们学习了颜色' })).toBe('zh')
    expect(guessLanguage({ text: 'Урок русского языка' })).toBe('ru')
  })
  it('then file names, recent homework, then profile subjects', () => {
    expect(guessLanguage({ text: '오늘 수업', fileNames: ['Lesson_12_Past_Simple.pdf'] })).toBe('en')
    expect(guessLanguage({ text: '오늘 수업', recent: ['de', 'de', 'en'] })).toBe('de')
    expect(guessLanguage({ text: '오늘 수업', subjects: ['korean', 'turkish'] })).toBe('tr')
    expect(guessLanguage({ text: '오늘 수업', subjects: ['math'] })).toBeNull()
  })
})

describe('essay scores', () => {
  const ielts = examById('ielts_academic')!.writing!.scale
  it('IELTS: mean of the four criteria, rounded to half bands with .25 and .75 going up', () => {
    expect(overallScore(ielts, { task: 6, coherence: 6, lexical: 7, grammar: 6 })).toBe(6.5) // 6.25
    expect(overallScore(ielts, { task: 7, coherence: 7, lexical: 7, grammar: 6 })).toBe(7) // 6.75
    expect(overallScore(ielts, { task: 6, coherence: 6, lexical: 6, grammar: 6 })).toBe(6)
    expect(formatOverall(ielts, 6.5)).toBe('Band 6.5')
    expect(overallMax(ielts)).toBe(9)
  })
  it('sum scales: TOPIK /50, Cambridge /20; scores are clamped to each criterion', () => {
    const topik = examById('topik')!.writing!.scale
    expect(overallMax(topik)).toBe(50)
    expect(overallScore(topik, { content: 10, structure: 9, language: 99 })).toBe(45)
    expect(formatOverall(topik, 45)).toBe('45/50')
    expect(overallMax(examById('cambridge')!.writing!.scale)).toBe(20)
  })
})
