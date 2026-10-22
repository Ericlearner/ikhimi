/**
 * The plan prices (DECISIONS.md AZ): kept in app_settings under 'pricing', edited by the owner in Admin → Money.
 * Until the owner saves them, CONFIG.pricing is in force. The pure maths is planTotal in @ikhimi/ai.
 */
import { z } from 'zod'
import { appSettings, CONFIG, eq, type Db } from '@ikhimi/db'
import type { Pricing } from '@ikhimi/ai'

const KEY = 'pricing'

const percent = z.number().int().min(0).max(90)
const price = z.number().int().min(1_000).max(10_000_000).nullable()

/** What the admin form may save */
export const pricingSchema = z.object({
  monthly: z.object({ pro: price, vip: price }),
  periodDiscount: z
    .record(z.string().regex(/^(1|2|3|4|5|6|9|12|18|24)$/), percent)
    .refine((d) => Object.keys(d).length >= 1 && Object.keys(d).length <= 6, { message: 'periods' }),
  teacherDiscount: percent,
  teacherCommission: z.number().int().min(0).max(50),
  vipGiftUntil: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  /** Older saved settings have no gift length: the default fills it */
  vipGiftDays: z.number().int().min(1).max(90).default(CONFIG.pricing.vipGiftDays),
})

export const DEFAULT_PRICING: Pricing = {
  monthly: { ...CONFIG.pricing.monthly },
  periodDiscount: { ...CONFIG.pricing.periodDiscount },
  teacherDiscount: CONFIG.pricing.teacherDiscount,
  teacherCommission: CONFIG.pricing.teacherCommission,
  vipGiftUntil: CONFIG.pricing.vipGiftUntil,
  vipGiftDays: CONFIG.pricing.vipGiftDays,
}

/** The prices in force: what the owner saved, or the defaults (a value that no longer parses falls back too) */
export async function getPricing(db: Db): Promise<Pricing> {
  // A database the 0014 migration hasn't reached yet has no app_settings: the defaults keep the plans page and
  // sign-up working until it runs
  const [row] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, KEY))
    .limit(1)
    .catch((e: unknown) => {
      console.warn('[pricing] app_settings unreadable, using the defaults', e)
      return []
    })
  const saved = row ? pricingSchema.safeParse(row.value) : null
  return saved?.success ? saved.data : DEFAULT_PRICING
}

export async function savePricing(db: Db, value: Pricing, actorId: string) {
  const v = pricingSchema.parse(value)
  await db
    .insert(appSettings)
    .values({ key: KEY, value: v, updatedBy: actorId, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: v, updatedBy: actorId, updatedAt: new Date() } })
  return v
}
