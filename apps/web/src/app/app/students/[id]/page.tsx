import { AlertTriangle, ArrowLeft, ChevronRight, Minus, PenLine, TrendingDown, TrendingUp, Trophy } from 'lucide-react'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getDb } from '@ikhimi/db'
import { formatDate, formatShortDate, type MessageKey } from '@ikhimi/i18n'
import { Avatar, Badge, CompareBars, EmptyState, ICON, LineChart, StatTile } from '@ikhimi/ui/components'
import { AppHeader } from '@/components/AppHeader'
import { getT } from '@/i18n/server'
import { ParentLink } from '@/components/ParentLink'
import { studentAnalytics } from '@/server/analytics'
import { activeParentLink, parentUrl } from '@/server/parents'
import { getSession } from '@/server/request'

/** Everything a teacher knows about one of their students: results over time against the class, skills, writing. */
export default async function StudentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string }> }) {
  const session = await getSession()
  if (!session || session.user.role !== 'teacher') redirect('/signin')
  const data = await studentAnalytics(getDb(), session.user, (await params).id)
  // Not in any of this teacher's groups: same answer as "doesn't exist"
  if (!data || !data.groups.length) notFound()
  const { t } = await getT()
  const from = (await searchParams).from
  const back = data.groups.find((g) => g.id === from) ?? data.groups[0]!
  const TrendIcon = data.trend === 'up' ? TrendingUp : data.trend === 'down' ? TrendingDown : Minus
  const parent = await activeParentLink(getDb(), session.user.id, data.student.id)

  return (
    <>
      <AppHeader />
      <main className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-6 pb-16">
        <Link href={`/app/groups/${back.id}`} className="t-small inline-flex items-center gap-1 self-start font-medium text-ink-500 hover:text-ink-800">
          <ArrowLeft size={16} strokeWidth={ICON.strokeWidth} aria-hidden /> {back.name}
        </Link>

        <header className="flex items-center gap-4">
          <Avatar id={data.student.id} name={data.student.name} size={64} />
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="t-display-2 truncate">{data.student.name}</h1>
            <div className="flex flex-wrap gap-2">
              {data.groups.map((g) => (
                <Badge key={g.id}>{g.name}</Badge>
              ))}
            </div>
          </div>
        </header>

        <section className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <StatTile
            value={data.average === null ? '—' : `${data.average}%`}
            label={t('report.average')}
            hint={data.classAverage === null ? undefined : t('student.classAvg', { n: data.classAverage })}
          />
          <StatTile value={`${data.completed}/${data.assigned}`} label={t('profile.completed')} hint={data.overdue ? t('student.overdue', { n: data.overdue }) : undefined} />
          <StatTile value={data.onTimeRate === null ? '—' : `${data.onTimeRate}%`} label={t('student.onTime')} />
          <StatTile
            value={
              data.trend ? (
                <span className={`inline-flex items-center gap-1 ${data.trend === 'up' ? 'text-success-600' : data.trend === 'down' ? 'text-error-600' : 'text-ink-700'}`}>
                  <TrendIcon size={28} strokeWidth={2} aria-hidden /> {t(`trend.${data.trend}` as MessageKey)}
                </span>
              ) : (
                '—'
              )
            }
            label={t('student.trend')}
            hint={data.trend ? undefined : t('student.trendNeedsMore')}
          />
        </section>

        <ParentLink studentId={data.student.id} initialUrl={parent ? parentUrl(parent.token) : null} />

        {data.standings.length > 0 && (
          <section className="flex flex-col gap-2">
            {data.standings.map((s) => (
              <p key={s.groupId} className="t-body flex flex-wrap items-center gap-2 rounded-2xl border-2 border-paper-300 bg-paper-50 px-4 py-3">
                <Trophy size={20} strokeWidth={ICON.strokeWidth} className="text-gold-500" aria-hidden />
                {s.rank === null ? (
                  <span className="text-ink-500">{t('student.noRankYet', { group: s.groupName })}</span>
                ) : (
                  <span>{t('student.rankIn', { rank: s.rank, of: s.of, group: s.groupName })}</span>
                )}
                {s.groupAverage !== null && <span className="t-small text-ink-500">· {t('student.classAvg', { n: s.groupAverage })}</span>}
              </p>
            ))}
          </section>
        )}

        {data.timeline.length === 0 ? (
          <div className="rounded-2xl border-2 border-paper-300 bg-paper-50">
            <EmptyState illustration="pages" title={t('student.noResultsYet')} />
          </div>
        ) : (
          <>
            <section className="flex flex-col gap-3">
              <h2 className="t-h1">{t('student.overTime')}</h2>
              <div className="rounded-2xl border-2 border-paper-300 bg-paper-50 p-4">
                <LineChart
                  caption={t('student.overTime')}
                  labels={data.timeline.map((x) => (x.submittedAt ? formatShortDate(x.submittedAt) : ''))}
                  series={[
                    { label: data.student.name, values: data.timeline.map((x) => x.percent), tone: 'text-orange-500' },
                    { label: t('student.classAverage'), values: data.timeline.map((x) => x.classAverage), tone: 'text-ink-400', dashed: true },
                  ]}
                />
              </div>
            </section>

            <section className="flex flex-col gap-3">
              <h2 className="t-h1">{t('student.eachHomework')}</h2>
              <ul className="overflow-hidden rounded-2xl border-2 border-paper-300 bg-paper-50">
                {[...data.timeline].reverse().map((x) => (
                  <li key={x.attemptId} className="border-b border-paper-300 last:border-b-0">
                    <Link href={`/app/a/${x.assignmentId}/report`} className="press flex items-center gap-3 px-4 py-3 hover:bg-paper-100">
                      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                        <span className="t-body flex items-baseline justify-between gap-3">
                          <span className="truncate font-medium">{x.title}</span>
                          <span className="t-num shrink-0 font-semibold">
                            {x.percent}%{x.classAverage !== null && <span className="t-small ml-1.5 font-normal text-ink-400">/ {x.classAverage}%</span>}
                          </span>
                        </span>
                        <span className="relative block h-2 rounded-pill bg-paper-200">
                          <span
                            className={`absolute inset-y-0 left-0 rounded-pill ${x.percent >= 80 ? 'bg-success-600' : x.percent >= 50 ? 'bg-orange-500' : 'bg-error-600'}`}
                            style={{ width: `${Math.max(2, x.percent)}%` }}
                          />
                          {x.classAverage !== null && <span className="absolute -inset-y-1 w-0.5 bg-ink-800" style={{ left: `calc(${x.classAverage}% - 1px)` }} />}
                        </span>
                        <span className="t-small t-num flex flex-wrap gap-x-3 text-ink-500">
                          {x.submittedAt && <span>{formatDate(x.submittedAt)}</span>}
                          {x.rank !== null && <span>{t('student.place', { rank: x.rank, of: x.classSize })}</span>}
                          <span>
                            {x.minutes} {t('param.minutes')}
                          </span>
                          {x.late && <span className="text-warn-600">{t('student.late')}</span>}
                          {x.pending > 0 && <span className="text-warn-600">⏳ {t('report.pending')}</span>}
                        </span>
                      </span>
                      <ChevronRight size={18} strokeWidth={ICON.strokeWidth} className="shrink-0 text-ink-400" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="t-small flex items-center gap-1.5 text-ink-500">
                <span className="inline-block h-3 w-0.5 bg-ink-800" /> {t('student.classAverage')}
              </p>
            </section>

            {data.skills.length > 0 && (
              <section className="flex flex-col gap-3">
                <h2 className="t-h1">{t('profile.bySkill')}</h2>
                <div className="rounded-2xl border-2 border-paper-300 bg-paper-50 p-4">
                  <CompareBars
                    caption={t('profile.bySkill')}
                    valueLabel={data.student.name}
                    referenceLabel={t('student.classAverage')}
                    rows={data.skills.map((s) => ({ key: s.skill, label: t(`skill.${s.skill}` as MessageKey), value: s.accuracy, reference: s.classAccuracy }))}
                  />
                </div>
              </section>
            )}
          </>
        )}

        {data.writing.length > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className="t-h1 flex items-center gap-2">
              <PenLine size={24} strokeWidth={ICON.strokeWidth} aria-hidden /> {t('student.writing')}
            </h2>
            <ul className="flex flex-col gap-2">
              {data.writing.map((w, i) => (
                <li key={i} className="flex flex-col gap-1 rounded-2xl border-2 border-paper-300 bg-paper-50 p-4">
                  <span className="t-body flex items-baseline justify-between gap-3">
                    <span className="font-medium">{w.title}</span>
                    {w.score ? (
                      <span className="t-num shrink-0 font-semibold">{w.score}</span>
                    ) : (
                      w.ok !== null && (
                        <span className="t-num shrink-0 font-semibold">
                          {t('student.sentencesOk', { n: w.ok, total: w.written })}
                        </span>
                      )
                    )}
                  </span>
                  <span className="t-small text-ink-500">{w.task}</span>
                  {w.summary && <p className="t-body mt-1 text-ink-800">{w.summary}</p>}
                  {w.mistakes.length > 0 && (
                    <ul className="t-small mt-1 flex list-disc flex-col gap-0.5 pl-5 text-error-600">
                      {w.mistakes.map((m, j) => (
                        <li key={j}>{m}</li>
                      ))}
                    </ul>
                  )}
                  {w.teacherFeedback && <p className="t-small mt-1 text-orange-700">{t('result.teacherNote')}: {w.teacherFeedback}</p>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {data.missing.length > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className="t-h1 flex items-center gap-2">
              <AlertTriangle size={24} strokeWidth={ICON.strokeWidth} className="text-warn-600" aria-hidden /> {t('student.notDone')}
            </h2>
            <ul className="overflow-hidden rounded-2xl border-2 border-paper-300 bg-paper-50">
              {data.missing.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 border-b border-paper-300 px-4 py-3 last:border-b-0">
                  <Link href={`/app/a/${m.id}/report`} className="t-body truncate font-medium hover:underline">
                    {m.title}
                  </Link>
                  {m.dueAt && (
                    <span className={`t-small t-num shrink-0 ${m.dueAt < new Date() ? 'text-error-600' : 'text-ink-500'}`}>{formatDate(m.dueAt)}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </>
  )
}
