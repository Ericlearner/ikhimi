import { ArrowLeft, CalendarDays, ChevronRight, Minus, Plus, Settings2, Sparkles, TrendingDown, TrendingUp } from 'lucide-react'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getDb } from '@ikhimi/db'
import { formatDate, formatShortDate, type MessageKey } from '@ikhimi/i18n'
import { Avatar, Badge, CompareBars, EmptyState, Histogram, ICON, LineChart, Sparkline, StatTile } from '@ikhimi/ui/components'
import { AppHeader } from '@/components/AppHeader'
import { GroupEditForm, LeaderboardToggle } from '@/components/GroupEditForm'
import { getT } from '@/i18n/server'
import { groupAnalytics } from '@/server/analytics'
import { groupOverview } from '@/server/groups'
import { groupRanking } from '@/server/ranking'
import { MEDALS, RankChange } from '@/components/RankChange'
import { getSession } from '@/server/request'

/** One group: its details, every homework published to it, and its students. */
export default async function GroupPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session || session.user.role !== 'teacher') redirect('/signin')
  const data = await groupOverview(getDb(), session.user.id, (await params).id)
  if (!data) notFound()
  const { t } = await getT()
  const { group: g, work, students } = data
  const stats = (await groupAnalytics(getDb(), session.user.id, g.id))!
  const ranking = await groupRanking(getDb(), g.id)
  const charted = stats.perAssignment.filter((p) => p.average !== null)
  // Skills the group gets wrong often enough to practise (weakest first), with enough answers to mean something
  const weak = stats.skills.filter((s) => s.accuracy < 80 && s.total >= 5).slice(0, 3)

  return (
    <>
      <AppHeader />
      <main className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-6 pb-16">
        <Link href="/app/groups" className="t-small inline-flex items-center gap-1 self-start font-medium text-ink-500 hover:text-ink-800">
          <ArrowLeft size={16} strokeWidth={ICON.strokeWidth} aria-hidden /> {t('nav.groups')}
        </Link>

        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h1 className="t-display-2">{g.name}</h1>
            <Link href="/app" className="btn btn-primary btn-md">
              <span className="btn-label">
                <Plus size={18} strokeWidth={ICON.strokeWidth} aria-hidden /> {t('group.newHomework')}
              </span>
            </Link>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {g.cefrLevel && <Badge tone="orange">{g.cefrLevel}</Badge>}
            {g.startDate && (
              <Badge icon={<CalendarDays size={14} strokeWidth={ICON.strokeWidth} aria-hidden />}>
                {t('group.starts', { date: formatDate(new Date(`${g.startDate}T12:00:00Z`)) })}
              </Badge>
            )}
            <Badge>
              {t('groups.joinCode')}: <span className="t-num font-semibold tracking-wider">{g.joinCode}</span>
            </Badge>
          </div>
          <p className="t-small text-ink-500">{t('group.codeHint', { code: g.joinCode })}</p>
          {g.description && <p className="t-body measure whitespace-pre-line text-ink-700">{g.description}</p>}
        </div>

        <section className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <StatTile value={g.expectedStudents ? `${students.length}/${g.expectedStudents}` : students.length} label={t('group.students')} />
          <StatTile value={data.published} label={t('group.homework')} />
          <StatTile value={data.average === null ? '—' : `${data.average}%`} label={t('report.average')} />
        </section>

        {charted.length > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className="t-h1">{t('group.progress')}</h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="rounded-2xl border-2 border-paper-300 bg-paper-50 p-4">
                <h3 className="t-h3 mb-2">{t('group.averageOverTime')}</h3>
                <LineChart
                  caption={t('group.averageOverTime')}
                  labels={charted.map((p) => (p.publishedAt ? formatShortDate(p.publishedAt) : ''))}
                  series={[
                    { label: t('report.average'), values: charted.map((p) => p.average), tone: 'text-orange-500' },
                    { label: t('group.lowest'), values: charted.map((p) => p.min), tone: 'text-error-600', dashed: true },
                  ]}
                />
              </div>
              <div className="rounded-2xl border-2 border-paper-300 bg-paper-50 p-4">
                <h3 className="t-h3 mb-2">{t('group.spread')}</h3>
                <Histogram
                  caption={t('group.spread')}
                  buckets={stats.buckets.map((b, i) => ({ ...b, tone: ['bg-error-600', 'bg-orange-400', 'bg-orange-500', 'bg-success-600'][i] }))}
                />
              </div>
            </div>
            {stats.skills.length > 0 && (
              <div className="rounded-2xl border-2 border-paper-300 bg-paper-50 p-4">
                <h3 className="t-h3 mb-3">{t('group.skills')}</h3>
                <CompareBars
                  caption={t('group.skills')}
                  valueLabel={t('report.average')}
                  rows={stats.skills.map((s) => ({ key: s.skill, label: t(`skill.${s.skill}` as MessageKey), value: s.accuracy }))}
                />
                {/* The weakest skills, each one click from a practice homework built on what the group got wrong */}
                {weak.length > 0 && (
                  <div className="mt-4 flex flex-col gap-2 border-t border-paper-300 pt-4">
                    <p className="t-small text-ink-500">{t('practice.groupHint')}</p>
                    <div className="flex flex-wrap gap-2">
                      {weak.map((s, i) => (
                        <Link key={s.skill} href={`/app?practice=${g.id}&skill=${s.skill}`} className={`btn ${i === 0 ? 'btn-primary' : 'btn-secondary'} btn-md`}>
                          <span className="btn-label">
                            <Sparkles size={18} strokeWidth={ICON.strokeWidth} aria-hidden /> {t('practice.button', { skill: t(`skill.${s.skill}` as MessageKey), n: s.accuracy })}
                          </span>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        <section className="flex flex-col gap-2">
          <h2 className="t-h1">{t('group.homework')}</h2>
          {work.length === 0 ? (
            <div className="rounded-2xl border-2 border-paper-300 bg-paper-50">
              <EmptyState illustration="pages" title={t('group.noHomework')} action={{ label: t('group.newHomework'), href: '/app' }} />
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {work.map((w, i) => (
                <li key={w.id} style={{ ['--i' as string]: i }} className="card-enter">
                  <Link
                    href={w.status === 'draft' ? `/app/a/${w.id}` : `/app/a/${w.id}/report`}
                    className="press flex items-center justify-between gap-3 rounded-2xl border-2 border-paper-300 bg-paper-50 p-4 hover:bg-paper-200"
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="t-h3 truncate">{w.title}</span>
                      <span className="t-small t-num text-ink-500">
                        {w.publishedAt ? formatDate(w.publishedAt) : t('state.draft')}
                        {w.status !== 'draft' && ` · ${t('group.done', { n: w.submitted })}`}
                        {w.average !== null && ` · ${w.average}%`}
                      </span>
                    </span>
                    <ChevronRight size={20} strokeWidth={ICON.strokeWidth} className="shrink-0 text-ink-400" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="t-h1">{t('rank.title')}</h2>
          {students.length === 0 ? (
            <p className="t-body rounded-2xl border-2 border-paper-300 bg-paper-50 p-4 text-ink-500">{t('group.noStudents', { code: g.joinCode })}</p>
          ) : (
            <>
              <ol className="overflow-hidden rounded-2xl border-2 border-paper-300 bg-paper-50">
                {ranking.map((r) => {
                  const s = stats.students.find((x) => x.id === r.studentId)
                  const TrendIcon = s?.trend === 'up' ? TrendingUp : s?.trend === 'down' ? TrendingDown : Minus
                  return (
                    <li key={r.studentId} className="border-b border-paper-300 last:border-b-0">
                      <Link href={`/app/students/${r.studentId}?from=${g.id}`} className="press flex items-center gap-3 px-4 py-3 hover:bg-paper-100">
                        <span className="t-body t-num w-7 shrink-0 text-center font-semibold text-ink-500">{r.place === null ? '–' : (MEDALS[r.place] ?? r.place)}</span>
                        <Avatar id={r.studentId} name={r.name} size={32} />
                        <span className="t-body min-w-0 flex-1 truncate font-medium">{r.name}</span>
                        <RankChange change={r.change} label={(n) => t(n > 0 ? 'rank.up' : 'rank.down', { n: Math.abs(n) })} />
                        {s && <Sparkline values={s.series} label={t('student.overTime')} className="hidden sm:block" />}
                        {s?.trend && (
                          <TrendIcon
                            size={18}
                            strokeWidth={2}
                            className={`hidden sm:block ${s.trend === 'up' ? 'text-success-600' : s.trend === 'down' ? 'text-error-600' : 'text-ink-400'}`}
                            aria-label={t(`trend.${s.trend}` as MessageKey)}
                          />
                        )}
                        <span className="t-small t-num text-ink-500" title={t('rank.doneOf', { done: r.done, counted: r.counted })}>
                          {r.done}/{r.counted}
                        </span>
                        <span className="t-body t-num w-14 text-right font-semibold">{r.score === null ? '—' : `${r.score}%`}</span>
                        <ChevronRight size={18} strokeWidth={ICON.strokeWidth} className="shrink-0 text-ink-400" aria-hidden />
                      </Link>
                    </li>
                  )
                })}
              </ol>
              <p className="t-small text-ink-400">{t('rank.rule')}</p>
            </>
          )}
        </section>

        <details className="group rounded-2xl border-2 border-paper-300 bg-paper-50">
          <summary className="t-h3 flex cursor-pointer list-none items-center gap-2 p-4">
            <Settings2 size={20} strokeWidth={ICON.strokeWidth} className="text-ink-500" aria-hidden /> {t('group.details')}
          </summary>
          <div className="flex flex-col gap-4 border-t border-paper-300 p-4">
            <LeaderboardToggle groupId={g.id} initial={g.studentsSeeLeaderboard} />
            <GroupEditForm
              groupId={g.id}
              initial={{
                name: g.name,
                cefrLevel: g.cefrLevel ?? '',
                startDate: g.startDate ?? '',
                expectedStudents: g.expectedStudents ? String(g.expectedStudents) : '',
                description: g.description ?? '',
              }}
            />
          </div>
        </details>
      </main>
    </>
  )
}
