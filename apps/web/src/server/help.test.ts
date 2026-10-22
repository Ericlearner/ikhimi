import { beforeEach, describe, expect, it } from 'vitest'
import { createTestDb } from '@ikhimi/db/testing'
import { CONFIG, helpQuestions, users, type Db } from '@ikhimi/db'
import type { LlmProvider, LlmRequest } from '@ikhimi/ai'
import { HELP_TOPIC_IDS, helpGuide, helpPlace } from '@/content/help-guide'
import { askHelp, helpTeacher, mostAsked, pruneHelpQuestions } from './help'
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

const ask = { history: [], path: '/app', locale: 'ko' as const, prices: DEFAULT_PRICING, store: false }

async function teacher() {
  const [u] = await db.insert(users).values({ role: 'teacher', phone: 'google:t1', fullName: 'Nodira Karimova' }).returning()
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
    expect(rows).toMatchObject([{ userId: t.id, topic: 'digitize', gist: null }])
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
      { userId: t.id, topic: 'publish', createdAt: old },
      { userId: t.id, topic: 'start', createdAt: new Date(Date.now() - 100 * 86400_000) },
    ])
    const m = await mostAsked(db, 30)
    expect(m.topics).toEqual([
      { topic: 'digitize', n: 2 },
      { topic: 'publish', n: 1 },
    ])
    expect(m.unknown).toEqual([{ gist: 'pdf qilib yuklab olish', n: 2 }])
    expect(m.totals).toEqual({ questions: 6, teachers: 1 })
    expect(await pruneHelpQuestions(db)).toBe(1)
  })
})
