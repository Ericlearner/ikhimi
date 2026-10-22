import { describe, expect, it } from 'vitest'
import type { LlmProvider, LlmRequest } from './llm/types'
import { gradeWriting } from './writing'

const input = {
  task: 'Write 4 sentences about your family in Present Simple.',
  checklist: ['Present Simple'],
  rubric: 'Present Simple, -s for he/she/it',
  examples: ['My father works in a bank.'],
  lines: 4,
  instructionLocale: 'ko' as const,
  contentLanguage: 'en',
}

function fake(json: unknown) {
  const requests: LlmRequest[] = []
  const llm: LlmProvider = {
    name: 'fake',
    async generateJson(req) {
      requests.push(req)
      return { json, usage: { inputTokens: 5, outputTokens: 5 }, model: 'fake' }
    },
  }
  return { llm, requests }
}

describe('gradeWriting', () => {
  it('scores acceptable sentences over the number asked for; empty boxes count as not done', async () => {
    const { llm, requests } = fake({
      lines: [
        { n: 1, ok: true, correction: 'My mother cooks dinner.', feedback: "To'g'ri." },
        { n: 2, ok: false, correction: 'My brother plays football.', feedback: "he/she bilan -s: plays" },
      ],
      summary: 'Yaxshi.',
    })
    const g = await gradeWriting(llm, { ...input, answers: ['My mother cooks dinner.', 'My brother play football.', '', ''] })
    expect(g.fraction).toBe(0.25)
    expect(g.lines[1]).toMatchObject({ ok: false, correction: 'My brother plays football.' })
    expect(g.lines[2]).toMatchObject({ ok: false, feedback: '' })
    // Only written sentences are sent
    expect(JSON.parse((requests[0]!.parts[0] as { text: string }).text).studentSentences).toHaveLength(2)
  })

  it('makes no call when nothing was written', async () => {
    const { llm, requests } = fake({})
    const g = await gradeWriting(llm, { ...input, answers: ['', ' '] })
    expect(g.fraction).toBe(0)
    expect(requests).toHaveLength(0)
  })

  it('throws when the model skips a sentence, so the answer stays pending', async () => {
    const { llm } = fake({ lines: [{ n: 1, ok: true, correction: 'x', feedback: 'x' }], summary: '' })
    await expect(gradeWriting(llm, { ...input, answers: ['A cat sleeps.', 'A dog runs.'] })).rejects.toThrow()
  })
})
