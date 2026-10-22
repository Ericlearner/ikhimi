import { beforeEach, describe, expect, it } from 'vitest'
import { createTestDb } from '@ikhimi/db/testing'
import { attempts, eq, planPackages, subscriptions, users, type Db } from '@ikhimi/db'
import { convertItem, splitByPlan, type GenerateResult, type LlmItem } from '@ikhimi/ai'
import { checkAnswer, createDraft, loadExercises, publishAssignment, startAttempt, submitAttempt } from './assignments'
import { createPackagePayment, createPlanPayment, markCancelled, markPaid } from './payments/core'
import { findOrCreateUserByPhone } from './auth/users'
import { claimSeat, giveVipGift, grantPlan, studentPlan, studentPlanInfo } from './plans'
import { DEFAULT_PRICING, getPricing, savePricing } from './pricing'
import { teacherEarnings } from './earnings'

let db: Db

const item = (raw: LlmItem) => {
  const r = convertItem({ explanation: '', ...raw }, 1)
  if (!r.ok) throw new Error(r.reason)
  return r.ex
}

async function setup() {
  const [t] = await db.insert(users).values({ role: 'teacher', phone: '+998900000001', fullName: 'Nodira' }).returning()
  const exercises = [
    item({ kind: 'mcq_single', skill: 'vocabulary', prompt: "«journey» nima degani?", options: ['sayohat', 'uy'], correctOptionIndexes: [0] }),
    item({ kind: 'gap_fill', skill: 'grammar', prompt: 'Complete', gapText: 'She ___ (go) home.', gapAnswers: [{ accepted: ['goes'] }] }),
    item({ kind: 'shadowing', skill: 'pronunciation', prompt: 'Repeat', shadowingLines: ['I think so.'] }),
  ]
  const result: GenerateResult = {
    draft: { title: 'Mixed', instructions: '', rationale: '', contentLanguage: 'en', cefrLevel: 'A2', estimatedMinutes: 5, exercises },
    meta: { model: 'fake', usage: { inputTokens: 0, outputTokens: 0 }, dropped: [], trimmedForTime: 0, solveBack: [], instructionsScriptOk: true, raw: {} },
  }
  const a = await publishAssignment(db, await createDraft(db, { teacherId: t!.id, conversationId: null, instructionLocale: 'ko', difficulty: 3, result }), { newGroupName: '7-A' })
  const student = async (n: number) => (await db.insert(users).values({ role: 'student', phone: `+99890000010${n}`, fullName: `S${n}` }).returning())[0]!
  return { t: t!, a, rows: await loadExercises(db, a.id), student }
}

beforeEach(async () => {
  db = await createTestDb()
})

describe('student plans', () => {
  it('a Free student sees and is scored on vocabulary only; locked items cannot be checked', async () => {
    const { a, rows, student } = await setup()
    const s = await student(1)
    const at = await startAttempt(db, a, s.id)
    expect(await claimSeat(db, s.id)).toBe('free')
    const { shown, locked } = splitByPlan(rows, 'free')
    expect(shown.map((e) => e.kind)).toEqual(['mcq_single'])
    expect(locked).toEqual({ pro: 1, vip: 1 })

    const grammar = rows.find((e) => e.kind === 'gap_fill')!
    expect(await checkAnswer(db, at, a, { exerciseId: grammar.id, value: ['goes'], revision: 1 })).toEqual({ ok: false, reason: 'plan' })
    const vocab = shown[0]!
    const right = (vocab.answerKey as { correct: number }).correct
    await checkAnswer(db, at, a, { exerciseId: vocab.id, value: right, revision: 1 })
    const done = await submitAttempt(db, at)
    expect(done).toMatchObject({ plan: 'free', percent: 100, maxScore: vocab.points, status: 'graded' })
  })

  it("a teacher's package gives its class seats until they run out", async () => {
    const { t, a, student } = await setup()
    const [pkg] = await db
      .insert(planPackages)
      .values({ teacherId: t.id, plan: 'pro', seats: 1, months: 1, groupId: a.groupId, status: 'active', priceKrw: 0, periodStart: new Date(), periodEnd: new Date(Date.now() + 30 * 86_400_000) })
      .returning()
    const s1 = await student(1)
    const s2 = await student(2)
    await startAttempt(db, a, s1.id)
    await startAttempt(db, a, s2.id)
    expect(await claimSeat(db, s1.id)).toBe('pro')
    expect(await claimSeat(db, s1.id)).toBe('pro') // a second visit takes no second seat
    expect(await claimSeat(db, s2.id)).toBe('free') // no seats left
    expect((await studentPlanInfo(db, s1.id)).fromPackage).toBe(true)

    // A VIP student keeps VIP and leaves the seat for someone else
    await db.update(planPackages).set({ seats: 3 }).where(eq(planPackages.id, pkg!.id))
    const s3 = await student(3)
    await startAttempt(db, a, s3.id)
    await grantPlan(db, s3.id, 'vip', 30)
    expect(await claimSeat(db, s3.id)).toBe('vip')
  })

  it('a plan is bought for months with the period discount, runs on after the first, and nothing is sold without a price', async () => {
    const { t, a, student } = await setup()
    const s = await student(1)
    const first = await createPlanPayment(db, { studentId: s.id, plan: 'pro', months: 3, provider: 'test' })
    expect(first.payment.amountKrw).toBe(26_700) // 3 × 9 900 − 10% = 26 730, rounded to 100 won
    expect(await studentPlan(db, s.id)).toBe('free') // not paid yet
    await markPaid(db, first.payment.id)
    const one = await studentPlanInfo(db, s.id)
    expect(one.plan).toBe('pro')
    const second = await createPlanPayment(db, { studentId: s.id, plan: 'pro', months: 1, provider: 'test' })
    expect(second.payment.amountKrw).toBe(9_900)
    await markPaid(db, second.payment.id)
    const two = await studentPlanInfo(db, s.id)
    expect(two.until!.getTime()).toBeGreaterThan(one.until!.getTime() + 27 * 86_400_000)
    // No teacher yet: no commission
    expect(first.payment.commissionTeacherId).toBeNull()

    // A student of a class: 10% of their own purchase is credited to the teacher
    const s2 = await student(2)
    await startAttempt(db, a, s2.id)
    const third = await createPlanPayment(db, { studentId: s2.id, plan: 'vip', months: 12, provider: 'test' })
    expect(third.payment).toMatchObject({ amountKrw: 134_100, commissionTeacherId: t.id, commissionKrw: 13_410 })

    await savePricing(db, { ...DEFAULT_PRICING, monthly: { pro: null, vip: 14_900 } }, t.id)
    await expect(createPlanPayment(db, { studentId: s.id, plan: 'pro', months: 1, provider: 'test' })).rejects.toThrow('not_for_sale')
    await expect(createPlanPayment(db, { studentId: s.id, plan: 'vip', months: 2, provider: 'test' })).rejects.toThrow('not_for_sale')
  })

  it("a teacher's package is 10% cheaper on top of the period discount; seats open, a refund takes them back", async () => {
    const { t, a, student } = await setup()
    const { payment } = await createPackagePayment(db, { teacherId: t.id, plan: 'vip', seats: 20, months: 1, groupId: a.groupId, provider: 'test' })
    expect(payment.amountKrw).toBe(268_200) // 20 × 14 900 − 10%
    expect(payment.commissionTeacherId).toBeNull()
    const year = await createPackagePayment(db, { teacherId: t.id, plan: 'pro', seats: 10, months: 12, groupId: a.groupId, provider: 'test' })
    expect(year.payment.amountKrw).toBe(772_200) // 10 × 12 × 9 900 − 35%
    const s = await student(1)
    await startAttempt(db, a, s.id)
    expect(await claimSeat(db, s.id)).toBe('free') // pending
    await markPaid(db, payment.id)
    expect(await claimSeat(db, s.id)).toBe('vip')
    await markCancelled(db, payment.id)
    expect(await studentPlan(db, s.id)).toBe('free')
  })

  it("the owner's prices replace the defaults; values out of range are refused", async () => {
    const { t } = await setup()
    expect(await getPricing(db)).toEqual(DEFAULT_PRICING)
    const mine = { ...DEFAULT_PRICING, monthly: { pro: 49_000, vip: 99_000 }, teacherDiscount: 15 }
    await savePricing(db, mine, t.id)
    expect(await getPricing(db)).toEqual(mine)
    await expect(savePricing(db, { ...mine, teacherCommission: 80 }, t.id)).rejects.toThrow()
    expect((await getPricing(db)).monthly.pro).toBe(49_000)
  })

  it("a new student gets a week of VIP, then Free; only while the offer runs; teachers get none", async () => {
    // The offer runs to the end of a day next year, so the test holds whenever it runs
    const day = `${new Date().getUTCFullYear() + 1}-12-31`
    const { user: owner } = await findOrCreateUserByPhone(db, { phone: '+998901112200', role: 'teacher', uiLocale: 'ko' })
    await savePricing(db, { ...DEFAULT_PRICING, vipGiftUntil: day, vipGiftDays: 7 }, owner.id)
    const signedUp = Date.now()
    const { user: s } = await findOrCreateUserByPhone(db, { phone: '+998901112233', role: 'student', uiLocale: 'ko' })
    const info = await studentPlanInfo(db, s.id)
    expect(info.plan).toBe('vip')
    expect(Math.abs(info.until!.getTime() - (signedUp + 7 * 86_400_000))).toBeLessThan(60_000)
    // A week later they are on Free until they pay
    expect(await studentPlan(db, s.id, new Date(signedUp + 7 * 86_400_000 + 120_000))).toBe('free')
    expect(await db.select().from(subscriptions).where(eq(subscriptions.studentId, owner.id))).toHaveLength(0)
    // After the offer's last day: no gift
    expect(await giveVipGift(db, s.id, new Date(new Date(`${day}T23:59:59+05:00`).getTime() + 1000))).toBeNull()
    await savePricing(db, { ...DEFAULT_PRICING, vipGiftUntil: null }, owner.id)
    const { user: late } = await findOrCreateUserByPhone(db, { phone: '+998901112255', role: 'student', uiLocale: 'ko' })
    expect(await studentPlan(db, late.id)).toBe('free')
  })

  it("a teacher earns only from their own class's students, and sees it on their earnings page", async () => {
    const { t, a, student } = await setup()
    const [other] = await db.insert(users).values({ role: 'teacher', phone: '+998900000009', fullName: 'Boshqa' }).returning()
    const mine = await student(1)
    await startAttempt(db, a, mine.id) // in the teacher's class
    const stranger = await student(2) // in nobody's class
    const p1 = await createPlanPayment(db, { studentId: mine.id, plan: 'pro', months: 1, provider: 'card' })
    const p2 = await createPlanPayment(db, { studentId: stranger.id, plan: 'vip', months: 1, provider: 'card' })
    expect(p1.payment.commissionTeacherId).toBe(t.id)
    expect(p2.payment.commissionTeacherId).toBeNull()
    expect((await teacherEarnings(db, t.id)).totalKrw).toBe(0) // not paid yet
    await markPaid(db, p1.payment.id)
    await markPaid(db, p2.payment.id)
    const e = await teacherEarnings(db, t.id)
    expect(e).toMatchObject({ totalKrw: 990, monthKrw: 990, students: 1 })
    expect(e.recent).toEqual([expect.objectContaining({ student: 'S1', plan: 'pro', months: 1, amountKrw: 9_900, commissionKrw: 990 })])
    expect((await teacherEarnings(db, other!.id)).recent).toHaveLength(0)
    // A refund takes it back
    await markCancelled(db, p1.payment.id)
    expect((await teacherEarnings(db, t.id)).totalKrw).toBe(0)
  })

  it('work from before plans keeps every item', async () => {
    const { a, rows, student } = await setup()
    const s = await student(1)
    const at = await startAttempt(db, a, s.id)
    const [legacy] = await db.select().from(attempts).where(eq(attempts.id, at.id))
    expect(legacy!.plan).toBeNull()
    expect(splitByPlan(rows, null).shown).toHaveLength(3)
  })
})
