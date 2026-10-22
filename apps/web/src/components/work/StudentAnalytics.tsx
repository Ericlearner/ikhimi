/**
 * The student's full analytics (Profile → Analitika): the skill map, the trend line and the group rankings. My work
 * keeps the numbers and a short summary that links here.
 */
import type { MessageKey } from '@ikhimi/i18n'
import { TaskIcon } from '@ikhimi/ui/components'
import { MEDALS, RankChange } from '@/components/RankChange'
import type { StudentDashboard } from '@/server/student-dashboard'
import { MIN_ANSWERS, type SkillResult } from '@/server/student-results'
import { band, CARD, SKILL_ICON, type Band } from './bands'
import { ChangeChip, SkillMap, TrendChart } from './ResultsCharts'
import { ScoreRing } from './ScoreRing'

type T = (k: MessageKey, v?: Record<string, string | number>) => string

export const BAND_WORD: Record<Band, MessageKey> = { strong: 'work.bandStrong', mid: 'work.bandMid', low: 'work.bandLow' }

export function StudentAnalytics({ d, t }: { d: StudentDashboard; t: T }) {
  const { results, trend, rankings } = d
  const mapSkills = results.skills.filter((s) => s.total >= MIN_ANSWERS)
  if (!trend.latest.length && !results.skills.length) {
    return (
      <div className={`flex flex-col items-center gap-3 p-6 text-center ${CARD}`}>
        <TaskIcon name="chart-increasing" size={44} />
        <p className="t-body text-ink-500">{t('work.analyticsEmpty')}</p>
      </div>
    )
  }
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {results.skills.length > 0 && (
        <div className={`flex min-w-0 flex-col gap-3 p-4 ${CARD} bg-gradient-to-b from-orange-100/60 to-paper-50`}>
          <h3 className="t-h3">{t('work.skills')}</h3>
          {mapSkills.length >= 3 ? (
            <SkillMap skills={mapSkills} />
          ) : (
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {results.skills.map((s) => (
                <SkillCard key={s.skill} s={s} t={t} />
              ))}
            </ul>
          )}
          <BandKey t={t} />
        </div>
      )}

      {trend.latest.length > 0 && (
        <div className={`flex min-w-0 flex-col gap-3 p-4 ${CARD}`}>
          <div className="flex items-center justify-between gap-3">
            <h3 className="t-h3 inline-flex items-center gap-2">
              <TaskIcon name="chart-increasing" size={22} /> {t('work.trend')}
            </h3>
            {trend.average !== null && (
              <span className="flex items-center gap-2">
                <span className="t-h1 t-num leading-none">{trend.average}%</span>
                <ChangeChip change={trend.change} title={t('work.changeHint')} />
              </span>
            )}
          </div>
          <TrendChart points={trend.latest} average={trend.average} />
        </div>
      )}

      {rankings.map((g) => (
        <div key={g.groupId} className={`flex min-w-0 flex-col gap-3 p-4 ${CARD}`}>
          <h3 className="t-h3 inline-flex items-center gap-2">
            <TaskIcon name="trophy" size={22} /> {t('rank.groupTitle', { group: g.groupName })}
          </h3>
          <ol className="overflow-hidden rounded-xl border border-paper-300">
            {g.rows.map((r) => (
              <li
                key={r.studentId}
                aria-current={r.me || undefined}
                className={`flex items-center gap-3 border-b border-paper-300 px-3 py-2.5 last:border-b-0 ${r.me ? 'bg-orange-100 font-semibold' : ''}`}
              >
                <span className="t-body t-num w-7 shrink-0 text-center font-semibold text-ink-500">{r.place === null ? '–' : (MEDALS[r.place] ?? r.place)}</span>
                <span className="t-body min-w-0 flex-1 truncate">
                  {r.name}
                  {r.me && <span className="t-small ml-2 font-normal text-ink-500">({t('student.you')})</span>}
                </span>
                <RankChange change={r.change} label={(n) => t(n > 0 ? 'rank.up' : 'rank.down', { n: Math.abs(n) })} />
                <span className="t-body t-num w-14 text-right">{r.score === null ? '—' : `${r.score}%`}</span>
              </li>
            ))}
          </ol>
          <p className="t-small text-ink-400">{t('rank.rule')}</p>
        </div>
      ))}
    </div>
  )
}

/** The three colours, once, so the map and the line need no other words */
function BandKey({ t }: { t: T }) {
  return (
    <ul className="t-small flex flex-wrap justify-center gap-x-4 gap-y-1 text-ink-500">
      {(['strong', 'mid', 'low'] as const).map((b) => (
        <li key={b} className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full" style={{ background: `var(--score-${b})` }} aria-hidden />
          {t(BAND_WORD[b])}
        </li>
      ))}
    </ul>
  )
}

/** Fewer than three skills to map: a card each, with a ring filled to the score */
function SkillCard({ s, t }: { s: SkillResult; t: T }) {
  const enough = s.total >= MIN_ANSWERS
  return (
    <li className={`flex flex-col items-center gap-2 p-4 text-center ${CARD}`} title={t('work.skillAnswers', { n: s.total })}>
      <ScoreRing percent={s.percent} dashed={!enough}>
        <TaskIcon name={SKILL_ICON[s.skill] ?? 'star'} size={30} />
      </ScoreRing>
      <span className="t-body font-semibold leading-tight">{t(`skill.${s.skill}` as MessageKey)}</span>
      {enough ? (
        <span className="t-small t-num text-ink-500">
          {s.percent}% · {t(BAND_WORD[band(s.percent)])}
        </span>
      ) : (
        <span className="t-small text-ink-400">{t('work.fewData')}</span>
      )}
    </li>
  )
}
