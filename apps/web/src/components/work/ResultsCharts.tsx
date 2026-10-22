'use client'
/**
 * My work's results, read from the picture: the skill map (a spider chart with each skill's picture and % around it;
 * tap one for its strongest topics and the ones to work on), and the trend line of the latest homework scores.
 */
import { ArrowDown, ArrowUp, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useId, useRef, useState } from 'react'
import { formatDate, type MessageKey } from '@ikhimi/i18n'
import { ICON, TaskIcon, type TaskIconName } from '@ikhimi/ui/components'
import { useI18n } from '@/i18n/client'
import type { SkillResult, Topic } from '@/server/student-results'
import { band, BAND_BG, CARD, SKILL_ICON } from './bands'
import { ScorePill } from './WorkCharts'

/** ▲ 12 / ▼ 5: change against before, in points */
export function ChangeChip({ change, title }: { change: number | null; title?: string }) {
  if (change === null || change === 0) return null
  const up = change > 0
  return (
    <span
      title={title}
      className={`t-small t-num inline-flex items-center gap-0.5 rounded-pill px-2 py-0.5 font-semibold ${up ? 'bg-paper-200 text-score-strong' : 'bg-orange-100 text-orange-700'}`}
    >
      {up ? <ArrowUp size={14} strokeWidth={2.5} aria-hidden /> : <ArrowDown size={14} strokeWidth={2.5} aria-hidden />}
      {Math.abs(change)}
    </span>
  )
}

const C = 150
const R = 92

/** The skill map: 3 or more skills with enough answers */
export function SkillMap({ skills }: { skills: SkillResult[] }) {
  const { t } = useI18n()
  const [sel, setSel] = useState(0)
  const gid = useId().replace(/:/g, '')
  const n = skills.length
  const angle = (i: number) => -Math.PI / 2 + (2 * Math.PI * i) / n
  const at = (i: number, v: number): [number, number] => [C + ((R * v) / 100) * Math.cos(angle(i)), C + ((R * v) / 100) * Math.sin(angle(i))]
  const ring = (v: number) => skills.map((_, i) => at(i, v).join(',')).join(' ')
  const shape = skills.map((s, i) => at(i, Math.max(s.percent, 4)).join(',')).join(' ')
  const picked = skills[sel]!
  const name = (s: string) => t(`skill.${s}` as MessageKey)

  return (
    // min-w-0: a long topic name must shorten with "…", never widen the page
    <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 sm:items-start">
      <div className="relative mx-auto aspect-square w-full min-w-0 max-w-[360px]">
        <svg viewBox="0 0 300 300" className="absolute inset-0 size-full" role="img" aria-label={skills.map((s) => `${name(s.skill)} ${s.percent}%`).join(', ')}>
          <defs>
            <radialGradient id={`${gid}-fill`}>
              <stop offset="0%" stopColor="var(--orange-400)" stopOpacity="0.15" />
              <stop offset="100%" stopColor="var(--orange-500)" stopOpacity="0.45" />
            </radialGradient>
          </defs>
          {/* Rings at 25, 50, 75, 100 and the spokes */}
          {[25, 50, 75, 100].map((v) => (
            <polygon key={v} points={ring(v)} fill={v === 100 ? 'var(--paper-50)' : 'none'} stroke="var(--paper-300)" strokeWidth={v === 100 ? 1.5 : 1} strokeDasharray={v === 100 ? undefined : '3 3'} />
          ))}
          {skills.map((_, i) => {
            const [x, y] = at(i, 100)
            return <line key={i} x1={C} y1={C} x2={x} y2={y} stroke="var(--paper-300)" strokeWidth={1} />
          })}
          {/* 50 and 100, between the first two spokes so no dot covers them */}
          {[50, 100].map((v) => {
            const a = -Math.PI / 2 + Math.PI / n
            return (
              <text key={v} x={C + ((R * v) / 100) * Math.cos(a)} y={C + ((R * v) / 100) * Math.sin(a)} textAnchor="middle" dominantBaseline="middle" className="fill-ink-400 text-[9px]">
                {v}
              </text>
            )
          })}
          <polygon points={shape} fill={`url(#${gid}-fill)`} stroke="var(--orange-600)" strokeWidth={2} strokeLinejoin="round" />
          {skills.map((s, i) => {
            const [x, y] = at(i, Math.max(s.percent, 4))
            return <circle key={s.skill} cx={x} cy={y} r={i === sel ? 7 : 5} fill={i === sel ? 'var(--orange-500)' : 'var(--paper-50)'} stroke="var(--orange-600)" strokeWidth={2} />
          })}
        </svg>
        {/* Each skill's picture and % around the map; tap to see it */}
        {skills.map((s, i) => {
          const a = angle(i)
          return (
            <button
              key={s.skill}
              type="button"
              onClick={() => setSel(i)}
              aria-pressed={i === sel}
              aria-label={`${name(s.skill)}: ${s.percent}%`}
              className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-0.5"
              style={{ left: `${50 + 41 * Math.cos(a)}%`, top: `${50 + 41 * Math.sin(a)}%` }}
            >
              <span
                className={`flex size-12 items-center justify-center rounded-full border bg-paper-50 shadow-[var(--e-1)] transition-transform ${i === sel ? 'scale-110 border-orange-500 ring-2 ring-orange-500' : 'border-paper-300'}`}
              >
                <TaskIcon name={SKILL_ICON[s.skill] ?? 'star'} size={28} />
              </span>
              <span className="t-small t-num inline-flex items-center gap-1 rounded-pill bg-paper-50/90 px-1.5 font-bold text-ink-800">
                <span className={`size-2 rounded-full ${BAND_BG[band(s.percent)]}`} aria-hidden />
                {s.percent}%
              </span>
            </button>
          )
        })}
      </div>

      {/* The chosen skill */}
      <div className={`flex min-w-0 flex-col gap-4 p-4 ${CARD}`}>
        <div className="flex items-center gap-3">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-orange-100">
            <TaskIcon name={SKILL_ICON[picked.skill] ?? 'star'} size={30} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="t-body truncate font-semibold text-ink-700">{name(picked.skill)}</span>
            <span className="t-display-2 t-num leading-none">{picked.percent}%</span>
          </span>
          <ChangeChip change={picked.change} title={t('work.changeHint')} />
        </div>
        <TopicList icon="flexed-biceps" label={t('work.strengths')} topics={picked.strengths} />
        <TopicList icon="bullseye" label={t('work.attention')} topics={picked.attention} />
        {!picked.strengths.length && !picked.attention.length && <p className="t-small text-ink-400">{t('work.fewData')}</p>}
      </div>
    </div>
  )
}

function TopicList({ icon, label, topics }: { icon: TaskIconName; label: string; topics: Topic[] }) {
  if (!topics.length) return null
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <span className="t-small inline-flex items-center gap-1.5 font-semibold text-ink-700">
        <TaskIcon name={icon} size={18} /> {label}
      </span>
      <ul className="flex flex-col gap-1">
        {topics.map((tp) => (
          <li key={tp.id}>
            <Link href={`/t/${tp.slug}/result`} className="press flex min-w-0 flex-col gap-1 rounded-md px-1 py-1 hover:bg-paper-200">
              <span className="flex items-center gap-2">
                <span className="t-small min-w-0 flex-1 truncate text-ink-700">{tp.title}</span>
                <span className="t-small t-num font-semibold">{tp.percent}%</span>
              </span>
              <span className="h-2 overflow-hidden rounded-pill bg-paper-200">
                <span className={`block h-full rounded-pill ${BAND_BG[band(tp.percent)]}`} style={{ width: `${Math.max(tp.percent, 3)}%` }} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

export type TrendPoint = { id: string; title: string; slug: string; percent: number; at: Date | null }

/** The latest homework scores as a line over a soft area, a dot each (its level's colour), the average dashed. Tap a dot. */
export function TrendChart({ points, average }: { points: TrendPoint[]; average: number | null }) {
  const { t } = useI18n()
  const gid = useId().replace(/:/g, '')
  const [sel, setSel] = useState<number | null>(null)
  // Drawn at its real width (text and dots keep their size on a phone and a wide screen alike)
  const box = useRef<HTMLDivElement>(null)
  const [W, setW] = useState(320)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.round(e!.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const H = 160
  const L = 8
  const Rt = 30
  const T = 10
  const B = 12
  const y = (v: number) => T + (1 - v / 100) * (H - T - B)
  const x = (i: number) => (points.length === 1 ? (L + W - Rt) / 2 : L + (i * (W - L - Rt)) / (points.length - 1))
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.percent)}`).join(' ')
  const area = `${line} L${x(points.length - 1)},${y(0)} L${x(0)},${y(0)} Z`
  const picked = sel !== null ? points[sel] : null
  const step = points.length > 1 ? (W - L - Rt) / (points.length - 1) : W

  return (
    <figure className="flex min-w-0 flex-col gap-2">
      <div ref={box} className="w-full min-w-0">
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block max-w-full" role="img" aria-label={points.map((p) => `${p.title} ${p.percent}%`).join(', ')} onMouseLeave={() => setSel(null)}>
          <defs>
            <linearGradient id={`${gid}-area`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--orange-500)" stopOpacity="0.35" />
              <stop offset="100%" stopColor="var(--orange-500)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0, 50, 100].map((v) => (
            <g key={v}>
              <line x1={L} x2={W - Rt + 6} y1={y(v)} y2={y(v)} stroke="var(--paper-300)" strokeWidth={1} />
              <text x={W - Rt + 10} y={y(v) + 3.5} className="fill-ink-400 text-[10px]">
                {v}
              </text>
            </g>
          ))}
          {average !== null && <line x1={L} x2={W - Rt + 6} y1={y(average)} y2={y(average)} stroke="var(--ink-500)" strokeWidth={1.5} strokeDasharray="5 4" />}
          {points.length > 1 && <path d={area} fill={`url(#${gid}-area)`} />}
          {points.length > 1 && <path d={line} fill="none" stroke="var(--orange-600)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
          {sel !== null && <line x1={x(sel)} x2={x(sel)} y1={T} y2={y(0)} stroke="var(--ink-400)" strokeWidth={1} />}
          {points.map((p, i) => (
            <circle
              key={p.id}
              cx={x(i)}
              cy={y(p.percent)}
              r={i === sel ? 6.5 : 4.5}
              fill={`var(--score-${band(p.percent)})`}
              stroke="var(--paper-50)"
              strokeWidth={2}
            />
          ))}
          {/* Bigger tap targets than the dots */}
          {points.map((p, i) => (
            <rect
              key={`hit-${p.id}`}
              x={x(i) - step / 2}
              y={0}
              width={step}
              height={H}
              fill="transparent"
              className="cursor-pointer"
              onClick={() => setSel(sel === i ? null : i)}
              onMouseEnter={() => setSel(i)}
            >
              <title>{`${p.title}: ${p.percent}%`}</title>
            </rect>
          ))}
        </svg>
      </div>
      <figcaption className="flex min-h-11 items-center gap-3 rounded-md bg-paper-200 px-3 py-2">
        {picked ? (
          <>
            <ScorePill percent={picked.percent} />
            <span className="t-small min-w-0 flex-1 truncate text-ink-700">{picked.title}</span>
            {picked.at && <span className="t-small t-num shrink-0 text-ink-400">{formatDate(new Date(picked.at))}</span>}
            <Link href={`/t/${picked.slug}/result`} className="shrink-0 text-ink-500" aria-label={t('work.openResult')}>
              <ChevronRight size={18} strokeWidth={ICON.strokeWidth} />
            </Link>
          </>
        ) : (
          <span className="t-small flex items-center gap-2 text-ink-500">
            <span className="inline-block w-5 border-t-2 border-dashed border-ink-500" aria-hidden /> {t('work.avgLine')}
          </span>
        )}
      </figcaption>
    </figure>
  )
}
