import { beforeEach, describe, expect, it } from 'vitest'
import { createTestDb } from '@ikhimi/db/testing'
import { assignments, attempts, conversations, eq, googleAccounts, messages, users, type Db } from '@ikhimi/db'
import { convertItem, type GenerateResult } from '@ikhimi/ai'
import { createDraft, loadExercises, publishAssignment, saveAnswer, startAttempt, submitAttempt } from './assignments'
import { grantPlan } from './plans'
import { purgeDeletedAccounts } from './purge'

let db: Db
const DAY = 86400_000
const now = new Date('2026-10-08T12:00:00Z')

const result = (): GenerateResult => {
  const r = convertItem({ kind: 'short_answer', skill: 'grammar', prompt: 'Past of take?', acceptedAnswers: ['took'], explanation: '' }, 3)
  if (!r.ok) throw new Error(r.reason)
  return {
    draft: { title: 'Past Simple', instructions: '', rationale: '', contentLanguage: 'en', cefrLevel: 'A2', estimatedMinutes: 5, exercises: [r.ex] },
    meta: { model: 'fake', usage: { inputTokens: 0, outputTokens: 0 }, dropped: [], trimmedForTime: 0, solveBack: [], instructionsScriptOk: true, raw: {} },
  }
}

/** An account as Google makes it: the sign-in key, the email and the Google link */
async function person(key: string, name: string, role: 'teacher' | 'student' = 'student') {
  const [u] = await db.insert(users).values({ role, roles: [role], phone: `google:${key}`, email: `${key}@gmail.com`, fullName: name }).returning()
  await db.insert(googleAccounts).values({ userId: u!.id, sub: key, email: `${key}@gmail.com` })
  if (role === 'student') await grantPlan(db, u!.id, 'vip', 365)
  return u!
}

beforeEach(async () => {
  db = await createTestDb()
})

describe('erasing deleted accounts', () => {
  it('erases accounts deleted 30+ days ago: who they were and a student’s answers; keeps the rest', async () => {
    const teacher = await person('nodira', 'Nodira', 'teacher')
    const [chat] = await db.insert(conversations).values({ teacherId: teacher.id }).returning()
    await db.insert(messages).values({ conversationId: chat!.id, role: 'teacher', body: 'Present Simple, 10 ta mashq' })
    const draft = await createDraft(db, { teacherId: teacher.id, conversationId: chat!.id, instructionLocale: 'ko', difficulty: 3, result: result() })
    const a = await publishAssignment(db, draft, { newGroupName: '7-A' })
    const gone = await person('aziz', 'Aziz')
    const recent = await person('malika', 'Malika')
    for (const s of [gone, recent]) {
      const at = await startAttempt(db, a, s.id)
      await saveAnswer(db, at, { exerciseId: (await loadExercises(db, a.id))[0]!.id, value: 'took', revision: 1 })
      await submitAttempt(db, at)
    }
    await db.update(users).set({ deletedAt: new Date(now.getTime() - 31 * DAY) }).where(eq(users.id, gone.id))
    await db.update(users).set({ deletedAt: new Date(now.getTime() - 31 * DAY) }).where(eq(users.id, teacher.id))
    await db.update(users).set({ deletedAt: new Date(now.getTime() - 10 * DAY) }).where(eq(users.id, recent.id))

    expect(await purgeDeletedAccounts(db, now)).toBe(2)
    const [g] = await db.select().from(users).where(eq(users.id, gone.id))
    expect(g).toMatchObject({ phone: `deleted:${gone.id}`, email: null, fullName: null, prefs: {} })
    // Signing in with that Google account again starts a new account
    expect(await db.select().from(googleAccounts).where(eq(googleAccounts.userId, gone.id))).toEqual([])
    expect(await db.select().from(attempts).where(eq(attempts.studentId, gone.id))).toEqual([])
    // Still within 30 days: untouched, and signing in again would restore it
    const [r] = await db.select().from(users).where(eq(users.id, recent.id))
    expect(r).toMatchObject({ phone: 'google:malika', email: 'malika@gmail.com', fullName: 'Malika' })
    expect(await db.select().from(attempts).where(eq(attempts.studentId, recent.id))).toHaveLength(1)
    // The teacher's words to the AI go; the homework students did stays, without the chat
    expect(await db.select().from(messages)).toEqual([])
    const [hw] = await db.select().from(assignments).where(eq(assignments.id, a.id))
    expect(hw).toMatchObject({ conversationId: null, status: 'published' })

    expect(await purgeDeletedAccounts(db, now)).toBe(0)
  })
})
