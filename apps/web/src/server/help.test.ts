import { beforeEach, describe, expect, it } from 'vitest'
import { createTestDb } from '@ikhimi/db/testing'
import { CONFIG, eq, helpQuestions, supportThreads, users, type Db } from '@ikhimi/db'
import type { LlmProvider, LlmRequest } from '@ikhimi/ai'
import { HELP_TOPIC_IDS, helpGuide, helpPlace } from '@/content/help-guide'
import { askHelp, handOff, helpTeacher, mostAsked, pruneHelpQuestions } from './help'
import { DEFAULT_PRICING } from './pricing'

let db: Db

function fakeLlm(reply: { answer: string; topic: string; links: string[]; gist: string }) {
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

function fakeBot(opts: { teacherReachable?: boolean } = {}) {
  const sent: { method: string; params: Record<string, unknown> }[] = []
  let id = 100
  return {
    sent,
    bot: {
      async call<T>(method: string, params: Record<string, unknown> = {}) {
        sent.push({ method, params })
        return { message_id: ++id } as T
      },
      async sendMessage(chatId: string, text: string) {
        if (opts.teacherReachable === false) throw new Error('Forbidden: bot was blocked by the user')
        sent.push({ method: 'sendMessage', params: { chat_id: chatId, text } })
      },
    },
  }
}

const ask = { history: [], path: '/app', locale: 'ko' as const, prices: DEFAULT_PRICING, store: false }

async function teacher(telegram = true) {
  const [u] = await db
    .insert(users)
    .values({ role: 'teacher', phone: '+998900000001', fullName: 'Nodira Karimova', telegramChatId: telegram ? '5551' : null })
    .returning()
  return (await helpTeacher(db, u!.id))!
}

beforeEach(async () => {
  db = await createTestDb()
})

describe('help guide', () => {
  it('reads well, with real on-screen names and no leftover placeholders', () => {
    const { topics, links } = helpGuide('ko', { prices: DEFAULT_PRICING, store: false })
    expect(topics.map((t) => t.id)).toEqual(HELP_TOPIC_IDS)
    for (const t of topics) {
      expect(t.text, t.id).not.toMatch(/undefined|null|NaN|«[a-z]+\.[a-zA-Z.]+»|\{\w+\}/)
    }
    expect(links.length).toBeGreaterThan(3)
    expect(topics.find((t) => t.id === 'digitize')!.text).toContain('«교재 문제 옮기기»')
    expect(topics.find((t) => t.id === 'plans')!.text).toContain('9,900원')
  })

  it('says nothing about buying in the store apps', () => {
    const { topics, links } = helpGuide('ko', { prices: DEFAULT_PRICING, store: true })
    expect(topics.map((t) => t.id)).not.toContain('plans')
    expect(topics.map((t) => t.id)).not.toContain('course_price')
    expect(links.map((l) => l.id)).not.toContain('packages')
    expect(topics.map((t) => t.text).join('\n')).not.toMatch(/\d원/)
  })

  it('knows the page the chat was opened on', () => {
    expect(helpPlace('/app').place).toBe('home')
    expect(helpPlace('/app/a/01ABC').place).toBe('draft')
    expect(helpPlace('/app/a/01ABC/report?x=1').place).toBe('report')
    expect(helpPlace('/app/groups/01ABC').about).toMatch(/group/)
    expect(helpPlace('/somewhere').place).toBe('other')
  })
})

describe('help chat', () => {
  it('answers with real links, records only the topic, and counts down the day', async () => {
    const t = await teacher()
    const { llm, requests } = fakeLlm({ answer: 'Nusxalash rejimini tanlang.', topic: 'digitize', links: ['home'], gist: '' })
    const r = await askHelp(db, t, { ...ask, question: 'Kitobni qanday nusxalayman?', path: '/app/a/x' }, llm)
    expect(r).toEqual({ ok: true, answer: 'Nusxalash rejimini tanlang.', topic: 'digitize', links: [{ href: '/app', label: '홈' }], left: CONFIG.help.questionsPerDay - 1 })
    expect(requests[0]!.system).toContain("a homework's page")
    const rows = await db.select().from(helpQuestions)
    expect(rows).toMatchObject([{ userId: t.id, topic: 'digitize', gist: null, handoff: false }])
  })

  it('stops at the daily limit without calling the AI', async () => {
    const t = await teacher()
    await db.insert(helpQuestions).values(Array.from({ length: CONFIG.help.questionsPerDay }, () => ({ userId: t.id, topic: 'start' })))
    const { llm, requests } = fakeLlm({ answer: 'x', topic: 'start', links: [], gist: '' })
    expect(await askHelp(db, t, { ...ask, question: 'Yana?' }, llm)).toEqual({ ok: false, reason: 'limit', limit: CONFIG.help.questionsPerDay })
    expect(requests).toHaveLength(0)
  })

  it('records nothing when the AI fails', async () => {
    const t = await teacher()
    const llm: LlmProvider = { name: 'fake', generateJson: async () => Promise.reject(new Error('busy')) }
    await expect(askHelp(db, t, { ...ask, question: 'Savol' }, llm)).rejects.toThrow()
    expect(await db.select().from(helpQuestions)).toHaveLength(0)
  })
})

describe('sending the conversation to the team', () => {
  const input = { question: 'Vazifani PDF qilib yuklab olsa bo‘ladimi?', history: [{ role: 'teacher' as const, text: 'Salom' }, { role: 'assistant' as const, text: "Qo'llanmada yo'q." }], path: '/app/a/x' }

  it('lands in the admin chat, and a Reply there reaches the teacher in Telegram', async () => {
    const t = await teacher()
    const { bot, sent } = fakeBot()
    expect(await handOff(db, t, input, { bot, adminChatId: '-100' })).toEqual({ ok: true, reach: 'telegram' })
    expect(sent[0]).toMatchObject({ params: { chat_id: '5551' } })
    const [head, body] = sent.filter((s) => s.params.chat_id === '-100')
    expect(head!.params.text).toContain('Nodira Karimova')
    expect(head!.params.text).not.toContain('+998')
    expect(body!.params.text).toContain('Vazifani PDF')
    expect(body!.params.text).toContain("🤖 Qo'llanmada yo'q.")
    expect(body!.params.reply_parameters).toEqual({ message_id: 101 })
    const threads = await db.select().from(supportThreads)
    expect(threads.map((x) => x.userChatId)).toEqual(['5551', '5551'])
    expect(await db.select().from(helpQuestions).where(eq(helpQuestions.handoff, true))).toHaveLength(1)
  })

  it('gives the team the number when Telegram can’t reach the teacher', async () => {
    const t = await teacher(false)
    const { bot, sent } = fakeBot()
    expect(await handOff(db, t, input, { bot, adminChatId: '-100' })).toEqual({ ok: true, reach: 'phone' })
    expect(sent[0]!.params.text).toContain('+998900000001')
    expect(await db.select().from(supportThreads)).toHaveLength(0)

    const blocked = await db.update(users).set({ telegramChatId: '5551' }).where(eq(users.id, t.id)).returning()
    const r = await handOff(db, (await helpTeacher(db, blocked[0]!.id))!, input, { bot: fakeBot({ teacherReachable: false }).bot, adminChatId: '-100' })
    expect(r).toEqual({ ok: true, reach: 'phone' })
  })

  it('is limited a day, and unavailable without a support chat', async () => {
    const t = await teacher()
    expect(await handOff(db, t, input, { bot: fakeBot().bot, adminChatId: undefined })).toEqual({ ok: false, reason: 'unavailable' })
    for (let i = 0; i < CONFIG.help.handoffsPerDay; i++) await handOff(db, t, input, { bot: fakeBot().bot, adminChatId: '-100' })
    expect(await handOff(db, t, input, { bot: fakeBot().bot, adminChatId: '-100' })).toEqual({ ok: false, reason: 'limit', limit: CONFIG.help.handoffsPerDay })
  })
})

describe("Admin's most asked", () => {
  it('counts topics and the questions the guide misses, over the last 30 days, and old rows go', async () => {
    const t = await teacher()
    const old = new Date(Date.now() - 40 * 86400_000)
    await db.insert(helpQuestions).values([
      { userId: t.id, topic: 'digitize' },
      { userId: t.id, topic: 'digitize' },
      { userId: t.id, topic: 'publish' },
      { userId: t.id, topic: 'unknown', gist: 'pdf qilib yuklab olish' },
      { userId: t.id, topic: 'unknown', gist: 'pdf qilib yuklab olish' },
      { userId: t.id, topic: 'off_topic' },
      { userId: t.id, topic: 'handoff', handoff: true },
      { userId: t.id, topic: 'publish', createdAt: old },
      { userId: t.id, topic: 'start', createdAt: new Date(Date.now() - 100 * 86400_000) },
    ])
    const m = await mostAsked(db, 30)
    expect(m.topics).toEqual([
      { topic: 'digitize', n: 2 },
      { topic: 'publish', n: 1 },
    ])
    expect(m.unknown).toEqual([{ gist: 'pdf qilib yuklab olish', n: 2 }])
    expect(m.totals).toEqual({ questions: 6, teachers: 1, handoffs: 1 })
    expect(await pruneHelpQuestions(db)).toBe(1)
  })
})
