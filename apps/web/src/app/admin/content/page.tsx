import { ArrowLeft, ChevronRight, Search } from 'lucide-react'
import Link from 'next/link'
import { getDb } from '@ikhimi/db'
import { formatDate } from '@ikhimi/i18n'
import { Avatar, Badge, ICON } from '@ikhimi/ui/components'
import { getT } from '@/i18n/server'
import { pageStaff } from '@/server/admin/guard'
import { can } from '@/server/admin/staff'
import { homeworkTeachers, recentHomework, teacherHomework } from '@/server/admin/stats'

type T = Awaited<ReturnType<typeof getT>>['t']
/** A homework line: with its teacher (search) or how many handed it in (one teacher's page) */
type Homework = { a: { id: string; title: string; status: string; createdAt: Date }; items: number; teacherName?: string | null; submitted?: number }

/**
 * Every teacher's homework, to open one when a teacher reports a problem: the teachers first (most recently active
 * on top), then one teacher's homework group by group. A search lists matching homework from everyone.
 */
export default async function AdminContent({ searchParams }: { searchParams: Promise<{ q?: string; teacher?: string }> }) {
  const db = getDb()
  const { access } = await pageStaff(db, 'content')
  const { t } = await getT()
  const params = await searchParams
  const q = (params.q ?? '').slice(0, 80)
  const teacherId = (params.teacher ?? '').slice(0, 40)

  return (
    <div className="flex flex-col gap-4">
      <form className="flex max-w-xl items-center gap-2" action="/admin/content">
        <label className="relative flex-1">
          <span className="sr-only">{t('admin.users.search')}</span>
          <Search size={18} strokeWidth={ICON.strokeWidth} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" aria-hidden />
          <input name="q" defaultValue={q} placeholder={t('admin.content.searchPlaceholder')} className="t-body min-h-11 w-full rounded-md border border-paper-300 bg-paper-50 pl-10 pr-3" />
        </label>
        <button className="btn btn-secondary btn-md">
          <span className="btn-label">{t('admin.users.search')}</span>
        </button>
      </form>
      {q ? <SearchResults q={q} t={t} /> : teacherId ? <OneTeacher id={teacherId} showUser={can(access, 'users.view')} t={t} /> : <Teachers t={t} />}
    </div>
  )
}

const LIST = 'overflow-hidden rounded-lg border border-paper-300 bg-paper-50'

async function Teachers({ t }: { t: T }) {
  const rows = await homeworkTeachers(getDb())
  if (!rows.length) return <p className="t-body text-ink-500">{t('admin.content.none')}</p>
  return (
    <section className="flex flex-col gap-2">
      <h2 className="t-h2">
        {t('admin.content.teachers')} <span className="t-num text-ink-500">{rows.length}</span>
      </h2>
      <ul className={LIST}>
        {rows.map((r) => (
          <li key={r.id} className="border-b border-paper-300 last:border-b-0">
            <Link href={`/admin/content?teacher=${r.id}`} className="press flex items-center gap-3 px-4 py-3 hover:bg-paper-100">
              <Avatar id={r.id} name={r.name} size={36} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="t-body truncate font-medium">{r.name ?? '—'}</span>
                <span className="t-small t-num text-ink-500">
                  {t('admin.content.counts', { n: r.total, p: r.published })} · {t('admin.content.lastMade', { date: formatDate(r.last) })}
                </span>
              </span>
              <span className="t-h3 t-num shrink-0 text-ink-700">{r.total}</span>
              <ChevronRight size={18} strokeWidth={ICON.strokeWidth} className="shrink-0 text-ink-400" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

async function OneTeacher({ id, showUser, t }: { id: string; showUser: boolean; t: T }) {
  const d = await teacherHomework(getDb(), id)
  return (
    <section className="flex flex-col gap-4">
      <Link href="/admin/content" className="t-small inline-flex items-center gap-1 self-start font-medium text-ink-500 hover:text-ink-800">
        <ArrowLeft size={16} strokeWidth={ICON.strokeWidth} aria-hidden /> {t('admin.content.allTeachers')}
      </Link>
      {!d ? (
        <p className="t-body text-ink-500">{t('admin.content.none')}</p>
      ) : (
        <>
          <header className="flex items-center gap-3">
            <Avatar id={d.teacher.id} name={d.teacher.name} size={44} />
            <span className="flex min-w-0 flex-col">
              <h2 className="t-h1 truncate">{d.teacher.name ?? '—'}</h2>
              <span className="t-small t-num text-ink-500">
                {t('admin.content.homeworkCount', { n: d.total })}
                {showUser && (
                  <>
                    {' · '}
                    <Link href={`/admin/users/${d.teacher.id}`} className="font-medium text-orange-700 hover:underline">
                      {t('admin.content.profile')}
                    </Link>
                  </>
                )}
              </span>
            </span>
          </header>
          {d.sections.map((s) => (
            <div key={s.id ?? 'none'} className="flex flex-col gap-2">
              <h3 className="t-h3">
                {s.name ?? t('admin.content.noGroup')} <span className="t-num text-ink-500">{s.rows.length}</span>
              </h3>
              <HomeworkList rows={s.rows} t={t} />
            </div>
          ))}
        </>
      )}
    </section>
  )
}

async function SearchResults({ q, t }: { q: string; t: T }) {
  const rows = await recentHomework(getDb(), { q })
  return (
    <section className="flex flex-col gap-2">
      <Link href="/admin/content" className="t-small inline-flex items-center gap-1 self-start font-medium text-ink-500 hover:text-ink-800">
        <ArrowLeft size={16} strokeWidth={ICON.strokeWidth} aria-hidden /> {t('admin.content.allTeachers')}
      </Link>
      {rows.length ? (
        <HomeworkList rows={rows} t={t} />
      ) : (
        <p className="t-body text-ink-500">{t('admin.content.none')}</p>
      )}
    </section>
  )
}

function HomeworkList({ rows, t }: { rows: Homework[]; t: T }) {
  return (
    <ul className={LIST}>
      {rows.map((r) => (
        <li key={r.a.id} className="border-b border-paper-300 last:border-b-0">
          <Link href={`/admin/content/${r.a.id}`} className="press flex items-center gap-3 px-4 py-3 hover:bg-paper-100">
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="t-body truncate font-medium">{r.a.title}</span>
              <span className="t-small t-num text-ink-500">
                {r.teacherName !== undefined && `${r.teacherName ?? '—'} · `}
                {formatDate(r.a.createdAt)} · {r.items} {t('admin.users.items')}
                {r.submitted !== undefined && r.a.status !== 'draft' && ` · ${t('admin.content.submitted', { n: r.submitted })}`}
              </span>
            </span>
            <Badge tone={r.a.status === 'published' ? 'published' : 'neutral'}>{r.a.status === 'draft' ? t('state.draft') : t('state.published')}</Badge>
          </Link>
        </li>
      ))}
    </ul>
  )
}
