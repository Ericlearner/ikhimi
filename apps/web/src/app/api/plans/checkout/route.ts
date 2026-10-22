import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb } from '@ikhimi/db'
import { SITE } from '@/content/site'
import { createPlanPayment } from '@/server/payments/core'
import { enabledProviders, PROVIDERS } from '@/server/payments/providers'
import { HttpError, requireSession, route } from '@/server/request'
import { isStoreApp } from '@/server/store-app'

const body = z.object({
  plan: z.enum(['pro', 'vip']),
  months: z.number().int().min(1).max(12),
  provider: z.enum(['test']),
  acceptOffer: z.literal(true),
})

/** A student buys Pro or VIP for themselves: our payment, then the provider's checkout address. */
export const POST = route(async (req) => {
  const { user } = await requireSession()
  // Nothing is sold in the Google Play app (server/store-app.ts)
  if (await isStoreApp()) throw new HttpError(403, 'store_app')
  const input = body.parse(await req.json())
  const p = PROVIDERS[input.provider]
  if (!enabledProviders().includes(p)) throw new HttpError(400, 'provider_unavailable')
  try {
    const { payment } = await createPlanPayment(getDb(), { studentId: user.id, plan: input.plan, months: input.months, provider: input.provider, offerVersion: SITE.legalVersion })
    const origin = (process.env.PUBLIC_ORIGIN ?? new URL(req.url).origin).replace(/\/$/, '')
    const url = p.checkoutUrl({ paymentId: payment.id, amountKrw: payment.amountKrw, returnUrl: `${origin}/plans?paid=1`, description: `익히미 ${input.plan.toUpperCase()}` })
    return NextResponse.json({ url })
  } catch (e) {
    if (e instanceof Error && e.message === 'not_for_sale') throw new HttpError(409, 'not_for_sale')
    throw e
  }
})
