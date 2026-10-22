import { notFound, redirect } from 'next/navigation'
import { courses, eq, getDb } from '@ikhimi/db'
import { formatKrw, type MessageKey } from '@ikhimi/i18n'
import { AppHeader } from '@/components/AppHeader'
import { TestCheckout } from '@/components/TestCheckout'
import { getT } from '@/i18n/server'
import { loadPayment, payerId } from '@/server/payments/core'
import { testProvider } from '@/server/payments/providers'
import { getSession } from '@/server/request'

/** Pretend checkout page for the test provider (development, or PAYMENT_TEST_ENABLED=1). */
export default async function TestPay({ params }: { params: Promise<{ paymentId: string }> }) {
  if (!testProvider.enabled()) notFound()
  const session = await getSession()
  if (!session) redirect('/signin')
  const db = getDb()
  const row = await loadPayment(db, (await params).paymentId)
  if (!row || row.payment.provider !== 'test' || payerId(row) !== session.user.id) notFound()
  const courseId = row.subscription?.courseId
  const [c] = courseId ? await db.select().from(courses).where(eq(courses.id, courseId)).limit(1) : []
  const { t } = await getT()
  // What is being bought, and where the buyer goes back to
  const plan = row.pkg?.plan ?? row.subscription?.plan
  const what = c ? c.title : row.pkg ? t('plans.packageTitle', { plan: t(`plans.name.${row.pkg.plan}` as MessageKey), n: row.pkg.seats, months: row.pkg.months }) : t('plans.planTitle', { plan: t(`plans.name.${plan}` as MessageKey), months: row.subscription?.months ?? 1 })
  const back = c ? `/course/${c.slug}` : row.pkg ? '/app/packages' : '/plans'
  return (
    <>
      <AppHeader />
      <main className="mx-auto flex max-w-md flex-col gap-4 px-4 py-10">
        <h1 className="t-display-2">{t('pay.test.title')}</h1>
        <p className="t-body rounded-md border border-warn-600 bg-warn-100 px-4 py-3 text-warn-600">{t('pay.test.hint')}</p>
        <div className="rounded-lg border border-paper-300 bg-paper-50 p-4">
          <p className="t-h3">{what}</p>
          <p className="t-small mt-2 text-ink-500">{t('pay.amount')}</p>
          <p className="t-display-2 t-num">{t('course.priceValue', { price: formatKrw(row.payment.amountKrw) })}</p>
        </div>
        <TestCheckout paymentId={row.payment.id} back={back} status={row.payment.status} />
      </main>
    </>
  )
}
