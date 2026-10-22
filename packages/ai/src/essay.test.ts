import { describe, expect, it } from 'vitest'
import { gradeEssay } from './essay'
import { examById } from './exams'
import type { LlmProvider, LlmRequest } from './llm/types'

const scale = examById('ielts_academic')!.writing!.scale
const base = {
  task: 'Some people think university should be free. Discuss both views and give your opinion.',
  taskLabel: 'IELTS Writing Task 2',
  exam: 'IELTS Academic · Band 6.5',
  rubric: 'IELTS descriptors',
  scale,
  min: 250,
  instructionLocale: 'ko' as const,
  contentLanguage: 'en',
}

function fake(json: unknown) {
  const requests: LlmRequest[] = []
  const llm: LlmProvider = {
    name: 'fake',
    async generateJson(req) {
      requests.push(req)
      return { json, usage: { inputTokens: 1, outputTokens: 1 }, model: 'fake' }
    },
  }
  return { llm, requests }
}

describe('gradeEssay', () => {
  it('overall is computed in code with IELTS rounding, not taken from the model', async () => {
    const { llm, requests } = fake({
      criteria: [
        { id: 'task', score: 6, feedback: 'ok' },
        { id: 'coherence', score: 6, feedback: 'ok' },
        { id: 'lexical', score: 7, feedback: 'ok' },
        { id: 'grammar', score: 6.4, feedback: 'ok' },
      ],
      overall: 9,
      strengths: ['Clear position'],
      improvements: ['Develop the second view'],
      corrections: [{ original: 'peoples thinks', corrected: 'people think', why: 'plural' }],
      summary: 'Yaxshi.',
    })
    const g = await gradeEssay(llm, { ...base, text: 'word '.repeat(260), knownNames: [] })
    expect(g.overall).toBe(6.5)
    expect(g.overallLabel).toBe('Band 6.5')
    expect(g.fraction).toBeCloseTo(6.5 / 9)
    expect(g.length).toBe(260)
    expect(g.criteria.find((c) => c.id === 'grammar')!.score).toBe(6)
    // The grader is told the length and the minimum
    expect(requests[0]!.system).toContain('the student wrote 260')
  })

  it('throws when a criterion is missing, so the essay stays pending', async () => {
    const { llm } = fake({ criteria: [{ id: 'task', score: 6, feedback: '' }], strengths: [], improvements: [], corrections: [], summary: '' })
    await expect(gradeEssay(llm, { ...base, text: 'An essay.' })).rejects.toThrow()
  })

  it("strips the student's name from the essay", async () => {
    const { llm, requests } = fake({ criteria: scale.criteria.map((c) => ({ id: c.id, score: 5, feedback: '' })), strengths: [], improvements: [], corrections: [], summary: '' })
    await gradeEssay(llm, { ...base, text: 'My name is Aziz Karimov and I think…', knownNames: ['Aziz Karimov'] })
    expect((requests[0]!.parts[0] as { text: string }).text).not.toContain('Karimov')
  })

  it('counts Korean essays in characters', async () => {
    const topik = examById('topik')!.writing!.scale
    const { llm } = fake({ criteria: topik.criteria.map((c) => ({ id: c.id, score: c.max, feedback: '' })), strengths: [], improvements: [], corrections: [], summary: '' })
    const g = await gradeEssay(llm, { ...base, scale: topik, min: 600, max: 700, text: '가'.repeat(650), contentLanguage: 'ko' })
    expect(g.length).toBe(650)
    expect(g.overallLabel).toBe('50/50')
  })
})
