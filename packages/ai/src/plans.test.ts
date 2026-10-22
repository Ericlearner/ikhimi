import { describe, expect, it } from 'vitest'
import { bestPlan, itemPlan, orderDiscount, planAllows, planTotal, pricingMonths, splitByPlan, vipGiftEnd, vipGiftFor, type Pricing } from './plans'

const items = [
  { id: 'v', kind: 'mcq_single', skillTags: ['vocabulary'] },
  { id: 'g', kind: 'gap_fill', skillTags: ['grammar'] },
  { id: 'p', kind: 'mcq_single', skillTags: ['pronunciation'] },
  { id: 's', kind: 'shadowing', skillTags: ['pronunciation'] },
]

describe('student plans', () => {
  it('vocabulary is free, voice work is VIP, everything else Pro', () => {
    expect(items.map(itemPlan)).toEqual(['free', 'pro', 'pro', 'vip'])
    expect(itemPlan({ kind: 'short_answer', skillTags: ['speaking'] })).toBe('vip')
  })
  it('each plan sees its items and counts the locked ones', () => {
    expect(splitByPlan(items, 'free')).toEqual({ shown: [items[0]], locked: { pro: 2, vip: 1 } })
    expect(splitByPlan(items, 'pro').shown.map((e) => e.id)).toEqual(['v', 'g', 'p'])
    expect(splitByPlan(items, 'vip')).toEqual({ shown: items, locked: { pro: 0, vip: 0 } })
    expect(splitByPlan(items, null).shown).toHaveLength(4) // attempts from before plans
  })
  it('ranks plans', () => {
    expect(bestPlan('pro', 'vip')).toBe('vip')
    expect(bestPlan('free', 'pro')).toBe('pro')
    expect(planAllows('pro', 'vip')).toBe(false)
    expect(planAllows('vip', 'free')).toBe(true)
  })
})

describe('prices', () => {
  const p: Pricing = {
    monthly: { pro: 59_000, vip: 89_000 },
    periodDiscount: { '1': 0, '3': 10, '6': 15, '12': 25 },
    teacherDiscount: 10,
    teacherCommission: 10,
    vipGiftUntil: '2026-12-31',
    vipGiftDays: 7,
  }
  it('a student pays the monthly price less the period discount', () => {
    expect(planTotal(p, 'pro', 1)).toBe(59_000)
    expect(planTotal(p, 'pro', 3)).toBe(159_300) // 177 000 − 10%
    expect(planTotal(p, 'vip', 6)).toBe(453_900) // 534 000 − 15%
    expect(planTotal(p, 'vip', 12)).toBe(801_000) // 1 068 000 − 25%
  })
  it('a teacher gets 10% more off, for every seat', () => {
    expect(orderDiscount(p, 1, true)).toBe(10)
    expect(orderDiscount(p, 12, true)).toBe(35)
    expect(planTotal(p, 'pro', 1, 10, true)).toBe(531_000) // 590 000 − 10%
    expect(planTotal(p, 'vip', 3, 20, true)).toBe(4_272_000) // 5 340 000 − 20%
  })
  it('nothing is sold without a price or for a period not on sale', () => {
    expect(planTotal({ ...p, monthly: { pro: null, vip: 89_000 } }, 'pro', 1)).toBeNull()
    expect(planTotal(p, 'pro', 2)).toBeNull()
    expect(pricingMonths(p)).toEqual([1, 3, 6, 12])
  })
  it('the VIP gift: a week from registering, for students who register until the end of its day in Seoul', () => {
    expect(vipGiftEnd(p)!.toISOString()).toBe('2026-12-31T14:59:59.000Z')
    expect(vipGiftFor(p, new Date('2026-10-07T10:00:00Z'))!.toISOString()).toBe('2026-10-14T10:00:00.000Z')
    // Registering on the last evening still gives the whole week
    expect(vipGiftFor(p, new Date('2026-12-31T14:00:00Z'))!.toISOString()).toBe('2027-01-07T14:00:00.000Z')
    expect(vipGiftFor(p, new Date('2026-12-31T19:00:00Z'))).toBeNull()
    expect(vipGiftFor({ ...p, vipGiftUntil: null }, new Date('2026-10-07T10:00:00Z'))).toBeNull()
    expect(vipGiftEnd({ vipGiftUntil: null })).toBeNull()
    expect(vipGiftEnd({ vipGiftUntil: '31.12.2026' })).toBeNull()
  })
})
