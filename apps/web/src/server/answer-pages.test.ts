import { beforeEach, describe, expect, it } from 'vitest'
import { createTestDb } from '@ikhimi/db/testing'
import { eq, materialBlobs, materials, users, type Db } from '@ikhimi/db'
import { convertItem, type GenerateResult, type LlmProvider, type LlmRequest } from '@ikhimi/ai'
import { applyAnswerPages } from './answer-pages'
import { createDraft, loadExercises, replaceDraft } from './assignments'
import { dropAnswerFiles, pruneAnswerFiles } from './materials'

let db: Db

const item = (raw: Record<string, unknown>, answerSource: 'answer_key' | 'ai', flags: string[] = []) => {
  const r = convertItem({ skill: 'grammar', explanation: 'AI: o‘tgan zamon.', ...raw } as never, 1)
  if (!r.ok) throw new Error(r.reason)
  return { ...r.ex, answerSource, flags: [...r.ex.flags, ...flags] }
}
const gap = item({ kind: 'gap_fill', prompt: '1. Complete.', gapText: 'I ___ to school yesterday.', gapAnswers: [{ accepted: ['go'] }], sourceRef: 'Page 12, ex. 1' }, 'ai', ['answer_ai_inferred'])
const short = item({ kind: 'short_answer', prompt: '2. Past of see?', acceptedAnswers: ['saw'], sourceRef: 'Page 12, ex. 2' }, 'ai', ['answer_ai_inferred'])
const book = item({ kind: 'short_answer', prompt: '3. Past of eat?', acceptedAnswers: ['ate'], sourceRef: 'Page 12, ex. 3' }, 'answer_key')

const result = (exercises = [gap, short, book]): GenerateResult => ({
  draft: { title: 'Unit 3', instructions: '', rationale: '', contentLanguage: 'en', cefrLevel: 'A2', estimatedMinutes: 5, exercises },
  meta: { model: 'fake', usage: { inputTokens: 0, outputTokens: 0 }, dropped: [], trimmedForTime: 0, solveBack: [], instructionsScriptOk: true, raw: {} },
})

/** Fake model: the answer pages cover exercise 1 only (the book says "went") */
function pagesLlm() {
  const requests: LlmRequest[] = []
  const llm: LlmProvider = {
    name: 'fake',
    async generateJson(req) {
      requests.push(req)
      return { json: { answers: [{ n: 1, blanks: [{ accepted: ['went'] }], explanation: 'Kitob: went.' }] }, usage: { inputTokens: 0, outputTokens: 0 }, model: 'fake' }
    },
  }
  return { llm, requests }
}

async function setup() {
  const [t] = await db.insert(users).values({ role: 'teacher', roles: ['teacher'], phone: '+998900000051', fullName: 'Nodira' }).returning()
  const a = await createDraft(db, { teacherId: t!.id, conversationId: null, instructionLocale: 'ko', difficulty: 3, result: result() })
  const answerPage = async (createdAt = new Date()) => {
    const [m] = await db
      .insert(materials)
      .values({ teacherId: t!.id, kind: 'image', originalFilename: 'answers.jpg', mimeType: 'image/jpeg', processingStatus: 'ready', purpose: 'answers', createdAt })
      .returning()
    await db.insert(materialBlobs).values({ materialId: m!.id, data: Buffer.from('jpeg') })
    return m!.id
  }
  return { teacher: t!, a, answerPage }
}

const kept = async (id: string) => {
  const [m] = await db.select().from(materials).where(eq(materials.id, id))
  const blobs = await db.select().from(materialBlobs).where(eq(materialBlobs.materialId, id))
  return !m!.deletedAt && blobs.length > 0
}

beforeEach(async () => {
  db = await createTestDb()
})

describe("the book's answer pages, added after copying", () => {
  it('replace the answers they cover, list where the book differs, and are not kept', async () => {
    const { a, answerPage } = await setup()
    const page = await answerPage()
    const { llm, requests } = pagesLlm()
    const r = await applyAnswerPages(db, llm, a, { materialIds: [page], instructionLocale: 'ko' })
    expect(r).toEqual({ found: 1, changed: [{ n: 1, ref: 'Page 12, ex. 1', before: 'go', after: 'went' }] })
    // The model got the answer pages and the exercises, never as materials to copy
    expect(requests[0]!.parts.some((p) => 'text' in p && p.text === 'Answer key 1 (photo):')).toBe(true)

    const [one, two, three] = await loadExercises(db, a.id)
    expect(one).toMatchObject({ answerKey: { blanks: [['went']] }, answerSource: 'answer_key', verifyFlags: [], explanation: 'Kitob: went.' })
    // Not on the pages: still the AI's answer, still marked for checking
    expect(two).toMatchObject({ answerSource: 'ai', verifyFlags: ['answer_ai_inferred'] })
    expect(three!.answerSource).toBe('answer_key')
    expect(await kept(page)).toBe(false)
  })

  it('more than the answer page limit is refused before any AI call', async () => {
    const { a, answerPage } = await setup()
    const pages = [await answerPage(), await answerPage(), await answerPage(), await answerPage(), await answerPage()]
    const { llm, requests } = pagesLlm()
    await expect(applyAnswerPages(db, llm, a, { materialIds: pages, instructionLocale: 'ko' })).rejects.toMatchObject({ code: 'too_many_pages', n: 4 })
    expect(requests).toHaveLength(0)
  })
})

describe('answer files are not kept', () => {
  it('removed once read, or by the daily job a day after upload; other files stay', async () => {
    const { teacher, answerPage } = await setup()
    const fresh = await answerPage()
    const old = await answerPage(new Date(Date.now() - 30 * 3600_000))
    const [page] = await db.insert(materials).values({ teacherId: teacher.id, kind: 'image', originalFilename: 'p12.jpg', mimeType: 'image/jpeg', processingStatus: 'ready', createdAt: new Date(Date.now() - 30 * 3600_000) }).returning()
    await db.insert(materialBlobs).values({ materialId: page!.id, data: Buffer.from('jpeg') })

    expect(await pruneAnswerFiles(db)).toBe(1)
    expect([await kept(fresh), await kept(old), await kept(page!.id)]).toEqual([true, false, true])
    // Only answer files, and only the teacher's own
    await dropAnswerFiles(db, 'someone-else', [fresh])
    await dropAnswerFiles(db, teacher.id, [page!.id])
    expect([await kept(fresh), await kept(page!.id)]).toEqual([true, true])
    await dropAnswerFiles(db, teacher.id, [fresh])
    expect(await kept(fresh)).toBe(false)
  })
})

describe('a revision of a copied draft', () => {
  it("keeps where an unchanged answer came from (it's written without the answer pages)", async () => {
    const { a } = await setup()
    // The model now calls every answer its own; the unchanged book answer stays the book's, a changed one doesn't
    const again = [item({ kind: 'short_answer', prompt: '3. Past of eat?', acceptedAnswers: ['ate'] }, 'ai', ['answer_ai_inferred']), item({ kind: 'short_answer', prompt: '2. Past of see?', acceptedAnswers: ['seen'] }, 'ai', ['answer_ai_inferred'])]
    await replaceDraft(db, a, result(again))
    const rows = await loadExercises(db, a.id)
    expect(rows.map((r) => [r.answerSource, r.verifyFlags])).toEqual([
      ['answer_key', []],
      ['ai', ['answer_ai_inferred']],
    ])
  })
})
