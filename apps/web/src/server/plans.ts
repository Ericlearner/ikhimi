/**
 * Student plans on the server (DECISIONS.md AV). What each plan includes is decided in @ikhimi/ai plans.ts;
 * here: which plan a student has right now, seats taken from teachers' packages, and staff grants.
 */
import { and, count, enrollments, eq, gt, inArray, isNull, or, planPackages, subscriptions, type Db } from '@ikhimi/db'
import { bestPlan, isStudentPlan, PAID_PLANS, PLAN_FEATURES, planAllows, vipGiftFor, type PaidPlan, type PlanFeature, type StudentPlan } from '@ikhimi/ai'
import { getPricing } from './pricing'

const DAY = 86_400_000

/** A subscription that gives a plan right now */
const activePlanRows = (studentId: string, now: Date) =>
  and(
    eq(subscriptions.studentId, studentId),
    isNull(subscriptions.courseId),
    inArray(subscriptions.plan, [...PAID_PLANS]),
    eq(subscriptions.status, 'active'),
    or(isNull(subscriptions.periodEnd), gt(subscriptions.periodEnd, now)),
  )

/** The student's plan right now and when it ends (the best of everything they have; Free when nothing) */
export async function studentPlanInfo(db: Db, studentId: string, now = new Date()): Promise<{ plan: StudentPlan; until: Date | null; fromPackage: boolean }> {
  const rows = await db.select().from(subscriptions).where(activePlanRows(studentId, now))
  let out: { plan: StudentPlan; until: Date | null; fromPackage: boolean } = { plan: 'free', until: null, fromPackage: false }
  for (const r of rows) {
    if (!isStudentPlan(r.plan)) continue
    const better = bestPlan(out.plan, r.plan) !== out.plan
    const later = r.plan === out.plan && (!r.periodEnd || (out.until && r.periodEnd > out.until))
    if (better || later) out = { plan: r.plan, until: r.periodEnd, fromPackage: !!r.packageId }
  }
  return out
}

export const studentPlan = async (db: Db, studentId: string, now = new Date()) => (await studentPlanInfo(db, studentId, now)).plan

/** Whether the student's plan includes a feature (the AI tutor…) */
export async function hasFeature(db: Db, studentId: string, feature: PlanFeature) {
  return planAllows(await studentPlan(db, studentId), PLAN_FEATURES[feature])
}

/**
 * A student of a class with a teacher's package takes a seat, if one is free and it is better than what they
 * have. Called when they open homework, so students who join later get a seat too. Returns the plan they now have.
 */
export async function claimSeat(db: Db, studentId: string, now = new Date()): Promise<StudentPlan> {
  const have = await studentPlan(db, studentId, now)
  if (have === 'vip') return have
  const groups = await db.select({ groupId: enrollments.groupId }).from(enrollments).where(and(eq(enrollments.studentId, studentId), eq(enrollments.status, 'active')))
  if (!groups.length) return have
  const packs = await db
    .select()
    .from(planPackages)
    .where(and(inArray(planPackages.groupId, groups.map((g) => g.groupId)), eq(planPackages.status, 'active'), gt(planPackages.periodEnd, now)))
  // The best plan first, then the one that runs longest
  packs.sort((a, b) => (a.plan === b.plan ? b.periodEnd!.getTime() - a.periodEnd!.getTime() : a.plan === 'vip' ? -1 : 1))
  for (const p of packs) {
    if (!planAllows(p.plan, have) || p.plan === have) continue
    const [used] = await db.select({ n: count() }).from(subscriptions).where(and(eq(subscriptions.packageId, p.id), eq(subscriptions.status, 'active')))
    if ((used?.n ?? 0) >= p.seats) continue
    await db.insert(subscriptions).values({ studentId, plan: p.plan, status: 'active', packageId: p.id, groupId: p.groupId, priceKrw: 0, periodStart: now, periodEnd: p.periodEnd })
    return p.plan
  }
  return have
}

/** Seats taken in each package */
export async function seatsUsed(db: Db, packageIds: string[]): Promise<Record<string, number>> {
  if (!packageIds.length) return {}
  const rows = await db
    .select({ id: subscriptions.packageId, n: count() })
    .from(subscriptions)
    .where(and(inArray(subscriptions.packageId, packageIds), eq(subscriptions.status, 'active')))
    .groupBy(subscriptions.packageId)
  return Object.fromEntries(rows.map((r) => [r.id!, r.n]))
}

/** Staff: give a plan for some days (added after a running plan of the same kind), or take staff-given plans back */
export async function grantPlan(db: Db, studentId: string, plan: PaidPlan | null, days: number, now = new Date()) {
  const staff = and(eq(subscriptions.studentId, studentId), isNull(subscriptions.courseId), isNull(subscriptions.packageId), isNull(subscriptions.provider), eq(subscriptions.status, 'active'))
  if (!plan) {
    await db.update(subscriptions).set({ status: 'cancelled' }).where(and(staff, inArray(subscriptions.plan, [...PAID_PLANS])))
    return null
  }
  const periodEnd = new Date((await planStart(db, studentId, plan, now)).getTime() + days * DAY)
  await db.insert(subscriptions).values({ studentId, plan, status: 'active', priceKrw: 0, periodStart: now, periodEnd })
  return periodEnd
}

/**
 * The welcome gift (DECISIONS.md AZ): a student who registers before the offer's last day gets VIP for a week
 * (vipGiftDays), then is on Free until they pay. Called once, when an account becomes a student. Returns the end,
 * or null when there is no gift now.
 */
export async function giveVipGift(db: Db, studentId: string, now = new Date()) {
  const end = vipGiftFor(await getPricing(db), now)
  if (!end) return null
  await db.insert(subscriptions).values({ studentId, plan: 'vip', status: 'active', priceKrw: 0, periodStart: now, periodEnd: end })
  return end
}

/** A plan that runs from when it's paid: from now, or after the end of the same plan already running */
export async function planStart(db: Db, studentId: string, plan: PaidPlan, now = new Date()) {
  const rows = await db.select().from(subscriptions).where(and(activePlanRows(studentId, now), eq(subscriptions.plan, plan)))
  const ends = rows.map((r) => r.periodEnd?.getTime() ?? 0).filter((t) => t > now.getTime())
  return new Date(Math.max(now.getTime(), ...ends))
}

export const addMonths = (from: Date, months: number) => {
  const d = new Date(from)
  d.setMonth(d.getMonth() + months)
  return d
}
