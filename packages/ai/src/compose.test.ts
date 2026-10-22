import { describe, expect, it } from 'vitest'
import { convertItem, generateAssignment, type DraftExercise } from './generate'
import { gradeExercise } from './exercises'
import { placeVocab, vocabTasks, withoutSpeech } from './compose'
import { learnPrefs, normalizePlan, planHomework, planItemCount, vocabCounts, type HomeworkPlan } from './plan'
import type { LlmProvider, LlmRequest } from './llm/types'

const PLAN: HomeworkPlan = normalizePlan({
  title: "O'tgan zamon",
  instructions: 'Mashqlarni bajaring.',
  rationale: 'Tanishdan erkin mashqqa.',
  contentLanguage: 'en',
  level: 'A2',
  focus: 'grammar',
  grammarPoints: ['Past Simple'],
  words: [
    { word: 'yesterday', meaning: 'kecha' },
    { word: 'bought', meaning: 'sotib oldi' },
    { word: 'journey', meaning: 'sayohat' },
    { word: 'tired', meaning: 'charchagan' },
  ],
  sections: [
    { title: "Bo'sh joylar", skill: 'grammar', kinds: [{ kind: 'gap_fill', count: 3 }], about: 'Past Simple of irregular verbs' },
    { title: "O'qish", skill: 'reading', kinds: [{ kind: 'true_false', count: 2 }], about: 'A trip', passage: true },
  ],
  vocabRepetition: true,
  teacherSetCount: false,
})!

const gap = (n: number) => ({ kind: 'gap_fill', skill: 'grammar', prompt: 'Fill in', gapText: `I ___ (go) home ${n}.`, gapAnswers: [{ accepted: ['went'] }], explanation: '…' })
const tf = (n: number, passageId = 'p1') => ({ kind: 'true_false', skill: 'reading', prompt: `Statement ${n}`, trueFalseAnswer: 'true', passageId, explanation: '…' })

/** Fake model that answers each kind of call the composer makes */
function fakeLlm(opts: { shortFirst?: boolean; failVocab?: boolean } = {}) {
  const requests: LlmRequest[] = []
  let s1Calls = 0
  const llm: LlmProvider = {
    name: 'fake',
    async generateJson(req) {
      requests.push(req)
      const text = req.parts.map((p) => ('text' in p ? p.text : '')).join('\n')
      const usage = { inputTokens: 10, outputTokens: 5 }
      if (req.system.includes('SHORT vocabulary')) {
        if (opts.failVocab) throw new Error('vocab down')
        const lines = [...text.matchAll(/word «(.+?)» \(meaning: .+?\), stage (meet|recall), listen=(true|false)/g)]
        return {
          json: {
            items: lines.map(([, word, stage, listen]) =>
              stage === 'recall'
                ? { kind: 'short_answer', word, stage, speak: listen === 'true' ? word : 'ignored', prompt: listen === 'true' ? 'Listen and type' : `Write the word`, acceptedAnswers: [word], explanation: '…' }
                : { kind: 'mcq_single', word, stage, speak: listen === 'true' ? word : '', prompt: listen === 'true' ? 'Listen' : `What does ${word} mean?`, options: [word, 'x1', 'x2', 'x3'], correctOptionIndexes: [0], explanation: '…' },
            ),
          },
          usage,
          model: 'fake-gen',
        }
      }
      if (text.includes('YOUR PART: s1')) {
        s1Calls++
        if (opts.shortFirst && s1Calls === 1) return { json: { exercises: [gap(1)] }, usage, model: 'fake-gen' }
        if (text.includes('still missing')) return { json: { exercises: [gap(2), gap(3)] }, usage, model: 'fake-gen' }
        return { json: { exercises: [gap(1), gap(2), gap(3), gap(4)] }, usage, model: 'fake-gen' }
      }
      if (text.includes('YOUR PART: s2')) {
        return { json: { passages: [{ id: 'p1', title: 'A trip', text: 'Aziz went to Samarkand.' }], exercises: [tf(1), tf(2, '')] }, usage, model: 'fake-gen' }
      }
      if (req.system.includes('careful top student')) return { json: { answers: [] }, usage, model: 'fake-review' }
      if (req.system.includes('senior examiner')) return { json: { items: [] }, usage, model: 'fake-review' }
      return { json: { items: [] }, usage, model: 'fake' }
    },
  }
  return { llm, requests }
}

const base = { teacherText: 'Past simple', materials: [], instructionLocale: 'ko' as const, targetMinutes: 20, difficulty: 3 as const, mode: 'create' as const, seed: 42 }

describe('normalizePlan', () => {
  it('keeps known kinds, numbers the parts, and caps the total', () => {
    const p = normalizePlan({
      title: 'T',
      sections: [
        { title: 'a', skill: 'speaking', kinds: [{ kind: 'gap_fill', count: 20 }, { kind: 'drawing', count: 3 }], about: 'x' },
        { title: 'b', skill: 'grammar', kinds: [{ kind: 'mcq_single', count: 20 }], about: 'y', passage: true },
        { title: 'c', skill: 'grammar', kinds: [{ kind: 'matching', count: 0 }], about: 'z' },
      ],
      words: [{ word: 'go', meaning: 'bormoq' }, { word: 'Go', meaning: 'dup' }],
    })!
    expect(p.sections.map((s) => s.id)).toEqual(['s1', 's2'])
    expect(p.sections[0]!.skill).toBe('grammar') // no speaking tasks
    expect(p.sections[0]!.kinds).toEqual([{ kind: 'gap_fill', count: 15 }])
    expect(planItemCount(p)).toBe(30)
    expect(p.sections[1]!.passage).toBe(false) // only reading parts carry a passage
    expect(p.words).toHaveLength(1)
  })
  it('returns null without usable parts, and turns repetition off without words', () => {
    expect(normalizePlan({ sections: [] })).toBeNull()
    expect(normalizePlan({ sections: [{ kinds: [{ kind: 'gap_fill', count: 2 }] }], words: [], vocabRepetition: true })!.vocabRepetition).toBe(false)
  })
})

describe('vocabulary items', () => {
  it('meets every word, recalls every other one, and hears every other meeting only with speech', () => {
    expect(vocabCounts(PLAN)).toEqual({ meet: 4, recall: 2 })
    const t = vocabTasks(PLAN, true)
    expect(t.filter((x) => x.stage === 'meet').map((x) => x.listen)).toEqual([false, true, false, true])
    expect(t.filter((x) => x.stage === 'recall').map((x) => x.word)).toEqual(['yesterday', 'journey'])
    // every other recall is heard and typed
    expect(t.filter((x) => x.stage === 'recall').map((x) => x.listen)).toEqual([false, true])
    expect(vocabTasks(PLAN, false).some((x) => x.listen)).toBe(false)
    expect(vocabTasks({ ...PLAN, vocabRepetition: false }, true)).toEqual([])
  })

  const ex = (id: string, extra: Partial<DraftExercise> = {}) =>
    ({ kind: 'gap_fill', prompt: id, payload: {}, answerKey: {}, points: 1, skill: 'grammar', explanation: '', sourceRef: null, estimatedSeconds: 30, flags: [], aiConfidence: 0.9, ...extra }) as DraftExercise
  const v = (word: string, stage: 'meet' | 'recall') => ex(`${stage}:${word}`, { vocab: { word, stage } })

  it('spreads vocabulary between blocks and never splits a passage from its questions', () => {
    const main = [ex('a'), ex('r1', { payload: { passage: 'P' } }), ex('r2', { payload: { passage: 'P' } }), ex('b'), ex('c'), ex('d')]
    const out = placeVocab(main, [v('w1', 'meet'), v('w2', 'meet'), v('w1', 'recall')]).map((e) => e.prompt)
    expect(out[0]).toBe('meet:w1') // warm-up
    expect(out.indexOf('r2')).toBe(out.indexOf('r1') + 1)
    expect(out).toHaveLength(9)
    // no two vocabulary items in a row while there are blocks to put between them
    const isV = (p: string) => p.includes(':')
    expect(out.some((p, i) => i > 0 && isV(p) && isV(out[i - 1]!))).toBe(false)
    expect(out.indexOf('meet:w1')).toBeLessThan(out.indexOf('recall:w1'))
  })
  it('starts recall with a different word than the last one met', () => {
    const out = placeVocab([ex('a'), ex('b'), ex('c'), ex('d'), ex('e'), ex('f'), ex('g'), ex('h')], [v('w1', 'meet'), v('w2', 'meet'), v('w2', 'recall'), v('w1', 'recall')])
    const words = out.filter((e) => e.vocab).map((e) => e.prompt)
    expect(words).toEqual(['meet:w1', 'meet:w2', 'recall:w1', 'recall:w2'])
  })
  it('a typed word that could not be spoken is asked by its meaning', () => {
    const e = ex('Listen and type', { kind: 'short_answer', vocab: { word: 'journey', stage: 'recall' }, speak: 'journey' })
    withoutSpeech(e, PLAN, 'ko')
    expect(e.prompt).toBe('‘sayohat’에 해당하는 단어를 쓰세요')
  })
  it('asks by meaning when the word could not be spoken', () => {
    const e = ex('Listen', { vocab: { word: 'journey', stage: 'meet' }, speak: 'journey' })
    withoutSpeech(e, PLAN, 'ko')
    expect(e.prompt).toBe('‘sayohat’에 해당하는 단어는 무엇인가요?')
    expect(e.speak).toBeNull()
  })
})

describe('composeFromPlan', () => {
  it('writes every part with its exact count, the passage, and vocabulary items', async () => {
    const { llm, requests } = fakeLlm()
    const items: number[] = []
    const r = await generateAssignment(llm, { ...base, plan: PLAN, review: true, speech: true, onItems: (x) => items.push(x.length) })
    const main = r.draft.exercises.filter((e) => !e.vocab)
    expect(main.filter((e) => e.kind === 'gap_fill')).toHaveLength(3) // 4 written, 3 asked
    expect(main.filter((e) => e.kind === 'true_false')).toHaveLength(2)
    // the item without a passage id still gets the part's passage
    expect(main.filter((e) => e.payload.passage === 'A trip\n\nAziz went to Samarkand.')).toHaveLength(2)
    const vocab = r.draft.exercises.filter((e) => e.vocab)
    expect(vocab).toHaveLength(6)
    // heard: every other meeting, every other recall; a speak the task didn't ask for is dropped
    expect(vocab.filter((e) => e.speak).map((e) => `${e.kind}:${e.speak}`).sort()).toEqual(['mcq_single:bought', 'mcq_single:tired', 'short_answer:journey'])
    expect(r.draft.title).toBe("O'tgan zamon")
    expect(r.meta.plan?.sections.map((s) => [s.asked, s.written])).toEqual([[3, 3], [2, 2]])
    expect(items.reduce((a, b) => a + b, 0)).toBe(r.draft.exercises.length)
    // parts are written from the plan, not the time budget
    const part = requests.find((q) => q.parts.some((p) => 'text' in p && p.text.includes('YOUR PART: s1')))!
    expect(part.system).toContain('never more, never fewer')
    expect(part.system).not.toContain('Time budget')
  })
  it('tops a short part up to the count with one more call', async () => {
    const { llm, requests } = fakeLlm({ shortFirst: true })
    const r = await generateAssignment(llm, { ...base, plan: PLAN })
    expect(r.draft.exercises.filter((e) => e.kind === 'gap_fill')).toHaveLength(3)
    expect(r.meta.plan?.sections[0]!.topUp).toBe(true)
    expect(requests.filter((q) => q.parts.some((p) => 'text' in p && p.text.includes('still missing')))).toHaveLength(1)
  })
  it('goes on without vocabulary items when they fail', async () => {
    const { llm } = fakeLlm({ failVocab: true })
    const r = await generateAssignment(llm, { ...base, plan: PLAN })
    expect(r.draft.exercises).toHaveLength(5)
  })
  it('a revision ignores the plan and uses the single-call path', async () => {
    const { llm, requests } = fakeLlm()
    await generateAssignment(llm, { ...base, plan: PLAN, refine: { previous: { title: 'x', instructions: '', rationale: '', contentLanguage: 'en', cefrLevel: null, estimatedMinutes: 5, exercises: [] }, feedback: 'harder' } }).catch(() => {})
    expect(requests.some((q) => q.parts.some((p) => 'text' in p && p.text.includes('YOUR PART')))).toBe(false)
  })
})

describe('planHomework', () => {
  it('asks the plan model and normalizes the answer; a revision sends the previous plan', async () => {
    const reqs: LlmRequest[] = []
    const llm: LlmProvider = {
      name: 'fake',
      async generateJson(req) {
        reqs.push(req)
        return { json: { ...PLAN, sections: PLAN.sections.map(({ id: _id, ...s }) => s) }, usage: { inputTokens: 1, outputTokens: 1 }, model: 'fake-plan' }
      },
    }
    const { plan } = await planHomework(llm, { ...base, revise: { previous: PLAN, feedback: "rasmli mashq qo'sh" } })
    expect(reqs[0]!.task).toBe('plan')
    expect(plan.sections).toHaveLength(2)
    expect(JSON.stringify(reqs[0]!.parts)).toContain("rasmli mashq qo'sh")
    expect(reqs[0]!.system).toContain('No free speaking tasks')
  })
})

describe('learnPrefs', () => {
  it('moves a kind up when the teacher adds it and down when they remove it', () => {
    const final = { ...PLAN, vocabRepetition: false, sections: [{ ...PLAN.sections[0]!, kinds: [{ kind: 'gap_fill' as const, count: 5 }] }] }
    const p = learnPrefs({ kindBias: { matching: 1 } }, PLAN, final)
    expect(p).toEqual({ vocabRepetition: false, kindBias: { matching: 1, gap_fill: 1, true_false: -1 } })
    expect(learnPrefs({ kindBias: { gap_fill: 3 } }, PLAN, final).kindBias?.gap_fill).toBe(3)
  })
})

describe('pronunciation', () => {
  it('a shadowing item keeps its lines, has no key and is worth a point per sentence', () => {
    const r = convertItem({ kind: 'shadowing', skill: 'pronunciation', prompt: 'Listen and say it along', shadowingLines: [' I live in Tashkent. ', '', 'It is a big city.'], explanation: '' }, 1)
    if (!r.ok) throw new Error(r.reason)
    expect(r.ex.payload.lines).toEqual([{ text: 'I live in Tashkent.' }, { text: 'It is a big city.' }])
    expect(r.ex.answerKey).toEqual({})
    expect(r.ex.points).toBe(2)
    expect(r.ex.payload.mode).toBe('shadow')
    // only "practised" without a microphone: no points
    expect(gradeExercise('shadowing', r.ex.payload, r.ex.answerKey, true)).toEqual({ fraction: 0, isCorrect: false })
    // checked: the average of each sentence's best score; correct only when every sentence passed
    const line = (best: number, passed: boolean) => ({ best, tries: 2, passed, missed: [], tip: '' })
    expect(gradeExercise('shadowing', r.ex.payload, r.ex.answerKey, { lines: [line(90, true), line(60, false)] })).toEqual({ fraction: 0.75, isCorrect: false })
    expect(gradeExercise('shadowing', r.ex.payload, r.ex.answerKey, { lines: [line(80, true), line(70, true)] }).isCorrect).toBe(true)
    expect(convertItem({ kind: 'shadowing', prompt: 'x', shadowingLines: ['go'], readAloud: true, explanation: '' }, 1)).toMatchObject({ ok: true, ex: { payload: { mode: 'read' } } })
    expect(convertItem({ kind: 'shadowing', prompt: 'x', shadowingLines: [], explanation: '' }, 1).ok).toBe(false)
  })
  it('a minimal pair keeps the word the student hears', () => {
    const r = convertItem({ kind: 'mcq_single', skill: 'pronunciation', prompt: 'Listen and choose', options: ['ship', 'sheep'], correctOptionIndexes: [1], speak: ' sheep ', explanation: '' }, 3)
    if (!r.ok) throw new Error(r.reason)
    expect(r.ex.speak).toBe('sheep')
  })
  it('pronunciation parts are written with the pronunciation rules and may play sound', async () => {
    const reqs: LlmRequest[] = []
    const plan = normalizePlan({ ...PLAN, vocabRepetition: false, sections: [{ title: 'Talaffuz', skill: 'pronunciation', kinds: [{ kind: 'mcq_single', count: 1 }, { kind: 'shadowing', count: 1 }], about: 'th sound' }] })!
    const llm: LlmProvider = {
      name: 'fake',
      async generateJson(req) {
        reqs.push(req)
        return {
          json: {
            exercises: [
              { kind: 'mcq_single', skill: 'pronunciation', prompt: 'Listen and choose', options: ['think', 'sink'], correctOptionIndexes: [0], speak: 'think', explanation: '…' },
              { kind: 'shadowing', skill: 'pronunciation', prompt: 'Say it along', shadowingLines: ['I think so.', 'Thank you.'], explanation: '' },
            ],
            items: [],
            answers: [],
          },
          usage: { inputTokens: 1, outputTokens: 1 },
          model: 'fake',
        }
      },
    }
    const r = await generateAssignment(llm, { ...base, plan })
    expect(r.draft.exercises.map((e) => e.kind)).toEqual(['mcq_single', 'shadowing'])
    const part = reqs.find((q) => q.parts.some((p) => 'text' in p && p.text.includes('YOUR PART')))!
    expect(part.system).toContain('never stored')
    expect(JSON.stringify(part.schema)).toContain('"speak"')
    // the solver never answers what it can't hear, nor practice
    const solver = reqs.find((q) => q.system.includes('careful top student'))
    expect(solver).toBeUndefined()
  })
})
