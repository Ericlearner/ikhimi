import { describe, expect, it } from 'vitest'
import { convertItem, generateAssignment, type Material } from './generate'
import { audioNameMatches } from './audio-names'
import { completeListening } from './listening'
import type { LlmProvider, LlmRequest } from './llm/types'

const usage = { inputTokens: 1, outputTokens: 1 }
const audio: Material = { label: 'Track 1.12.mp3', mimeType: 'audio/mpeg', dataBase64: 'AAAA' }
const page: Material = { label: 'p12.jpg', mimeType: 'image/jpeg', dataBase64: 'AAAA' }

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

const listenGap = { kind: 'gap_fill', skill: 'listening', prompt: '3. Listen and complete.', gapText: 'Tom lives in ___. He is ___.', listening: true, audioLabel: 'Track 1.12', explanation: '' }

describe('listening items', () => {
  it('without audio: keeps the structure, placeholder answers, flagged needs_audio', () => {
    const r = convertItem({ ...listenGap, gapAnswers: [] }, 1)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.ex.flags).toContain('needs_audio')
    expect(r.ex.audioLabel).toBe('Track 1.12')
    expect(r.ex.audioFile).toBeNull()
    expect(r.ex.answerKey).toEqual({ blanks: [['?'], ['?']] })
  })

  it('an audioFile that was not actually attached is not trusted', async () => {
    const { llm } = scripted({ title: 'U1', instructions: 'Bajaring.', rationale: '', contentLanguage: 'en', exercises: [{ ...listenGap, audioFile: 'other.mp3', gapAnswers: [{ accepted: ['London'] }, { accepted: ['ten'] }] }] })
    const res = await generateAssignment(llm, { mode: 'digitize', teacherText: '', materials: [page, audio], instructionLocale: 'ko', targetMinutes: 5, difficulty: 3 })
    expect(res.draft.exercises[0]!.audioFile).toBeNull()
    expect(res.draft.exercises[0]!.flags).toContain('needs_audio')
  })

  it('attached audio is linked by file name and listening items skip the text-only solve-back', async () => {
    const { llm, requests } = scripted({
      title: 'U1',
      instructions: 'Bajaring.',
      rationale: '',
      contentLanguage: 'en',
      exercises: [{ ...listenGap, audioFile: 'Track 1.12.mp3', answerSource: 'audio', gapAnswers: [{ accepted: ['London'] }, { accepted: ['ten'] }] }],
    })
    const res = await generateAssignment(llm, { mode: 'digitize', teacherText: '', materials: [page, audio], instructionLocale: 'ko', targetMinutes: 5, difficulty: 3 })
    expect(res.draft.exercises[0]).toMatchObject({ audioFile: 'Track 1.12.mp3', flags: [] })
    expect(requests).toHaveLength(1) // no solve-back call: nothing text-checkable
    expect(JSON.stringify(requests[0]!.parts)).toContain('audio file named \\"Track 1.12.mp3\\"')
  })
})

describe('digitize mode', () => {
  it('never trims for time, lists skipped exercises and flags AI-inferred answers', async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ kind: 'short_answer', skill: 'grammar', prompt: `${i + 1}. Past of go?`, acceptedAnswers: ['went'], answerSource: 'ai', sourceRef: 'Page 12, ex. 4', explanation: '' }))
    const { llm, requests } = scripted(
      { title: 'Unit 3', instructions: 'Bajaring.', rationale: '', contentLanguage: 'en', exercises: many, skipped: [{ ref: 'Page 12, ex. 6', reason: 'Insho' }] },
      { answers: many.map((_, i) => ({ n: i + 1, texts: ['went'] })) },
    )
    const res = await generateAssignment(llm, { mode: 'digitize', teacherText: '', materials: [page], instructionLocale: 'ko', targetMinutes: 5, difficulty: 3 })
    expect(res.draft.exercises).toHaveLength(30)
    expect(res.meta.trimmedForTime).toBe(0)
    expect(res.draft.skipped).toEqual([{ ref: 'Page 12, ex. 6', reason: 'Insho' }])
    expect(res.draft.exercises[0]!.flags).toEqual(['answer_ai_inferred'])
    expect(requests[0]!.system).toContain('You DIGITIZE; you do not create')
  })
})

describe('completeListening', () => {
  const item = { kind: 'gap_fill' as const, prompt: '3. Listen', payload: { text: 'Tom lives in ___. He is ___.', exactSpelling: false }, audioLabel: 'Track 1.12', sourceRef: 'Page 12, ex. 3' }

  it('refuses a recording that does not match', async () => {
    const { llm } = scripted({ matches: false, reason: 'Bu audio boshqa mashqqa tegishli.' })
    const r = await completeListening(llm, { audio, items: [item], instructionLocale: 'ko' })
    expect(r).toMatchObject({ matches: false, reason: 'Bu audio boshqa mashqqa tegishli.' })
  })

  it('takes answers from the recording and rejects keys that do not fit the item', async () => {
    const { llm } = scripted({
      matches: true,
      answers: [
        { n: 1, blanks: [{ accepted: ['London'] }, { accepted: ['ten', '10'] }], explanation: '"I live in London"' },
        { n: 2, optionIndexes: [7] },
      ],
    })
    const mcq = { kind: 'mcq_single' as const, prompt: 'Where?', payload: { options: ['a', 'b'] }, audioLabel: 'Track 1.12', sourceRef: null }
    const r = await completeListening(llm, { audio, items: [item, mcq], instructionLocale: 'ko' })
    expect(r.matches).toBe(true)
    if (!r.matches) return
    expect(r.keys[0]).toEqual({ blanks: [['London'], ['ten', '10']] })
    expect(r.keys[1]).toBeNull() // index 7 doesn't exist
    expect(r.explanations[0]).toBe('"I live in London"')
  })
})

describe('audioNameMatches', () => {
  it.each([
    ['Track 1.12.mp3', 'Track 1.12', null, true],
    ['CD1_12.mp3', 'Track 1.12', null, true],
    ['1-12.m4a', '1.12', null, true],
    ['Track 1.13.mp3', 'Track 1.12', null, false],
    ['Track 12.mp3', 'Track 1.12', null, false],
    ['ex3.mp3', null, 'Page 12, ex. 3', true],
    ['ex4.mp3', null, 'Page 12, ex. 3', false],
    ['recording.mp3', 'Track 1.12', null, false],
  ])('%s ↔ %s / %s → %s', (file, label, ref, want) => {
    expect(audioNameMatches(file, label, ref)).toBe(want)
  })
})
