import { beforeEach, describe, expect, it } from 'vitest'
import { createTestDb } from '@ikhimi/db/testing'
import { attempts, eq, exercises, users, type Db } from '@ikhimi/db'
import { convertItem, type GenerateResult, type LlmItem } from '@ikhimi/ai'
import { acceptAnswer, checkAnswer, createDraft, loadExercises, publishAssignment, startAttempt, submitAttempt } from './assignments'
import { grantPlan } from './plans'

let db: Db

async function setup(language: string, items: LlmItem[]) {
  const [t] = await db.insert(users).values({ role: 'teacher', phone: '+998900000001', fullName: 'Nodira' }).returning()
  const result: GenerateResult = {
    draft: {
      title: 'T',
      instructions: '',
      rationale: '',
      contentLanguage: language,
      cefrLevel: 'A2',
      estimatedMinutes: 3,
      exercises: items.map((raw, i) => {
        const r = convertItem({ explanation: '', ...raw }, i)
        if (!r.ok) throw new Error(r.reason)
        return r.ex
      }),
    },
    meta: { model: 'fake', usage: { inputTokens: 0, outputTokens: 0 }, dropped: [], trimmedForTime: 0, solveBack: [], instructionsScriptOk: true, raw: {} },
  }
  const a = await publishAssignment(db, await createDraft(db, { teacherId: t!.id, conversationId: null, instructionLocale: 'ko', difficulty: 3, result }), { newGroupName: '7-A' })
  const student = async (n: number) => {
    const [s] = await db.insert(users).values({ role: 'student', phone: `+99890000010${n}`, fullName: `S${n}` }).returning()
    // These tests are about checking answers: the student sees every item
    await grantPlan(db, s!.id, 'vip', 30)
    return startAttempt(db, a, s!.id)
  }
  return { a, rows: await loadExercises(db, a.id), student }
}

beforeEach(async () => {
  db = await createTestDb()
})

describe('checking by the homework language', () => {
  it('Korean spacing is accepted when the homework is Korean', async () => {
    const { a, rows, student } = await setup('ko', [{ kind: 'short_answer', skill: 'grammar', prompt: '번역하세요', acceptedAnswers: ['학교에 가요'] }])
    const at = await student(1)
    expect(await checkAnswer(db, at, a, { exerciseId: rows[0]!.id, value: '학교에가요', revision: 1 })).toMatchObject({ ok: true, isCorrect: true })
  })
})

describe('the teacher accepts an answer', () => {
  it('adds it to the item, re-scores everyone who wrote it, and the next student gets it right', async () => {
    const { a, rows, student } = await setup('en', [
      { kind: 'short_answer', skill: 'vocabulary', prompt: 'A word for a long trip', acceptedAnswers: ['journey'] },
      { kind: 'gap_fill', skill: 'grammar', prompt: 'Complete', gapText: 'I ___ to school. She ___ home.', gapAnswers: [{ accepted: ['go'] }, { accepted: ['goes'] }] },
    ])
    const [word, gap] = rows
    const s1 = await student(1)
    const s2 = await student(2)
    for (const at of [s1, s2]) {
      await checkAnswer(db, at, a, { exerciseId: word!.id, value: 'voyage', revision: 1 })
      await checkAnswer(db, at, a, { exerciseId: gap!.id, value: ['go', 'walks'], revision: 1 })
    }
    await submitAttempt(db, s1)
    // 1 of 3 points (the gap fill has a point per blank)
    expect((await db.select().from(attempts).where(eq(attempts.id, s1.id)))[0]!.percent).toBe(33.3)

    expect(await acceptAnswer(db, a, word!.id, { text: 'voyage', blank: null })).toEqual({ ok: true, nowRight: 2 })
    expect(await acceptAnswer(db, a, gap!.id, { text: 'walks', blank: 1 })).toEqual({ ok: true, nowRight: 2 })
    // The handed-in work is re-scored; the one still in progress keeps its checked items right
    expect((await db.select().from(attempts).where(eq(attempts.id, s1.id)))[0]!.percent).toBe(100)
    const [ex] = await db.select().from(exercises).where(eq(exercises.id, gap!.id))
    expect((ex!.answerKey as { blanks: string[][] }).blanks[1]).toEqual(['goes', 'walks'])

    const s3 = await student(3)
    expect(await checkAnswer(db, s3, a, { exerciseId: word!.id, value: 'Voyage', revision: 1 })).toMatchObject({ isCorrect: true })
  })
})
