import { describe, expect, it } from 'vitest'
import { addTry, assessPronunciation, MAX_TRIES, shadowFinished } from './pronounce'
import type { LlmProvider, LlmRequest } from './llm/types'

describe('pronunciation check', () => {
  it('sends the sentence and the voice, and keeps only words that are in the sentence', async () => {
    const reqs: LlmRequest[] = []
    const llm: LlmProvider = {
      name: 'fake',
      async generateJson(req) {
        reqs.push(req)
        return { json: { score: 64.6, missed: ['Think', 'banana', 'three'], tip: "th: tilni tishlar orasiga qo'ying" }, usage: { inputTokens: 1, outputTokens: 1 }, model: 'fake' }
      },
    }
    const r = await assessPronunciation(llm, { audio: { mimeType: 'audio/wav', dataBase64: 'AAAA' }, text: 'I think there are three.', language: 'en', locale: 'ko' })
    expect(r).toMatchObject({ score: 65, missed: ['Think', 'three'] })
    expect(reqs[0]!.parts).toEqual([{ text: 'TARGET: I think there are three.' }, { mimeType: 'audio/wav', dataBase64: 'AAAA' }])
    expect(reqs[0]!.system).toContain('English')
  })

  it('keeps the best score, counts every try, and lets the student move on after the last one', () => {
    let l = addTry(null, { score: 50, missed: ['think'], tip: 'a' })
    expect(l).toEqual({ best: 50, tries: 1, passed: false, missed: ['think'], tip: 'a' })
    l = addTry(l, { score: 40, missed: ['think', 'three'], tip: 'b' })
    expect(l).toMatchObject({ best: 50, tries: 2, missed: ['think'], tip: 'b' })
    expect(shadowFinished({ lines: [l] }, 1)).toBe(false)
    l = addTry(l, { score: 75, missed: [], tip: '' })
    expect(l).toMatchObject({ best: 75, passed: true })
    expect(shadowFinished({ lines: [l] }, 1)).toBe(true)
    expect(shadowFinished({ lines: [l] }, 2)).toBe(false)
    let stuck = addTry(null, { score: 10, missed: [], tip: '' })
    for (let i = 1; i < MAX_TRIES; i++) stuck = addTry(stuck, { score: 10, missed: [], tip: '' })
    expect(shadowFinished({ lines: [stuck] }, 1)).toBe(true)
    expect(stuck.passed).toBe(false)
  })
})
