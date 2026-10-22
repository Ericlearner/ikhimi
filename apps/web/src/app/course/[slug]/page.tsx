import { BookOpenCheck, CheckCircle2, Lock, PlayCircle } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getDb } from '@ikhimi/db'
import { formatKrw } from '@ikhimi/i18n'
import { Badge, ICON } from '@ikhimi/ui/components'
import { AppHeader } from '@/components/AppHeader'
import { AutoRefresh } from '@/components/AutoRefresh'
import { CourseCta } from '@/components/CourseCta'
import { getT } from '@/i18n/server'
import { canView, courseBySlug, coursePage, isPaid } from '@/server/courses'
import { enabledProviders } from '@/server/payments/providers'
import { getSession } from '@/server/request'
import { isStoreApp } from '@/server/store-app'

/** A course's public page: what it is, its lessons, and the one action: start, continue, or (a paid course) buy. */
export default async function CourseLanding({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ paid?: string }> }) {
  const { slug } = await params
  const justPaid = (await searchParams).paid === '1'
  const db = getDb()
  const c = await courseBySlug(db, slug)
  if (!c) notFound()
  const session = await getSession()
  const page = await coursePage(db, c, session?.user.id ?? null)
  if (!canView(c, page.access)) notFound()
  const { t } = await getT()
  const firstOpen = page.lessons.find((l) => l.enter) ?? null
  const store = await isStoreApp()

  return (
    <>
      <AppHeader />
      {justPaid && page.buy && <AutoRefresh seconds={5} />}
      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8 pb-20">
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {c.cefrLevel && <Badge tone="orange">{c.cefrLevel}</Badge>}
            <Badge>{t('course.lessonCount', { n: page.lessons.length })}</Badge>
            {isPaid(c) && !store && <Badge tone="published">{t('course.priceValue', { price: formatKrw(c.priceKrw!) })}</Badge>}
          </div>
          <h1 className="t-display-1">{c.title}</h1>
          {page.teacher.name && <p className="t-body text-ink-500">{t('course.byTeacher', { name: page.teacher.name })}</p>}
          {c.description && <p className="t-body-lg measure whitespace-pre-line text-ink-700">{c.description}</p>}
          <hr className="rule-gold w-16" />
          <CourseCta
            courseId={c.id}
            slug={c.slug}
            access={page.access}
            signedIn={!!session}
            firstLessonId={firstOpen?.id ?? page.lessons[0]?.id ?? null}
            buy={page.buy}
            priceKrw={c.priceKrw}
            providers={enabledProviders().map((p) => ({ id: p.id, label: p.label }))}
            store={store}
            justPaid={justPaid}
          />
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="t-h1">{t('course.lessons')}</h2>
          <ol className="overflow-hidden rounded-lg border border-paper-300 bg-paper-50">
            {page.lessons.map((l) => {
              const row = (
                <>
                  <span className="t-num t-h3 w-7 shrink-0 text-ink-500">{l.n}</span>
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="t-body font-medium">{l.title}</span>
                    <span className="flex flex-wrap gap-1.5">
                      {l.hasVideo && <Badge icon={<PlayCircle size={14} strokeWidth={ICON.strokeWidth} aria-hidden />}>{t('lesson.video.badge')}</Badge>}
                      {l.hasHomework && <Badge icon={<BookOpenCheck size={14} strokeWidth={ICON.strokeWidth} aria-hidden />}>{t('lesson.homework')}</Badge>}
                    </span>
                  </span>
                  {l.homework?.done ? (
                    <CheckCircle2 size={20} strokeWidth={ICON.strokeWidth} className="shrink-0 text-success-600" aria-label={t('course.homeworkDone', { percent: Math.round(l.homework.percent ?? 0) })} />
                  ) : !l.open ? (
                    <span className="flex shrink-0 items-center gap-1.5">
                      {l.enter && <span className="t-small text-ink-500">{t('courseSale.freePart')}</span>}
                      <Lock size={18} strokeWidth={ICON.strokeWidth} className="text-ink-400" aria-label={t('course.locked')} />
                    </span>
                  ) : null}
                </>
              )
              return (
                <li key={l.id} className="border-b border-paper-300 last:border-b-0">
                  {l.enter ? (
                    <Link href={`/course/${c.slug}/${l.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-paper-200">
                      {row}
                    </Link>
                  ) : (
                    <div className="flex items-center gap-3 px-4 py-3 opacity-80">{row}</div>
                  )}
                </li>
              )
            })}
          </ol>
        </section>
      </main>
    </>
  )
}
