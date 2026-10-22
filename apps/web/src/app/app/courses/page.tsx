import { ChevronRight, Users } from 'lucide-react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getDb } from '@ikhimi/db'
import { formatKrw } from '@ikhimi/i18n'
import { Badge, EmptyState, ICON } from '@ikhimi/ui/components'
import { AppHeader } from '@/components/AppHeader'
import { NewCourseForm } from '@/components/NewCourseForm'
import { getT } from '@/i18n/server'
import { teacherCourses } from '@/server/courses'
import { getSession } from '@/server/request'

/** A teacher's online courses: lessons (video + homework), approval, price, students. */
export default async function CoursesPage() {
  const session = await getSession()
  if (!session || session.user.role !== 'teacher') redirect('/signin')
  const { t } = await getT()
  const list = await teacherCourses(getDb(), session.user.id)
  return (
    <>
      <AppHeader />
      <main className="mx-auto flex max-w-4xl flex-col gap-5 px-4 py-6">
        <div>
          <h1 className="t-display-2">{t('nav.courses')}</h1>
        </div>
        <NewCourseForm />
        {list.length === 0 ? (
          <div className="rounded-2xl border-2 border-paper-300 bg-paper-50">
            <EmptyState illustration="book" title={t('course.empty')} />
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {list.map((c, i) => (
              <li key={c.id} style={{ ['--i' as string]: i }} className="card-enter">
                <Link href={`/app/courses/${c.id}`} className="press flex h-full flex-col gap-3 rounded-2xl border-2 border-paper-300 bg-paper-50 p-4 hover:bg-paper-200">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="t-h2">{c.title}</h2>
                    <ChevronRight size={20} strokeWidth={ICON.strokeWidth} className="mt-0.5 shrink-0 text-ink-400" aria-hidden />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge tone={c.visibility === 'private' ? 'neutral' : 'published'}>{t(`course.visibility.${c.visibility}`)}</Badge>
                    {c.visibility !== 'private' && c.reviewStatus !== 'approved' && (
                      <Badge tone={c.reviewStatus === 'returned' ? 'orange' : 'neutral'}>{t(`courseReview.status.${c.reviewStatus}`)}</Badge>
                    )}
                    {(c.priceKrw ?? 0) > 0 && <Badge>{t('course.priceValue', { price: formatKrw(c.priceKrw!) })}</Badge>}
                    {c.cefrLevel && <Badge tone="orange">{c.cefrLevel}</Badge>}
                  </div>
                  <dl className="t-small grid grid-cols-2 gap-2">
                    <div>
                      <dt className="text-ink-500">{t('course.lessons')}</dt>
                      <dd className="t-body t-num font-semibold">{c.lessonCount}</dd>
                    </div>
                    <div>
                      <dt className="text-ink-500">{t('course.students')}</dt>
                      <dd className="t-body t-num inline-flex items-center gap-1 font-semibold">
                        <Users size={16} strokeWidth={ICON.strokeWidth} aria-hidden /> {c.students}
                      </dd>
                    </div>
                  </dl>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  )
}
