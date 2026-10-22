import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getDb } from '@ikhimi/db'
import { formatDate, formatKrw, type MessageKey } from '@ikhimi/i18n'
import { AppHeader } from '@/components/AppHeader'
import { AutoRefresh } from '@/components/AutoRefresh'
import { PlanCheckout } from '@/components/PlanCheckout'
import { getT } from '@/i18n/server'
import { enabledProviders } from '@/server/payments/providers'
import { studentPlanInfo } from '@/server/plans'
import { getPricing } from '@/server/pricing'
import { getSession } from '@/server/request'
import { isStoreApp } from '@/server/store-app'

/** The plans: what each gives, the student's own plan, and buying one */
export default async function Plans({ searchParams }: { searchParams: Promise<{ paid?: string }> }) {
  // Nothing is sold in the Google Play app (server/store-app.ts)
  if (await isStoreApp()) redirect('/work')
  const session = await getSession()
  const { t } = await getT()
  const justPaid = (await searchParams).paid === '1'
  const mine = session ? await studentPlanInfo(getDb(), session.user.id) : null
  const pricing = await getPricing(getDb())

  return (
    <>
      <AppHeader />
      {justPaid && <AutoRefresh seconds={5} />}
      <main className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-8">
        <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
          <h1 className="t-display-2">{t('plans.title')}</h1>
          <p className="t-body-lg mt-2 text-ink-700">{t('plans.lead')}</p>
          <hr className="rule-gold mt-4 w-12" />
          {mine && (
            <p className="t-body mt-4 rounded-full border border-paper-300 bg-paper-50 px-4 py-1.5 text-ink-700">
              {t('plans.yours')}: <b>{t(`plans.name.${mine.plan}` as MessageKey)}</b>
              {mine.until ? ` · ${t('plans.until', { date: formatDate(mine.until) })}` : ''}
              {mine.fromPackage ? ` · ${t('plans.fromTeacher')}` : ''}
            </p>
          )}
          {justPaid && <p className="t-body mt-2 text-ink-500">{t('plans.paidPending')}</p>}
        </div>

        <PlanCheckout
          mode="student"
          pricing={pricing}
          providers={enabledProviders().map((p) => ({ id: p.id, label: p.label }))}
          initialPlan={mine?.plan === 'pro' ? 'vip' : 'pro'}
          current={mine?.plan ?? null}
          signInHref={session ? undefined : '/signin?next=%2Ftariflar'}
        />

        {session?.user.role === 'teacher' && (
          <p className="t-body text-center text-ink-700">
            {t('plans.teacherHint')}{' '}
            <Link href="/app/packages" className="font-semibold text-orange-700 underline">
              {t('nav.packages')}
            </Link>
          </p>
        )}
      </main>
    </>
  )
}
