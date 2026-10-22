import { describe, expect, it } from 'vitest'
import { generateAssignment, type Material } from './generate'
import { keysFromAnswerPages } from './answer-key'
import { audioNameMatches, pickTracks, suggestedFileName } from './audio-names'
import type { LlmProvider, LlmRequest } from './llm/types'

const usage = { inputTokens: 1, outputTokens: 1 }
const page: Material = { label: 'p12.jpg', mimeType: 'image/jpeg', dataBase64: 'AAAA' }
const key: Material = { label: 'answers.jpg', mimeType: 'image/jpeg', dataBase64: 'BBBB' }

function scripted(...responses: unknown[]) {
  const requests: LlmRequest[] = []
  const llm: LlmProvider = {
    name: 'fake',
    async generateJson(req) {
      requests.push(req)
      return { json: responses[Math.min(requests.length - 1, responses.length - 1)], usage, model: 'fake' }
    },
  }
  return { llm, requests }
}

const short = (n: number, answerSource?: string) => ({ kind: 'short_answer', skill: 'grammar', prompt: `${n}. Past of go?`, acceptedAnswers: ['went'], sourceRef: `Page 12, ex. ${n}`, explanation: '', ...(answerSource && { answerSource }) })
const listenGap = { kind: 'gap_fill', skill: 'listening', prompt: '5. Listen and complete.', gapText: 'Tom lives in ___.', gapAnswers: [{ accepted: ['London'] }], listening: true, audioLabel: 'Track 1.12', explanation: '' }

describe("the book's answer pages (copying)", () => {
  it('go to the model as answer pages, apart from the materials; each answer says where it came from', async () => {
    const { llm, requests } = scripted({
      title: 'U3',
      instructions: 'Bajaring.',
      rationale: '',
      contentLanguage: 'en',
      exercises: [short(1, 'answer_key'), short(2, 'ai'), short(3), { ...listenGap, answerSource: 'audio' }],
    }, { answers: [] })
    const r = await generateAssignment(llm, { mode: 'digitize', teacherText: '', materials: [page], answerPages: [key], instructionLocale: 'ko', targetMinutes: 5, difficulty: 3 })
    const req = requests[0]!
    expect(req.system).toContain("the book's ANSWER KEY")
    expect(req.system).toContain('every unit has an "ex. 4b"')
    const texts = req.parts.map((p) => ('text' in p ? p.text : '[data]'))
    expect(texts).toContain('Material 1 (photo):')
    expect(texts).toContain('Answer key 1 (photo):')
    expect(texts.join('\n')).not.toContain('Material 2')
    // Every copied item must say where its answer came from
    const anyOf = (req.schema as { properties: { exercises: { items: { anyOf: { required: string[] }[] } } } }).properties.exercises.items.anyOf
    expect(anyOf.every((v) => v.required.includes('answerSource'))).toBe(true)

    // (the fake solver below answers nothing, so solve-back marks every checkable item; only the source note matters here)
    const [fromKey, solved, unsaid, listening] = r.draft.exercises
    expect(fromKey!.answerSource).toBe('answer_key')
    expect(fromKey!.flags).not.toContain('answer_ai_inferred')
    expect(solved!.answerSource).toBe('ai')
    expect(solved!.flags).toContain('answer_ai_inferred')
    // No source given counts as the AI's own solving
    expect(unsaid!.answerSource).toBe('ai')
    expect(unsaid!.flags).toContain('answer_ai_inferred')
    // A listening item waiting for its recording has a best guess: no "check" note, the recording will decide
    expect(listening).toMatchObject({ answerSource: 'ai', flags: ['needs_audio'] })
  })

  it('without answer pages the model is told to solve, and answer pages never reach Create', async () => {
    const { llm, requests } = scripted({ title: 'U3', instructions: 'Bajaring.', rationale: '', contentLanguage: 'en', exercises: [short(1, 'ai')] })
    await generateAssignment(llm, { mode: 'digitize', teacherText: '', materials: [page], instructionLocale: 'ko', targetMinutes: 5, difficulty: 3 })
    expect(requests[0]!.system).toContain('Otherwise solve carefully yourself')
    expect(requests[0]!.system).not.toContain('ANSWER KEY')

    const create = scripted({ title: 'U3', instructions: 'Bajaring.', rationale: '', contentLanguage: 'en', exercises: [short(1)] })
    const r = await generateAssignment(create.llm, { mode: 'create', teacherText: 'past simple', materials: [], answerPages: [key], instructionLocale: 'ko', targetMinutes: 5, difficulty: 3 })
    expect(JSON.stringify(create.requests[0]!.parts)).not.toContain('Answer key')
    expect(r.draft.exercises[0]!.answerSource).toBeUndefined()
  })

  it('read after copying: a key only for the exercises the pages cover, in the shape the student sees', async () => {
    const { llm, requests } = scripted({
      answers: [
        { n: 1, blanks: [{ accepted: ['am'] }, { accepted: ['is'] }], explanation: 'Kitobda: am, is.' },
        // One blank for a two-gap item: doesn't fit, so not used
        { n: 2, blanks: [{ accepted: ['are'] }] },
      ],
    })
    const gap = { kind: 'gap_fill' as const, prompt: '1. Complete.', payload: { text: 'I ___ here. She ___ here.' }, audioLabel: null, sourceRef: 'Page 12, ex. 1' }
    const r = await keysFromAnswerPages(llm, { pages: [key], instructionLocale: 'ko', items: [gap, { ...gap, sourceRef: 'Page 12, ex. 2' }, { ...gap, sourceRef: 'Page 12, ex. 3' }] })
    expect(r.keys).toEqual([{ blanks: [['am'], ['is']] }, null, null])
    expect(r.explanations[0]).toBe('Kitobda: am, is.')
    expect(requests[0]!.system).toContain('Never answer from your own knowledge')

    const none = scripted({ answers: [] })
    expect((await keysFromAnswerPages(none.llm, { pages: [], instructionLocale: 'ko', items: [gap] })).keys).toEqual([null])
    expect(none.requests).toHaveLength(0)
  })
})

describe('recordings by file name', () => {
  it('picks the one file each track needs from a whole folder or ZIP, and suggests names', () => {
    const files = ['CD1/Track 1.01.mp3', 'CD1/Track 1.12.mp3', 'CD1/Track 1.13.mp3', 'CD1/._Track 1.12.mp3', 'CD1/cover.jpg', 'CD2/Track 2.03.mp3']
    expect(pickTracks(files, [{ label: 'Track 1.12', sourceRef: null }, { label: 'Track 2.03', sourceRef: null }, { label: 'Track 4.01', sourceRef: null }])).toEqual([1, 5, -1])
    // A path counts by its file name only
    expect(audioNameMatches('Unit 12/Track 1.12.mp3', 'Track 1.12')).toBe(true)
    expect(audioNameMatches('Unit 12/ex3.mp3', null, 'Page 12, ex. 3')).toBe(true)
    expect(suggestedFileName('Track 1.12')).toBe('Track 1.12.mp3')
    expect(suggestedFileName('CD1: 12')).toBe('CD1 12.mp3')
  })
})
