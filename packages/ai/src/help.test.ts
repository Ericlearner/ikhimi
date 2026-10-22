import { describe, expect, it } from 'vitest'
import { answerHelp, helpPrompt, type HelpInput } from './help'
import type { LlmProvider, LlmRequest } from './llm/types'

const input: HelpInput = {
  topics: [
    { id: 'digitize', text: 'Copying: choose «Kitob mashqlarini nusxalash».' },
    { id: 'publish', text: 'Press «Nashr qilish».' },
  ],
  links: [
    { id: 'home', label: 'Bosh sahifa' },
    { id: 'groups', label: 'Guruhlar' },
  ],
  page: 'the home page',
  question: 'Kitobni qanday nusxalayman? Raqamim +998 90 123 45 67',
  history: [{ role: 'teacher', text: 'Salom, men Nodira' }],
  locale: 'ko',
  knownNames: ['Nodira'],
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

describe('help chat', () => {
  it('answers from the guide only, with the exact on-screen names and the page', () => {
    const p = helpPrompt(input)
    expect(p).toContain('[digitize]\nCopying: choose «Kitob mashqlarini nusxalash».')
    expect(p).toContain('home: Bosh sahifa')
    expect(p).toContain('The teacher is on: the home page')
    expect(p).toContain('Korean (Hangul')
    expect(p).toMatch(/Never invent a feature/)
  })

  it('keeps the teacher’s number and name out of what is sent', async () => {
    const { llm, requests } = fake({ answer: 'Tanlang.', topic: 'digitize', links: [], gist: '' })
    await answerHelp(llm, input)
    const sent = (requests[0]!.parts[0] as { text: string }).text
    expect(sent).not.toContain('123 45 67')
    expect(sent).not.toContain('Nodira')
  })

  it('keeps only known links and topics, and plain text', async () => {
    const { llm } = fake({ answer: '**Bosing:**\n- birinchi\n- ikkinchi', topic: 'digitize', links: ['home', 'https://evil.example', 'home', 'groups', 'x'], gist: 'ignored' })
    const r = await answerHelp(llm, input)
    expect(r.answer).toBe('Bosing:\n• birinchi\n• ikkinchi')
    expect(r.links).toEqual(['home', 'groups'])
    expect(r.gist).toBeNull()
  })

  it('records a short gist for a question the guide does not answer, and treats a made-up topic as unknown', async () => {
    const a = await answerHelp(fake({ answer: "Qo'llanmada yo'q.", topic: 'unknown', links: [], gist: 'Vazifani PDF qilib yuklab olish?' }).llm, input)
    expect(a).toMatchObject({ topic: 'unknown', gist: 'vazifani pdf qilib yuklab olish' })
    const b = await answerHelp(fake({ answer: 'Javob.', topic: 'invented', links: [], gist: '' }).llm, input)
    expect(b.topic).toBe('unknown')
    expect(b.gist).toBeTruthy()
    const c = await answerHelp(fake({ answer: 'Faqat 익히미 haqida.', topic: 'off_topic', links: [], gist: '' }).llm, input)
    expect(c).toMatchObject({ topic: 'off_topic', gist: null })
  })

  it('fails when the model writes nothing', async () => {
    await expect(answerHelp(fake({ answer: '  ', topic: 'digitize', links: [], gist: '' }).llm, input)).rejects.toThrow()
  })
})
