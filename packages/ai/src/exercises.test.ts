import { describe, expect, it } from 'vitest'
import { describeAnswer, gapVerdicts, gradeExercise, levenshtein, normalizeAnswer, seededShuffle, textMatches } from './exercises'

const opts = { typoToleranceMinLength: 4 }

describe('normalizeAnswer', () => {
  it('folds case, spaces, apostrophes, edge punctuation and ё/е', () => {
    expect(normalizeAnswer('  Went. ')).toBe(normalizeAnswer('went'))
    expect(normalizeAnswer("don't")).toBe(normalizeAnswer('don’t'))
    expect(normalizeAnswer('ёлка')).toBe(normalizeAnswer('елка'))
    expect(normalizeAnswer('did  not   go')).toBe(normalizeAnswer('did not go'))
  })
})

describe('textMatches', () => {
  it('accepts listed variants', () => {
    expect(textMatches("didn't go", ['did not go', "didn't go"], false, opts)).toBe(true)
  })
  it('allows one typo only on longer words, never when exact spelling is required', () => {
    expect(textMatches('bougth', ['bought'], false, opts)).toBe(false) // transposition = 2 edits
    expect(textMatches('boughtt', ['bought'], false, opts)).toBe(true)
    expect(textMatches('boughtt', ['bought'], true, opts)).toBe(false)
    expect(textMatches('wnt', ['went'], false, opts)).toBe(false) // 4 chars: no tolerance
    expect(textMatches('boughtt', ['bought'], false, { typoToleranceMinLength: null })).toBe(false)
  })
  it('never accepts an empty answer', () => {
    expect(textMatches('   ', ['a'], false, opts)).toBe(false)
  })
  it('levenshtein', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3)
  })
})

describe('gradeExercise', () => {
  it('mcq_single', () => {
    expect(gradeExercise('mcq_single', { options: ['a', 'b'] }, { correct: 1 }, 1)).toEqual({ fraction: 1, isCorrect: true })
    expect(gradeExercise('mcq_single', { options: ['a', 'b'] }, { correct: 1 }, 0).isCorrect).toBe(false)
  })
  it('mcq_multi gives partial credit and penalises wrong picks', () => {
    const p = { options: ['a', 'b', 'c', 'd'] }
    const k = { correct: [0, 2] }
    expect(gradeExercise('mcq_multi', p, k, [0, 2]).fraction).toBe(1)
    expect(gradeExercise('mcq_multi', p, k, [0]).fraction).toBe(0.5)
    expect(gradeExercise('mcq_multi', p, k, [0, 1, 2, 3]).fraction).toBe(0)
  })
  it('gap_fill scores per blank', () => {
    const r = gradeExercise('gap_fill', { text: 'I ___ to school and ___ lunch.' }, { blanks: [['went'], ['ate', 'had']] }, ['Went', 'had'])
    expect(r).toEqual({ fraction: 1, isCorrect: true })
    expect(gradeExercise('gap_fill', { text: '___ ___' }, { blanks: [['a'], ['b']] }, ['a', 'x']).fraction).toBe(0.5)
  })
  it('matching and ordering', () => {
    expect(gradeExercise('matching', { left: ['a', 'b'], right: ['2', '1'] }, { pairs: [1, 0] }, [1, 0]).isCorrect).toBe(true)
    expect(gradeExercise('matching', { left: ['a', 'b'], right: ['2', '1'] }, { pairs: [1, 0] }, [1, null]).fraction).toBe(0.5)
    expect(gradeExercise('ordering', { items: ['c', 'a', 'b'] }, { order: [1, 2, 0] }, [1, 2, 0]).isCorrect).toBe(true)
  })
  it('true_false and short_answer', () => {
    expect(gradeExercise('true_false', { allowNotGiven: true }, { answer: 'not_given' }, 'not_given').isCorrect).toBe(true)
    expect(gradeExercise('short_answer', { exactSpelling: false }, { accepted: ['because it rained'] }, 'Because it rained!').isCorrect).toBe(true)
  })
  it('malformed responses score zero instead of throwing', () => {
    expect(gradeExercise('mcq_single', { options: ['a', 'b'] }, { correct: 0 }, 'zero')).toEqual({ fraction: 0, isCorrect: false })
    expect(gradeExercise('gap_fill', { text: '___' }, { blanks: [['a']] }, null).fraction).toBe(0)
  })
})

describe('helpers', () => {
  it('describes answers', () => {
    expect(describeAnswer('ordering', { items: ['c', 'a', 'b'] }, { order: [1, 2, 0] })).toBe('a → b → c')
  })
  it('shuffles deterministically without losing items', () => {
    const a = seededShuffle([1, 2, 3, 4, 5], 42)
    expect(a).toEqual(seededShuffle([1, 2, 3, 4, 5], 42))
    expect([...a].sort()).toEqual([1, 2, 3, 4, 5])
  })
})

describe('gapVerdicts', () => {
  it('judges each blank against all accepted variants', () => {
    expect(gapVerdicts({ text: '___ and ___' }, { blanks: [["didn't go", 'did not go'], ['ate']] }, ['did not go', 'eat'])).toEqual([true, false])
  })
})
