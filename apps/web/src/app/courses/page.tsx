import { BookOpen, Users } from 'lucide-react'
import Link from 'next/link'
import { getDb } from '@ikhimi/db'
import { formatKrw } from '@ikhimi/i18n'
import { Badge, EmptyState, ICON } from '@ikhimi/ui/components'
import { AppHeader } from '@/components/AppHeader'
import { getT } from '@/i18n/server'
import { catalog } from '@/server/courses'
import { isStoreApp } from '@/server/store-app'

export const metadata = { title: '강좌 — 익히미' }

/** Public course catalog: anyone can browse, no sign-in needed. */
export default async function Catalog() {
  const { t } = await getT()
  const list = await catalog(getDb())
  // The store apps show no prices (nothing is sold there)
  const store = await isStoreApp()
  return (
    <>
      <AppHeader />
      <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8">
        <div className="max-w-2xl">
          <h1 className="t-display-1">{t('course.catalog')}</h1>
          <p className="t-body-lg mt-2 text-ink-500">{t('course.catalogSubtitle')}</p>
          <hr className="rule-gold mt-4 w-16" />
        </div>
        {list.length === 0 ? (
          <div className="rounded-lg border border-paper-300 bg-paper-50">
            <EmptyState illustration="book" title={t('course.catalogEmpty')} />
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((c, i) => (
              <li key={c.id} style={{ ['--i' as string]: i }} className="card-enter">
                <Link href={`/course/${c.slug}`} className="press flex h-full flex-col gap-3 rounded-lg border border-paper-300 bg-paper-50 p-5 shadow-e1 hover:bg-paper-200">
                  <h2 className="t-h2">{c.title}</h2>
                  {c.teacherName && <p className="t-small text-ink-500">{t('course.byTeacher', { name: c.teacherName })}</p>}
                  {c.description && <p className="t-body line-clamp-3 text-ink-700">{c.description}</p>}
                  <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
                    {c.cefrLevel && <Badge tone="orange">{c.cefrLevel}</Badge>}
                    <Badge icon={<BookOpen size={14} strokeWidth={ICON.strokeWidth} aria-hidden />}>{t('course.lessonCount', { n: c.lessonCount })}</Badge>
                    <Badge icon={<Users size={14} strokeWidth={ICON.strokeWidth} aria-hidden />}>{c.students}</Badge>
                    {!store && (c.priceKrw ?? 0) > 0 && <Badge tone="published">{t('course.priceValue', { price: formatKrw(c.priceKrw!) })}</Badge>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  )
}
