import { describe, expect, it } from 'vitest'
import { convertItem, type DraftExercise, type GenerateResult, type HomeworkPlan } from '@ikhimi/ai'
import { checkHomework, plannedTotal, type Fixture } from './checks'

const item = (prompt = 'Choose the right form.'): DraftExercise => {
  const r = convertItem({ kind: 'mcq_single', skill: 'grammar', prompt, options: ['go', 'goes', 'going'], correctOptionIndexes: [1], explanation: '' }, 3)
  if (!r.ok) throw new Error(r.reason)
  return r.ex
}

const plan = (counts: number[], over: Partial<HomeworkPlan> = {}): HomeworkPlan => ({
  title: 'Present Simple',
  instructions: "Mashqlarni bajaring.",
  rationale: '',
  contentLanguage: 'en',
  level: 'A2',
  focus: 'grammar',
  grammarPoints: [],
  words: [],
  sections: counts.map((n, i) => ({ id: `s${i}`, title: '', skill: 'grammar', kinds: [{ kind: 'mcq_single', count: n }], about: '', passage: false, pictures: false })),
  vocabRepetition: true,
  teacherSetCount: true,
  notes: '',
  ...over,
})

const result = (items: DraftExercise[], p: HomeworkPlan, minutes = 10): GenerateResult => ({
  draft: { title: p.title, instructions: p.instructions, rationale: '', contentLanguage: 'en', cefrLevel: 'A2', estimatedMinutes: minutes, exercises: items, skipped: [] },
  meta: {
    model: 'fake',
    usage: { inputTokens: 0, outputTokens: 0 },
    dropped: [],
    trimmedForTime: 0,
    solveBack: [],
    instructionsScriptOk: true,
    raw: null,
    plan: { plan: p, sections: p.sections.map((s) => ({ id: s.id, ms: 0, asked: s.kinds[0]!.count, written: s.kinds[0]!.count, topUp: false, reviewed: 0 })), vocab: 0 },
  },
})

const fixture = (expect: Fixture['expect'], minutes = 10): Fixture => ({ id: 't', locale: 'ko', text: '', minutes, expect })
const failed = (cs: ReturnType<typeof checkHomework>) => cs.filter((c) => !c.ok && !c.soft).map((c) => c.name)

describe('checkHomework', () => {
  it('passes a homework with the teacher\'s exact count, language and clean items', () => {
    const p = plan([6, 4])
    expect(plannedTotal(p)).toBe(10)
    const cs = checkHomework(fixture({ contentLanguage: 'en', total: 10, kinds: { mcq_single: 10 } }), p, result(Array.from({ length: 10 }, () => item()), p))
    expect(failed(cs)).toEqual([])
  })

  it('fails a wrong count, a wrong language and an item short', () => {
    const p = plan([6, 3], { contentLanguage: 'ru', teacherSetCount: false })
    const cs = checkHomework(fixture({ contentLanguage: 'en', total: 10 }), p, result(Array.from({ length: 8 }, () => item()), p))
    expect(failed(cs)).toEqual(['language', 'count', 'written'])
  })

  it('fails an item that asks students to speak where they can only choose', () => {
    const p = plan([2])
    const cs = checkHomework(fixture({ contentLanguage: 'en' }), p, result([item(), item('Say the word aloud and record yourself.')], p))
    expect(failed(cs)).toContain('structure')
  })

  it('reports time and solve-back as warnings, not failures', () => {
    const p = plan([2], { teacherSetCount: false })
    const bad = item()
    bad.flags.push('solve_back_disagrees')
    const cs = checkHomework(fixture({ contentLanguage: 'en' }, 30), p, result([item(), bad], p, 10))
    expect(failed(cs)).toEqual([])
    expect(cs.filter((c) => !c.ok).map((c) => c.name)).toEqual(['time', 'solve-back'])
  })
})
