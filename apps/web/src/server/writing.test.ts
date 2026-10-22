import { beforeEach, describe, expect, it } from 'vitest'
import { createTestDb } from '@ikhimi/db/testing'
import { attempts, eq, responses, users, type Db } from '@ikhimi/db'
import { convertItem, examById, type GenerateResult, type LlmProvider, type LlmRequest } from '@ikhimi/ai'
import { buildReport, checkAnswer, createDraft, loadExercises, publishAssignment, saveAnswer, startAttempt, submitAttempt } from './assignments'
import { overrideResponse, parseEssayFeedback, parseWritingFeedback, regradePending } from './writing'
import { grantPlan } from './plans'

let db: Db
let teacherId: string

const ex = (item: Parameters<typeof convertItem>[0]) => {
  const r = convertItem(item, 3)
  if (!r.ok) throw new Error(r.reason)
  return r.ex
}

const result = (): GenerateResult => ({
  draft: {
    title: 'Family',
    instructions: 'Bajaring',
    rationale: '',
    contentLanguage: 'en',
    cefrLevel: 'A2',
    estimatedMinutes: 10,
    exercises: [
      ex({ kind: 'mcq_single', skill: 'grammar', prompt: 'She ___ tea.', options: ['drinks', 'drink', 'drinking'], correctOptionIndexes: [0], explanation: '-s' }),
      ex({
        kind: 'open_writing',
        skill: 'writing',
        prompt: 'Write 4 sentences about your family in Present Simple.',
        writingLines: 4,
        writingChecklist: ['Present Simple'],
        writingRubric: 'Present Simple with -s for he/she/it',
        writingExamples: ['My father works in a bank.'],
        explanation: 'Present Simple',
      }),
    ],
  },
  meta: { model: 'fake', usage: { inputTokens: 1, outputTokens: 1 }, dropped: [], trimmedForTime: 0, solveBack: [], instructionsScriptOk: true, raw: {} },
})

/** Grader stand-in: sentence n is ok unless it contains "play " (the classic missing -s) */
function grader(opts: { fail?: boolean } = {}) {
  const requests: LlmRequest[] = []
  const llm: LlmProvider = {
    name: 'fake',
    async generateJson(req) {
      requests.push(req)
      if (opts.fail) throw new Error('503')
      const sent = JSON.parse((req.parts[0] as { text: string }).text).studentSentences as { n: number; text: string }[]
      return {
        json: {
          lines: sent.map((s) => ({ n: s.n, ok: !/\bplay /.test(s.text), correction: s.text.replace(/\bplay /, 'plays '), feedback: /\bplay /.test(s.text) ? '-s' : 'ok' })),
          summary: 'Yaxshi',
        },
        usage: { inputTokens: 1, outputTokens: 1 },
        model: 'fake',
      }
    },
  }
  return { llm, requests }
}

beforeEach(async () => {
  db = await createTestDb()
  const [t] = await db.insert(users).values({ role: 'teacher', phone: '+998900000001', fullName: 'Nodira' }).returning()
  teacherId = t!.id
})

async function setup() {
  const a = await createDraft(db, { teacherId, conversationId: null, instructionLocale: 'ko', difficulty: 3, result: result() })
  const pub = await publishAssignment(db, a, { newGroupName: '5-A' })
  const rows = await loadExercises(db, a.id)
  const [s] = await db.insert(users).values({ role: 'student', phone: '+998900000002', fullName: 'Aziz Karimov' }).returning()
  // Grading tests: the student sees every item (plans are tested in plans.test.ts)
  await grantPlan(db, s!.id, 'vip', 365)
  const at = await startAttempt(db, pub, s!.id)
  const mcq = rows[0]!
  const writing = rows[1]!
  await saveAnswer(db, at, { exerciseId: mcq.id, value: (mcq.answerKey as { correct: number }).correct, revision: 1 })
  return { pub, at, mcq, writing }
}

const sentences = ['My mother cooks dinner.', 'My brother play football.', 'My sister reads books.', 'My father drives a car.']

describe('open_writing grading', () => {
  it('is stored as AI-graded with 4 points for 4 sentences', async () => {
    const { writing } = await setup()
    expect(writing.gradingMode).toBe('ai')
    expect(writing.points).toBe(4)
  })

  it('check: the AI grades each sentence, locks the item and strips the student name', async () => {
    const { pub, at, writing } = await setup()
    const { llm, requests } = grader()
    const r = await checkAnswer(db, at, pub, { exerciseId: writing.id, value: [...sentences.slice(0, 3), 'Aziz Karimov likes tea.'], revision: 1 }, { llm })
    expect(r.ok && r.writing?.lines.map((l) => l.ok)).toEqual([true, false, true, true])
    expect(r.ok && r.writing?.lines[1]!.correction).toBe('My brother plays football.')
    expect(r.ok && r.fraction).toBe(0.75)
    expect((requests[0]!.parts[0] as { text: string }).text).not.toContain('Karimov')
    // A second check returns the stored verdict without calling the AI again
    await checkAnswer(db, at, pub, { exerciseId: writing.id, value: ['changed'], revision: 2 }, { llm })
    expect(requests).toHaveLength(1)
  })

  it('check without the AI: answer saved, not locked', async () => {
    const { pub, at, writing } = await setup()
    const r = await checkAnswer(db, at, pub, { exerciseId: writing.id, value: sentences, revision: 1 }, { llm: grader({ fail: true }).llm })
    expect(r).toEqual({ ok: false, reason: 'ai_unavailable' })
    const [row] = await db.select().from(responses).where(eq(responses.exerciseId, writing.id))
    expect(row!.checkedAt).toBeNull()
    expect(row!.value).toEqual(sentences)
  })

  it('submit grades unchecked writing; score counts sentences', async () => {
    const { at, writing } = await setup()
    await saveAnswer(db, at, { exerciseId: writing.id, value: sentences, revision: 1 })
    const done = await submitAttempt(db, at, { llm: grader().llm })
    expect(done.status).toBe('graded')
    // mcq 1/1 + writing 3/4 sentences of 4 points
    expect(done.score).toBe(4)
    expect(done.maxScore).toBe(5)
    expect(done.aiGradedCount).toBe(1)
  })

  it('submit while the AI is down: pending, report shows it, regrade finishes it', async () => {
    const { pub, at, writing } = await setup()
    await saveAnswer(db, at, { exerciseId: writing.id, value: sentences, revision: 1 })
    const done = await submitAttempt(db, at, { llm: grader({ fail: true }).llm })
    expect(done.status).toBe('submitted')
    expect(done.manualPendingCount).toBe(1)

    const report = await buildReport(db, pub)
    expect(report.counts.submitted).toBe(1)
    expect(report.students[0]!.pending).toBe(1)
    // Counted as handed in (with a provisional score), not as still working on it
    expect(report.counts.inProgress).toBe(0)
    expect(report.students[0]!.percent).not.toBeNull()

    const r = await regradePending(db, grader().llm, at.id)
    expect(r?.attempt?.status).toBe('graded')
    expect(r?.attempt?.score).toBe(4)
  })

  it('an empty writing answer scores 0 without calling the AI', async () => {
    const { at } = await setup()
    const { llm, requests } = grader()
    const done = await submitAttempt(db, at, { llm })
    expect(done.status).toBe('graded')
    expect(requests).toHaveLength(0)
  })

  it('the teacher overrides: flips a sentence and sets points; the attempt is regraded', async () => {
    const { at, writing } = await setup()
    await saveAnswer(db, at, { exerciseId: writing.id, value: sentences, revision: 1 })
    await submitAttempt(db, at, { llm: grader().llm })
    const [row] = await db.select().from(responses).where(eq(responses.exerciseId, writing.id))
    const after = await overrideResponse(db, row!.id, { points: 4, lines: [true, true, true, true], teacherFeedback: 'Zo‘r!' })
    expect(after?.score).toBe(5)
    expect(after?.percent).toBe(100)
    const [saved] = await db.select().from(responses).where(eq(responses.id, row!.id))
    expect(saved!.teacherOverrode).toBe(true)
    expect(saved!.teacherFeedback).toBe('Zo‘r!')
    expect(parseWritingFeedback(saved!.aiFeedback)?.gradedBy).toBe('teacher')
    // Points are capped at the item's worth
    await overrideResponse(db, row!.id, { points: 99 })
    const [at2] = await db.select().from(attempts).where(eq(attempts.id, at.id))
    expect(at2!.score).toBe(5)
  })

  it('a double submit grades once', async () => {
    const { at, writing } = await setup()
    await saveAnswer(db, at, { exerciseId: writing.id, value: sentences, revision: 1 })
    const { llm, requests } = grader()
    await Promise.all([submitAttempt(db, at, { llm }), submitAttempt(db, at, { llm })])
    expect(requests).toHaveLength(1)
  })
})

describe('essay grading', () => {
  const essayResult = (grader?: 'teacher'): GenerateResult => {
    const r = convertItem(
      { kind: 'essay', skill: 'writing', prompt: 'Discuss both views and give your opinion.', essayTaskId: 'task2', essayRubric: 'Both views, clear opinion.', essayModelAnswer: 'Model.', explanation: '' },
      1,
      {},
      { scale: examById('ielts_academic')!.writing!.scale, rubric: 'IELTS', tasks: examById('ielts_academic')!.writing!.tasks, examLabel: 'IELTS Academic · Band 6.5' },
    )
    if (!r.ok) throw new Error(r.reason)
    if (grader) r.ex.payload.grader = grader
    return { ...result(), draft: { ...result().draft, exercises: [r.ex] } }
  }
  const examiner = (opts: { fail?: boolean } = {}) => {
    const requests: LlmRequest[] = []
    const llm: LlmProvider = {
      name: 'fake',
      async generateJson(req) {
        requests.push(req)
        if (opts.fail) throw new Error('503')
        return {
          json: {
            criteria: [
              { id: 'task', score: 6, feedback: 'ok' },
              { id: 'coherence', score: 7, feedback: 'ok' },
              { id: 'lexical', score: 7, feedback: 'ok' },
              { id: 'grammar', score: 7, feedback: 'ok' },
            ],
            strengths: ['Clear'],
            improvements: ['Examples'],
            corrections: [],
            summary: 'Yaxshi',
          },
          usage: { inputTokens: 1, outputTokens: 1 },
          model: 'fake',
        }
      },
    }
    return { llm, requests }
  }
  async function start(grader?: 'teacher') {
    const a = await createDraft(db, { teacherId, conversationId: null, instructionLocale: 'ko', difficulty: 3, result: essayResult(grader) })
    const pub = await publishAssignment(db, a, { newGroupName: 'IELTS' })
    const [ex] = await loadExercises(db, a.id)
    const [s] = await db.insert(users).values({ role: 'student', phone: '+998900000007', fullName: 'Malika' }).returning()
    // Grading tests: the student sees every item (plans are tested in plans.test.ts)
    await grantPlan(db, s!.id, 'vip', 365)
    const at = await startAttempt(db, pub, s!.id)
    return { pub, at, ex: ex! }
  }
  const essayText = 'word '.repeat(260)

  it('AI grade: IELTS overall 7.0 from 6/7/7/7 (6.75 rounds up), 10 points scaled by band', async () => {
    const { pub, at, ex } = await start()
    expect(ex.gradingMode).toBe('ai')
    const r = await checkAnswer(db, at, pub, { exerciseId: ex.id, value: essayText, revision: 1 }, { llm: examiner().llm })
    expect(r.ok && r.essay?.overallLabel).toBe('Band 7')
    const done = await submitAttempt(db, at, { llm: examiner().llm })
    expect(done.status).toBe('graded')
    expect(done.score).toBeCloseTo((7 / 9) * 10, 1)
  })

  it('teacher grades: never sent to the AI, waits, then per-criterion scores set the points', async () => {
    const { pub, at, ex } = await start('teacher')
    expect(ex.gradingMode).toBe('manual')
    const { llm, requests } = examiner()
    expect(await checkAnswer(db, at, pub, { exerciseId: ex.id, value: essayText, revision: 1 }, { llm })).toEqual({ ok: false, reason: 'teacher_grades' })
    const done = await submitAttempt(db, at, { llm })
    expect(requests).toHaveLength(0)
    expect(done.status).toBe('submitted')
    expect((await regradePending(db, llm, at.id))?.failed).toBe(0) // not a failure, and still no AI call
    expect(requests).toHaveLength(0)

    const [row] = await db.select().from(responses).where(eq(responses.exerciseId, ex.id))
    const after = await overrideResponse(db, row!.id, { points: 0, criteria: { task: 6, coherence: 6, lexical: 7, grammar: 6 } })
    expect(after?.status).toBe('graded')
    expect(after?.score).toBeCloseTo((6.5 / 9) * 10, 1)
    const f = parseEssayFeedback((await db.select().from(responses).where(eq(responses.id, row!.id)))[0]!.aiFeedback)
    expect(f).toMatchObject({ overallLabel: 'Band 6.5', gradedBy: 'teacher' })
  })

  it('AI down at submit: the essay stays pending for the teacher', async () => {
    const { at, ex } = await start()
    await saveAnswer(db, at, { exerciseId: ex.id, value: essayText, revision: 1 })
    const done = await submitAttempt(db, at, { llm: examiner({ fail: true }).llm })
    expect(done.status).toBe('submitted')
    expect(done.manualPendingCount).toBe(1)
  })
})
