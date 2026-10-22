'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { planTotal, pricingMonths, type PaidPlan, type Pricing } from '@ikhimi/ai'
import { formatKrw } from '@ikhimi/i18n'
import { Button, Input } from '@ikhimi/ui/components'
import { useI18n } from '@/i18n/client'
import { postJson } from '@/lib/client'

const PLANS: PaidPlan[] = ['pro', 'vip']

/**
 * The plan prices in Admin → Money: monthly prices, the discount per period, the teacher's extra discount and
 * commission, and the VIP gift's last day. Only the owner can save; a table shows what every order will cost.
 */
export function PricingForm({ pricing, canEdit }: { pricing: Pricing; canEdit: boolean }) {
  const { t } = useI18n()
  const router = useRouter()
  const [p, setP] = useState<Pricing>(pricing)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const months = pricingMonths(p)
  const dirty = JSON.stringify(p) !== JSON.stringify(pricing)
  const num = (v: string) => Math.max(0, Math.round(Number(v.replace(/\s/g, '')) || 0))

  const save = async () => {
    setBusy(true)
    setMsg(null)
    const { ok, json } = await postJson('/api/admin/pricing', p, 'PUT')
    setBusy(false)
    if (!ok) return setMsg({ ok: false, text: json.error === 'reauth' ? t('admin.verify.title') : t('admin.pricing.invalid') })
    setMsg({ ok: true, text: t('admin.pricing.saved') })
    router.refresh()
  }

  const field = 'flex flex-col gap-1 t-small font-medium text-ink-500'
  return (
    <div className="flex flex-col gap-4">
      <fieldset disabled={!canEdit} className="grid gap-3 rounded-lg border border-paper-300 bg-paper-50 p-4 md:grid-cols-2">
        {PLANS.map((plan) => (
          <label key={plan} className={field}>
            {t('admin.pricing.monthly', { plan: plan.toUpperCase() })}
            <Input inputMode="numeric" className="t-num" value={p.monthly[plan] ?? ''} placeholder="—" onChange={(e) => setP({ ...p, monthly: { ...p.monthly, [plan]: e.target.value.trim() ? num(e.target.value) : null } })} />
          </label>
        ))}
        <div className="flex flex-col gap-1 md:col-span-2">
          <span className="t-small font-medium text-ink-500">{t('admin.pricing.periodDiscount')}</span>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {months.map((m) => (
              <label key={m} className="t-small flex items-center gap-2 text-ink-700">
                <span className="w-14 shrink-0">{t('plans.monthsN', { n: m })}</span>
                <Input inputMode="numeric" className="t-num" value={p.periodDiscount[String(m)] ?? 0} onChange={(e) => setP({ ...p, periodDiscount: { ...p.periodDiscount, [String(m)]: Math.min(90, num(e.target.value)) } })} />
                <span>%</span>
              </label>
            ))}
          </div>
        </div>
        <label className={field}>
          {t('admin.pricing.teacherDiscount')}
          <Input inputMode="numeric" className="t-num" value={p.teacherDiscount} onChange={(e) => setP({ ...p, teacherDiscount: Math.min(90, num(e.target.value)) })} />
        </label>
        <label className={field}>
          {t('admin.pricing.teacherCommission')}
          <Input inputMode="numeric" className="t-num" value={p.teacherCommission} onChange={(e) => setP({ ...p, teacherCommission: Math.min(50, num(e.target.value)) })} />
        </label>
        <label className={`${field} md:col-span-2`}>
          {t('admin.pricing.vipGift')}
          <div className="flex flex-wrap items-center gap-3">
            <Input type="date" className="max-w-48" value={p.vipGiftUntil ?? ''} onChange={(e) => setP({ ...p, vipGiftUntil: e.target.value || null })} />
            <span className="flex items-center gap-2 font-normal text-ink-700">
              <Input inputMode="numeric" className="t-num w-20" aria-label={t('admin.pricing.vipGiftDays')} value={p.vipGiftDays} onChange={(e) => setP({ ...p, vipGiftDays: Math.min(90, Math.max(1, num(e.target.value))) })} />
              {t('admin.pricing.vipGiftDays')}
            </span>
            {p.vipGiftUntil && (
              <Button size="sm" variant="secondary" onClick={() => setP({ ...p, vipGiftUntil: null })}>
                {t('admin.pricing.vipGiftOff')}
              </Button>
            )}
          </div>
          <span className="font-normal text-ink-400">{p.vipGiftUntil ? t('admin.pricing.vipGiftHint', { date: p.vipGiftUntil, n: p.vipGiftDays }) : t('admin.pricing.vipGiftNone')}</span>
        </label>
      </fieldset>

      <div className="overflow-x-auto rounded-lg border border-paper-300 bg-paper-50">
        <table className="t-small t-num w-full text-left">
          <thead className="text-ink-500">
            <tr className="border-b border-paper-300">
              <th className="px-3 py-2 font-medium">{t('admin.pricing.preview')}</th>
              {months.map((m) => (
                <th key={m} className="px-3 py-2 font-medium">
                  {t('plans.monthsN', { n: m })}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PLANS.flatMap((plan) =>
              [false, true].map((teacher) => (
                <tr key={`${plan}-${teacher}`} className="border-b border-paper-300 last:border-b-0">
                  <td className="px-3 py-2 font-medium text-ink-700">
                    {plan.toUpperCase()} · {teacher ? t('admin.pricing.forTeacher') : t('admin.pricing.forStudent')}
                  </td>
                  {months.map((m) => {
                    const total = planTotal(p, plan, m, 1, teacher)
                    return (
                      <td key={m} className="px-3 py-2">
                        {total === null ? '—' : formatKrw(total)}
                      </td>
                    )
                  })}
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>

      {canEdit ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={save} loading={busy} disabled={!dirty}>
            {t('action.save')}
          </Button>
          {dirty && (
            <Button variant="ghost" onClick={() => setP(pricing)}>
              {t('common.cancel')}
            </Button>
          )}
          {msg && (
            <p role={msg.ok ? 'status' : 'alert'} className={`t-small ${msg.ok ? 'text-success-600' : 'text-error-600'}`}>
              {msg.text}
            </p>
          )}
        </div>
      ) : (
        <p className="t-small text-ink-500">{t('admin.pricing.ownerOnly')}</p>
      )}
    </div>
  )
}
