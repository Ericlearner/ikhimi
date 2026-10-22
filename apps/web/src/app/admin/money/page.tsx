import { CONFIG, getDb } from '@ikhimi/db'
import { formatDate, formatKrw } from '@ikhimi/i18n'
import { Badge, StatTile } from '@ikhimi/ui/components'
import { Section } from '@/components/admin/Bars'
import { PricingForm } from '@/components/admin/PricingForm'
import { getT } from '@/i18n/server'
import { pageStaff } from '@/server/admin/guard'
import { moneyStats, teacherCommissions } from '@/server/admin/stats'
import { getPricing } from '@/server/pricing'

/** Plan prices, payment providers, revenue, teachers' commissions and recent payments */
export default async function AdminMoney() {
  const db = getDb()
  const { access } = await pageStaff(db, 'money')
  const { t } = await getT()
  const [m, pricing, commissions] = await Promise.all([moneyStats(db, 30), getPricing(db), teacherCommissions(db)])
  const testOn = process.env.PAYMENT_TEST_ENABLED === '1'
  return (
    <div className="flex flex-col gap-8">
      <Section title={t('admin.pricing.title')}>
        <PricingForm pricing={pricing} canEdit={access.owner} />
      </Section>
      <Section title={t('admin.money.providers')}>
        <p className="t-body text-ink-700">{t('admin.money.noGateway')}</p>
        {testOn && <p className="t-small text-warn-600">{t('admin.money.testOn', { flag: 'PAYMENT_TEST_ENABLED=1' })}</p>}
      </Section>
      <Section title={t('admin.money.title30')}>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <StatTile value={formatKrw(m.revenueKrw)} label={t('admin.money.revenue30')} />
          <StatTile value={m.subscriptions.paidActive} label={t('admin.money.paidActive')} />
          <StatTile value={m.subscriptions.active} label={t('admin.money.allActive')} />
          {m.byProvider.map((p) => (
            <StatTile key={p.provider} value={formatKrw(p.sum)} label={p.provider} hint={t('admin.money.payments', { n: p.n })} />
          ))}
        </div>
      </Section>
      <Section title={t('admin.money.commissions')}>
        <p className="t-small text-ink-500">{t('admin.money.commissionsHint', { n: pricing.teacherCommission, share: CONFIG.courses.teacherSharePercent })}</p>
        {commissions.length === 0 ? (
          <p className="t-body text-ink-500">{t('admin.money.noCommissions')}</p>
        ) : (
          <ul className="overflow-hidden rounded-lg border border-paper-300 bg-paper-50">
            {commissions.map((c) => (
              <li key={c.teacherId} className="t-small flex flex-wrap items-center justify-between gap-2 border-b border-paper-300 px-4 py-2 last:border-b-0">
                <span className="font-medium">{c.name ?? '—'}</span>
                <span className="t-num flex flex-wrap items-center gap-3 text-ink-500">
                  <span>{t('admin.money.payments', { n: c.payments })}</span>
                  <span>
                    {t('admin.money.thisMonth')}: <b className="text-ink-800">{formatKrw(c.monthKrw)}</b>
                  </span>
                  <span>
                    {t('admin.money.allTime')}: <b className="text-ink-800">{formatKrw(c.totalKrw)}</b>
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title={t('admin.money.recent')}>
        {m.recent.length === 0 ? (
          <p className="t-body text-ink-500">{t('admin.money.none')}</p>
        ) : (
          <ul className="overflow-hidden rounded-lg border border-paper-300 bg-paper-50">
            {m.recent.map((p) => (
              <li key={p.id} className="t-small flex flex-wrap items-center justify-between gap-2 border-b border-paper-300 px-4 py-2 last:border-b-0">
                <span className="font-medium">{p.name ?? '—'}</span>
                <span className="t-num flex items-center gap-2 text-ink-500">
                  {formatDate(p.at)} · {p.provider} · {formatKrw(p.amountKrw)}
                  <Badge tone={p.status === 'paid' ? 'success' : p.status === 'failed' || p.status === 'cancelled' ? 'error' : 'neutral'}>{p.status}</Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  )
}
