'use client'
import { Lock } from 'lucide-react'
import Link from 'next/link'
import type { PaidPlan } from '@ikhimi/ai'
import { ICON } from '@ikhimi/ui/components'
import { useI18n } from '@/i18n/client'

/**
 * One quiet line: how many more tasks this homework has on a better plan, and where to see the plans (not in the Play
 * app). A paid course's lesson not bought yet: they open with the course, and the link goes to it.
 */
export function PlanTeaser({
  locked,
  course = null,
  className = '',
  store = false,
}: {
  locked: Record<PaidPlan, number>
  course?: { slug: string; title: string } | null
  className?: string
  store?: boolean
}) {
  const { t } = useI18n()
  if (!locked.pro && !locked.vip) return null
  if (course) {
    return (
      <p className={`t-small flex items-start gap-2 rounded-md border border-paper-300 bg-paper-50 px-3 py-2 text-ink-700 ${className}`}>
        <Lock size={16} strokeWidth={ICON.strokeWidth} className="mt-0.5 shrink-0 text-orange-700" aria-hidden />
        <span>
          {t('courseSale.teaser', { n: locked.pro + locked.vip, course: course.title })}{' '}
          {!store && (
            <Link href={`/course/${course.slug}`} className="font-semibold whitespace-nowrap text-orange-700 underline underline-offset-2">
              {t('courseSale.see')}
            </Link>
          )}
        </span>
      </p>
    )
  }
  const parts = [locked.pro ? t('plans.lockedPro', { n: locked.pro }) : '', locked.vip ? t('plans.lockedVip', { n: locked.vip }) : ''].filter(Boolean)
  return (
    <p className={`t-small flex items-start gap-2 rounded-md border border-paper-300 bg-paper-50 px-3 py-2 text-ink-700 ${className}`}>
      <Lock size={16} strokeWidth={ICON.strokeWidth} className="mt-0.5 shrink-0 text-orange-700" aria-hidden />
      <span>
        {t('plans.teaserLead')} {parts.join(' · ')}.{' '}
        {!store && (
          <Link href="/plans" className="font-semibold whitespace-nowrap text-orange-700 underline underline-offset-2">
            {t('plans.see')}
          </Link>
        )}
      </span>
    </p>
  )
}
