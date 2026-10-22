import { beforeEach, describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { PDFDocument } from 'pdf-lib'
import { createTestDb } from '@ikhimi/db/testing'
import { eq, labMessages, materialBlobs, materials, methodologies, methodologyVersions, users, type Db } from '@ikhimi/db'
import type { LlmProvider, LlmRequest } from '@ikhimi/ai'
import { authorizeUpload, loadMaterialsForLlm, MaterialError } from './materials'
import { countStyleUse, createOwn, deleteOwn, examMethodology, labDecide, labRemovePoint, labRemoveTask, labSend, labUndo, ownStyles, resolveStyle, updateOwn } from './lab'

let db: Db
let owner: string

function researcher(replies: unknown[]) {
  const requests: LlmRequest[] = []
  const llm: LlmProvider = {
    name: 'fake',
    async generateJson(req) {
      requests.push(req)
      return { json: replies.shift() ?? { reply: 'Nothing.', changes: [] }, usage: { inputTokens: 1, outputTokens: 1 }, model: 'fake' }
    },
  }
  return { llm, requests }
}

/** A page the owner uploaded */
async function page() {
  const png = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#ffffff' } }).png().toBuffer()
  const [m] = await db.insert(materials).values({ teacherId: owner, kind: 'image', originalFilename: 'guide.png', mimeType: 'image/png', bytes: png.length, processingStatus: 'ready' }).returning()
  await db.insert(materialBlobs).values({ materialId: m!.id, data: png })
  return m!.id
}

/** A PDF the owner uploaded, with this many pages */
async function pdf(pages: number) {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pages; i++) doc.addPage()
  const data = Buffer.from(await doc.save())
  const [m] = await db.insert(materials).values({ teacherId: owner, kind: 'pdf', originalFilename: 'test.pdf', mimeType: 'application/pdf', bytes: data.length, processingStatus: 'ready' }).returning()
  await db.insert(materialBlobs).values({ materialId: m!.id, data })
  return m!.id
}

beforeEach(async () => {
  db = await createTestDb()
  const [u] = await db.insert(users).values({ role: 'teacher', phone: '+998900000001', fullName: 'Owner' }).returning()
  owner = u!.id
})

describe('the Lab chat', () => {
  it('reads a resource for one methodology, keeps the thread and the proposal, and deletes the upload', async () => {
    const ielts = (await examMethodology(db, 'ielts_academic'))!
    expect(await examMethodology(db, 'ielts_academic')).toMatchObject({ id: ielts.id }) // one row per exam
    expect(await examMethodology(db, 'made_up')).toBeNull()
    const file = await page()
    const { llm, requests } = researcher([{ reply: 'Kept two reading points.', changes: [{ op: 'add', area: 'reading', text: 'NG statements reuse a topic word.', why: 'p. 3' }, { op: 'add', area: 'listening', text: 'Speakers correct themselves.', why: 'p. 9' }] }])
    const r = await labSend(db, llm, { ownerId: owner, methodologyId: ielts.id, text: 'Look at the traps', materialIds: [file] })
    expect(r).toMatchObject({ ok: true, proposed: 2 })
    expect(requests[0]!.system).toContain('BUILT-IN DESCRIPTION') // the exam's own description is known
    expect(requests[0]!.parts.some((p) => 'mimeType' in p)).toBe(true)
    const thread = await db.select().from(labMessages).where(eq(labMessages.methodologyId, ielts.id))
    expect(thread.map((m) => [m.role, m.text, m.files])).toEqual([
      ['owner', 'Look at the traps', ['guide.png']],
      ['ai', 'Kept two reading points.', []],
    ])
    expect(thread[1]!.proposal).toMatchObject({ status: 'open', ops: [{ op: 'add' }, { op: 'add' }] })
    // Nothing is kept before the owner applies it, and the page itself is gone
    expect((await db.select().from(methodologies).where(eq(methodologies.id, ielts.id)))[0]!.points).toEqual([])
    expect(await db.select().from(materialBlobs)).toEqual([])
    expect((await db.select().from(materials))[0]!.deletedAt).not.toBeNull()

    // The next turn sees the chat so far
    const next = researcher([])
    await labSend(db, next.llm, { ownerId: owner, methodologyId: ielts.id, text: 'Anything on writing?', materialIds: [] })
    expect((next.requests[0]!.parts[0] as { text: string }).text).toContain('Owner: Look at the traps\nYou: Kept two reading points.')
    expect(await labSend(db, next.llm, { ownerId: owner, methodologyId: ielts.id, text: ' ', materialIds: [] })).toEqual({ ok: false, reason: 'empty' })
  })

  it('applies only the ticked changes, keeps the history, undoes the newest, removes by hand', async () => {
    const m = (await examMethodology(db, 'ielts_academic'))!
    await labSend(db, researcher([{ reply: 'r', changes: [{ op: 'add', area: 'reading', text: 'A', why: '' }, { op: 'add', area: 'writing', text: 'B', why: '' }] }]).llm, { ownerId: owner, methodologyId: m.id, text: 'go', materialIds: [] })
    const [ai] = await db.select().from(labMessages).where(eq(labMessages.role, 'ai'))
    expect(await labDecide(db, { ownerId: owner, messageId: ai!.id, action: 'apply', pick: [] })).toEqual({ ok: false, reason: 'nothing_picked' })
    expect(await labDecide(db, { ownerId: owner, messageId: ai!.id, action: 'apply', pick: [1, 1, 7] })).toMatchObject({ ok: true, added: 1 })
    const points = async () => (await db.select().from(methodologies).where(eq(methodologies.id, m.id)))[0]!.points
    expect(await points()).toEqual([{ id: 'k1', area: 'writing', text: 'B' }])
    expect((await db.select().from(labMessages).where(eq(labMessages.id, ai!.id)))[0]!.proposal).toMatchObject({ status: 'applied', applied: [1] })
    // Decided once
    expect(await labDecide(db, { ownerId: owner, messageId: ai!.id, action: 'dismiss' })).toEqual({ ok: false, reason: 'gone' })

    // Sharpen it from the chat, then change your mind
    await labSend(db, researcher([{ reply: 'r', changes: [{ op: 'update', id: 'k1', area: 'writing', text: 'B, sharper', why: '' }] }]).llm, { ownerId: owner, methodologyId: m.id, text: 'sharpen k1', materialIds: [] })
    const [, second] = await db.select().from(labMessages).where(eq(labMessages.role, 'ai')).orderBy(labMessages.createdAt)
    await labDecide(db, { ownerId: owner, messageId: second!.id, action: 'apply', pick: [0] })
    expect((await points())[0]!.text).toBe('B, sharper')
    expect((await db.select().from(methodologyVersions)).map((v) => v.note).sort()).toEqual(['+1', '~1'])
    expect(await labUndo(db, m.id)).toBe(true)
    expect(await points()).toEqual([{ id: 'k1', area: 'writing', text: 'B' }])

    expect(await labRemovePoint(db, { ownerId: owner, methodologyId: m.id, pointId: 'k9' })).toBe(false)
    expect(await labRemovePoint(db, { ownerId: owner, methodologyId: m.id, pointId: 'k1' })).toBe(true)
    expect(await points()).toEqual([])
    expect(await labUndo(db, m.id)).toBe(true)
    expect(await labUndo(db, m.id)).toBe(true)
    expect(await points()).toEqual([])
    expect(await labUndo(db, m.id)).toBe(false)
  })

  it('reads a whole exam PDF longer than a teacher’s page limit (up to the Lab’s own)', async () => {
    const m = (await examMethodology(db, 'topik'))!
    const long = await pdf(30)
    // A teacher's homework still stops at its own limit; the Lab takes the whole test
    await expect(loadMaterialsForLlm(db, owner, [long])).rejects.toBeInstanceOf(MaterialError)
    const { llm, requests } = researcher([{ reply: 'Read it.', changes: [] }])
    expect(await labSend(db, llm, { ownerId: owner, methodologyId: m.id, text: 'Reading part', materialIds: [long], sample: true })).toMatchObject({ ok: true })
    expect(requests[0]!.parts.some((p) => 'mimeType' in p && p.mimeType === 'application/pdf')).toBe(true)
    await expect(labSend(db, llm, { ownerId: owner, methodologyId: m.id, text: '', materialIds: [await pdf(101)], sample: true })).rejects.toMatchObject({ code: 'pdf_pages' })
  })

  it('counts a real sample when applied (even with nothing else), with the tasks it had; undo takes the tasks and the sample back', async () => {
    const m = (await examMethodology(db, 'ielts_academic'))!
    const row = async () => (await db.select().from(methodologies).where(eq(methodologies.id, m.id)))[0]!
    const aiMessages = () => db.select().from(labMessages).where(eq(labMessages.role, 'ai')).orderBy(labMessages.createdAt)

    // Test 1: two task types, and a point for one of them
    const first = researcher([
      {
        reply: 'Two task types.',
        tasks: [
          { op: 'add', key: 'n1', area: 'reading', name: 'True/False/Not Given', format: 'Statements in passage order.', kinds: ['true_false'], buildable: true, why: '' },
          { op: 'add', key: 'n2', area: 'listening', name: 'Form completion', format: 'A form with gaps.', kinds: ['gap_fill'], buildable: true, why: '' },
        ],
        changes: [{ op: 'add', area: 'reading', task: 'n1', slot: 'traps', text: 'NG statements reuse a topic word.', why: '' }],
      },
    ])
    expect(await labSend(db, first.llm, { ownerId: owner, methodologyId: m.id, text: '', materialIds: [await page()], sample: true })).toMatchObject({ ok: true, proposed: 3 })
    expect(first.requests[0]!.system).toContain('WHEN THE OWNER SHOWS A REAL SAMPLE')
    const [owners] = await db.select().from(labMessages).where(eq(labMessages.role, 'owner'))
    expect(owners).toMatchObject({ sample: true, files: ['guide.png'] })
    const [a1] = await aiMessages()
    expect(a1!.proposal).toMatchObject({ status: 'open', sample: { name: 'guide.png', seen: [] } })
    expect(await labDecide(db, { ownerId: owner, messageId: a1!.id, action: 'apply', pick: [0, 1, 2] })).toMatchObject({ ok: true, added: 1, tasks: 2, sample: true })
    let r = await row()
    expect(r.tasks.map((t) => [t.id, t.name])).toEqual([
      ['t1', 'True/False/Not Given'],
      ['t2', 'Form completion'],
    ])
    expect(r.points).toEqual([{ id: 'k1', area: 'reading', text: 'NG statements reuse a topic word.', task: 't1', slot: 'traps' }])
    expect(r.samples).toMatchObject([{ name: 'guide.png', tasks: ['t1', 't2'] }])

    // Test 2 taught nothing new: counted with nothing ticked
    await labSend(db, researcher([{ reply: 'Nothing new.', seen: ['t1', 't7'], changes: [] }]).llm, { ownerId: owner, methodologyId: m.id, text: 'Cambridge 18, Test 2', materialIds: [], sample: true })
    const [, a2] = await aiMessages()
    expect(a2!.proposal).toMatchObject({ ops: [], sample: { name: 'Cambridge 18, Test 2', seen: ['t1'] } })
    expect(await labDecide(db, { ownerId: owner, messageId: a2!.id, action: 'apply', pick: [] })).toMatchObject({ ok: true, sample: true })
    r = await row()
    expect(r.samples.map((x) => x.tasks)).toEqual([['t1', 't2'], ['t1']])
    expect((await db.select().from(methodologyVersions)).map((v) => v.note).sort()).toEqual(['sample 1 +2 tasks +1', 'sample 2'])

    // Create gets the tasks with how many samples had them
    expect(await resolveStyle(db, { language: 'en', exam: { id: 'ielts_academic', level: 'Band 6.5' } })).toMatchObject({
      style: { samples: 2, tasks: [{ id: 't1', seen: 2 }, { id: 't2', seen: 1 }] },
    })

    // Removing a task by hand keeps its points as general ones; undo brings back the task, then the sample
    expect(await labRemoveTask(db, { ownerId: owner, methodologyId: m.id, taskId: 't9' })).toBe(false)
    expect(await labRemoveTask(db, { ownerId: owner, methodologyId: m.id, taskId: 't1' })).toBe(true)
    r = await row()
    expect(r.tasks.map((t) => t.id)).toEqual(['t2'])
    expect(r.points).toEqual([{ id: 'k1', area: 'reading', text: 'NG statements reuse a topic word.' }])
    expect(await labUndo(db, m.id)).toBe(true)
    expect((await row()).tasks.map((t) => t.id)).toEqual(['t1', 't2'])
    expect(await labUndo(db, m.id)).toBe(true)
    expect((await row()).samples).toHaveLength(1)

    // A sample that isn't counted changes nothing
    await labSend(db, researcher([{ reply: 'r', changes: [] }]).llm, { ownerId: owner, methodologyId: m.id, text: 'not really a test', materialIds: [], sample: true })
    const a3 = (await aiMessages()).at(-1)!
    await labDecide(db, { ownerId: owner, messageId: a3.id, action: 'dismiss' })
    expect((await row()).samples).toHaveLength(1)
  })
})

describe("the owner's own methodologies", () => {
  it('are made, edited, shown to teachers only when switched on, and deleted; exams are not', async () => {
    const id = await createOwn(db, { name: ' Story first ', language: 'en', levels: [], about: 'Words in a story first.' })
    expect(await ownStyles(db)).toEqual([])
    expect(await updateOwn(db, id, { visible: true, levels: ['Starters', 'Movers', 'Movers', ' '] })).toBe(true)
    expect(await ownStyles(db)).toEqual([{ id, name: 'Story first', language: 'en', levels: ['Starters', 'Movers'] }])
    const exam = (await examMethodology(db, 'ielts_academic'))!
    expect(await updateOwn(db, exam.id, { name: 'Renamed' })).toBe(false)
    expect(await deleteOwn(db, exam.id)).toBe(false)
    expect(await deleteOwn(db, id)).toBe(true)
    expect(await db.select().from(methodologies)).toHaveLength(1)
  })
})

describe('the Style a teacher picks', () => {
  it('a catalog exam brings what the Lab knows about it; another language’s exam is refused', async () => {
    expect(await resolveStyle(db, { language: 'en', exam: null })).toMatchObject({ ok: true, style: null, chosen: null, language: 'en' })
    const bare = await resolveStyle(db, { language: 'en', exam: { id: 'ielts_academic', level: 'Band 6.5' } })
    expect(bare).toMatchObject({ ok: true, exam: { id: 'ielts_academic', level: 'Band 6.5' }, chosen: { name: 'IELTS Academic' }, style: null })
    const m = (await examMethodology(db, 'ielts_academic'))!
    await db.update(methodologies).set({ points: [{ id: 'k1', area: 'reading', text: 'NG reuses a topic word.' }] }).where(eq(methodologies.id, m.id))
    expect(await resolveStyle(db, { language: 'en', exam: { id: 'ielts_academic', level: 'Band 6.5' } })).toMatchObject({
      style: { name: 'IELTS Academic', custom: false, points: [{ text: 'NG reuses a topic word.' }] },
      methodologyId: m.id,
    })
    expect(await resolveStyle(db, { language: 'ar', exam: { id: 'ielts_academic', level: 'Band 6.5' } })).toEqual({ ok: false })
    expect(await resolveStyle(db, { language: 'en', exam: { id: 'ielts_academic', level: 'Band 12' } })).toEqual({ ok: false })
  })

  it("the owner's own: only when switched on, in its language, at one of its levels; a revision keeps it", async () => {
    const id = await createOwn(db, { name: 'Story first', language: 'en', levels: ['A1', 'A2'], about: 'Words in a story first.' })
    const pick = { language: 'en' as const, exam: { id, level: 'A2' } }
    expect(await resolveStyle(db, pick)).toEqual({ ok: false }) // hidden from teachers
    expect(await resolveStyle(db, pick, { stored: true })).toMatchObject({ ok: true, exam: null, chosen: { id, level: 'A2', name: 'Story first' } })
    await updateOwn(db, id, { visible: true })
    expect(await resolveStyle(db, pick)).toMatchObject({
      ok: true,
      exam: null,
      style: { name: 'Story first', level: 'A2', about: 'Words in a story first.', custom: true },
      language: 'en',
      methodologyId: id,
    })
    expect(await resolveStyle(db, { language: 'ru', exam: { id, level: 'A2' } })).toEqual({ ok: false })
    expect(await resolveStyle(db, { language: 'en', exam: { id, level: 'C2' } })).toEqual({ ok: false })
    await countStyleUse(db, id)
    expect((await db.select().from(methodologies))[0]!.usedCount).toBe(1)
  })
})

describe('Lab resources', () => {
  it('the owner attaches them from either side of the account; a student still cannot upload', () => {
    process.env.OWNER_EMAILS = 'owner@gmail.com'
    const ownerAsStudent = { id: 'o1', role: 'student' as const, email: 'owner@gmail.com' }
    expect(() => authorizeUpload(ownerAsStudent)).not.toThrow()
    expect(() => authorizeUpload(ownerAsStudent, 'o1')).not.toThrow()
    expect(() => authorizeUpload(ownerAsStudent, 'someone-else')).toThrow()
    expect(() => authorizeUpload({ ...ownerAsStudent, blockedAt: new Date() })).toThrow()
    expect(() => authorizeUpload({ id: 's1', role: 'student', email: 's1@gmail.com' })).toThrow()
    expect(() => authorizeUpload({ id: 't1', role: 'teacher', email: null }, 't1')).not.toThrow()
    delete process.env.OWNER_EMAILS
  })
})
