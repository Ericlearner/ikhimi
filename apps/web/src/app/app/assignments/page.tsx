import { ChevronDown, ChevronRight, Settings2 } from 'lucide-react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { and, assignments, attempts, desc, eq, getDb, groups, isNull, sql } from '@ikhimi/db'
import { formatDate } from '@ikhimi/i18n'
import { Badge, EmptyState, ICON, TaskIcon } from '@ikhimi/ui/components'
import { AppHeader } from '@/components/AppHeader'
import { getT } from '@/i18n/server'
import { getSession } from '@/server/request'

/**
 * Every homework, course by course (a course = one of the teacher's groups): unpublished drafts first, then each
 * course with its homework inside, the most recently active course open. Nothing mixes across courses.
 */
export default async function AssignmentsList() {
  const session = await getSession()
  if (!session) redirect('/signin')
  const { t } = await getT()
  const db = getDb()
  const all = await db
    .select({
      a: assignments,
      groupName: groups.name,
      submitted: sql<number>`(select count(*)::int from ${attempts} where ${attempts.assignmentId} = ${assignments.id} and ${attempts.status} <> 'in_progress')`,
      average: sql<number | null>`(select round(avg(${attempts.percent}))::int from ${attempts} where ${attempts.assignmentId} = ${assignments.id} and ${attempts.status} <> 'in_progress')`,
    })
    .from(assignments)
    .leftJoin(groups, eq(groups.id, assignments.groupId))
    .where(and(eq(assignments.teacherId, session.user.id), isNull(assignments.deletedAt)))
    .orderBy(desc(assignments.createdAt))
    .limit(500)

  const drafts = all.filter((r) => !r.a.groupId)
  const courses = new Map<string, { id: string; name: string; rows: typeof all }>()
  for (const r of all) {
    if (!r.a.groupId) continue
    const c = courses.get(r.a.groupId) ?? { id: r.a.groupId, name: r.groupName ?? '—', rows: [] }
    c.rows.push(r)
    courses.set(r.a.groupId, c)
  }
  const list = [...courses.values()] // already newest-activity first (rows came newest first)

  const Row = ({ r }: { r: (typeof all)[number] }) => (
    <li className="border-b border-paper-300 last:border-b-0">
      <Link href={r.a.status === 'draft' ? `/app/a/${r.a.id}` : `/app/a/${r.a.id}/report`} className="press flex items-center gap-3 px-4 py-3 hover:bg-paper-200">
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="t-body truncate font-medium">{r.a.title}</span>
          <span className="t-small t-num text-ink-500">
            {formatDate(r.a.publishedAt ?? r.a.createdAt)}
            {r.a.status !== 'draft' && ` · ${t('group.done', { n: r.submitted })}`}
            {r.average !== null && ` · ${r.average}%`}
          </span>
        </span>
        {r.a.status === 'draft' && <Badge tone="neutral">{t('state.draft')}</Badge>}
        <ChevronRight size={18} strokeWidth={ICON.strokeWidth} className="shrink-0 text-ink-400" aria-hidden />
      </Link>
    </li>
  )

  return (
    <>
      <AppHeader />
      <main className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6 pb-16">
        <div>
          <h1 className="t-display-2">{t('nav.reports')}</h1>
        </div>
        {all.length === 0 ? (
          <EmptyState illustration="pages" title={t('reports.empty')} action={{ label: t('compose.newAssignment'), href: '/app' }} />
        ) : (
          <>
            {drafts.length > 0 && (
              <details open className="group rounded-2xl border-2 border-paper-300 bg-paper-50">
                <summary className="flex cursor-pointer list-none items-center gap-3 p-4">
                  <TaskIcon name="pencil" size={32} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="t-h2">{t('reports.drafts')}</span>
                    <span className="t-small text-ink-500">{t('reports.draftsHint', { n: drafts.length })}</span>
                  </span>
                  <ChevronDown size={20} strokeWidth={ICON.strokeWidth} className="shrink-0 text-ink-400 transition-transform group-open:rotate-180" aria-hidden />
                </summary>
                <ul className="border-t border-paper-300">
                  {drafts.map((r) => (
                    <Row key={r.a.id} r={r} />
                  ))}
                </ul>
              </details>
            )}
            {list.map((c, i) => (
              <details key={c.id} open={i === 0} className="group rounded-2xl border-2 border-paper-300 bg-paper-50">
                <summary className="flex cursor-pointer list-none items-center gap-3 p-4">
                  <TaskIcon name="books" size={32} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="t-h2 truncate">{c.name}</span>
                    <span className="t-small t-num text-ink-500">{t('reports.courseCount', { n: c.rows.length })}</span>
                  </span>
                  <ChevronDown size={20} strokeWidth={ICON.strokeWidth} className="shrink-0 text-ink-400 transition-transform group-open:rotate-180" aria-hidden />
                </summary>
                <ul className="border-t border-paper-300">
                  {c.rows.map((r) => (
                    <Row key={r.a.id} r={r} />
                  ))}
                </ul>
                <Link href={`/app/groups/${c.id}`} className="t-small flex items-center gap-1.5 border-t border-paper-300 px-4 py-3 font-medium text-orange-700 hover:bg-paper-200">
                  <Settings2 size={16} strokeWidth={ICON.strokeWidth} aria-hidden /> {t('reports.openCourse')}
                </Link>
              </details>
            ))}
          </>
        )}
      </main>
    </>
  )
}
