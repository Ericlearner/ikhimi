import { ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getDb } from '@ikhimi/db'
import { formatDate } from '@ikhimi/i18n'
import { Badge, EmptyState, ICON, TaskIcon } from '@ikhimi/ui/components'
import { AppHeader } from '@/components/AppHeader'
import { getT } from '@/i18n/server'
import { teacherGroups } from '@/server/profiles'
import { getSession } from '@/server/request'

/** Groups (design spec §11 screen 4): student count, last assignment, average, join code. */
export default async function GroupsPage() {
  const session = await getSession()
  if (!session || session.user.role !== 'teacher') redirect('/signin')
  const { t } = await getT()
  const groups = await teacherGroups(getDb(), session.user.id)
  return (
    <>
      <AppHeader />
      <main className="mx-auto flex max-w-4xl flex-col gap-5 px-4 py-6">
        <div>
          <h1 className="t-display-2">{t('nav.groups')}</h1>
        </div>
        {groups.length === 0 ? (
          <div className="rounded-2xl border-2 border-paper-300 bg-paper-50">
            <EmptyState illustration="cap" title={t('groups.empty')} action={{ label: t('compose.newAssignment'), href: '/app' }} />
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {groups.map((g, i) => (
              <li key={g.id} style={{ ['--i' as string]: i }} className="card-enter">
                <Link href={`/app/groups/${g.id}`} className="press flex h-full flex-col gap-3 rounded-2xl border-2 border-paper-300 bg-paper-50 p-4 hover:bg-paper-200">
                  <div className="flex items-center gap-3">
                    <TaskIcon name="books" size={32} />
                    <h2 className="t-h2 min-w-0 flex-1 truncate">{g.name}</h2>
                    <ChevronRight size={20} strokeWidth={ICON.strokeWidth} className="shrink-0 text-ink-400" aria-hidden />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {g.cefrLevel && <Badge tone="orange">{g.cefrLevel}</Badge>}
                    {g.startDate && <Badge>{t('group.starts', { date: formatDate(new Date(`${g.startDate}T12:00:00Z`)) })}</Badge>}
                    <Badge>
                      {t('groups.joinCode')}: {g.joinCode}
                    </Badge>
                  </div>
                  {/* Three numbers with a picture each, like the student's tiles */}
                  <dl className="t-small grid grid-cols-3 gap-2">
                    {(
                      [
                        ['graduation-cap', t('report.students'), g.expectedStudents ? `${g.students}/${g.expectedStudents}` : String(g.students)],
                        ['memo', t('group.homework'), String(g.homework)],
                        ['bullseye', t('report.average'), g.average === null ? '—' : `${g.average}%`],
                      ] as const
                    ).map(([icon, label, value]) => (
                      <div key={label} className="flex flex-col items-center gap-0.5 rounded-xl border-2 border-paper-300 px-1 py-2 text-center">
                        <TaskIcon name={icon} size={22} />
                        {/* The label reads first (dt before dd), shown under the number */}
                        <dt className="order-last w-full truncate text-ink-500">{label}</dt>
                        <dd className="t-body t-num font-semibold">{value}</dd>
                      </div>
                    ))}
                  </dl>
                  {g.lastAssignment && (
                    <p className="t-small truncate border-t border-paper-300 pt-2 text-ink-500">
                      {t('groups.lastAssignment')}: <span className="font-medium text-ink-700">{g.lastAssignment.title}</span>
                    </p>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  )
}
