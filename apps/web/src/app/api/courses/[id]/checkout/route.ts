import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb } from '@ikhimi/db'
import { SITE } from '@/content/site'
import { createCoursePayment } from '@/server/payments/core'
import { enabledProviders, PROVIDERS } from '@/server/payments/providers'
import { HttpError, requireSession, route } from '@/server/request'
import { isStoreApp } from '@/server/store-app'

const body = z.object({ provider: z.enum(['test']), acceptOffer: z.literal(true) })

/** A student buys a paid course (DECISIONS.md BL): our payment, then the provider's checkout address */
export const POST = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const { user } = await requireSession()
  // Nothing is sold in the store apps (server/store-app.ts)
  if (await isStoreApp()) throw new HttpError(403, 'store_app')
  const input = body.parse(await req.json())
  const p = PROVIDERS[input.provider]
  if (!enabledProviders().includes(p)) throw new HttpError(400, 'provider_unavailable')
  try {
    const { payment, course } = await createCoursePayment(getDb(), { studentId: user.id, courseId: (await ctx.params).id, provider: input.provider, offerVersion: SITE.legalVersion })
    const origin = (process.env.PUBLIC_ORIGIN ?? new URL(req.url).origin).replace(/\/$/, '')
    const url = p.checkoutUrl({ paymentId: payment.id, amountKrw: payment.amountKrw, returnUrl: `${origin}/course/${course.slug}?paid=1`, description: `익히미: ${course.title}`.slice(0, 120) })
    return NextResponse.json({ url })
  } catch (e) {
    const code = e instanceof Error ? e.message : ''
    if (code === 'not_for_sale' || code === 'already_bought' || code === 'own_course') throw new HttpError(409, code)
    throw e
  }
})
