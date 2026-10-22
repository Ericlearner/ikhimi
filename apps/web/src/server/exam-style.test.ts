import { describe, expect, it } from 'vitest'
import { examFor } from './exam-style'

describe('examFor', () => {
  it('accepts an exam of the chosen language and fills the language from the exam', () => {
    expect(examFor({ language: 'en', exam: { id: 'ielts_academic', level: 'Band 6.5' } })).toEqual({ ok: true, exam: { id: 'ielts_academic', level: 'Band 6.5' }, language: 'en' })
    expect(examFor({ exam: { id: 'topik', level: 'TOPIK II (3–4급)' } })).toMatchObject({ ok: true, language: 'ko' })
  })
  it("rejects another language's exam, an unknown exam, or a level the exam doesn't have", () => {
    expect(examFor({ language: 'en', exam: { id: 'arabic_cefr', level: 'A2' } }).ok).toBe(false)
    expect(examFor({ language: 'ar', exam: { id: 'ielts_academic', level: 'Band 6.5' } }).ok).toBe(false)
    expect(examFor({ exam: { id: 'made_up', level: 'A1' } }).ok).toBe(false)
    expect(examFor({ exam: { id: 'jlpt', level: 'N9' } }).ok).toBe(false)
  })
  it('no exam: standard homework in the chosen language', () => {
    expect(examFor({ language: 'de' })).toEqual({ ok: true, exam: null, language: 'de' })
  })
})
