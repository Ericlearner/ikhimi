import { describe, expect, it } from 'vitest'
import { explainMistake, publicTutorNotes, type TutorInput } from './tutor'
import type { LlmProvider, LlmRequest } from './llm/types'

function fake(reply: { text: string; example: string; practice?: unknown }) {
  const requests: LlmRequest[] = []
  const llm: LlmProvider = {
    name: 'fake',
    async generateJson(req) {
      requests.push(req)
      return { json: reply, usage: { inputTokens: 1, outputTokens: 1 }, model: 'fake' }
    },
  }
  return { llm, requests }
}

const base: TutorInput = {
  kind: 'mcq_single',
  item: 'Choose: "Hurry up! Everybody ___ for you."\nOptions: is waiting | wait | waits | are waiting',
  studentAnswer: 'are waiting',
  correctAnswer: 'is waiting',
  reveal: true,
  teacherNote: "Everybody birlikda: is waiting.",
  locale: 'ko',
  language: 'en',
}

describe('explainMistake', () => {
  it("explains the student's answer in their language, with the key when answers are shown", async () => {
    const { llm, requests } = fake({ text: "«are waiting» emas: everybody birlik.", example: 'Everyone is listening now.' })
    const r = await explainMistake(llm, base)
    expect(r).toMatchObject({ text: "«are waiting» emas: everybody birlik.", example: 'Everyone is listening now.' })
    const sent = JSON.parse((requests[0]!.parts[0] as { text: string }).text)
    expect(sent).toMatchObject({ studentAnswer: 'are waiting', correctAnswer: 'is waiting' })
    expect(requests[0]!.system).toContain('Korean (Hangul')
  })
  it('never sends or shows a hidden answer', async () => {
    const { llm, requests } = fake({ text: 'Bu yerda is waiting kerak edi.', example: 'Everybody is waiting outside.' })
    const r = await explainMistake(llm, { ...base, reveal: false })
    const sent = (requests[0]!.parts[0] as { text: string }).text
    expect(sent).not.toContain('correctAnswer')
    expect(requests[0]!.system).toContain('NEVER say')
    expect(r.text).toBe('Bu yerda ___ kerak edi.')
    expect(r.example).toBeNull()
  })
  it('asked again, it is told what was already said and to say it differently', async () => {
    const { llm, requests } = fake({ text: 'Boshqacha: …', example: '' })
    const r = await explainMistake(llm, { ...base, previous: [{ text: 'Birinchi izoh', example: null }] })
    expect(r.example).toBeNull()
    expect(requests[0]!.system).toContain('DIFFERENT, simpler')
    expect((requests[0]!.parts[0] as { text: string }).text).toContain('Birinchi izoh')
  })
  it('the "simpler" and "example" buttons shape the reply', async () => {
    const simpler = fake({ text: 'Soddaroq: …', example: 'The class is waiting.' })
    await explainMistake(simpler.llm, { ...base, mode: 'simpler', previous: [{ text: 'Birinchi izoh', example: null }] })
    expect(simpler.requests[0]!.system).toContain('DIFFERENT, simpler')

    const ex = fake({ text: '«is» ga qarang.', example: 'Nobody is sleeping.' })
    expect(await explainMistake(ex.llm, { ...base, mode: 'example' })).toMatchObject({ mode: 'example', example: 'Nobody is sleeping.' })
    expect(ex.requests[0]!.system).toContain('another example')
    await expect(explainMistake(fake({ text: 'Mana.', example: '' }).llm, { ...base, mode: 'example' })).rejects.toThrow()
  })
  it('writes one small practice item on the same rule; its answer stays on the server until tried', async () => {
    const { llm, requests } = fake({ text: 'Sinab ko‘ring!', example: 'x', practice: { question: 'My family ___ at home.', options: ['are', 'is'], answers: ['is'], why: 'family — birlik.' } })
    const r = await explainMistake(llm, { ...base, mode: 'practice' })
    expect(requests[0]!.schema).toMatchObject({ required: ['text', 'example', 'practice'] })
    expect(r.example).toBeNull()
    expect(r.practice).toMatchObject({ question: 'My family ___ at home.', answers: ['is'], why: 'family — birlik.' })
    expect([...r.practice!.options!].sort()).toEqual(['are', 'is'])

    const [shown] = publicTutorNotes([r])
    expect(shown!.practice).toEqual({ question: 'My family ___ at home.', options: r.practice!.options })
    const [tried] = publicTutorNotes([{ ...r, practice: { ...r.practice!, given: 'are', right: false } }])
    expect(tried!.practice).toMatchObject({ answers: ['is'], given: 'are', right: false })
  })
  it('refuses a practice item it cannot check', async () => {
    const bad = [
      { question: 'My family ___ at home.', options: ['are', 'is'], answers: ['was'], why: '' }, // the answer isn't an option
      { question: 'My family is at home.', options: [], answers: ['is'], why: '' }, // no blank
      { question: 'A ___ and ___.', options: [], answers: ['is'], why: '' }, // two blanks
      { question: '', options: ['a', 'b'], answers: ['a'], why: '' },
    ]
    for (const practice of bad) await expect(explainMistake(fake({ text: 'Sinab ko‘ring!', example: '', practice }).llm, { ...base, mode: 'practice' })).rejects.toThrow()
    const blank = await explainMistake(fake({ text: 'Yozing!', example: '', practice: { question: 'She ___ (be) happy.', options: [], answers: ['is', "'s"], why: '' } }).llm, { ...base, mode: 'practice' })
    expect(blank.practice).toMatchObject({ options: null, answers: ['is', "'s"] })
  })
  it('with hidden answers, a practice item that holds the answer is refused', async () => {
    const leak = fake({ text: 'Sinab ko‘ring!', example: '', practice: { question: 'The team ___ for the bus.', options: ['is waiting', 'are waiting'], answers: ['is waiting'], why: '' } })
    await expect(explainMistake(leak.llm, { ...base, reveal: false, mode: 'practice' })).rejects.toThrow('hidden answer')
    expect(leak.requests[0]!.system).toContain('or practice item may contain it')
  })
})
