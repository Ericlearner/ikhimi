/**
 * Small, dependency-free SVG charts for progress pages. Server-renderable (no hooks), coloured through the
 * design tokens (currentColor + text-* classes, so dark mode follows), and each carries a visually hidden
 * table so screen readers get the numbers, not a picture.
 */
import type { ReactNode } from 'react'

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

export type ChartSeries = {
  label: string
  /** One value per x label; null = no data for that point (the line breaks there) */
  values: (number | null)[]
  /** Tailwind text colour class for the line, e.g. text-orange-500 */
  tone: string
  dashed?: boolean
}

function SrTable({ caption, head, rows }: { caption: string; head: string[]; rows: (string | number)[][] }) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          {head.map((h) => (
            <th key={h} scope="col">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((c, j) => (j === 0 ? <th key={j} scope="row">{c}</th> : <td key={j}>{c}</td>))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function ChartLegend({ items }: { items: { label: string; tone: string; dashed?: boolean }[] }) {
  return (
    <ul className="t-small flex flex-wrap gap-x-4 gap-y-1 text-ink-500" aria-hidden>
      {items.map((it) => (
        <li key={it.label} className="inline-flex items-center gap-1.5">
          <svg width="18" height="6" className={it.tone}>
            <line x1="1" y1="3" x2="17" y2="3" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray={it.dashed ? '3 4' : undefined} />
          </svg>
          {it.label}
        </li>
      ))}
    </ul>
  )
}

/** Percent over time (0–100). Several series share the axes, e.g. a student and their class average. */
export function LineChart({ labels, series, caption, height = 180 }: { labels: string[]; series: ChartSeries[]; caption: string; height?: number }) {
  const W = 600
  const H = height
  const pad = { l: 34, r: 12, t: 12, b: 24 }
  const n = Math.max(1, labels.length)
  const x = (i: number) => (n === 1 ? (pad.l + W - pad.r) / 2 : pad.l + (i * (W - pad.l - pad.r)) / (n - 1))
  const y = (v: number) => pad.t + (1 - Math.max(0, Math.min(100, v)) / 100) * (H - pad.t - pad.b)
  // Show at most ~6 x labels so they never collide on a phone
  const every = Math.max(1, Math.ceil(n / 6))

  return (
    <figure className="flex flex-col gap-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={caption}>
        {[0, 50, 100].map((g) => (
          <g key={g}>
            <line x1={pad.l} x2={W - pad.r} y1={y(g)} y2={y(g)} className="text-paper-300" stroke="currentColor" strokeWidth="1" />
            <text x={pad.l - 6} y={y(g) + 4} textAnchor="end" className="fill-ink-400 text-[11px]">
              {g}%
            </text>
          </g>
        ))}
        {labels.map((l, i) =>
          i % every === 0 || i === n - 1 ? (
            <text key={i} x={x(i)} y={H - 6} textAnchor="middle" className="fill-ink-400 text-[11px]">
              {l}
            </text>
          ) : null,
        )}
        {series.map((s) => {
          // Break the line at gaps
          const segs: string[] = []
          let cur = ''
          s.values.forEach((v, i) => {
            if (v === null) {
              if (cur) segs.push(cur)
              cur = ''
            } else cur += `${cur ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`
          })
          if (cur) segs.push(cur)
          return (
            <g key={s.label} className={s.tone}>
              {segs.map((d, i) => (
                <path key={i} d={d} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.dashed ? '5 6' : undefined} />
              ))}
              {!s.dashed &&
                s.values.map((v, i) => (v === null ? null : <circle key={i} cx={x(i)} cy={y(v)} r="4" fill="currentColor" className="stroke-paper-50" strokeWidth="2" />))}
            </g>
          )
        })}
      </svg>
      <ChartLegend items={series.map((s) => ({ label: s.label, tone: s.tone, dashed: s.dashed }))} />
      <SrTable caption={caption} head={['', ...series.map((s) => s.label)]} rows={labels.map((l, i) => [l, ...series.map((s) => (s.values[i] === null ? '—' : `${s.values[i]}%`))])} />
    </figure>
  )
}

/** Horizontal bars of a value (0–100) with an optional reference mark, e.g. a student vs the class. */
export function CompareBars({
  rows,
  caption,
  valueLabel,
  referenceLabel,
}: {
  rows: { label: ReactNode; key: string; value: number | null; reference?: number | null }[]
  caption: string
  valueLabel: string
  referenceLabel?: string
}) {
  const tone = (v: number) => (v >= 80 ? 'bg-success-600' : v >= 50 ? 'bg-orange-500' : 'bg-error-600')
  return (
    <figure className="flex flex-col gap-3">
      <ul className="flex flex-col gap-3" aria-hidden>
        {rows.map((r) => (
          <li key={r.key} className="flex flex-col gap-1">
            <span className="t-body flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate">{r.label}</span>
              <span className="t-num shrink-0 font-semibold">
                {r.value === null ? '—' : `${r.value}%`}
                {r.reference !== undefined && r.reference !== null && <span className="t-small ml-1.5 font-normal text-ink-400">/ {r.reference}%</span>}
              </span>
            </span>
            <span className="relative block h-2.5 rounded-pill bg-paper-200">
              {r.value !== null && <span className={cx('absolute inset-y-0 left-0 rounded-pill', tone(r.value))} style={{ width: `${Math.max(2, Math.min(100, r.value))}%` }} />}
              {r.reference !== undefined && r.reference !== null && (
                <span className="absolute -inset-y-1 w-0.5 rounded-pill bg-ink-800" style={{ left: `calc(${Math.min(100, r.reference)}% - 1px)` }} />
              )}
            </span>
          </li>
        ))}
      </ul>
      {referenceLabel && (
        <p className="t-small flex items-center gap-1.5 text-ink-500" aria-hidden>
          <span className="inline-block h-3 w-0.5 bg-ink-800" /> {referenceLabel}
        </p>
      )}
      <SrTable
        caption={caption}
        head={['', valueLabel, ...(referenceLabel ? [referenceLabel] : [])]}
        rows={rows.map((r) => [r.key, r.value === null ? '—' : `${r.value}%`, ...(referenceLabel ? [r.reference == null ? '—' : `${r.reference}%`] : [])])}
      />
    </figure>
  )
}

/** Vertical bars of counts, e.g. how many students scored 0–49%, 50–69%… */
export function Histogram({ buckets, caption, highlight }: { buckets: { label: string; count: number; tone?: string }[]; caption: string; highlight?: number }) {
  const max = Math.max(1, ...buckets.map((b) => b.count))
  return (
    <figure className="flex flex-col gap-2">
      <div className="flex h-36 items-end gap-2" aria-hidden>
        {buckets.map((b, i) => (
          <div key={b.label} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
            <span className="t-small t-num font-semibold text-ink-700">{b.count}</span>
            <span
              className={cx('w-full rounded-t-md', b.tone ?? 'bg-orange-400', highlight === i && 'ring-2 ring-ink-800 ring-offset-2 ring-offset-paper-50')}
              style={{ height: `${Math.max(3, (b.count / max) * 100)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-2" aria-hidden>
        {buckets.map((b) => (
          <span key={b.label} className="t-small flex-1 text-center text-ink-500">
            {b.label}
          </span>
        ))}
      </div>
      <SrTable caption={caption} head={['', '#']} rows={buckets.map((b) => [b.label, b.count])} />
    </figure>
  )
}

/** A tiny trend line for tables (no axes). */
export function Sparkline({ values, label, className }: { values: number[]; label: string; className?: string }) {
  if (values.length < 2) return <span className={cx('inline-block h-5 w-16', className)} aria-hidden />
  const W = 64
  const H = 20
  const x = (i: number) => (i * (W - 4)) / (values.length - 1) + 2
  const y = (v: number) => 2 + (1 - Math.max(0, Math.min(100, v)) / 100) * (H - 4)
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')
  const up = values[values.length - 1]! >= values[0]!
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={label} className={cx(up ? 'text-success-600' : 'text-error-600', className)}>
      <path d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}
