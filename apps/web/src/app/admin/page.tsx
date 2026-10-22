import Link from 'next/link'
import { getDb } from '@ikhimi/db'
import { formatKrw } from '@ikhimi/i18n'
import { StatTile } from '@ikhimi/ui/components'
import { Section, seconds, usd } from '@/components/admin/Bars'
import { getT } from '@/i18n/server'
import { usdToKrw } from '@/server/ai-usage'
import { pageStaff } from '@/server/admin/guard'
import { can } from '@/server/admin/staff'
import { businessStats, healthStats, moneyStats } from '@/server/admin/stats'

/** The first screen: today at a glance, only the parts this staff member may see */
export default async function AdminHome() {
  const db = getDb()
  const { access } = await pageStaff(db)
  const { t } = await getT()
  const [health, biz, money] = await Promise.all([
    can(access, 'health') ? healthStats(db, 7) : null,
    can(access, 'business') ? businessStats(db, 30) : null,
    can(access, 'money') ? moneyStats(db, 30) : null,
  ])
  const today = health?.days.at(-1)
  const week = health?.days.reduce((s, d) => ({ total: s.total + d.total, failed: s.failed + d.failed }), { total: 0, failed: 0 })

  return (
    <div className="flex flex-col gap-8">
      {health && today && week && (
        <Section title={t('admin.overview.today')} aside={<Link href="/admin/health" className="t-small font-medium text-orange-600 hover:underline">{t('admin.more')}</Link>}>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <StatTile value={today.total} label={t('admin.health.generations')} hint={t('admin.health.weekTotal', { n: week.total })} />
            <StatTile
              value={<span className={today.failed ? 'text-error-600' : ''}>{today.failed}</span>}
              label={t('admin.health.failed')}
              hint={week.total ? t('admin.health.weekFailRate', { n: Math.round((week.failed / week.total) * 100) }) : undefined}
            />
            <StatTile value={seconds(today.avgMs)} label={t('admin.health.avgTime')} hint={today.p90Ms ? t('admin.health.p90', { s: seconds(today.p90Ms) }) : undefined} />
            <StatTile value={usd(health.ai.totalUsd)} label={t('admin.health.aiCost7')} hint={`≈ ${formatKrw(Math.round(health.ai.totalUsd * usdToKrw()))}원`} />
          </div>
        </Section>
      )}
      {biz && (
        <Section title={t('admin.overview.people')} aside={<Link href="/admin/business" className="t-small font-medium text-orange-600 hover:underline">{t('admin.more')}</Link>}>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <StatTile value={biz.users.teachers} label={t('admin.biz.teachers')} hint={t('admin.biz.newWeek', { n: biz.users.newTeachersWeek })} />
            <StatTile value={biz.users.students} label={t('admin.biz.students')} hint={t('admin.biz.newWeek', { n: biz.users.newStudentsWeek })} />
            <StatTile value={biz.homework.createdWeek} label={t('admin.biz.homeworkWeek')} />
            <StatTile value={biz.attempts.submittedWeek} label={t('admin.biz.submittedWeek')} />
          </div>
        </Section>
      )}
      {money && (
        <Section title={t('admin.nav.money')} aside={<Link href="/admin/money" className="t-small font-medium text-orange-600 hover:underline">{t('admin.more')}</Link>}>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <StatTile value={`${formatKrw(money.revenueKrw)}`} label={t('admin.money.revenue30')} />
            <StatTile value={money.subscriptions.paidActive} label={t('admin.money.paidActive')} />
          </div>
        </Section>
      )}
      {!health && !biz && !money && <p className="t-body text-ink-500">{t('admin.overview.pickTab')}</p>}
    </div>
  )
}
