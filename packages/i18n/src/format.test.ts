import { describe, expect, it } from 'vitest'
import { formatDate, formatPhone, formatKrw, formatShortDate, listCountries, maskPhone, normalizePhone } from './format'

describe('phone', () => {
  it.each([
    ['010-1234-5678', '+821012345678'],
    ['01012345678', '+821012345678'],
    ['+82 10-1234-5678', '+821012345678'],
    ['821012345678', '+821012345678'],
    ['02-312-3456', '+8223123456'],
    // Abroad
    ['+1 (415) 555-2671', '+14155552671'],
    ['+81 90-1234-5678', '+819012345678'],
  ])('normalises %s', (input, e164) => expect(normalizePhone(input)).toBe(e164))

  it('uses the chosen country for national-format input', () => {
    expect(normalizePhone('(415) 555-2671', 'US')).toBe('+14155552671')
  })

  it.each(['123', '', '+1 23', 'abc'])('rejects %s', (input) => expect(normalizePhone(input)).toBeNull())

  it('formats and masks', () => {
    expect(formatPhone('+821012345678')).toBe('010-1234-5678')
    expect(formatPhone('+14155552671')).toBe('+1 415 555 2671')
    expect(maskPhone('+821012345678')).toBe('+82 ********78')
  })

  it('lists Korea first', () => {
    const list = listCountries()
    expect(list[0]).toEqual({ code: 'KR', dial: '82' })
    expect(list.length).toBeGreaterThan(200)
  })
})

describe('dates and money', () => {
  it('formats YYYY.MM.DD in Seoul time', () => {
    // 16:30 UTC on 31 Dec is already 1 Jan in Seoul (UTC+9)
    expect(formatDate(new Date('2025-12-31T16:30:00Z'))).toBe('2026.01.01')
    expect(formatShortDate(new Date('2025-12-31T16:30:00Z'))).toBe('01.01')
  })
  it('formats integer KRW with comma separators', () => {
    expect(formatKrw(25000)).toBe('25,000')
    expect(formatKrw(1250000, '원')).toBe('1,250,000원')
    expect(() => formatKrw(10.5)).toThrow()
  })
})
