import { Crown, Zap } from 'lucide-react'
import { redirect } from 'next/navigation'
import { and, CONFIG, desc, eq, getDb, groups, inArray, isNull, planPackages } from '@ikhimi/db'
import { formatDate, type MessageKey } from '@ikhimi/i18n'
import { Badge } from '@ikhimi/ui/components'
import { AppHeader } from '@/components/AppHeader'
import { AutoRefresh } from '@/components/AutoRefresh'
import { PackageGroup } from '@/components/PackageGroup'
import { PlanCheckout } from '@/components/PlanCheckout'
import { getT } from '@/i18n/server'
import { enabledProviders, payInTelegram } from '@/server/payments/providers'
import { supportBotUrl } from '@/content/site'
import { seatsUsed } from '@/server/plans'
import { getPricing } from '@/server/pricing'
import { getSession } from '@/server/request'
import { isStoreApp } from '@/server/store-app'

/**
 * A teacher's packages of student plans: Pro or VIP places for the students of a class. Teachers create with
 * everything for free; a package is how they give their students the paid plans (and include it in their price).
 */
export default async function Packages({ searchParams }: { searchParams: Promise<{ paid?: string }> }) {
  // Nothing is sold in the Google Play app (server/store-app.ts)
  if (await isStoreApp()) redirect('/app')
  const session = await getSession()
  if (!session || session.user.role !== 'teacher') redirect('/signin')
  const { t } = await getT()
  const db = getDb()
  const justPaid = (await searchParams).paid === '1'
  const myGroups = await db
    .select({ id: groups.id, name: groups.name })
    .from(groups)
    .where(and(eq(groups.teacherId, session.user.id), isNull(groups.archivedAt), isNull(groups.deletedAt)))
  const packs = await db
    .select()
    .from(planPackages)
    .where(and(eq(planPackages.teacherId, session.user.id), inArray(planPackages.status, ['active', 'pending'])))
    .orderBy(desc(planPackages.createdAt))
  const used = await seatsUsed(db, packs.map((p) => p.id))
  const now = new Date()

  return (
    <>
      <AppHeader />
      {justPaid && <AutoRefresh seconds={5} />}
      <main className="mx-auto flex max-w-4xl flex-col gap-8 px-4 py-8">
        <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
          <h1 className="t-display-2">{t('packages.title')}</h1>
          <p className="t-body-lg mt-2 text-ink-700">{t('packages.lead')}</p>
          {justPaid && <p className="t-body mt-2 text-ink-500">{t('plans.paidPending')}</p>}
        </div>

        {packs.length > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className="t-h1">{t('packages.yours')}</h2>
            <div className="grid gap-3 md:grid-cols-2">
              {packs.map((p) => {
                const ended = !!p.periodEnd && p.periodEnd <= now
                const vip = p.plan === 'vip'
                const taken = used[p.id] ?? 0
                return (
                  <div
                    key={p.id}
                    className={`flex flex-col gap-3 rounded-[var(--r-lg)] border p-4 shadow-[var(--e-1)] ${vip ? 'border-[color-mix(in_srgb,var(--vip-gold)_45%,transparent)] bg-[var(--vip-bg)] text-[var(--vip-text)]' : 'border-paper-300 bg-paper-50'} ${ended ? 'opacity-70' : ''}`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`inline-flex items-center gap-1.5 t-h2 ${vip ? 'text-[var(--vip-gold)]' : 'text-orange-700'}`}>
                        {vip ? <Crown size={20} aria-hidden /> : <Zap size={20} aria-hidden />}
                        {t(`plans.name.${p.plan}` as MessageKey)}
                      </span>
                      <span className="ml-auto">
                        {p.status === 'pending' ? (
                          <Badge tone="warn">{t('packages.pending')}</Badge>
                        ) : ended ? (
                          <Badge tone="neutral">{t('packages.ended')}</Badge>
                        ) : (
                          p.periodEnd && <Badge tone="success">{t('plans.until', { date: formatDate(p.periodEnd) })}</Badge>
                        )}
                      </span>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <span className={`t-body t-num ${vip ? 'text-[var(--vip-soft)]' : 'text-ink-700'}`}>{t('packages.seatsUsed', { used: taken, total: p.seats })}</span>
                      <div className={`h-2 overflow-hidden rounded-full ${vip ? 'bg-white/10' : 'bg-paper-200'}`} aria-hidden>
                        <div className={`h-full rounded-full ${vip ? 'bg-[var(--vip-gold)]' : 'bg-orange-500'}`} style={{ width: `${Math.min(100, (taken / Math.max(1, p.seats)) * 100)}%` }} />
                      </div>
                    </div>
                    {p.status === 'active' && !ended && (
                      <div className={vip ? 'rounded-md bg-paper-50 p-2' : ''}>
                        <PackageGroup packageId={p.id} groupId={p.groupId} groups={myGroups} />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        )}
        <section className="flex flex-col gap-3">
          {packs.length > 0 && <h2 className="t-h1">{t('packages.buy')}</h2>}
          <PlanCheckout
            mode="package"
            pricing={await getPricing(db)}
            maxSeats={CONFIG.plans.maxSeats}
            providers={enabledProviders().map((p) => ({ id: p.id, label: p.label }))}
            telegramBot={payInTelegram()}
            supportUrl={supportBotUrl()}
            groups={myGroups}
          />
          <p className="t-small text-center text-ink-500">{t('packages.howSeats')}</p>
        </section>
      </main>
    </>
  )
}
