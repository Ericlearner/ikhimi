import { describe, expect, it } from 'vitest'
import ko from '../messages/ko.json'
import { t } from './index'

describe('message catalog', () => {
  it('every message is filled in', () => {
    for (const [k, v] of Object.entries(ko)) expect(v.trim(), k).not.toBe('')
  })

  it('has no Uzbek or Cyrillic text left', () => {
    for (const [k, v] of Object.entries(ko)) {
      expect(v, k).not.toMatch(/[Ѐ-ӿ]/)
      expect(v, k).not.toMatch(/\b(va|uchun|bilan|so'm|o'qituvchi|o'quvchi)\b/)
    }
  })

  it('interpolates', () => {
    expect(t('ko', 'notify.graded', { title: 'Unit 3', percent: 90 })).toBe('✅ “Unit 3” 채점이 끝났어요: 90%')
  })
})
