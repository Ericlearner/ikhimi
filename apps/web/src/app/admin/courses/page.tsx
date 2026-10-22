import { ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { getDb } from '@ikhimi/db'
import { formatDate, formatKrw } from '@ikhimi/i18n'
import { Badge, ICON } from '@ikhimi/ui/components'
import { getT } from '@/i18n/server'
import { pageStaff } from '@/server/admin/guard'
import { reviewCourses } from '@/server/admin/stats'

const TONE = { pending: 'orange', returned: 'neutral', approved: 'published', draft: 'neutral' } as const

/** Courses teachers want to open to others (DECISIONS.md BL): approve them here, waiting ones first */
export default async function AdminCourses() {
  const db = getDb()
  await pageStaff(db, 'content')
  const { t } = await getT()
  const rows = await reviewCourses(db)
  const waiting = rows.filter((r) => r.c.reviewStatus === 'pending').length
  return (
    <div className="flex flex-col gap-4">
      <p className="t-body text-ink-700">{waiting ? t('adminCourses.waiting', { n: waiting }) : t('adminCourses.noneWaiting')}</p>
      {rows.length === 0 ? (
        <p className="t-body text-ink-500">{t('adminCourses.empty')}</p>
      ) : (
        <ul className="overflow-hidden rounded-lg border border-paper-300 bg-paper-50">
          {rows.map(({ c, teacherName }) => (
            <li key={c.id} className="border-b border-paper-300 last:border-b-0">
              <Link href={`/admin/courses/${c.id}`} className="press flex items-center gap-3 px-4 py-3 hover:bg-paper-100">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="t-body truncate font-medium">{c.title}</span>
                  <span className="t-small t-num text-ink-500">
                    {teacherName ?? '—'} · {t('course.lessonCount', { n: c.lessonCount })} ·{' '}
                    {c.priceKrw ? t('course.priceValue', { price: formatKrw(c.priceKrw) }) : t('courseSale.planCovered')}
                    {c.submittedAt && ` · ${formatDate(c.submittedAt)}`}
                  </span>
                </span>
                <Badge tone={TONE[c.reviewStatus]}>{t(`courseReview.status.${c.reviewStatus}`)}</Badge>
                <ChevronRight size={18} strokeWidth={ICON.strokeWidth} className="shrink-0 text-ink-400" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
