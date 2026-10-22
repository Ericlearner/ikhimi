import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { and, assignments, CONFIG, courseRuns, desc, eq, getDb, groups, isNull } from '@ikhimi/db'
import { ICON, StatTile } from '@ikhimi/ui/components'
import { AppHeader } from '@/components/AppHeader'
import { CourseBuilder } from '@/components/CourseBuilder'
import { getT } from '@/i18n/server'
import { courseStats, loadLessons, ownedCourse } from '@/server/courses'
import { getSession } from '@/server/request'

export default async function CoursePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session || session.user.role !== 'teacher') redirect('/signin')
  const db = getDb()
  const c = await ownedCourse(db, session.user.id, (await params).id)
  if (!c) notFound()
  const { t } = await getT()
  const [lessons, homework, teacherGroups, linked, stats] = await Promise.all([
    loadLessons(db, c.id),
    db
      .select({ id: assignments.id, title: assignments.title, publishedAt: assignments.publishedAt })
      .from(assignments)
      .where(and(eq(assignments.teacherId, c.teacherId), eq(assignments.status, 'published'), isNull(assignments.deletedAt)))
      .orderBy(desc(assignments.publishedAt))
      .limit(200),
    db
      .select({ id: groups.id, name: groups.name })
      .from(groups)
      .where(and(eq(groups.teacherId, c.teacherId), isNull(groups.archivedAt), isNull(groups.deletedAt))),
    db.select({ groupId: courseRuns.groupId }).from(courseRuns).where(eq(courseRuns.courseId, c.id)),
    courseStats(db, [c.id]),
  ])
  const s = stats.get(c.id) ?? { students: 0 }
  const origin = (process.env.PUBLIC_ORIGIN ?? 'https://ikhimi.kr').replace(/\/$/, '')

  return (
    <>
      <AppHeader />
      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6 pb-24">
        <Link href="/app/courses" className="t-small inline-flex items-center gap-1 self-start font-medium text-ink-500 hover:text-ink-800">
          <ArrowLeft size={16} strokeWidth={ICON.strokeWidth} aria-hidden /> {t('nav.courses')}
        </Link>
        <div>
          <h1 className="t-display-2">{c.title}</h1>
        </div>
        <section className="grid grid-cols-2 gap-2">
          <StatTile value={lessons.length} label={t('course.lessons')} />
          <StatTile value={s.students} label={t('course.students')} />
        </section>
        <CourseBuilder
          course={{
            id: c.id,
            slug: c.slug,
            url: `${origin}/course/${c.slug}`,
            title: c.title,
            description: c.description ?? '',
            cefrLevel: c.cefrLevel ?? '',
            visibility: c.visibility,
            paid: (c.priceKrw ?? 0) > 0,
            price: c.priceKrw ? c.priceKrw.toLocaleString('ru-RU') : '',
          }}
          review={{ status: c.reviewStatus, note: c.reviewNote }}
          rules={{ minPriceKrw: CONFIG.courses.minPriceKrw, maxPriceKrw: CONFIG.courses.maxPriceKrw, sharePercent: CONFIG.courses.teacherSharePercent }}
          lessons={lessons.map((l) => ({
            id: l.id,
            title: l.title,
            videoUrl: l.videoUrl ?? '',
            videoNote: l.videoNote ?? '',
            assignmentId: l.assignmentTemplateId ?? '',
            isPreview: l.isPreview,
          }))}
          homework={homework.map((h) => ({ id: h.id, title: h.title }))}
          groups={teacherGroups}
          linkedGroupIds={linked.map((l) => l.groupId)}
        />
      </main>
    </>
  )
}
