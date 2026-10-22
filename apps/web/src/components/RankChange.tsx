import { ArrowDown, ArrowUp } from 'lucide-react'

/** Places 1–3 */
export const MEDALS: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' }

/** ▲2 / ▼1: places gained or lost since the latest homework (nothing when it didn't move) */
export function RankChange({ change, label }: { change: number | null; label: (n: number) => string }) {
  if (!change) return <span className="w-8 shrink-0" />
  const up = change > 0
  const Icon = up ? ArrowUp : ArrowDown
  return (
    <span className={`t-small t-num inline-flex w-8 shrink-0 items-center gap-0.5 font-semibold ${up ? 'text-success-600' : 'text-error-600'}`} aria-label={label(change)} title={label(change)}>
      <Icon size={14} strokeWidth={2.5} aria-hidden />
      {Math.abs(change)}
    </span>
  )
}
