/**
 * Student plans (DECISIONS.md AV). Teachers always create with everything; what a STUDENT sees of a homework
 * depends on the student's plan. One list decides it, so a new feature is one line here.
 *
 *   Free: vocabulary items
 *   Pro:  everything except voice work (shadowing, read aloud; speaking later)
 *   VIP:  everything, the AI tutor, and every future feature
 */
export const STUDENT_PLANS = ['free', 'pro', 'vip'] as const
export type StudentPlan = (typeof STUDENT_PLANS)[number]
/** Plans that are sold (Free is what everyone has) */
export const PAID_PLANS = ['pro', 'vip'] as const
export type PaidPlan = (typeof PAID_PLANS)[number]

const RANK: Record<StudentPlan, number> = { free: 0, pro: 1, vip: 2 }

export const isStudentPlan = (p: unknown): p is StudentPlan => typeof p === 'string' && (STUDENT_PLANS as readonly string[]).includes(p)
/** The better of two plans */
export const bestPlan = (a: StudentPlan, b: StudentPlan): StudentPlan => (RANK[a] >= RANK[b] ? a : b)
/** Whether `have` includes what needs `need` */
export const planAllows = (have: StudentPlan, need: StudentPlan) => RANK[have] >= RANK[need]

/** Features beyond homework items, and the plan each needs */
export const PLAN_FEATURES = { tutor: 'vip' } as const satisfies Record<string, StudentPlan>
export type PlanFeature = keyof typeof PLAN_FEATURES

/** Item kinds that need the student's voice: VIP (speaking joins them when it exists) */
const VOICE_KINDS = ['shadowing']

/** The plan a homework item needs. `skillTags` as stored on the exercise. */
export function itemPlan(e: { kind: string; skillTags?: readonly string[] | null }): StudentPlan {
  if (VOICE_KINDS.includes(e.kind) || e.skillTags?.includes('speaking')) return 'vip'
  if (e.skillTags?.includes('vocabulary')) return 'free'
  return 'pro'
}

/**
 * What a student on `plan` gets of a homework: the items they see, and how many are locked behind each better
 * plan (for the teaser). `plan` null = everything (attempts from before plans existed).
 */
export function splitByPlan<T extends { kind: string; skillTags?: readonly string[] | null }>(items: T[], plan: StudentPlan | null) {
  const shown: T[] = []
  const locked: Record<PaidPlan, number> = { pro: 0, vip: 0 }
  for (const e of items) {
    const need = itemPlan(e)
    if (plan === null || planAllows(plan, need)) shown.push(e)
    else locked[need as PaidPlan]++
  }
  return { shown, locked }
}

// ─── prices ─────────────────────────────────────────────────────────────────

/**
 * What the plans cost (DECISIONS.md AZ). Stored in the database and edited in Admin → Money; the defaults are in
 * CONFIG.pricing. One function prices every order, on the server and in the checkout, so they always agree.
 */
export type Pricing = {
  /** Per student per month, integer won; null = not on sale (no buy button) */
  monthly: Record<PaidPlan, number | null>
  /** Percent off by how many months are bought at once; the keys are the months on sale */
  periodDiscount: Record<string, number>
  /** Extra percent off for a teacher buying a package (added to the period discount) */
  teacherDiscount: number
  /** Percent of a student's own plan purchase that goes to their teacher */
  teacherCommission: number
  /** The welcome gift: students who register before the end of this day (YYYY-MM-DD, Seoul) get VIP; null = off */
  vipGiftUntil: string | null
  /** …for this many days, then they are on Free until they pay */
  vipGiftDays: number
}

/** The months on sale, smallest first */
export const pricingMonths = (p: Pricing) => Object.keys(p.periodDiscount).map(Number).filter((m) => m > 0).sort((a, b) => a - b)

/** Percent off this order: the period's discount, plus the teacher's when a teacher buys a package */
export const orderDiscount = (p: Pricing, months: number, teacher = false) => Math.min(90, (p.periodDiscount[String(months)] ?? 0) + (teacher ? p.teacherDiscount : 0))

/** The full price before any discount */
export function listPrice(p: Pricing, plan: PaidPlan, months: number, seats = 1): number | null {
  const monthly = p.monthly[plan]
  return monthly ? monthly * months * seats : null
}

/**
 * What an order costs, rounded to 100 won; null when the plan or the period isn't on sale. `teacher`: a teacher's
 * package (the teacher's discount is added).
 */
export function planTotal(p: Pricing, plan: PaidPlan, months: number, seats = 1, teacher = false): number | null {
  const full = listPrice(p, plan, months, seats)
  if (full === null || !(String(months) in p.periodDiscount)) return null
  return Math.round((full * (100 - orderDiscount(p, months, teacher))) / 100 / 100) * 100
}

/** The last moment one can register and get the VIP gift: the end of that day in Seoul (UTC+9); null when off */
export function vipGiftEnd(p: Pick<Pricing, 'vipGiftUntil'>): Date | null {
  if (!p.vipGiftUntil || !/^\d{4}-\d{2}-\d{2}$/.test(p.vipGiftUntil)) return null
  const end = new Date(`${p.vipGiftUntil}T23:59:59+09:00`)
  return Number.isNaN(end.getTime()) ? null : end
}

/** Until when a student registering at `now` has the gift VIP (vipGiftDays from now); null when there is no gift */
export function vipGiftFor(p: Pick<Pricing, 'vipGiftUntil' | 'vipGiftDays'>, now: Date): Date | null {
  const last = vipGiftEnd(p)
  if (!last || now > last || p.vipGiftDays < 1) return null
  return new Date(now.getTime() + p.vipGiftDays * 86_400_000)
}
