import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb } from '@ikhimi/db'
import { loadPayment, markCancelled, markPaid, payerId } from '@/server/payments/core'
import { testProvider } from '@/server/payments/providers'
import { HttpError, requireSession, route } from '@/server/request'

/** The pretend checkout's buttons. Only the buyer can act, and only while the test provider is enabled. */
export const POST = route(async (req, ctx: { params: Promise<{ paymentId: string }> }) => {
  if (!testProvider.enabled()) throw new HttpError(404, 'not_found')
  const { user } = await requireSession()
  const { action } = z.object({ action: z.enum(['pay', 'cancel']) }).parse(await req.json())
  const db = getDb()
  const row = await loadPayment(db, (await ctx.params).paymentId)
  if (!row || row.payment.provider !== 'test' || payerId(row) !== user.id) throw new HttpError(404, 'not_found')
  if (action === 'pay') await markPaid(db, row.payment.id, { test: true })
  else await markCancelled(db, row.payment.id, { test: true })
  return NextResponse.json({ ok: true })
})
