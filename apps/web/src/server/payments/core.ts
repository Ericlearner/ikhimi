import { and, CONFIG, courses, desc, enrollments, eq, groups, isNull, payments, planPackages, subscriptions, type Db } from '@ikhimi/db'
import { planTotal, pricingMonths, type PaidPlan, type Pricing } from '@ikhimi/ai'
import { ownsCourse } from '../courses'
import { addMonths, planStart } from '../plans'
import { getPricing } from '../pricing'

export type ProviderId = 'test' | 'card'
export type PaymentRow = typeof payments.$inferSelect

/** What a provider adapter must do. Webhooks are provider-specific routes that call markPaid / markCancelled. */
export interface PaymentProvider {
  id: ProviderId
  /** Shown on the buy button */
  label: string
  enabled(): boolean
  /** Where to send the buyer to pay */
  checkoutUrl(p: { paymentId: string; amountKrw: number; returnUrl: string; description: string }): string
}

/** Which months are on sale, from the prices in force */
const sellable = (p: Pricing, months: number) => pricingMonths(p).includes(months)

/** A payment row we own, for a subscription or a package */
async function insertPayment(
  db: Db,
  v: { subscriptionId?: string; packageId?: string; provider: ProviderId; amountKrw: number; offerVersion?: string; commission?: { teacherId: string; amountKrw: number } | null },
) {
  const [pay] = await db
    .insert(payments)
    .values({
      subscriptionId: v.subscriptionId ?? null,
      packageId: v.packageId ?? null,
      provider: v.provider,
      providerTxnId: `pending:${v.subscriptionId ?? v.packageId}`,
      amountKrw: v.amountKrw,
      status: 'created',
      commissionTeacherId: v.commission?.teacherId ?? null,
      commissionKrw: v.commission?.amountKrw ?? null,
      raw: { offerVersion: v.offerVersion ?? null, offerAcceptedAt: new Date().toISOString() },
    })
    .returning()
  return pay!
}

/**
 * The teacher a student's own purchase is credited to: only a teacher whose class the student is in (the class
 * joined most recently). Not in anyone's class, or the student's own class = no commission.
 */
export async function studentTeacher(db: Db, studentId: string): Promise<string | null> {
  const [row] = await db
    .select({ teacherId: groups.teacherId })
    .from(enrollments)
    .innerJoin(groups, eq(groups.id, enrollments.groupId))
    .where(and(eq(enrollments.studentId, studentId), eq(enrollments.status, 'active'), isNull(groups.deletedAt)))
    .orderBy(desc(enrollments.joinedAt))
    .limit(1)
  return row && row.teacherId !== studentId ? row.teacherId : null
}

/** A student (or a parent, signed in as them) buys Pro or VIP for some months; their teacher earns the commission */
export async function createPlanPayment(db: Db, input: { studentId: string; plan: PaidPlan; months: number; provider: ProviderId; offerVersion?: string }) {
  const pricing = await getPricing(db)
  const price = planTotal(pricing, input.plan, input.months)
  if (!price || !sellable(pricing, input.months)) throw new Error('not_for_sale')
  const teacherId = await studentTeacher(db, input.studentId)
  const commission = teacherId && pricing.teacherCommission > 0 ? { teacherId, amountKrw: Math.round((price * pricing.teacherCommission) / 100) } : null
  const [sub] = await db
    .insert(subscriptions)
    .values({ studentId: input.studentId, plan: input.plan, months: input.months, status: 'pending', provider: input.provider, priceKrw: price })
    .returning()
  const payment = await insertPayment(db, { subscriptionId: sub!.id, provider: input.provider, amountKrw: price, offerVersion: input.offerVersion, commission })
  return { payment, subscription: sub! }
}

/**
 * A student buys a paid course (DECISIONS.md BL): once, for life. The course's teacher earns their share
 * (CONFIG.courses.teacherSharePercent), recorded like a plan commission and paid out by hand.
 */
export async function createCoursePayment(db: Db, input: { studentId: string; courseId: string; provider: ProviderId; offerVersion?: string }) {
  const [c] = await db.select().from(courses).where(and(eq(courses.id, input.courseId), isNull(courses.deletedAt))).limit(1)
  const price = c?.priceKrw ?? 0
  if (!c || price <= 0 || c.reviewStatus !== 'approved' || c.visibility === 'private') throw new Error('not_for_sale')
  if (c.teacherId === input.studentId) throw new Error('own_course')
  const [have] = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(and(eq(subscriptions.studentId, input.studentId), eq(subscriptions.courseId, c.id), eq(subscriptions.status, 'active'), ownsCourse))
    .limit(1)
  if (have) throw new Error('already_bought')
  const commission = { teacherId: c.teacherId, amountKrw: Math.round((price * CONFIG.courses.teacherSharePercent) / 100) }
  const [sub] = await db
    .insert(subscriptions)
    .values({ studentId: input.studentId, courseId: c.id, plan: 'course', status: 'pending', provider: input.provider, priceKrw: price })
    .returning()
  const payment = await insertPayment(db, { subscriptionId: sub!.id, provider: input.provider, amountKrw: price, offerVersion: input.offerVersion, commission })
  return { payment, subscription: sub!, course: c }
}

/** A teacher buys a package: `seats` students of one class get the plan for some months */
export async function createPackagePayment(
  db: Db,
  input: { teacherId: string; plan: PaidPlan; seats: number; months: number; groupId: string | null; provider: ProviderId; offerVersion?: string },
) {
  const pricing = await getPricing(db)
  // A teacher's package: the teacher's discount on top of the period's
  const price = planTotal(pricing, input.plan, input.months, input.seats, true)
  if (!price || !sellable(pricing, input.months) || input.seats < 1 || input.seats > CONFIG.plans.maxSeats) throw new Error('not_for_sale')
  const [pkg] = await db
    .insert(planPackages)
    .values({ teacherId: input.teacherId, plan: input.plan, seats: input.seats, months: input.months, groupId: input.groupId, status: 'pending', provider: input.provider, priceKrw: price })
    .returning()
  const payment = await insertPayment(db, { packageId: pkg!.id, provider: input.provider, amountKrw: price, offerVersion: input.offerVersion })
  return { payment, pkg: pkg! }
}

export async function loadPayment(db: Db, paymentId: string) {
  const [row] = await db
    .select({ payment: payments, subscription: subscriptions, pkg: planPackages })
    .from(payments)
    .leftJoin(subscriptions, eq(subscriptions.id, payments.subscriptionId))
    .leftJoin(planPackages, eq(planPackages.id, payments.packageId))
    .where(eq(payments.id, paymentId))
    .limit(1)
  return row ?? null
}

/** The course a payment is for, if it is one */
export async function paymentCourse(db: Db, row: NonNullable<Awaited<ReturnType<typeof loadPayment>>>) {
  if (!row.subscription?.courseId) return null
  const [c] = await db.select({ id: courses.id, title: courses.title, slug: courses.slug }).from(courses).where(eq(courses.id, row.subscription.courseId)).limit(1)
  return c ?? null
}

/** Who paid: the student of a subscription, or the teacher of a package */
export const payerId = (row: NonNullable<Awaited<ReturnType<typeof loadPayment>>>) => row.subscription?.studentId ?? row.pkg?.teacherId ?? null

/** Provider accepted the order (a gateway's "prepare" call, or a bank-transfer confirmation received). Idempotent. */
export async function markPending(db: Db, paymentId: string, providerTxnId: string, raw: Record<string, unknown>) {
  const row = await loadPayment(db, paymentId)
  if (!row) return null
  if (row.payment.status === 'created') {
    await db
      .update(payments)
      .set({ status: 'pending', providerTxnId, raw: { ...(row.payment.raw as object), ...raw } })
      .where(eq(payments.id, paymentId))
  }
  return loadPayment(db, paymentId)
}

/** Money received: activate access. Safe to call any number of times (providers retry). */
export async function markPaid(db: Db, paymentId: string, raw: Record<string, unknown> = {}) {
  const row = await loadPayment(db, paymentId)
  if (!row) return null
  if (row.payment.status === 'paid') return row
  if (row.payment.status === 'cancelled' || row.payment.status === 'refunded' || row.payment.status === 'failed') throw new Error('payment_closed')
  await db
    .update(payments)
    .set({ status: 'paid', raw: { ...(row.payment.raw as object), ...raw, paidAt: new Date().toISOString() } })
    .where(eq(payments.id, paymentId))
  const now = new Date()
  const sub = row.subscription
  if (sub && sub.months && !sub.courseId && (sub.plan === 'pro' || sub.plan === 'vip')) {
    // A plan runs from now, or after the same plan already running
    const start = await planStart(db, sub.studentId, sub.plan, now)
    await db.update(subscriptions).set({ status: 'active', periodStart: start, periodEnd: addMonths(start, sub.months) }).where(eq(subscriptions.id, sub.id))
  } else if (sub) {
    await db.update(subscriptions).set({ status: 'active', periodStart: now }).where(eq(subscriptions.id, sub.id))
  } else if (row.pkg) {
    await db.update(planPackages).set({ status: 'active', periodStart: now, periodEnd: addMonths(now, row.pkg.months) }).where(eq(planPackages.id, row.pkg.id))
  }
  // A Telegram note never holds up or fails the provider's callback
  await import('../telegram/shop').then((m) => m.notifyPlanPaid(db, paymentId)).catch((e) => console.error('[telegram notify]', e))
  return loadPayment(db, paymentId)
}

/** Cancelled before paying, or refunded after: access is withdrawn when money goes back. */
export async function markCancelled(db: Db, paymentId: string, raw: Record<string, unknown> = {}) {
  const row = await loadPayment(db, paymentId)
  if (!row) return null
  if (row.payment.status === 'cancelled' || row.payment.status === 'refunded') return row
  const refunded = row.payment.status === 'paid'
  await db
    .update(payments)
    .set({ status: refunded ? 'refunded' : 'cancelled', raw: { ...(row.payment.raw as object), ...raw, cancelledAt: new Date().toISOString() } })
    .where(eq(payments.id, paymentId))
  if (row.subscription) await db.update(subscriptions).set({ status: 'cancelled' }).where(eq(subscriptions.id, row.subscription.id))
  if (row.pkg) {
    // A refunded package takes its seats back
    await db.update(planPackages).set({ status: 'cancelled' }).where(eq(planPackages.id, row.pkg.id))
    await db.update(subscriptions).set({ status: 'cancelled' }).where(eq(subscriptions.packageId, row.pkg.id))
  }
  return loadPayment(db, paymentId)
}
