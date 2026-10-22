import { describe, expect, it } from 'vitest'
import { convertItem, itemProblem, type DraftExercise, type LlmItem } from './generate'
import { normalizePlan } from './plan'

/** An item as the writer would return it, converted and with its sound */
function item(raw: LlmItem): DraftExercise {
  const r = convertItem(raw, 1)
  if (!r.ok) throw new Error(r.reason)
  return r.ex
}

describe('itemProblem', () => {
  it('takes the voice off a written grammar question (it read the answer aloud)', () => {
    const e = item({
      kind: 'mcq_single',
      skill: 'grammar',
      prompt: 'Choose the correct sentence to complete the conversation:\n\n"Hurry up! Everybody ___ for you."',
      options: ['is waiting', 'wait', 'waits', 'are waiting'],
      correctOptionIndexes: [0],
      speak: 'is waiting',
    })
    expect(itemProblem(e)).toBeNull()
    expect(e.speak).toBeNull()
  })
  it('rewrites a "verb in brackets" gap fill that shows no brackets', () => {
    const e = item({
      kind: 'gap_fill',
      skill: 'grammar',
      prompt: 'Complete the sentence with the correct form of the verb in brackets (Present Continuous or Present Simple):',
      gapText: 'The River Nile ___ into the Mediterranean, but the river ___ very fast today.',
      gapAnswers: [{ accepted: ['flows'] }, { accepted: ['is flowing'] }],
      speak: 'flow',
    })
    expect(itemProblem(e)).toMatch(/brackets/)
    expect(e.speak).toBeNull()
    const ok = item({ kind: 'gap_fill', skill: 'grammar', prompt: 'Complete with the verb in brackets', gapText: 'The Nile ___ (flow) into the sea.', gapAnswers: [{ accepted: ['flows'] }] })
    expect(itemProblem(ok)).toBeNull()
  })
  it('rewrites a listening item whose voice is not what the student needs', () => {
    const e = item({
      kind: 'gap_fill',
      skill: 'listening',
      prompt: 'Listen and fill in the missing words',
      gapText: 'She ___ to school every day.',
      gapAnswers: [{ accepted: ['walks'] }],
      speak: 'walks',
    })
    expect(itemProblem(e)).toMatch(/sentence/)
    const ok = item({ kind: 'gap_fill', skill: 'listening', prompt: 'Listen and fill in the missing words', gapText: 'She ___ to school every day.', gapAnswers: [{ accepted: ['walks'] }], speak: 'She walks to school every day.' })
    expect(itemProblem(ok)).toBeNull()
  })
  it('keeps minimal pairs, stress, dictation and listen-and-type as they are', () => {
    const pair = item({ kind: 'mcq_single', skill: 'pronunciation', prompt: "Eshitgan so'zingizni tanlang.", options: ['leaving', 'living'], correctOptionIndexes: [1], speak: 'living' })
    const stress = item({ kind: 'mcq_single', skill: 'pronunciation', prompt: "Audioni tinglang va urg'u qaysi bo'g'inga tushishini tanlang.", options: ['com-PLAIN', 'COM-plain'], correctOptionIndexes: [0], speak: 'complain' })
    const dictation = item({ kind: 'short_answer', skill: 'pronunciation', prompt: 'Audioni tinglang va eshitgan gapingizni yozing.', acceptedAnswers: ['He is always complaining.'], speak: 'He is always complaining.' })
    for (const e of [pair, stress, dictation]) {
      expect(itemProblem(e)).toBeNull()
      expect(e.speak).not.toBeNull()
    }
    const wrong = item({ kind: 'mcq_single', skill: 'pronunciation', prompt: 'Listen and choose the word you hear', options: ['ship', 'sheep'], correctOptionIndexes: [0], speak: 'sheep' })
    expect(itemProblem(wrong)).toMatch(/wrong option/)
  })
  it('never asks students to speak or shadow outside shadowing, nor to listen to nothing', () => {
    const typed = item({ kind: 'short_answer', skill: 'pronunciation', prompt: 'Audioni tinglang va yozing (shadowing mashqi uchun tinglab, takrorlang).', acceptedAnswers: ['He is always complaining.'], speak: 'He is always complaining.' })
    expect(itemProblem(typed)).toMatch(/speak or shadow/)
    const silent = item({ kind: 'short_answer', skill: 'listening', prompt: 'Listen and type what you hear', acceptedAnswers: ['hello'] })
    expect(itemProblem(silent)).toMatch(/plays nothing/)
    // "listen" inside the exercise sentence is content, not an instruction
    const content = item({ kind: 'mcq_single', skill: 'grammar', prompt: 'Choose the correct form:\nTom usually ___ to music in the evening. Listen and you will hear him.', options: ['listens', 'is listening'], correctOptionIndexes: [0] })
    expect(itemProblem(content)).toBeNull()
  })
})

describe('pronunciation parts', () => {
  it('hold only items done by ear or by voice', () => {
    const p = normalizePlan({
      title: 'T',
      sections: [{ title: 'Talaffuz', skill: 'pronunciation', kinds: [{ kind: 'mcq_single', count: 2 }, { kind: 'open_writing', count: 1 }, { kind: 'short_answer', count: 1 }, { kind: 'shadowing', count: 1 }], about: 'x' }],
    })!
    expect(p.sections[0]!.kinds).toEqual([
      { kind: 'mcq_single', count: 2 },
      { kind: 'short_answer', count: 2 },
      { kind: 'shadowing', count: 1 },
    ])
  })
})
