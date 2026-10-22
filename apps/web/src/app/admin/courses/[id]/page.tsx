import { ArrowLeft, BookOpenCheck, Eye, Video } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getDb } from '@ikhimi/db'
import { formatDate, formatKrw } from '@ikhimi/i18n'
import { Badge, ICON } from '@ikhimi/ui/components'
import { panel } from '@/components/admin/Bars'
import { CourseReviewActions } from '@/components/admin/CourseReviewActions'
import { getT } from '@/i18n/server'
import { parseVideoUrl } from '@/lib/video'
import { pageStaff } from '@/server/admin/guard'
import { reviewCourseDetail } from '@/server/admin/stats'

/** One course as the admin checks it before it opens to others: every lesson's video, notes and homework */
export default async function AdminCourse({ params }: { params: Promise<{ id: string }> }) {
  const db = getDb()
  await pageStaff(db, 'content')
  const { t } = await getT()
  const d = await reviewCourseDetail(db, (await params).id)
  if (!d) notFound()
  const { c } = d
  return (
    <div className="flex flex-col gap-5">
      <Link href="/admin/courses" className="t-small inline-flex items-center gap-1 self-start font-medium text-ink-500 hover:text-ink-800">
        <ArrowLeft size={16} strokeWidth={ICON.strokeWidth} aria-hidden /> {t('admin.nav.courses')}
      </Link>
      <header className="flex flex-col gap-2">
        <h2 className="t-h1">{c.title}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={c.reviewStatus === 'approved' ? 'published' : c.reviewStatus === 'pending' ? 'orange' : 'neutral'}>{t(`courseReview.status.${c.reviewStatus}`)}</Badge>
          <Badge>{t(`course.visibility.${c.visibility}`)}</Badge>
          <Badge>{c.priceKrw ? t('course.priceValue', { price: formatKrw(c.priceKrw) }) : t('courseSale.planCovered')}</Badge>
          {c.cefrLevel && <Badge tone="orange">{c.cefrLevel}</Badge>}
        </div>
        <p className="t-small t-num text-ink-500">
          {d.teacherName ?? '—'} · {formatDate(c.createdAt)}
          {c.submittedAt && ` · ${t('adminCourses.sent', { date: formatDate(c.submittedAt) })}`}
          {d.sales.n > 0 && ` · ${t('adminCourses.sales', { n: d.sales.n, sum: formatKrw(d.sales.sumKrw) })}`}
        </p>
        {c.description && <p className="t-body measure whitespace-pre-line text-ink-700">{c.description}</p>}
        {c.reviewNote && <p className="t-small text-ink-500">{t('adminCourses.lastNote', { note: c.reviewNote })}</p>}
      </header>

      <CourseReviewActions courseId={c.id} status={c.reviewStatus} />

      <section className="flex flex-col gap-3">
        <h3 className="t-h2">{t('course.lessons')}</h3>
        {d.lessons.map(({ l, homework, items }) => {
          const video = parseVideoUrl(l.videoUrl)
          return (
            <div key={l.id} className={`${panel} flex flex-col gap-2`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="t-h3">
                  {l.orderIndex + 1}. {l.title}
                </span>
                {l.isPreview && (
                  <Badge tone="orange" icon={<Eye size={14} strokeWidth={ICON.strokeWidth} aria-hidden />}>
                    {t('lesson.preview')}
                  </Badge>
                )}
              </div>
              {video && (
                <div className="aspect-video w-full max-w-xl overflow-hidden rounded-md bg-ink-900">
                  <iframe src={video.embedUrl} title={l.title} className="size-full" allow="encrypted-media; picture-in-picture; fullscreen" allowFullScreen loading="lazy" />
                </div>
              )}
              {!video && l.videoUrl && (
                <p className="t-small flex items-center gap-1 text-ink-500">
                  <Video size={14} strokeWidth={ICON.strokeWidth} aria-hidden /> {l.videoUrl}
                </p>
              )}
              {l.videoNote && <p className="t-body measure whitespace-pre-line text-ink-700">{l.videoNote}</p>}
              {l.assignmentTemplateId && (
                <Link href={`/admin/content/${l.assignmentTemplateId}`} className="t-body inline-flex items-center gap-2 self-start font-medium text-orange-700 hover:underline">
                  <BookOpenCheck size={18} strokeWidth={ICON.strokeWidth} aria-hidden /> {homework ?? t('lesson.homework')} · {items} {t('admin.users.items')}
                </Link>
              )}
            </div>
          )
        })}
      </section>
    </div>
  )
}
