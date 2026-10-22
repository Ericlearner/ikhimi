'use client'
/**
 * My work's homework (design: the student understands from the picture, not from reading): a card per class that
 * opens to its homework, each line with its deadline or its score.
 */
import { CheckCircle2, ChevronDown, ChevronRight, Circle, Hourglass, PlayCircle } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { ICON, TaskIcon } from '@ikhimi/ui/components'
import { useI18n } from '@/i18n/client'
import { band, BAND_BG, CARD } from './bands'


export type WorkItem = {
  id: string
  title: string
  slug: string
  dueAt: Date | null
  status: 'new' | 'in_progress' | 'done'
  percent: number | null
  pending: boolean
  /** The class (or "online course") it came from */
  group: string | null
}

/** "Bugun", "Ertaga", "3 kun", or overdue — Seoul days */
export function useDueLabel() {
  const { t } = useI18n()
  return (dueAt: Date | null, now = new Date()) => {
    if (!dueAt) return null
    const day = (d: Date) => Math.floor((d.getTime() + 9 * 3600_000) / 86_400_000)
    const n = day(new Date(dueAt)) - day(now)
    if (new Date(dueAt) < now) return { text: t('work.overdue'), late: true }
    return { text: n <= 0 ? t('work.dueToday') : n === 1 ? t('work.dueTomorrow') : t('work.dueInDays', { n }), late: false }
  }
}

const DONE_SHOWN = 5

export type ClassHomework = { id: string; name: string; teacherName: string | null; items: WorkItem[] }

/**
 * One card per class: its name and how many to do; the homework appears only when the card is tapped (to do first,
 * then the latest done with their scores).
 */
export function ClassCard({ c }: { c: ClassHomework }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [all, setAll] = useState(false)
  // Started first, then the nearest deadline (the same order as the "next homework" card)
  const todo = c.items
    .filter((i) => i.status !== 'done')
    .sort((a, b) => (b.status === 'in_progress' ? 1 : 0) - (a.status === 'in_progress' ? 1 : 0) || (a.dueAt ? new Date(a.dueAt).getTime() : Infinity) - (b.dueAt ? new Date(b.dueAt).getTime() : Infinity))
  const done = c.items.filter((i) => i.status === 'done')
  const shownDone = all ? done : done.slice(0, DONE_SHOWN)
  return (
    <div className={`overflow-hidden ${todo.length ? 'rounded-2xl border-2 border-orange-500 bg-paper-50' : CARD}`}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="press flex w-full items-center gap-3 p-4 text-left">
        <TaskIcon name="books" size={32} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="t-h3 truncate">{c.name}</span>
          {c.teacherName && <span className="t-small truncate text-ink-500">{c.teacherName}</span>}
        </span>
        {todo.length > 0 ? (
          <span className="t-body t-num shrink-0 rounded-pill bg-orange-500 px-2.5 py-0.5 font-bold text-on-orange" aria-label={t('work.todoBadge', { n: todo.length })}>
            {todo.length}
          </span>
        ) : (
          <CheckCircle2 size={24} strokeWidth={ICON.strokeWidth} className="shrink-0 text-score-strong" aria-label={t('work.allDone')} />
        )}
        <ChevronDown size={20} strokeWidth={ICON.strokeWidth} className={`shrink-0 text-ink-400 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && (
        <div className="slide-down border-t-2 border-paper-300">
          {c.items.length === 0 ? (
            <p className="t-body px-4 py-3 text-ink-500">{t('work.classEmpty')}</p>
          ) : (
            <ul>
              {[...todo, ...shownDone].map((a) => (
                <HomeworkRow key={a.id} a={a} />
              ))}
            </ul>
          )}
          {!all && done.length > DONE_SHOWN && (
            <button type="button" onClick={() => setAll(true)} className="t-body min-h-11 w-full border-t border-paper-300 font-semibold text-ink-700">
              {t('work.showMore', { n: done.length - DONE_SHOWN })}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function HomeworkRow({ a }: { a: WorkItem }) {
  const { t } = useI18n()
  const due = useDueLabel()
  const Icon = a.status === 'done' ? (a.pending ? Hourglass : CheckCircle2) : a.status === 'in_progress' ? PlayCircle : Circle
  const d = a.status !== 'done' ? due(a.dueAt) : null
  return (
    <li className="border-b border-paper-300 last:border-b-0">
      <Link href={a.status === 'done' ? `/t/${a.slug}/result` : `/t/${a.slug}`} className="press flex min-h-14 items-center gap-3 px-4 py-2.5 hover:bg-paper-200">
        <Icon
          size={22}
          strokeWidth={ICON.strokeWidth}
          className={`shrink-0 ${a.status === 'in_progress' ? 'text-orange-500' : 'text-ink-400'}`}
          aria-label={t(a.status === 'done' ? 'work.statusDone' : a.status === 'in_progress' ? 'work.statusStarted' : 'work.statusNew')}
        />
        <span className="t-body min-w-0 flex-1 truncate font-medium">{a.title}</span>
        {d && <span className={`t-small t-num shrink-0 rounded-pill px-2 py-0.5 font-medium ${d.late ? 'bg-orange-100 text-orange-700' : 'bg-paper-200 text-ink-500'}`}>{d.text}</span>}
        {a.status === 'done' && (a.pending || a.percent === null ? <span className="t-body shrink-0 text-ink-400">…</span> : <ScorePill percent={a.percent} />)}
        <ChevronRight size={18} strokeWidth={ICON.strokeWidth} className="shrink-0 text-ink-400" aria-hidden />
      </Link>
    </li>
  )
}

/** The score with a dot in its level's colour (the number says it; the colour only helps) */
export function ScorePill({ percent }: { percent: number }) {
  return (
    <span className="t-body t-num inline-flex shrink-0 items-center gap-1.5 font-semibold text-ink-800">
      <span className={`size-2.5 rounded-full ${BAND_BG[band(percent)]}`} aria-hidden />
      {percent}%
    </span>
  )
}
