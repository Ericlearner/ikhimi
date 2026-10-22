import { describe, expect, it } from 'vitest'
import { groupPages, PAGE_MAX } from './pages'

const ex = (kind: string, extra: { passage?: string; audioUrl?: string } = {}) => ({ kind, payload: extra.passage ? { passage: extra.passage } : {}, audioUrl: extra.audioUrl ?? null })

describe('groupPages', () => {
  it('puts consecutive items of the same kind on one page', () => {
    expect(groupPages([ex('gap_fill'), ex('gap_fill'), ex('gap_fill'), ex('mcq_single'), ex('mcq_single'), ex('gap_fill')])).toEqual([[0, 1, 2], [3, 4], [5]])
  })
  it('keeps essays and listening items on their own page, and splits by reading text', () => {
    expect(groupPages([ex('essay'), ex('essay')])).toEqual([[0], [1]])
    expect(groupPages([ex('mcq_single', { audioUrl: '/a' }), ex('mcq_single', { audioUrl: '/b' })])).toEqual([[0], [1]])
    expect(groupPages([ex('true_false', { passage: 'A' }), ex('true_false', { passage: 'A' }), ex('true_false', { passage: 'B' })])).toEqual([[0, 1], [2]])
  })
  it(`never puts more than ${PAGE_MAX} items on a page`, () => {
    const pages = groupPages(Array.from({ length: PAGE_MAX + 3 }, () => ex('gap_fill')))
    expect(pages.map((p) => p.length)).toEqual([PAGE_MAX, 3])
  })
})
