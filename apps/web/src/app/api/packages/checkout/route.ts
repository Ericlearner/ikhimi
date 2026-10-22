import { NextResponse } from 'next/server'
import { z } from 'zod'
import { and, CONFIG, eq, getDb, groups } from '@ikhimi/db'
import { SITE } from '@/content/site'
import { createPackagePayment } from '@/server/payments/core'
import { enabledProviders, PROVIDERS } from '@/server/payments/providers'
import { HttpError, requireSession, route } from '@/server/request'
import { isStoreApp } from '@/server/store-app'

const body = z.object({
  plan: z.enum(['pro', 'vip']),
  seats: z.number().int().min(1).max(CONFIG.plans.maxSeats),
  months: z.number().int().min(1).max(12),
  groupId: z.string().max(40).nullable(),
  provider: z.enum(['test']),
  acceptOffer: z.literal(true),
})

/** A teacher buys Pro or VIP places for the students of one class. */
export const POST = route(async (req) => {
  const { user } = await requireSession()
  // Nothing is sold in the Google Play app (server/store-app.ts)
  if (await isStoreApp()) throw new HttpError(403, 'store_app')
  if (user.role !== 'teacher') throw new HttpError(403, 'forbidden')
  const input = body.parse(await req.json())
  const p = PROVIDERS[input.provider]
  if (!enabledProviders().includes(p)) throw new HttpError(400, 'provider_unavailable')
  const db = getDb()
  if (input.groupId) {
    const [g] = await db.select({ id: groups.id }).from(groups).where(and(eq(groups.id, input.groupId), eq(groups.teacherId, user.id))).limit(1)
    if (!g) throw new HttpError(404, 'group_not_found')
  }
  try {
    const { payment } = await createPackagePayment(db, { teacherId: user.id, ...input, offerVersion: SITE.legalVersion })
    const origin = (process.env.PUBLIC_ORIGIN ?? new URL(req.url).origin).replace(/\/$/, '')
    const url = p.checkoutUrl({ paymentId: payment.id, amountKrw: payment.amountKrw, returnUrl: `${origin}/app/packages?paid=1`, description: `익히미 ${input.plan.toUpperCase()} × ${input.seats}` })
    return NextResponse.json({ url })
  } catch (e) {
    if (e instanceof Error && e.message === 'not_for_sale') throw new HttpError(409, 'not_for_sale')
    throw e
  }
})
