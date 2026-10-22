import { ArrowLeft, ArrowRight, BookOpenCheck, CheckCircle2, Lock } from 'lucide-react'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getDb } from '@ikhimi/db'
import { ICON } from '@ikhimi/ui/components'
import { AppHeader } from '@/components/AppHeader'
import { getT } from '@/i18n/server'
import { canView, courseBySlug, coursePage } from '@/server/courses'
import { getSession } from '@/server/request'

/** One lesson: the video (YouTube/Vimeo embed), the teacher's notes, and the lesson's homework. */
export default async function LessonPage({ params }: { params: Promise<{ slug: string; lessonId: string }> }) {
  const { slug, lessonId } = await params
  const db = getDb()
  const c = await courseBySlug(db, slug)
  if (!c) notFound()
  const session = await getSession()
  const page = await coursePage(db, c, session?.user.id ?? null)
  if (!canView(c, page.access)) notFound()
  const i = page.lessons.findIndex((l) => l.id === lessonId)
  const l = page.lessons[i]
  if (!l) notFound()
  if (!l.enter) redirect(`/course/${slug}`)
  const { t } = await getT()
  const prev = page.lessons.slice(0, i).reverse().find((x) => x.enter)
  const next = page.lessons.slice(i + 1).find((x) => x.enter)
  const hwHref = l.homework ? (session ? `/t/${l.homework.slug}` : `/signin?as=student&next=${encodeURIComponent(`/t/${l.homework.slug}`)}`) : null

  return (
    <>
      <AppHeader />
      <main className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-6 pb-20">
        <Link href={`/course/${slug}`} className="t-small inline-flex items-center gap-1 self-start font-medium text-ink-500 hover:text-ink-800">
          <ArrowLeft size={16} strokeWidth={ICON.strokeWidth} aria-hidden /> {c.title}
        </Link>
        <div>
          <p className="t-caption text-ink-500">
            {l.n} / {page.lessons.length}
          </p>
          <h1 className="t-display-2 mt-1">{l.title}</h1>
        </div>
        {l.video && (
          <div className="aspect-video w-full overflow-hidden rounded-lg bg-ink-900 shadow-e2">
            <iframe
              src={l.video.embedUrl}
              title={l.title}
              className="size-full"
              allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
            />
          </div>
        )}
        {/* A paid course before buying: the video and notes open with the course, the homework's free part now */}
        {!l.open && (
          <Link href={`/course/${slug}`} className="t-body flex items-start gap-3 rounded-lg border border-paper-300 bg-paper-100 p-4 text-ink-700 hover:bg-paper-200">
            <Lock size={20} strokeWidth={ICON.strokeWidth} className="mt-0.5 shrink-0 text-orange-700" aria-hidden />
            <span>
              {t('courseSale.lessonLocked')} <span className="font-semibold text-orange-700 underline underline-offset-2">{t('courseSale.see')}</span>
            </span>
          </Link>
        )}
        {l.note && <div className="t-body-lg measure whitespace-pre-line rounded-lg border border-paper-300 bg-paper-50 p-4 text-ink-700">{l.note}</div>}
        {l.homework && hwHref && (
          <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-l-4 border-paper-300 border-l-orange-500 bg-paper-50 p-4">
            <span className="flex min-w-0 flex-col">
              <span className="t-caption text-ink-500">{t('lesson.homework')}</span>
              <span className="t-h3 truncate">{l.homework.title}</span>
              {l.homework.done && (
                <span className="t-small inline-flex items-center gap-1 text-success-600">
                  <CheckCircle2 size={16} strokeWidth={ICON.strokeWidth} aria-hidden /> {t('course.homeworkDone', { percent: Math.round(l.homework.percent ?? 0) })}
                </span>
              )}
            </span>
            <Link href={hwHref} className={`btn ${l.homework.done ? 'btn-secondary' : 'btn-primary'} btn-md`}>
              <span className="btn-label">
                <BookOpenCheck size={18} strokeWidth={ICON.strokeWidth} aria-hidden /> {t('course.doHomework')}
              </span>
            </Link>
          </section>
        )}
        <nav className="mt-2 flex justify-between gap-2">
          {prev ? (
            <Link href={`/course/${slug}/${prev.id}`} className="btn btn-ghost btn-md">
              <span className="btn-label">
                <ArrowLeft size={18} strokeWidth={ICON.strokeWidth} aria-hidden /> {t('course.prev')}
              </span>
            </Link>
          ) : (
            <span />
          )}
          {next ? (
            <Link href={`/course/${slug}/${next.id}`} className="btn btn-secondary btn-md">
              <span className="btn-label">
                {t('course.next')} <ArrowRight size={18} strokeWidth={ICON.strokeWidth} aria-hidden />
              </span>
            </Link>
          ) : (
            <Link href={`/course/${slug}`} className="btn btn-secondary btn-md">
              <span className="btn-label">{t('course.backToCourse')}</span>
            </Link>
          )}
        </nav>
      </main>
    </>
  )
}
