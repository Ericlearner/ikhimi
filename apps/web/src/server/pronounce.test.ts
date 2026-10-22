import { beforeEach, describe, expect, it } from 'vitest'
import { createTestDb } from '@ikhimi/db/testing'
import { attempts, eq, responses, users, type Db } from '@ikhimi/db'
import { convertItem, type GenerateResult, type LlmProvider } from '@ikhimi/ai'
import { checkAnswer, checkPronunciation, createDraft, loadExercises, publishAssignment, saveAnswer, startAttempt, submitAttempt } from './assignments'
import { grantPlan } from './plans'

let db: Db

/** Fake checker: scores whatever the test says next */
function checker(scores: number[]) {
  const calls: string[] = []
  const llm: LlmProvider = {
    name: 'fake',
    async generateJson(req) {
      calls.push((req.parts[0] as { text: string }).text)
      return { json: { score: scores.shift() ?? 0, missed: ['think'], tip: 'th' }, usage: { inputTokens: 1, outputTokens: 1 }, model: 'fake' }
    },
  }
  return { llm, calls }
}

async function setup() {
  const [t] = await db.insert(users).values({ role: 'teacher', phone: '+998900000001', fullName: 'Nodira' }).returning()
  const r = convertItem({ kind: 'shadowing', skill: 'pronunciation', prompt: 'Repeat', shadowingLines: ['I think so.', 'Thank you.'], explanation: '' }, 1)
  if (!r.ok) throw new Error(r.reason)
  const result: GenerateResult = {
    draft: { title: 'Talaffuz', instructions: '', rationale: '', contentLanguage: 'en', cefrLevel: 'A2', estimatedMinutes: 3, exercises: [r.ex] },
    meta: { model: 'fake', usage: { inputTokens: 0, outputTokens: 0 }, dropped: [], trimmedForTime: 0, solveBack: [], instructionsScriptOk: true, raw: {} },
  }
  const a = await publishAssignment(db, await createDraft(db, { teacherId: t!.id, conversationId: null, instructionLocale: 'ko', difficulty: 3, result }), { newGroupName: '7-A' })
  const [s] = await db.insert(users).values({ role: 'student', phone: '+998900000002', fullName: 'Aziz' }).returning()
  // Grading tests: the student sees every item (plans are tested in plans.test.ts)
  await grantPlan(db, s!.id, 'vip', 365)
  const at = await startAttempt(db, a, s!.id)
  const [ex] = await loadExercises(db, a.id)
  return { a, at, ex: ex! }
}

const audio = { mimeType: 'audio/wav', dataBase64: 'UklGRg==' }

beforeEach(async () => {
  db = await createTestDb()
})

describe('shadowing with the microphone', () => {
  it('keeps each sentence’s best score and tries; the grade is their average; the voice is never stored', async () => {
    const { a, at, ex } = await setup()
    const { llm, calls } = checker([55, 82, 74])
    const first = await checkPronunciation(db, at, a, { exerciseId: ex.id, line: 0, audio }, llm)
    expect(first).toMatchObject({ ok: true, line: { best: 55, tries: 1, passed: false, missed: ['think'] } })
    await checkPronunciation(db, at, a, { exerciseId: ex.id, line: 0, audio }, llm)
    await checkPronunciation(db, at, a, { exerciseId: ex.id, line: 1, audio }, llm)
    expect(calls).toEqual(['TARGET: I think so.', 'TARGET: I think so.', 'TARGET: Thank you.'])
    const [row] = await db.select().from(responses).where(eq(responses.exerciseId, ex.id))
    expect(row!.value).toEqual({
      lines: [
        { best: 82, tries: 2, passed: true, missed: ['think'], tip: 'th' },
        // "think" isn't in this sentence, so it isn't marked
        { best: 74, tries: 1, passed: true, missed: [], tip: 'th' },
      ],
    })
    // Nothing of the recording is kept anywhere on the answer
    expect(JSON.stringify(row)).not.toContain('UklGRg')

    // The browser can't write its own scores, and checking uses the server's
    await saveAnswer(db, at, { exerciseId: ex.id, value: { lines: [{ best: 100, tries: 1, passed: true, missed: [], tip: '' }] }, revision: 9 })
    const c = await checkAnswer(db, at, a, { exerciseId: ex.id, value: { lines: [{ best: 100, tries: 1, passed: true, missed: [], tip: '' }, null] }, revision: 10 })
    expect(c).toMatchObject({ ok: true, isCorrect: true, fraction: 0.78 })
    const [graded] = await db.select().from(responses).where(eq(responses.exerciseId, ex.id))
    expect(graded!.pointsAwarded).toBe(1.56)
  })

  it('without a microphone, "practised" is accepted but earns nothing', async () => {
    const { a, at, ex } = await setup()
    await saveAnswer(db, at, { exerciseId: ex.id, value: true, revision: 1 })
    const done = await submitAttempt(db, at)
    expect(done.score).toBe(0)
    expect(done.maxScore).toBe(2)
    // and a checked attempt can't be checked again
    const [fresh] = await db.select().from(attempts).where(eq(attempts.id, at.id))
    expect(await checkPronunciation(db, fresh!, a, { exerciseId: ex.id, line: 0, audio }, checker([90]).llm)).toMatchObject({ ok: false, reason: 'submitted' })
  })
})
