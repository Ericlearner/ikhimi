import { NextResponse } from 'next/server'
import { getDb } from '@ikhimi/db'
import { apiStaff } from '@/server/admin/guard'
import { audit } from '@/server/admin/staff'
import { getPricing, pricingSchema, savePricing } from '@/server/pricing'
import { HttpError, route } from '@/server/request'

/** The owner changes the plan prices, discounts, teacher share and the VIP gift date (staff with Money only see them) */
export const PUT = route(async (req) => {
  const db = getDb()
  const { session, access } = await apiStaff(db, 'money')
  if (!access.owner) throw new HttpError(403, 'owner_only')
  const input = pricingSchema.safeParse(await req.json())
  if (!input.success) throw new HttpError(400, 'bad_pricing')
  const before = await getPricing(db)
  const saved = await savePricing(db, input.data, session.user.id)
  await audit(db, session.user.id, 'pricing.update', { type: 'settings', id: 'pricing' }, { before, after: saved })
  return NextResponse.json({ ok: true, pricing: saved })
})
