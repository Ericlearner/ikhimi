'use client'
import { Clock } from 'lucide-react'
import { ICON } from '@ikhimi/ui/components'
import { useDueLabel } from './WorkCharts'

/** "Bugun", "Ertaga", "3 kun", or overdue (orange) — the deadline in one or two words */
export function DueChip({ dueAt }: { dueAt: Date | null }) {
  const d = useDueLabel()(dueAt)
  if (!d) return null
  return (
    <span className={`t-small t-num inline-flex items-center gap-1 rounded-pill px-2.5 py-1 font-semibold ${d.late ? 'bg-orange-500 text-on-orange' : 'bg-paper-50 text-ink-700'}`}>
      <Clock size={14} strokeWidth={ICON.strokeWidth} aria-hidden /> {d.text}
    </span>
  )
}
