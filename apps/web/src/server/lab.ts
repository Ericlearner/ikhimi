/**
 * The owner's Lab on the server (DECISIONS.md BG, BH). Each methodology (a catalog exam, or the owner's own) has one
 * body of knowledge: its tasks (learned from real samples) and its points. The Lab chat proposes changes from real
 * samples, resources and messages, and only what the owner applies is kept. Create then aims the homework at the
 * chosen style's tasks. Samples and resources are deleted once read.
 */
import { and, asc, desc, eq, inArray, isNull, labMessages, materialBlobs, materials, methodologies, methodologyVersions, sql, type Db, type LabProposal } from '@ikhimi/db'
import { applyLabOps, examById, LAB_LIMITS, labTurn, LlmError, seenIn, type GeminiFiles, type LabOp, type LabPoint, type LabSample, type LabTask, type LanguageCode, type LlmProvider, type StyleKnowledge } from '@ikhimi/ai'
import { examFor } from './exam-style'
import { loadMaterialsForLlm } from './materials'
import { dropLabUploads, readyLabUploads } from './lab-uploads'

/** Levels a new methodology of the owner's offers teachers, unless the owner sets others */
export const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']

/** A resource can be longer than a teacher's book pages: a guide, a handbook chapter, a whole test */
export const LAB_MAX_PAGES = 100

/** Gemini takes at most 20 MB per request with the files inside (as base64): a bigger file goes in parts */
export const LAB_MAX_INLINE = 18 * 1024 * 1024

/** The Lab's row for a catalog exam, made the first time the owner opens it */
export async function examMethodology(db: Db, examId: string) {
  const exam = examById(examId)
  if (!exam) return null
  await db.insert(methodologies).values({ examId, name: exam.name, language: exam.language }).onConflictDoNothing()
  const [row] = await db.select().from(methodologies).where(eq(methodologies.examId, examId)).limit(1)
  return row ?? null
}

/**
 * One turn of the Lab chat: the owner's message and resource (or real sample), the AI's reply and the changes it
 * proposes (kept in the thread until the owner applies or dismisses them; a sample counts once applied). The uploads
 * are deleted afterwards either way.
 */
export async function labSend(
  db: Db,
  llm: LlmProvider,
  input: { ownerId: string; methodologyId: string; text: string; materialIds: string[]; uploads?: string[]; sample?: boolean },
  deps: { files?: GeminiFiles | null } = {},
) {
  // Whole books uploaded to Google (lab-uploads.ts): read by reference, then removed with the rest
  const books = await readyLabUploads(db, input.ownerId, input.uploads ?? [])
  try {
    const [m] = await db.select().from(methodologies).where(eq(methodologies.id, input.methodologyId)).limit(1)
    if (!m) return { ok: false as const, reason: 'not_found' }
    const files: { label: string; mimeType: string; fileUri: string }[] = []
    for (const b of books) {
      if (!deps.files) return { ok: false as const, reason: 'book_unreadable' }
      // Google processes a long PDF for a little while after the upload
      const f = await deps.files.waitActive(b.fileName!).catch(() => null)
      if (!f) return { ok: false as const, reason: 'book_unreadable' }
      files.push({ label: b.filename, mimeType: b.mimeType, fileUri: f.uri })
    }
    const pages = await loadMaterialsForLlm(db, input.ownerId, input.materialIds, { maxPages: LAB_MAX_PAGES })
    const size = pages.reduce((n, p) => n + p.dataBase64.length + (p.pictures ?? []).reduce((a, x) => a + x.dataBase64.length, 0), 0)
    if (size > LAB_MAX_INLINE) return { ok: false as const, reason: 'too_big' }
    const text = input.text.trim()
    if (!pages.length && !files.length && !text) return { ok: false as const, reason: 'empty' }
    const history = (
      await db
        .select({ role: labMessages.role, text: labMessages.text })
        .from(labMessages)
        .where(eq(labMessages.methodologyId, m.id))
        .orderBy(desc(labMessages.createdAt))
        .limit(LAB_LIMITS.history)
    ).reverse()
    const fileNames = [...pages.map((p) => p.label), ...files.map((f) => f.label)]
    const sample = !!input.sample
    let turn: Awaited<ReturnType<typeof labTurn>>
    try {
      turn = await labTurn(llm, {
        methodology: { name: m.name, language: m.language, exam: !!m.examId, builtIn: m.examId ? (examById(m.examId)?.guidance ?? null) : null, about: m.about || null, points: m.points, tasks: m.tasks as LabTask[], samples: m.samples },
        history,
        message: text,
        materials: pages,
        files,
        fileNames,
        sample,
      })
    } catch (e) {
      // Google refusing a book (too many pages, a damaged file) is said plainly, not as a model setup problem
      if (files.length && e instanceof LlmError && e.code === 'config') return { ok: false as const, reason: 'book_unreadable' }
      throw e
    }
    const { reply, ops, seen } = turn
    // Both at once, the owner's first: the thread is read in this order
    const now = Date.now()
    await db.insert(labMessages).values({ methodologyId: m.id, role: 'owner', text: text.slice(0, LAB_LIMITS.sourceChars), files: fileNames, sample, createdBy: input.ownerId, createdAt: new Date(now) })
    // A sample always asks to be counted, even when it taught nothing new
    const proposal = sample ? { ops, status: 'open' as const, sample: { name: (fileNames.join(', ') || text.split('\n')[0]!).slice(0, 200), seen } } : ops.length ? { ops, status: 'open' as const } : null
    const [ai] = await db
      .insert(labMessages)
      .values({ methodologyId: m.id, role: 'ai', text: reply, proposal, createdAt: new Date(now + 1) })
      .returning({ id: labMessages.id })
    return { ok: true as const, messageId: ai!.id, proposed: ops.length }
  } finally {
    await dropLabUploads(db, deps.files ?? null, books)
    // The resource was only read for this; only what the owner applies is kept, in our own words
    const ids = input.materialIds.slice(0, 50)
    if (ids.length) {
      const own = await db.select({ id: materials.id }).from(materials).where(and(inArray(materials.id, ids), eq(materials.teacherId, input.ownerId)))
      if (own.length) {
        await db.delete(materialBlobs).where(inArray(materialBlobs.materialId, own.map((x) => x.id)))
        await db.update(materials).set({ deletedAt: new Date() }).where(inArray(materials.id, own.map((x) => x.id)))
      }
    }
  }
}

type Knowledge = { points: LabPoint[]; tasks: LabTask[]; samples: LabSample[] }

/** Change the knowledge, keeping what it was so the newest change can be undone */
async function saveKnowledge(db: Db, m: typeof methodologies.$inferSelect, next: Partial<Knowledge>, note: string, by: string) {
  await db.insert(methodologyVersions).values({ methodologyId: m.id, before: m.points, beforeBlueprint: { tasks: m.tasks, samples: m.samples }, note, createdBy: by })
  await db
    .update(methodologies)
    .set({ ...next, updatedAt: new Date() })
    .where(eq(methodologies.id, m.id))
}

const changeNote = (r: { added: number; updated: number; removed: number; tasksAdded?: number; tasksUpdated?: number; tasksRemoved?: number }, sample?: number) =>
  [
    sample && `sample ${sample}`,
    r.tasksAdded && `+${r.tasksAdded} task${r.tasksAdded === 1 ? '' : 's'}`,
    r.tasksUpdated && `~${r.tasksUpdated} task${r.tasksUpdated === 1 ? '' : 's'}`,
    r.tasksRemoved && `−${r.tasksRemoved} task${r.tasksRemoved === 1 ? '' : 's'}`,
    r.added && `+${r.added}`,
    r.updated && `~${r.updated}`,
    r.removed && `−${r.removed}`,
  ]
    .filter(Boolean)
    .join(' ')

/** The owner applies the proposed changes they ticked, or dismisses the proposal */
export async function labDecide(db: Db, input: { ownerId: string; messageId: string; action: 'apply' | 'dismiss'; pick?: number[] }) {
  const [msg] = await db.select().from(labMessages).where(eq(labMessages.id, input.messageId)).limit(1)
  const proposal = msg?.proposal
  if (!msg || !proposal || proposal.status !== 'open') return { ok: false as const, reason: 'gone' }
  if (input.action === 'dismiss') {
    await db.update(labMessages).set({ proposal: { ...proposal, status: 'dismissed' } }).where(eq(labMessages.id, msg.id))
    return { ok: true as const, added: 0, updated: 0, removed: 0, skipped: 0 }
  }
  const pick = [...new Set(input.pick ?? [])].filter((i) => Number.isInteger(i) && i >= 0 && i < proposal.ops.length).sort((a, b) => a - b)
  // A real sample can be counted with nothing else applied
  if (!pick.length && !proposal.sample) return { ok: false as const, reason: 'nothing_picked' }
  const [m] = await db.select().from(methodologies).where(eq(methodologies.id, msg.methodologyId)).limit(1)
  if (!m) return { ok: false as const, reason: 'gone' }
  const r = applyLabOps({ points: m.points, tasks: m.tasks as LabTask[], samples: m.samples }, pick.map((i) => proposal.ops[i]!) as LabOp[])
  const next: Partial<Knowledge> = { points: r.points, tasks: r.tasks }
  if (proposal.sample) {
    // The sample had the known tasks it named, the ones it added and the ones it showed more precisely
    const tasks = [...new Set([...proposal.sample.seen, ...r.newTasks, ...r.changedTasks])].filter((id) => r.tasks.some((t) => t.id === id))
    next.samples = [...m.samples, { at: new Date().toISOString(), name: proposal.sample.name, tasks }]
  }
  if (next.samples || r.added || r.updated || r.removed || r.tasksAdded || r.tasksUpdated || r.tasksRemoved) await saveKnowledge(db, m, next, changeNote(r, next.samples?.length), input.ownerId)
  const applied: LabProposal = { ...proposal, status: 'applied', applied: pick }
  await db.update(labMessages).set({ proposal: applied }).where(eq(labMessages.id, msg.id))
  return { ok: true as const, added: r.added, updated: r.updated, removed: r.removed, skipped: r.skipped, tasks: r.tasksAdded, sample: !!proposal.sample }
}

/** The owner removes one point by hand */
export async function labRemovePoint(db: Db, input: { ownerId: string; methodologyId: string; pointId: string }) {
  const [m] = await db.select().from(methodologies).where(eq(methodologies.id, input.methodologyId)).limit(1)
  if (!m || !m.points.some((p) => p.id === input.pointId)) return false
  await saveKnowledge(db, m, { points: m.points.filter((p) => p.id !== input.pointId) }, `−1 (${input.pointId})`, input.ownerId)
  return true
}

/** The owner removes a task by hand (a duplicate, or one the real test doesn't have): its points become general */
export async function labRemoveTask(db: Db, input: { ownerId: string; methodologyId: string; taskId: string }) {
  const [m] = await db.select().from(methodologies).where(eq(methodologies.id, input.methodologyId)).limit(1)
  if (!m || !m.tasks.some((t) => t.id === input.taskId)) return false
  const r = applyLabOps({ points: m.points, tasks: m.tasks as LabTask[], samples: m.samples }, [{ op: 'task_remove', id: input.taskId, why: '' }])
  await saveKnowledge(db, m, { points: r.points, tasks: r.tasks }, `−1 task (${input.taskId})`, input.ownerId)
  return true
}

/** Undo the newest change: the knowledge goes back to what it was before it */
export async function labUndo(db: Db, methodologyId: string) {
  const [v] = await db.select().from(methodologyVersions).where(eq(methodologyVersions.methodologyId, methodologyId)).orderBy(desc(methodologyVersions.createdAt)).limit(1)
  if (!v) return false
  await db
    .update(methodologies)
    .set({ points: v.before, ...(v.beforeBlueprint ? { tasks: v.beforeBlueprint.tasks, samples: v.beforeBlueprint.samples } : {}), updatedAt: new Date() })
    .where(eq(methodologies.id, methodologyId))
  await db.delete(methodologyVersions).where(eq(methodologyVersions.id, v.id))
  return true
}

/** The thread, the change history and the methodology, for the Lab page */
export async function labThread(db: Db, methodologyId: string) {
  const [thread, history] = await Promise.all([
    db.select().from(labMessages).where(eq(labMessages.methodologyId, methodologyId)).orderBy(asc(labMessages.createdAt)).limit(200),
    db.select().from(methodologyVersions).where(eq(methodologyVersions.methodologyId, methodologyId)).orderBy(desc(methodologyVersions.createdAt)).limit(30),
  ])
  return { thread, history }
}

// ─── the owner's own methodologies ──────────────────────────────────────────

export type OwnFields = { name: string; language: LanguageCode; levels: string[]; about: string; visible?: boolean }

const cleanLevels = (levels: string[]) => [...new Set(levels.map((l) => l.trim().slice(0, 20)).filter(Boolean))].slice(0, 12)

export async function createOwn(db: Db, f: OwnFields) {
  const [row] = await db
    .insert(methodologies)
    .values({ name: f.name.trim(), language: f.language, levels: cleanLevels(f.levels).length ? cleanLevels(f.levels) : CEFR_LEVELS, about: f.about.trim(), visible: !!f.visible })
    .returning({ id: methodologies.id })
  return row!.id
}

/** Only the owner's own: a catalog exam's name, language and levels come from exams.ts */
export async function updateOwn(db: Db, id: string, f: Partial<OwnFields>) {
  const levels = f.levels ? cleanLevels(f.levels) : undefined
  const r = await db
    .update(methodologies)
    .set({
      ...(f.name?.trim() ? { name: f.name.trim() } : {}),
      ...(f.language ? { language: f.language } : {}),
      ...(levels?.length ? { levels } : {}),
      ...(f.about !== undefined ? { about: f.about.trim() } : {}),
      ...(f.visible !== undefined ? { visible: f.visible } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(methodologies.id, id), isNull(methodologies.examId)))
    .returning({ id: methodologies.id })
  return r.length > 0
}

/** Only the owner's own; its chat and history go with it. Drafts written in it keep their items. */
export async function deleteOwn(db: Db, id: string) {
  const r = await db.delete(methodologies).where(and(eq(methodologies.id, id), isNull(methodologies.examId))).returning({ id: methodologies.id })
  return r.length > 0
}

// ─── Create ─────────────────────────────────────────────────────────────────

/** The owner's own methodologies teachers can pick in the Style list (switched on in the Lab) */
export async function ownStyles(db: Db) {
  const rows = await db
    .select({ id: methodologies.id, name: methodologies.name, language: methodologies.language, levels: methodologies.levels })
    .from(methodologies)
    .where(and(isNull(methodologies.examId), eq(methodologies.visible, true)))
    .orderBy(asc(methodologies.name))
  return rows.map((r) => ({ ...r, levels: r.levels.length ? r.levels : CEFR_LEVELS }))
}
export type OwnStyle = Awaited<ReturnType<typeof ownStyles>>[number]

/** What a draft remembers about its style: the id and level, and the name for the draft screen */
export type ChosenStyle = { id: string; level: string; name: string }

export type ResolvedStyle = {
  ok: true
  /** A catalog exam, for what only exams have (task formats, essay grids) */
  exam: { id: string; level: string } | null
  /** What the draft stores, either kind */
  chosen: ChosenStyle | null
  /** What the planner and writers are told: the Lab's knowledge (and the owner's description for their own) */
  style: StyleKnowledge | null
  language: LanguageCode | null
  methodologyId: string | null
}

/**
 * The teacher's Style choice, checked on the server: a catalog exam (exam-style.ts rules: it must be the chosen
 * language's), or the owner's own methodology, switched on, in that language, at one of its levels. A revision
 * (`stored`) keeps the draft's style even if the owner has since switched it off.
 */
export async function resolveStyle(db: Db, input: { language?: LanguageCode | null; exam?: { id: string; level: string } | null }, opts: { stored?: boolean } = {}): Promise<ResolvedStyle | { ok: false }> {
  const none = { ok: true as const, exam: null, chosen: null, style: null, methodologyId: null }
  if (!input.exam) return { ...none, language: input.language ?? null }
  const exam = examById(input.exam.id)
  if (exam) {
    const r = examFor(input)
    if (!r.ok || !r.exam) return { ok: false }
    const [m] = await db.select().from(methodologies).where(eq(methodologies.examId, exam.id)).limit(1)
    return {
      ok: true,
      exam: r.exam,
      chosen: { ...r.exam, name: exam.name },
      style: m && (m.points.length || m.tasks.length) ? { name: exam.name, ...blueprint(m), custom: false } : null,
      language: r.language,
      methodologyId: m?.id ?? null,
    }
  }
  const [m] = await db.select().from(methodologies).where(and(eq(methodologies.id, input.exam.id), isNull(methodologies.examId))).limit(1)
  const levels = m?.levels.length ? m.levels : CEFR_LEVELS
  if (!m || (!m.visible && !opts.stored) || (input.language && input.language !== m.language) || !levels.includes(input.exam.level)) return { ok: false }
  return {
    ok: true,
    exam: null,
    chosen: { id: m.id, level: input.exam.level, name: m.name },
    style: { name: m.name, level: input.exam.level, about: m.about || null, ...blueprint(m), custom: true },
    language: m.language as LanguageCode,
    methodologyId: m.id,
  }
}

/** What Create is told: the points, and the tasks with how many real samples had them */
function blueprint(m: typeof methodologies.$inferSelect): Pick<StyleKnowledge, 'points' | 'tasks' | 'samples'> {
  return { points: m.points, tasks: (m.tasks as LabTask[]).map((t) => ({ ...t, seen: seenIn(m.samples, t.id) })), samples: m.samples.length }
}

/** A homework was written in this style */
export async function countStyleUse(db: Db, methodologyId: string | null) {
  if (methodologyId) await db.update(methodologies).set({ usedCount: sql`${methodologies.usedCount} + 1` }).where(eq(methodologies.id, methodologyId))
}
