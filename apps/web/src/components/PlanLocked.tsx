import { Lock } from 'lucide-react'
import type { PaidPlan } from '@ikhimi/ai'
import { ButtonLink, ICON } from '@ikhimi/ui/components'
import { AppHeader } from '@/components/AppHeader'
import { getT } from '@/i18n/server'
import { isStoreApp } from '@/server/store-app'

/** A homework with nothing on the student's plan: what it holds, and the way to the plans or the course (never an empty page) */
export async function PlanLockedHomework({ title, locked, course = null }: { title: string; locked: Record<PaidPlan, number>; course?: { slug: string; title: string } | null }) {
  const { t } = await getT()
  const need: PaidPlan = locked.pro ? 'pro' : 'vip'
  // The Google Play app points to no purchase
  const store = await isStoreApp()
  return (
    <>
      <AppHeader />
      <main className="mx-auto flex max-w-lg flex-col items-center gap-4 px-4 py-12 text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-orange-100 text-orange-700">
          <Lock size={28} strokeWidth={ICON.strokeWidth} aria-hidden />
        </span>
        <h1 className="t-h1">{title}</h1>
        <p className="t-body-lg text-ink-700">
          {course
            ? t('courseSale.homeworkNeeds', { n: locked.pro + locked.vip, course: course.title })
            : t(need === 'pro' ? 'plans.homeworkNeedsPro' : 'plans.homeworkNeedsVip', { n: locked.pro + locked.vip })}
        </p>
        {!store && (
          <ButtonLink href={course ? `/course/${course.slug}` : '/plans'} size="lg">
            {course ? t('courseSale.see') : t('plans.see')}
          </ButtonLink>
        )}
      </main>
    </>
  )
}
