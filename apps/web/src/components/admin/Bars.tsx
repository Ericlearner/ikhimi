/** Daily counts as small bars (the shared charts are 0–100 % only). Server-rendered, no script. */
export function Bars({ data, caption, format = (n) => String(n), tone = 'bg-orange-500' }: { data: { day: string; n: number }[]; caption: string; format?: (n: number) => string; tone?: string }) {
  const max = Math.max(1, ...data.map((d) => d.n))
  const every = Math.max(1, Math.ceil(data.length / 7))
  return (
    <figure className="flex flex-col gap-2">
      <div className="flex h-32 items-end gap-[2px]" role="img" aria-label={caption}>
        {data.map((d) => (
          <div key={d.day} className="flex h-full min-w-0 flex-1 flex-col justify-end" title={`${d.day}: ${format(d.n)}`}>
            <div className={`rounded-t-sm ${d.n ? tone : 'bg-paper-200'}`} style={{ height: `${d.n ? Math.max(4, (d.n / max) * 100) : 2}%` }} />
          </div>
        ))}
      </div>
      <div className="t-small t-num flex gap-[2px] text-ink-400">
        {data.map((d, i) => (
          <span key={d.day} className="min-w-0 flex-1 overflow-visible whitespace-nowrap">
            {i % every === 0 ? d.day.slice(5).replace('-', '.') : ''}
          </span>
        ))}
      </div>
      <figcaption className="t-small text-ink-500">
        {caption} · max {format(max)}
      </figcaption>
    </figure>
  )
}

/** Panel with a heading, as every admin section looks */
export function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="t-h1">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

export const panel = 'rounded-lg border border-paper-300 bg-paper-50 p-4'

export const usd = (v: number) => (v >= 1 ? `$${v.toFixed(2)}` : v > 0 ? `$${v.toFixed(3)}` : '$0')
export const seconds = (ms: number | null | undefined) => (ms == null ? '—' : `${Math.round(ms / 1000)} s`)
