import { describe, expect, it } from 'vitest'
import { assertNoPII, PIIError, sanitizeForLLM } from './sanitize'

describe('sanitizeForLLM', () => {
  it.each(['010-1234-5678', '01012345678', '010 1234 5678', '+82 10-1234-5678', '+821012345678', '02-312-3456', '031-123-4567', '+1 415 555 2671'])(
    'strips phone %s',
    (phone) => {
      const r = sanitizeForLLM(`학부모 연락처: ${phone}, 전화 주세요`)
      expect(r.text).not.toContain(phone)
      expect(r.text).toMatch(/\[\[P1\]\]/)
      expect(r.restore(r.text)).toBe(`학부모 연락처: ${phone}, 전화 주세요`)
    },
  )

  it('strips emails, cards, resident registration numbers, ULIDs and Telegram handles', () => {
    const input = '이메일 jieun@example.kr, 카드 9410 1234 5678 9012, 주민번호 090315-4123456, id 01JABCDEFGHJKMNPQRSTVWXYZ0, tg @jieun_teacher'
    const r = sanitizeForLLM(input)
    expect(r.text).not.toMatch(/jieun@|9410|090315|01JABCDE|@jieun_teacher/)
    expect(Object.values(r.tokens).sort()).toEqual(
      ['01JABCDEFGHJKMNPQRSTVWXYZ0', '9410 1234 5678 9012', '090315-4123456', '@jieun_teacher', 'jieun@example.kr'].sort(),
    )
    expect(r.restore(r.text)).toBe(input)
  })

  it('strips Korean names with particles attached, and the given name alone', () => {
    const r = sanitizeForLLM('김지은의 답이 맞았어요. 지은이는 숙제를 잘해요. 박민준 학생도요.', { knownNames: ['김지은', '박민준'] })
    expect(r.text).not.toMatch(/지은|민준/)
    expect(r.text).toContain('숙제를 잘해요')
  })

  it('strips known Latin-script names in any apostrophe form and case, full or partial', () => {
    const r = sanitizeForLLM("O’Brien and o'brien, and ANNA KIM. Anna reads well.", { knownNames: ["Liam O'Brien", 'Anna Kim'] })
    expect(r.text).not.toMatch(/brien|anna/i)
    expect(r.text).toContain('reads well')
  })

  it('gives repeated values the same token', () => {
    const r = sanitizeForLLM('Anna, Anna, Anna', { knownNames: ['Anna'] })
    expect(r.text).toBe('[[N1]], [[N1]], [[N1]]')
  })

  it('leaves learning content untouched', () => {
    const content = 'Unit 3, ex. 4b. Track 10. Fill in the gaps: I ___ (go) to school in 2019. 45쪽, 12문제, 20분. 과거시제.'
    const r = sanitizeForLLM(content, { knownNames: ['김지은'] })
    expect(r.text).toBe(content)
    expect(r.tokens).toEqual({})
  })

  it('does not match Latin names inside other words', () => {
    const r = sanitizeForLLM('Alison went to Alice Springs', { knownNames: ['Ali'] })
    expect(r.text).toBe('Alison went to Alice Springs')
  })
})

describe('assertNoPII', () => {
  it('passes clean payloads', () => {
    expect(() => assertNoPII(JSON.stringify({ messages: [{ content: 'Make 10 gap-fill items on Past Simple' }] }))).not.toThrow()
  })
  it('throws on leaked phone / name', () => {
    expect(() => assertNoPII('call 010-1234-5678')).toThrow(PIIError)
    expect(() => assertNoPII('지은이가 3/10을 받았어요', { knownNames: ['김지은'] })).toThrow(/name/)
  })
})
