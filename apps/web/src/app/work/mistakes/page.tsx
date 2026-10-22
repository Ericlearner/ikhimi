import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getDb } from '@ikhimi/db'
import { formatDate } from '@ikhimi/i18n'
import { TaskIcon, TemperatureProvider } from '@ikhimi/ui/components'
import { AppHeader } from '@/components/AppHeader'
import { CARD, CARD_HOT } from '@/components/work/bands'
import { getT } from '@/i18n/server'
import { getSession } from '@/server/request'
import { reviewSummary, syncReview } from '@/server/review'
import { isStoreApp } from '@/server/store-app'

export const metadata = { title: '오답 노트 — 익히미' }

/**
 * The mistakes page (the apps' "오답 노트" tab, server/review.ts): what's due now and the way into the full-screen
 * review (/work/review, which comes back here), when the next ones come back, how many are learned, and how many wait
 * for a better plan.
 */
export default async function MistakesPage() {
  const session = await getSession()
  if (!session) redirect('/signin?as=student&next=/work/mistakes')
  const db = getDb()
  await syncReview(db, session.user.id)
  const review = await reviewSummary(db, session.user.id)
  const { t } = await getT()
  const lockedTotal = review.locked.pro + review.locked.vip
  const nothingYet = review.due === 0 && !review.next && review.learned === 0 && lockedTotal === 0
  // The stores' apps don't sell plans in the app
  const canBuy = !(await isStoreApp())

  return (
    <TemperatureProvider value="warm">
      <AppHeader />
      <main className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6 pb-24">
        <h1 className="t-display-2">{t('review.title')}</h1>

        {nothingYet ? (
          <div className={`flex flex-col items-center gap-3 p-6 text-center ${CARD}`}>
            <TaskIcon name="owl" size={64} />
            <p className="t-body text-ink-500">{t('review.empty')}</p>
          </div>
        ) : (
          <section className={`flex flex-col items-start gap-4 p-5 ${review.due > 0 ? CARD_HOT : CARD}`}>
            <div className="flex items-center gap-3">
              <TaskIcon name="owl" size={56} />
              <p className="t-h2">
                {review.due > 0 ? t('review.due', { n: review.due }) : review.next ? t('review.next', { date: formatDate(review.next) }) : t('review.noneDue')}
              </p>
            </div>
            {review.due > 0 && (
              <Link href="/work/review?from=mistakes" className="btn btn-primary btn-xl w-full">
                <span className="btn-label">{t('review.start')} →</span>
              </Link>
            )}
            {review.due > 0 && review.next && <p className="t-small text-ink-500">{t('review.next', { date: formatDate(review.next) })}</p>}
          </section>
        )}

        {/* Mistakes in items the plan doesn't cover: waiting, not lost */}
        {lockedTotal > 0 && (
          <section className={`flex items-center gap-3 p-4 ${CARD}`}>
            <span className="text-2xl" aria-hidden>
              🔒
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              {review.locked.pro > 0 && <span className="t-body font-semibold">{t('plans.lockedPro', { n: review.locked.pro })}</span>}
              {review.locked.vip > 0 && <span className="t-body font-semibold">{t('plans.lockedVip', { n: review.locked.vip })}</span>}
            </span>
            {canBuy && (
              <Link href="/plans" className="btn btn-secondary btn-sm shrink-0">
                <span className="btn-label">{t('plans.see')}</span>
              </Link>
            )}
          </section>
        )}

        <div className="grid grid-cols-2 gap-2">
          <div className={`flex flex-col items-center gap-1 p-3 text-center ${CARD}`}>
            <TaskIcon name="brain" size={28} />
            <span className="t-h2 t-num">{review.due}</span>
            <span className="t-small text-ink-500">{t('review.statDue')}</span>
          </div>
          <div className={`flex flex-col items-center gap-1 p-3 text-center ${CARD}`}>
            <TaskIcon name="check-mark-button" size={28} />
            <span className="t-h2 t-num">{review.learned}</span>
            <span className="t-small text-ink-500">{t('review.statLearned')}</span>
          </div>
        </div>

        <p className="t-small measure text-ink-500">{t('review.how')}</p>
      </main>
    </TemperatureProvider>
  )
}
