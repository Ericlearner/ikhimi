import { describe, expect, it } from 'vitest'
import { convertItem, generateAssignment, pictureAvailable, withoutRepeatedLines, scriptMatches, settlePictures, studentView, WHOLE_PAGE, type DraftAssignment, type DraftExercise } from './generate'
import { gradeExercise, passageSeconds } from './exercises'
import type { LlmProvider, LlmRequest } from './llm/types'
import { PIIError } from './sanitize'

const ITEMS = [
  { kind: 'mcq_single', skill: 'grammar', prompt: 'Yesterday I ___ to school.', options: ['went', 'go', 'gone', 'going'], correctOptionIndexes: [0], explanation: "O'tgan zamon: go → went." },
  { kind: 'gap_fill', skill: 'grammar', prompt: 'Fill in', gapText: 'She ___ (buy) bread and ___ (eat) it.', gapAnswers: [{ accepted: ['bought'] }, { accepted: ['ate'] }], explanation: 'buy → bought, eat → ate.' },
  { kind: 'true_false', skill: 'reading', prompt: 'Tom went to the park.', trueFalseAnswer: 'true', explanation: '…' },
  { kind: 'matching', skill: 'vocabulary', prompt: 'Match', pairs: [{ left: 'go', right: 'went' }, { left: 'see', right: 'saw' }, { left: 'eat', right: 'ate' }], explanation: '…' },
  { kind: 'ordering', skill: 'grammar', prompt: 'Order', orderedItems: ['I', 'went', 'home'], explanation: '…' },
  { kind: 'short_answer', skill: 'writing', prompt: 'Past of "take"?', acceptedAnswers: ['took'], explanation: '…' },
  { kind: 'mcq_single', skill: 'grammar', prompt: 'Broken', options: ['a', 'b'], correctOptionIndexes: [], explanation: '…' },
]

/** Fake model: returns ITEMS, then solves them using the keys it can infer (or deliberately wrong). */
function fakeLlm(opts: { wrongSolveFor?: number[]; solveFails?: boolean } = {}) {
  const requests: LlmRequest[] = []
  const llm: LlmProvider = {
    name: 'fake',
    async generateJson(req) {
      requests.push(req)
      if (requests.length === 1) {
        return {
          json: { title: 'Past Simple', instructions: "Mashqlarni bajaring.", rationale: 'Takrorlash', contentLanguage: 'en', cefrLevel: 'A2', exercises: ITEMS },
          usage: { inputTokens: 100, outputTokens: 50 },
          model: 'fake-1',
        }
      }
      if (opts.solveFails) throw new Error('429')
      return { json: { answers: [] }, usage: { inputTokens: 10, outputTokens: 5 }, model: 'fake-1' }
    },
  }
  return { llm, requests }
}

describe('convertItem', () => {
  it('shuffles MCQ options and remaps the key', () => {
    for (let seed = 1; seed < 30; seed++) {
      const r = convertItem(ITEMS[0]!, seed)
      if (!r.ok) throw new Error(r.reason)
      const options = r.ex.payload.options as string[]
      expect(options[(r.ex.answerKey as { correct: number }).correct]).toBe('went')
    }
  })
  it('keeps matching and ordering solvable after shuffling', () => {
    for (let seed = 1; seed < 30; seed++) {
      const m = convertItem(ITEMS[3]!, seed)
      const o = convertItem(ITEMS[4]!, seed)
      if (!m.ok || !o.ok) throw new Error()
      const pairs = (m.ex.answerKey as { pairs: number[] }).pairs
      expect(gradeExercise('matching', m.ex.payload, m.ex.answerKey, pairs).isCorrect).toBe(true)
      expect((m.ex.payload.right as string[])[pairs[0]!]).toBe('went')
      const order = (o.ex.answerKey as { order: number[] }).order
      expect(order.map((i) => (o.ex.payload.items as string[])[i]).join(' ')).toBe('I went home')
      expect(order.every((v, i) => v === i)).toBe(false) // not pre-solved
    }
  })
  it('rejects malformed items with a reason', () => {
    expect(convertItem(ITEMS[6]!, 1)).toMatchObject({ ok: false })
    expect(convertItem({ kind: 'gap_fill', prompt: 'x', gapText: 'no blanks', gapAnswers: [], explanation: '' }, 1)).toMatchObject({ ok: false })
    expect(convertItem({ kind: 'gap_fill', prompt: 'x', gapText: 'a ___ b ___', gapAnswers: [{ accepted: ['x'] }], explanation: '' }, 1)).toMatchObject({ ok: false })
    expect(convertItem({ kind: 'speaking_record', prompt: 'x' }, 1)).toMatchObject({ ok: false })
  })
  it('flags distractor problems instead of dropping', () => {
    const r = convertItem({ kind: 'mcq_single', skill: 'grammar', prompt: 'p', options: ['go', 'went to the big park yesterday afternoon', 'goes', 'All of the above'], correctOptionIndexes: [1], explanation: '' }, 3)
    if (!r.ok) throw new Error()
    expect(r.ex.flags).toEqual(expect.arrayContaining(['all_none_of_above', 'length_cue']))
  })
  it('student view never contains the answer key', () => {
    const r = convertItem(ITEMS[5]!, 1)
    if (!r.ok) throw new Error()
    expect(JSON.stringify(studentView(r.ex))).not.toContain('took')
  })
})

describe('generateAssignment', () => {
  it('builds a verified draft, drops broken items, reports progress', async () => {
    const { llm, requests } = fakeLlm()
    const stages: string[] = []
    const { draft, meta } = await generateAssignment(llm, {
      teacherText: "Bugun Past Simple o'tdik, 20 daqiqalik vazifa",
      materials: [{ label: 'p1', mimeType: 'image/jpeg', dataBase64: 'AAAA' }],
      instructionLocale: 'ko',
      targetMinutes: 20,
      difficulty: 3,
      seed: 5,
      onProgress: (s) => stages.push(s),
    })
    expect(stages).toEqual(['reading', 'checking', 'finishing'])
    expect(draft.exercises).toHaveLength(6)
    expect(meta.dropped).toEqual([{ index: 6, reason: 'mcq_single needs exactly one correct option' }])
    expect(draft.estimatedMinutes).toBeGreaterThan(0)
    // The fake solver answered nothing → every item flagged by solve-back
    expect(draft.exercises.every((e) => e.flags.includes('solve_back_disagrees'))).toBe(true)
    // Solve-back request must not contain answer keys
    expect(JSON.stringify(requests[1]!.parts)).not.toMatch(/bought|"took"/)
    // Image passed through as inline data
    expect(requests[0]!.parts.some((p) => 'mimeType' in p)).toBe(true)
    expect(meta.usage.inputTokens).toBe(110)
  })

  it('survives a failed solve-back (free-tier rate limit)', async () => {
    const { llm } = fakeLlm({ solveFails: true })
    const { draft } = await generateAssignment(llm, { teacherText: 'x', materials: [], instructionLocale: 'ko', targetMinutes: 10, difficulty: 2 })
    expect(draft.exercises.length).toBeGreaterThan(0)
    expect(draft.exercises.some((e) => e.flags.includes('solve_back_disagrees'))).toBe(false)
  })

  it('trims to the time budget', async () => {
    const { llm } = fakeLlm()
    const { draft, meta } = await generateAssignment(llm, { teacherText: 'x', materials: [], instructionLocale: 'ko', targetMinutes: 2, difficulty: 3 })
    expect(draft.exercises).toHaveLength(4)
    expect(meta.trimmedForTime).toBe(2)
  })

  it('strips student names from the teacher text before it leaves', async () => {
    const { llm, requests } = fakeLlm()
    await generateAssignment(llm, {
      teacherText: 'Aziz Rahimov va Malika uchun qiyinroq qil',
      materials: [],
      instructionLocale: 'ko',
      targetMinutes: 20,
      difficulty: 3,
      knownNames: ['Aziz Rahimov'],
    })
    expect(JSON.stringify(requests[0]!.parts)).not.toMatch(/Aziz|Rahimov/)
  })

  it('includes retrieved methodology notes in the system prompt when present (§8.5)', async () => {
    const { llm, requests } = fakeLlm()
    await generateAssignment(llm, {
      teacherText: 'x',
      materials: [],
      instructionLocale: 'ko',
      targetMinutes: 10,
      difficulty: 2,
      methodologyNotes: [{ title: 'PPP structure', body: 'Sequence receptive to productive.' }],
    })
    expect(requests[0]!.system).toMatch(/METHODOLOGY NOTES/)
    expect(requests[0]!.system).toMatch(/PPP structure: Sequence receptive to productive\./)
  })

  it('omits the methodology section when no notes were retrieved', async () => {
    const { llm, requests } = fakeLlm()
    await generateAssignment(llm, { teacherText: 'x', materials: [], instructionLocale: 'ko', targetMinutes: 10, difficulty: 2 })
    expect(requests[0]!.system).not.toMatch(/METHODOLOGY NOTES/)
  })
})

describe('scriptMatches', () => {
  it('checks the instruction script', () => {
    expect(scriptMatches('문제를 풀어 보세요. Past Simple을 복습해요.', 'ko')).toBe(true)
    expect(scriptMatches('괄호 안의 동사를 알맞은 형태로 바꾸세요: (go) I ___ to school yesterday.', 'ko')).toBe(true)
    expect(scriptMatches('Do the exercises and review the past tense.', 'ko')).toBe(false)
  })
})

describe('PII guard', () => {
  it('Gemini adapter refuses payloads with phone numbers', async () => {
    const { GeminiProvider } = await import('./llm/gemini')
    const g = new GeminiProvider({ apiKey: 'k', model: 'm' }, (async () => new Response('{}')) as unknown as typeof fetch)
    await expect(g.generateJson({ system: 's', parts: [{ text: 'call +998901234567' }], schema: {} })).rejects.toBeInstanceOf(PIIError)
  })
})

describe('teacher-first create mode', () => {
  const scripted = (json: unknown) => {
    const requests: LlmRequest[] = []
    const llm: LlmProvider = {
      name: 'fake',
      async generateJson(req) {
        requests.push(req)
        return requests.length === 1
          ? { json, usage: { inputTokens: 1, outputTokens: 1 }, model: 'fake' }
          : { json: { answers: [] }, usage: { inputTokens: 1, outputTokens: 1 }, model: 'fake' }
      },
    }
    return { llm, requests }
  }
  const drill = (n: number) => ({
    kind: 'gap_fill',
    skill: 'grammar',
    prompt: `${n}. Make negative and question`,
    gapText: 'He plays football.\nNegative: ___\nQuestion: ___',
    gapAnswers: [{ accepted: ["He doesn't play football.", 'He does not play football.'] }, { accepted: ['Does he play football?'] }],
    explanation: '…',
  })
  const base = { mode: 'create' as const, teacherText: '15 sentences', materials: [], instructionLocale: 'ko' as const, targetMinutes: 5, difficulty: 3 as const }

  it('keeps every item when the teacher set the count, even over the time budget', async () => {
    const { llm } = scripted({ title: 'PS', instructions: 'Bajaring.', rationale: '', contentLanguage: 'en', teacherSetCount: true, exercises: Array.from({ length: 15 }, (_, i) => drill(i + 1)) })
    const r = await generateAssignment(llm, base)
    expect(r.draft.exercises).toHaveLength(15)
    expect(r.meta.trimmedForTime).toBe(0)
  })

  it('still trims to the budget when the teacher left the count open', async () => {
    const { llm } = scripted({ title: 'PS', instructions: 'Bajaring.', rationale: '', contentLanguage: 'en', exercises: Array.from({ length: 15 }, (_, i) => drill(i + 1)) })
    const r = await generateAssignment(llm, base)
    expect(r.draft.exercises.length).toBeLessThan(15)
  })

  it('times a whole-sentence gap_fill by its blanks, not a flat minute', () => {
    const r = convertItem(drill(1), 1)
    expect(r.ok && r.ex.estimatedSeconds).toBeGreaterThan(60)
  })

  it('converts open_writing and never sends it to solve-back', async () => {
    const writing = {
      kind: 'open_writing',
      skill: 'writing',
      prompt: 'Write 10 sentences about your family in Present Simple.',
      writingLines: 10,
      writingChecklist: ['Present Simple', 'he/she at least twice'],
      writingRubric: 'Each sentence uses Present Simple correctly (-s for he/she/it).',
      writingExamples: ['My mother works in a hospital.'],
      explanation: '…',
    }
    const { llm, requests } = scripted({ title: 'PS', instructions: 'Bajaring.', rationale: '', contentLanguage: 'en', exercises: [writing, drill(1)] })
    const r = await generateAssignment(llm, { ...base, targetMinutes: 30 })
    const w = r.draft.exercises.find((e) => e.kind === 'open_writing')!
    expect(w.payload).toMatchObject({ lines: 10, checklist: ['Present Simple', 'he/she at least twice'] })
    expect(w.answerKey).toMatchObject({ rubric: expect.stringContaining('Present Simple') })
    expect(w.points).toBe(10)
    expect(w.estimatedSeconds).toBe(600)
    expect(requests[1]!.parts[0]).not.toMatchObject({ text: expect.stringContaining('open_writing') })
  })

  it('attaches the shared reading passage to each item that refers to it', async () => {
    const text = 'Aziz lives in Samarkand. He gets up at seven and walks to school.'
    const { llm } = scripted({
      title: 'Reading',
      instructions: 'Matnni o‘qing.',
      rationale: '',
      contentLanguage: 'en',
      passages: [{ id: 'p1', title: 'Aziz', text }],
      exercises: [
        { kind: 'true_false', skill: 'reading', prompt: 'Aziz lives in Tashkent.', trueFalseAnswer: 'false', allowNotGiven: true, passageId: 'p1', explanation: '…' },
        { kind: 'short_answer', skill: 'reading', prompt: 'When does he get up?', acceptedAnswers: ['at seven'], passageId: 'p1', explanation: '…' },
      ],
    })
    const r = await generateAssignment(llm, base)
    expect(r.draft.exercises.every((e) => (e.payload.passage as string).includes('Samarkand'))).toBe(true)
    // Reading time counted once, on the first item that shows the passage
    expect(r.draft.exercises[0]!.estimatedSeconds).toBe(30 + passageSeconds(`Aziz\n\n${text}`))
    expect(r.draft.exercises[1]!.estimatedSeconds).toBe(90)
  })

  it('digitize mode drops AI-graded writing and ignores passages', async () => {
    const { llm, requests } = scripted({
      title: 'Unit 1',
      instructions: 'Bajaring.',
      rationale: '',
      contentLanguage: 'en',
      passages: [{ id: 'p1', text: 'Invented' }],
      exercises: [
        { kind: 'open_writing', skill: 'writing', prompt: 'Write', writingLines: 5, writingRubric: 'x', explanation: '…' },
        { ...drill(1), passageId: 'p1' },
      ],
    })
    const r = await generateAssignment(llm, { ...base, mode: 'digitize' })
    expect(r.draft.exercises.map((e) => e.kind)).toEqual(['gap_fill'])
    expect(r.draft.exercises[0]!.payload.passage).toBeUndefined()
    const schema = requests[0]!.schema as { properties: Record<string, { items?: { anyOf: { properties: Record<string, { enum?: string[] }> }[] } }> }
    expect(schema.properties.passages).toBeUndefined()
    const kinds = schema.properties.exercises!.items!.anyOf.map((v) => v.properties.kind!.enum![0])
    expect(kinds).not.toContain('open_writing')
    expect(kinds).not.toContain('essay')
    expect(schema.properties.exercises!.items!.anyOf.every((v) => !('passageId' in v.properties))).toBe(true)
  })
})

describe('exam style (create mode)', () => {
  const scripted = (json: unknown) => {
    const requests: LlmRequest[] = []
    const llm: LlmProvider = {
      name: 'fake',
      async generateJson(req) {
        requests.push(req)
        return requests.length === 1
          ? { json, usage: { inputTokens: 1, outputTokens: 1 }, model: 'fake' }
          : { json: { answers: [] }, usage: { inputTokens: 1, outputTokens: 1 }, model: 'fake' }
      },
    }
    return { llm, requests }
  }
  const essayItem = {
    kind: 'essay',
    skill: 'writing',
    prompt: 'Some people believe… Discuss both views and give your own opinion.',
    essayTaskId: 'task2',
    essayTaskLabel: 'IELTS Writing Task 2',
    essayRubric: 'Both views discussed, clear opinion.',
    essayModelAnswer: 'It is often argued…',
    explanation: '…',
  }
  const tf = { kind: 'true_false', skill: 'reading', prompt: 'Questions 1–5 — The writer…', trueFalseAnswer: 'not_given', allowNotGiven: true, explanation: '…' }
  const base = { mode: 'create' as const, teacherText: 'IELTS writing', materials: [], instructionLocale: 'ko' as const, targetMinutes: 45, difficulty: 3 as const }

  it('puts the exam formats in the prompt and grades essays on its official grid', async () => {
    const { llm, requests } = scripted({ title: 'IELTS', instructions: 'Bajaring.', rationale: '', contentLanguage: 'en', exercises: [tf, essayItem] })
    const r = await generateAssignment(llm, { ...base, language: 'en', exam: { id: 'ielts_academic', level: 'Band 6.5' } })
    expect(requests[0]!.system).toContain('EXAM STYLE: IELTS Academic, level Band 6.5')
    expect(requests[0]!.system).toContain('True/False/Not Given')
    expect(requests[0]!.system).toContain('LANGUAGE BEING TAUGHT: English')
    const essay = r.draft.exercises.find((e) => e.kind === 'essay')!
    expect(essay.payload).toMatchObject({ min: 250, grader: 'ai', exam: 'IELTS Academic · Band 6.5', taskLabel: 'IELTS Writing Task 2' })
    expect((essay.payload.scale as { criteria: { id: string }[] }).criteria.map((c) => c.id)).toEqual(['task', 'coherence', 'lexical', 'grammar'])
    expect(essay.answerKey.rubric).toContain('band descriptors')
    expect(essay.points).toBe(10)
  })

  it('an essay is never trimmed for time', async () => {
    const many = Array.from({ length: 8 }, () => tf)
    const { llm } = scripted({ title: 'IELTS', instructions: 'Bajaring.', rationale: '', contentLanguage: 'en', exercises: [...many, essayItem] })
    const r = await generateAssignment(llm, { ...base, targetMinutes: 10, exam: { id: 'ielts_academic', level: 'Band 6.5' } })
    expect(r.draft.exercises.some((e) => e.kind === 'essay')).toBe(true)
  })

  it('JLPT tells the model there is no writing section', async () => {
    const { llm, requests } = scripted({ title: 'N4', instructions: 'Bajaring.', rationale: '', contentLanguage: 'ja', exercises: [tf] })
    await generateAssignment(llm, { ...base, language: 'ja', exam: { id: 'jlpt', level: 'N4' } })
    expect(requests[0]!.system).toContain('has no writing section')
  })

  it('without an exam, essays use the general grid', async () => {
    const { llm } = scripted({ title: 'W', instructions: 'Bajaring.', rationale: '', contentLanguage: 'en', exercises: [{ ...essayItem, essayTaskId: '', essayMinLength: 120 }] })
    const r = await generateAssignment(llm, base)
    expect(r.draft.exercises[0]!.payload).toMatchObject({ min: 120, exam: '' })
    expect((r.draft.exercises[0]!.payload.scale as { criteria: unknown[] }).criteria).toHaveLength(4)
  })

  it('digitize mode ignores the exam entirely', async () => {
    const { llm, requests } = scripted({ title: 'Unit', instructions: 'Bajaring.', rationale: '', contentLanguage: 'en', exercises: [tf, essayItem] })
    const r = await generateAssignment(llm, { ...base, mode: 'digitize', exam: { id: 'ielts_academic', level: 'Band 6.5' } })
    expect(requests[0]!.system).not.toContain('EXAM STYLE')
    expect(r.draft.exercises.map((e) => e.kind)).toEqual(['true_false'])
  })
})

describe('review and repair pass', () => {
  const mcq = (prompt: string, correct = 0) => ({ kind: 'mcq_single', skill: 'grammar', prompt, options: ['went', 'go', 'gone'], correctOptionIndexes: [correct], explanation: '…' })
  const draft = (extra: Record<string, unknown> = {}) => ({
    title: 'PS',
    instructions: 'Bajaring.',
    rationale: '',
    contentLanguage: 'en',
    exercises: [mcq('1. Yesterday I ___ home.'), mcq('2. Last week she ___ away.'), mcq('3. Bad item', 2), mcq('4. Useless')],
    ...extra,
  })
  /** Call 1 writes the draft, call 2 is the reviewer, call 3 solves back */
  const three = (gen: unknown, review: unknown | Error) => {
    const requests: LlmRequest[] = []
    const llm: LlmProvider = {
      name: 'fake',
      async generateJson(req) {
        requests.push(req)
        if (requests.length === 1) return { json: gen, usage: { inputTokens: 10, outputTokens: 10 }, model: 'fake' }
        if (requests.length === 2) {
          if (review instanceof Error) throw review
          return { json: review, usage: { inputTokens: 5, outputTokens: 5 }, model: 'fake' }
        }
        return { json: { answers: [] }, usage: { inputTokens: 1, outputTokens: 1 }, model: 'fake' }
      },
    }
    return { llm, requests }
  }
  const base = { mode: 'create' as const, teacherText: 'Past Simple', materials: [], instructionLocale: 'ko' as const, targetMinutes: 20, difficulty: 3 as const, review: true }
  const verdicts = {
    items: [
      { n: 1, verdict: 'keep' },
      { n: 2, verdict: 'keep' },
      { n: 3, verdict: 'fix', issues: 'Wrong key', fixed: mcq('3. Two days ago we ___ to Bukhara.', 0) },
      { n: 4, verdict: 'drop', issues: 'Tests nothing' },
    ],
  }

  it('keeps good items, replaces fixed ones, drops the unfixable; runs as a review task', async () => {
    const { llm, requests } = three(draft(), verdicts)
    const r = await generateAssignment(llm, base)
    expect(r.draft.exercises.map((e) => e.prompt)).toEqual(['1. Yesterday I ___ home.', '2. Last week she ___ away.', '3. Two days ago we ___ to Bukhara.'])
    expect(r.meta.review).toEqual({ kept: 2, fixed: 1, dropped: 1, flagged: 0 })
    expect(requests[0]!.task).toBe('generate')
    expect(requests[1]!.task).toBe('review')
    expect(requests[1]!.effort).toBe('low')
    expect(requests[1]!.maxOutputTokens).toBe(16384)
    expect(requests[1]!.system).toContain('ONLY defensible answer')
    // The reviewer sees the answer keys
    expect((requests[1]!.parts.at(-1) as { text: string }).text).toContain('answerKey')
    expect(r.meta.usage.inputTokens).toBe(16)
  })

  it('never drops when the teacher set the count: the item is flagged with the reviewer’s note instead', async () => {
    const { llm } = three(draft({ teacherSetCount: true }), verdicts)
    const r = await generateAssignment(llm, base)
    expect(r.draft.exercises).toHaveLength(4)
    const flagged = r.draft.exercises[3]!
    expect(flagged.flags).toContain('review_flagged')
    expect(flagged.reviewNote).toBe('Tests nothing')
  })

  it('a reviewer failure keeps the draft as written', async () => {
    const { llm } = three(draft(), new Error('503'))
    const r = await generateAssignment(llm, base)
    expect(r.draft.exercises).toHaveLength(4)
    expect(r.meta.review).toMatchObject({ failed: true })
  })

  it('is off unless asked, and never runs in digitize mode', async () => {
    const off = three(draft(), verdicts)
    await generateAssignment(off.llm, { ...base, review: false })
    expect(off.requests[1]!.system).not.toContain('senior examiner')
    const dig = three(draft(), verdicts)
    await generateAssignment(dig.llm, { ...base, mode: 'digitize' })
    expect(dig.requests.some((r) => r.system.includes('senior examiner'))).toBe(false)
  })
})

describe('empty model reply', () => {
  it('asks once more when the model returns no exercises', async () => {
    const requests: LlmRequest[] = []
    const good = { title: 'PS', instructions: 'Bajaring.', rationale: '', contentLanguage: 'en', exercises: [ITEMS[0]] }
    const llm: LlmProvider = {
      name: 'fake',
      async generateJson(req) {
        requests.push(req)
        const json = requests.length === 1 ? { ...good, exercises: [] } : requests.length === 2 ? good : { answers: [] }
        return { json, usage: { inputTokens: 1, outputTokens: 1 }, model: 'fake' }
      },
    }
    const r = await generateAssignment(llm, { mode: 'create', teacherText: 'x', materials: [], instructionLocale: 'ko', targetMinutes: 10, difficulty: 3 })
    expect(r.draft.exercises).toHaveLength(1)
    expect((requests[1]!.parts.at(-1) as { text: string }).text).toContain('EMPTY')
  })
})

describe('item schema', () => {
  it('gives each kind only its own fields, with its answer fields required', async () => {
    const requests: LlmRequest[] = []
    const llm: LlmProvider = {
      name: 'fake',
      async generateJson(req) {
        requests.push(req)
        return { json: requests.length === 1 ? { title: 'x', instructions: 'Bajaring.', rationale: '', contentLanguage: 'en', exercises: [ITEMS[1]] } : { answers: [] }, usage: { inputTokens: 1, outputTokens: 1 }, model: 'fake' }
      },
    }
    await generateAssignment(llm, { mode: 'create', teacherText: 'x', materials: [], instructionLocale: 'ko', targetMinutes: 10, difficulty: 3 })
    const variants = (requests[0]!.schema as { properties: { exercises: { items: { anyOf: { properties: Record<string, { enum?: string[] }>; required: string[] }[] } } } }).properties.exercises.items.anyOf
    const gap = variants.find((v) => v.properties.kind!.enum![0] === 'gap_fill')!
    expect(gap.required).toEqual(expect.arrayContaining(['gapText', 'gapAnswers']))
    expect(Object.keys(gap.properties)).not.toContain('writingRubric')
    expect(Object.keys(gap.properties)).not.toContain('trueFalseAnswer')
  })
})

describe('pictures', () => {
  const plain = { kind: 'short_answer', skill: 'vocabulary', prompt: 'Say hello', acceptedAnswers: ['hello'], explanation: '…' }
  const run = async (materials: { label: string; mimeType: string; dataBase64: string }[], mode: 'create' | 'digitize' = 'create', box: number[] = [100, 200, 400, 500]) => {
    const requests: LlmRequest[] = []
    const llm: LlmProvider = {
      name: 'fake',
      async generateJson(req) {
        requests.push(req)
        const item = { kind: 'short_answer', skill: 'vocabulary', prompt: 'What is in picture 3?', acceptedAnswers: ['a sofa'], explanation: '…', sourceRef: 'Page 4, ex. 2', imageRef: { material: 1, box } }
        return {
          json: requests.length === 1 ? { title: 'x', instructions: 'Bajaring.', rationale: '', contentLanguage: 'en', exercises: [item, plain] } : { answers: [] },
          usage: { inputTokens: 1, outputTokens: 1 },
          model: 'fake',
        }
      },
    }
    const r = await generateAssignment(llm, { mode, teacherText: 'x', materials, instructionLocale: 'ko', targetMinutes: 10, difficulty: 3 })
    return { r, requests }
  }
  const photo = [{ label: 'p.jpg', mimeType: 'image/jpeg', dataBase64: 'x' }]

  it('keeps a picture reference to a photo', async () => {
    const { r, requests } = await run(photo)
    expect(r.draft.exercises[0]!.imageRef).toEqual({ material: 1, box: [100, 200, 400, 500] })
    expect(requests[0]!.system).toContain('PICTURES')
  })
  it('an unusable box becomes the whole page, a reversed one is put right', async () => {
    expect((await run(photo, 'create', [100, 200, 110, 205])).r.draft.exercises[0]!.imageRef!.box).toEqual(WHOLE_PAGE)
    expect((await run(photo, 'create', [400, 500, 100, 200])).r.draft.exercises[0]!.imageRef!.box).toEqual([100, 200, 400, 500])
  })
  it('create drops an item whose picture is not in the materials', async () => {
    const { r } = await run([{ label: 'a.mp3', mimeType: 'audio/mpeg', dataBase64: 'x' }])
    expect(r.draft.exercises.map((e) => e.prompt)).toEqual(['Say hello'])
  })
  it('digitize keeps the book pictures, and lists an exercise it could not picture as skipped', async () => {
    const ok = await run(photo, 'digitize')
    expect(JSON.stringify(ok.requests[0]!.schema)).toContain('imageRef')
    expect(ok.requests[0]!.system).toContain('PICTURES')
    expect(ok.r.draft.exercises[0]!.imageRef).toEqual({ material: 1, box: [100, 200, 400, 500] })
    const missing = await run([{ label: 'a.mp3', mimeType: 'audio/mpeg', dataBase64: 'x' }], 'digitize')
    expect(missing.r.draft.exercises).toHaveLength(1)
    expect(missing.r.draft.skipped).toEqual([{ ref: 'Page 4, ex. 2', reason: '문제의 그림을 잘라내지 못했어요' }])
  })
  it('a PDF picture keeps its page; a printed page number is mapped to its place in the file sent', () => {
    const pdf = { label: 'b.pdf', mimeType: 'application/pdf', dataBase64: 'x', pages: 3, pageNumbers: [12, 13, 14] }
    const ref = (page?: number) => ({ material: 1, ...(page ? { page } : {}), box: WHOLE_PAGE })
    const a = ref(2)
    expect(pictureAvailable(a, [pdf])).toBe(true)
    expect(a.page).toBe(2)
    const b = ref(13)
    expect(pictureAvailable(b, [pdf])).toBe(true)
    expect(b.page).toBe(2)
    const c = ref()
    expect(pictureAvailable(c, [pdf])).toBe(true)
    expect(c.page).toBe(1)
    expect(pictureAvailable(ref(40), [pdf])).toBe(false)
  })
  it('a Word document goes as its text and numbered pictures; an item may use a picture it has', async () => {
    const doc = { label: 'sheet.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', dataBase64: '', text: '<p>4. Look.</p> [Picture 1] ', pictures: [{ mimeType: 'image/jpeg', dataBase64: 'x' }] }
    const { requests } = await run([doc])
    const parts = requests[0]!.parts
    expect(parts.some((p) => 'text' in p && p.text.includes('Word document "sheet.docx"') && p.text.includes('[Picture 1]'))).toBe(true)
    expect(parts.some((p) => 'text' in p && p.text === 'Material 1, Picture 1:')).toBe(true)
    expect(parts.filter((p) => 'mimeType' in p)).toHaveLength(1)
    expect(pictureAvailable({ material: 1, picture: 1, box: WHOLE_PAGE }, [doc])).toBe(true)
    expect(pictureAvailable({ material: 1, picture: 2, box: WHOLE_PAGE }, [doc])).toBe(false)
    expect(pictureAvailable({ material: 1, box: WHOLE_PAGE }, [doc])).toBe(false)
  })
  it('a regenerated or revised item keeps the picture it had, as the files are not sent again', async () => {
    const withPic = { kind: 'short_answer', prompt: 'What is in picture 3?', payload: { exactSpelling: false, imageId: 'IMG1' }, answerKey: { accepted: ['a sofa'] }, sourceRef: 'Page 4, ex. 2' } as unknown as DraftExercise
    const previous = { title: 'x', exercises: [withPic] } as unknown as DraftAssignment
    const llm = (items: unknown[]): LlmProvider => ({
      name: 'fake',
      async generateJson() {
        return { json: { title: 'x', instructions: 'Bajaring.', rationale: '', contentLanguage: 'en', exercises: items, answers: [] }, usage: { inputTokens: 1, outputTokens: 1 }, model: 'fake' }
      },
    })
    const base = { teacherText: '', materials: [], instructionLocale: 'ko' as const, targetMinutes: 5, difficulty: 3 as const }
    // The new version even asks for the picture again (imageRef), which can't be served without the files
    const newItem = { kind: 'short_answer', skill: 'vocabulary', prompt: 'Name the thing in picture 3.', acceptedAnswers: ['a sofa'], explanation: '…', imageRef: { material: 1, box: [1, 1, 500, 500] } }
    const single = await generateAssignment(llm([newItem]), { ...base, single: { previous, index: 0, hint: '' } })
    expect(single.draft.exercises[0]!.payload.imageId).toBe('IMG1')
    expect(single.draft.exercises[0]!.flags).not.toContain('image_missing')

    const same = { kind: 'short_answer', skill: 'vocabulary', prompt: 'What is in  picture 3?', acceptedAnswers: ['a sofa'], explanation: '…' }
    const refined = await generateAssignment(llm([same, plain]), { ...base, refine: { previous, feedback: 'add one more' } })
    expect(refined.draft.exercises.map((e) => e.payload.imageId)).toEqual(['IMG1', undefined])
  })
  it('the review sees the same materials and knows pictures; solve-back leaves picture items alone', async () => {
    const doc = { label: 'sheet.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', dataBase64: '', text: '[Picture 1]', pictures: [{ mimeType: 'image/jpeg', dataBase64: 'x' }] }
    const requests: LlmRequest[] = []
    const item = { kind: 'short_answer', skill: 'vocabulary', prompt: 'What is in picture 1?', acceptedAnswers: ['a cat'], explanation: '…', imageRef: { material: 1, picture: 1, box: [0, 0, 1000, 1000] } }
    const llm: LlmProvider = {
      name: 'fake',
      async generateJson(req) {
        requests.push(req)
        const json = req.task === 'generate' ? { title: 'x', instructions: 'Bajaring.', rationale: '', contentLanguage: 'en', exercises: [item, plain] } : req.task === 'review' ? { items: [] } : { answers: [] }
        return { json, usage: { inputTokens: 1, outputTokens: 1 }, model: 'fake' }
      },
    }
    await generateAssignment(llm, { teacherText: '그림 문제로 만들어 주세요', materials: [doc], instructionLocale: 'ko', targetMinutes: 10, difficulty: 3, review: true })
    const review = requests.find((r) => r.task === 'review' && r.system.includes('senior examiner'))!
    expect(review.system).toContain('PICTURES')
    expect(review.parts.some((p) => 'dataBase64' in p && !p.dataBase64)).toBe(false)
    expect(review.parts.some((p) => 'text' in p && p.text.includes('Word document'))).toBe(true)
    const solve = requests.find((r) => r.system.includes('top student'))!
    expect((solve.parts[0] as { text: string }).text).not.toContain('picture 1')
    expect(requests[0]!.system).toContain('"그림 문제"')
  })
  it('an item that says "look at the picture" without pointing at one gets its picture found by a second call', async () => {
    const lookAt = (w: string) => ({ kind: 'gap_fill', skill: 'grammar', prompt: `Look at the picture and fill in the blank:\nB: 저는 ${w}___ 딸기를 좋아해요.`, gapText: `B: 저는 ${w}___ 딸기를 좋아해요.`, gapAnswers: [{ accepted: ['와'] }], explanation: '…' })
    const vocab = { kind: 'short_answer', skill: 'vocabulary', prompt: 'Translate: I took a picture.', acceptedAnswers: ['Men rasm oldim'], explanation: '…' }
    const requests: LlmRequest[] = []
    const llm: LlmProvider = {
      name: 'fake',
      async generateJson(req) {
        requests.push(req)
        const json =
          req.task === 'generate'
            ? { title: 'x', instructions: 'Bajaring.', rationale: '', contentLanguage: 'ko', exercises: [lookAt('수박'), lookAt('사과'), vocab, plain] }
            : req.system.startsWith('You find pictures')
              ? { items: [{ n: 1, needed: true, found: true, material: 1, box: [100, 100, 400, 400] }, { n: 2, needed: true, found: false }, { n: 3, needed: false, found: false }] }
              : { answers: [] }
        return { json, usage: { inputTokens: 1, outputTokens: 1 }, model: 'fake' }
      },
    }
    const r = await generateAssignment(llm, { teacherText: 'x', materials: photo, instructionLocale: 'ko', targetMinutes: 10, difficulty: 3 })
    const locate = requests.find((q) => q.system.startsWith('You find pictures'))!
    expect(JSON.parse((locate.parts.at(-1) as { text: string }).text).map((x: { n: number }) => x.n)).toEqual([1, 2, 3])
    // Found → points at it; not found → taken out; not needed → left as it is
    expect(r.draft.exercises.map((e) => e.prompt)).toEqual(['Look at the picture and fill in the blank:', 'Translate: I took a picture.', 'Say hello'])
    expect(r.draft.exercises[0]!.imageRef).toEqual({ material: 1, box: [100, 100, 400, 400] })
  })

  it('a gap_fill prompt does not repeat the gap text', () => {
    expect(withoutRepeatedLines('Fill in the blank:\nA: 무슨 과일을 좋아해요?\nB: 저는 수박___ 딸기를 좋아해요.', 'A: 무슨 과일을 좋아해요?\nB: 저는 수박 ___ 딸기를 좋아해요.')).toBe('Fill in the blank:')
    expect(withoutRepeatedLines('Complete the dialogue.', 'A: Hi ___')).toBe('Complete the dialogue.')
  })
  it('never empties the homework: if every item lacks its picture they stay, flagged', () => {
    const e = { flags: ['image_missing'], estimatedSeconds: 30, prompt: 'p', sourceRef: null } as unknown as DraftExercise
    const draft = { exercises: [e], skipped: [] } as unknown as DraftAssignment
    expect(settlePictures(draft, 'create', 'ko')).toBe(0)
    expect(draft.exercises).toHaveLength(1)
  })
})
