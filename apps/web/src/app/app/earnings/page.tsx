import { redirect } from 'next/navigation'
import { CONFIG, getDb } from '@ikhimi/db'
import { formatDate, formatKrw, type MessageKey } from '@ikhimi/i18n'
import { Badge, StatTile } from '@ikhimi/ui/components'
import { AppHeader } from '@/components/AppHeader'
import { getT } from '@/i18n/server'
import { teacherEarnings } from '@/server/earnings'
import { getPricing } from '@/server/pricing'
import { getSession } from '@/server/request'

/** A teacher's earnings: their share when their own students buy Pro or VIP themselves, and of their course sales (DECISIONS.md AZ, BL) */
export default async function Earnings() {
  const session = await getSession()
  if (!session || session.user.role !== 'teacher') redirect('/signin')
  const { t } = await getT()
  const db = getDb()
  const [e, pricing] = await Promise.all([teacherEarnings(db, session.user.id), getPricing(db)])

  return (
    <>
      <AppHeader />
      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8">
        <div>
          <h1 className="t-display-2">{t('earnings.title')}</h1>
          <p className="t-body-lg mt-2 text-ink-700">{t('earnings.lead', { n: pricing.teacherCommission })}</p>
          <p className="t-body mt-1 text-ink-700">{t('courseSale.earningsLead', { n: CONFIG.courses.teacherSharePercent })}</p>
        </div>

        <section className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <StatTile value={formatKrw(e.monthKrw)} label={t('earnings.month')} />
          <StatTile value={formatKrw(e.totalKrw)} label={t('earnings.total')} />
          <StatTile value={e.students} label={t('earnings.students')} />
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="t-h1">{t('earnings.recent')}</h2>
          {e.recent.length === 0 ? (
            <p className="t-body rounded-2xl border-2 border-paper-300 bg-paper-50 p-4 text-ink-500">{t('earnings.none')}</p>
          ) : (
            <ul className="overflow-hidden rounded-2xl border-2 border-paper-300 bg-paper-50">
              {e.recent.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-paper-300 px-4 py-3 last:border-b-0">
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="t-body font-medium">{r.student ?? '—'}</span>
                    <span className="t-small t-num text-ink-500">
                      {formatDate(r.at)} · {r.course ? `📚 ${r.course}` : t('plans.monthsN', { n: r.months ?? 1 })} · {t('course.priceValue', { price: formatKrw(r.amountKrw) })}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    {r.course ? <Badge tone="published">{t('courseSale.badge')}</Badge> : <Badge tone={r.plan === 'vip' ? 'orange' : 'neutral'}>{t(`plans.name.${r.plan}` as MessageKey)}</Badge>}
                    <span className="t-h3 t-num text-success-600">+{formatKrw(r.commissionKrw)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="t-small text-ink-500">{t('earnings.payout')}</p>
        </section>
      </main>
    </>
  )
}
