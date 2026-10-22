import { AlertCircle, Clock, Minus, TrendingDown, TrendingUp } from 'lucide-react'
import type { Metadata } from 'next'
import { getDb } from '@ikhimi/db'
import { formatDate, type MessageKey } from '@ikhimi/i18n'
import { Badge, CompareBars, EmptyState, ICON, StatTile, TemperatureProvider } from '@ikhimi/ui/components'
import { Logo } from '@/components/Logo'
import { getT } from '@/i18n/server'
import { parentView } from '@/server/parents'

// A private page: never in search results, never cached for someone else
export const metadata: Metadata = { robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

/** What a student's parents see through the teacher's link (server/parents.ts): read-only, no sign-in */
export default async function ParentPage({ params }: { params: Promise<{ token: string }> }) {
  const { t } = await getT()
  const v = await parentView(getDb(), (await params).token)
  const header = (
    <header className="border-b border-paper-300 px-4 py-3">
      <div className="mx-auto max-w-3xl">
        <Logo />
      </div>
    </header>
  )
  if (!v) {
    return (
      <>
        {header}
        <main className="mx-auto max-w-md px-4 py-10">
          <EmptyState illustration="pages" title={t('parent.gone')} />
        </main>
      </>
    )
  }
  const TrendIcon = v.trend === 'up' ? TrendingUp : v.trend === 'down' ? TrendingDown : Minus

  return (
    <TemperatureProvider value="calm">
      {header}
      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6 pb-16">
        <div className="flex flex-col gap-2">
          <h1 className="t-display-2">{t('parent.pageTitle', { name: v.studentName })}</h1>
          <p className="t-body text-ink-500">{t('parent.teacher', { name: v.teacherName })}</p>
          <div className="flex flex-wrap gap-2">
            {v.groups.map((g) => (
              <Badge key={g}>{g}</Badge>
            ))}
          </div>
          <hr className="rule-gold mt-1 w-12" />
        </div>

        <section className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <StatTile
            value={v.average === null ? '—' : `${v.average}%`}
            label={t('report.average')}
            hint={v.classAverage === null ? undefined : t('student.classAvg', { n: v.classAverage })}
          />
          <StatTile value={`${v.completed}/${v.assigned}`} label={t('profile.completed')} />
          <StatTile value={v.onTimeRate === null ? '—' : `${v.onTimeRate}%`} label={t('student.onTime')} />
          <StatTile
            value={
              v.trend ? (
                <span className={`inline-flex items-center gap-1 ${v.trend === 'up' ? 'text-success-600' : v.trend === 'down' ? 'text-error-600' : 'text-ink-700'}`}>
                  <TrendIcon size={28} strokeWidth={2} aria-hidden /> {t(`trend.${v.trend}` as MessageKey)}
                </span>
              ) : (
                '—'
              )
            }
            label={t('student.trend')}
            hint={v.trend ? undefined : t('student.trendNeedsMore')}
          />
        </section>

        {v.missing.length > 0 && (
          <section className="flex flex-col gap-2 rounded-lg border border-l-4 border-paper-300 border-l-warn-600 bg-paper-50 p-4">
            <h2 className="t-h3 flex items-center gap-2 text-warn-600">
              <AlertCircle size={20} strokeWidth={ICON.strokeWidth} aria-hidden /> {t('parent.missing', { n: v.missing.length })}
            </h2>
            <ul className="t-body flex flex-col gap-1 text-ink-700">
              {v.missing.slice(0, 8).map((m, i) => (
                <li key={i} className="flex justify-between gap-3">
                  <span className="truncate">{m.title}</span>
                  {m.dueAt && <span className="t-small t-num shrink-0 text-ink-500">{formatDate(m.dueAt)}</span>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {v.recent.length === 0 ? (
          <div className="rounded-lg border border-paper-300 bg-paper-50">
            <EmptyState illustration="pages" title={t('student.noResultsYet')} />
          </div>
        ) : (
          <section className="flex flex-col gap-3">
            <h2 className="t-h1">{t('student.eachHomework')}</h2>
            <ul className="overflow-hidden rounded-lg border border-paper-300 bg-paper-50">
              {v.recent.map((x, i) => (
                <li key={i} className="flex items-center gap-3 border-b border-paper-300 px-4 py-3 last:border-b-0">
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="t-body truncate font-medium">{x.title}</span>
                    <span className="t-small t-num inline-flex items-center gap-1 text-ink-500">
                      {x.submittedAt ? formatDate(x.submittedAt) : ''}
                      {x.late && (
                        <>
                          {' · '}
                          <Clock size={14} strokeWidth={ICON.strokeWidth} aria-hidden /> {t('parent.late')}
                        </>
                      )}
                    </span>
                  </span>
                  <span className="t-num shrink-0 text-right">
                    <span className="t-body font-semibold">{x.pending ? '…' : `${x.percent}%`}</span>
                    {x.classAverage !== null && <span className="t-small block text-ink-400">{t('student.classAvg', { n: x.classAverage })}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {v.skills.length > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className="t-h1">{t('parent.skills')}</h2>
            <div className="rounded-lg border border-paper-300 bg-paper-50 p-4">
              <CompareBars
                caption={t('parent.skills')}
                valueLabel={v.studentName}
                referenceLabel={t('student.classAverage')}
                rows={v.skills.map((s) => ({ key: s.skill, label: t(`skill.${s.skill}` as MessageKey), value: s.accuracy, reference: s.classAccuracy }))}
              />
            </div>
          </section>
        )}

        <p className="t-small text-ink-400">{t('parent.footer', { name: v.teacherName })}</p>
      </main>
    </TemperatureProvider>
  )
}
