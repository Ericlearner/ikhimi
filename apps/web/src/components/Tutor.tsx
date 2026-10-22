'use client'
import { RotateCcw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { PublicTutorNote, PublicTutorPractice } from '@ikhimi/ai'
import { Button, ICON, Input, TaskIcon } from '@ikhimi/ui/components'
import { useI18n } from '@/i18n/client'

export type TutorMood = 'idle' | 'thinking' | 'talking'

/**
 * The tutor's face. A placeholder owl for now: the animated mascot replaces this one component and keeps its
 * moods (idle, thinking while the AI writes, talking when an explanation arrives).
 */
export function TutorAvatar({ mood, size = 44 }: { mood: TutorMood; size?: number }) {
  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center rounded-full bg-orange-100 ${mood === 'thinking' ? 'tutor-thinking' : mood === 'talking' ? 'tutor-talking' : ''}`}
      style={{ width: size, height: size }}
    >
      <TaskIcon name="owl" size={Math.round(size * 0.72)} />
    </span>
  )
}

/** A button the student may press under the tutor's reply */
type Ask = 'simpler' | 'example' | 'practice'
const ASKS = [
  { mode: 'simpler', key: 'tutor.simpler' },
  { mode: 'example', key: 'tutor.anotherExample' },
  { mode: 'practice', key: 'tutor.practice' },
] as const satisfies readonly { mode: Ask; key: string }[]

/**
 * Under a wrong answer: the tutor explains it. VIP: a personal explanation of this student's mistake (asked for
 * once, kept on the server), then buttons, no typing (young children): "I don't get it", "another example",
 * "let me practise", up to `max` replies in all. Everyone else: the homework's own explanation, in the same voice.
 */
export function TutorCard({
  attemptId,
  exerciseId,
  explanation,
  vip,
  initialNotes,
  max,
  compact = false,
}: {
  attemptId: string
  exerciseId: string
  /** The explanation written with the homework (null when the teacher hides answers) */
  explanation: string | null
  vip: boolean
  initialNotes: PublicTutorNote[] | null | undefined
  max: number
  compact?: boolean
}) {
  const { t } = useI18n()
  const [notes, setNotes] = useState<PublicTutorNote[]>(initialNotes ?? [])
  const [status, setStatus] = useState<'ready' | 'thinking' | 'error'>(vip && !initialNotes?.length ? 'thinking' : 'ready')
  const [failed, setFailed] = useState<Ask | null>(null)
  const [mood, setMood] = useState<TutorMood>('idle')
  const [noMore, setNoMore] = useState(false)
  const card = useRef<HTMLDivElement>(null)
  const latest = useRef<HTMLDivElement>(null)
  const asked = useRef(false)

  const post = async (body: Record<string, unknown>) => {
    const res = await fetch(`/api/attempts/${attemptId}/tutor`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ exerciseId, ...body }),
    })
    if (res.status === 409) return null
    if (!res.ok) throw new Error(String(res.status))
    return ((await res.json()) as { notes: PublicTutorNote[] }).notes
  }

  const ask = async (mode?: Ask) => {
    setStatus('thinking')
    setMood('thinking')
    setFailed(null)
    try {
      const next = await post({ mode })
      if (!next) {
        setNoMore(true)
        setStatus('ready')
        setMood('idle')
        return
      }
      setNotes(next)
      setStatus('ready')
      setMood('talking')
      setTimeout(() => setMood('idle'), 600)
    } catch {
      setFailed(mode ?? null)
      setStatus('error')
      setMood('idle')
    }
  }

  /** The student's practice answer: checked on the server, no AI; one try */
  const answer = async (index: number, value: number | string) => {
    try {
      const next = await post({ practice: { index, value } })
      if (next) setNotes(next)
    } catch {
      setStatus('error')
    }
  }

  // The first explanation comes by itself, once
  useEffect(() => {
    if (!vip || asked.current || initialNotes?.length) return
    asked.current = true
    void ask()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // What the tutor says next is brought up under the header, clear of the verdict panel at the bottom
  // (one item per screen; a page of several items isn't scrolled about)
  useEffect(() => {
    if (compact || status === 'error') return
    ;(notes.length > 1 && status === 'ready' ? latest.current : card.current)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [status, notes.length, compact])

  if (!vip && !explanation) return null
  const shown = vip ? notes : []
  const fallback = !vip || (status === 'error' && !notes.length)
  const used = notes.length >= max || noMore

  return (
    <div ref={card} className={`slide-down flex scroll-mt-32 gap-3 rounded-lg border border-orange-400 bg-paper-50 ${compact ? 'mt-2 p-3' : 'mt-4 p-4'}`} aria-live="polite">
      <TutorAvatar mood={mood} size={compact ? 36 : 44} />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="t-small font-semibold text-orange-700">{vip ? t('tutor.name') : t('tutor.note')}</p>

        {fallback && explanation && <p className="t-tutor text-ink-800">{explanation}</p>}

        {shown.map((n, i) => (
          <div key={i} ref={i === shown.length - 1 ? latest : undefined} className={`flex scroll-mt-32 flex-col gap-1 ${i > 0 ? 'border-t border-paper-300 pt-2' : ''}`}>
            <p className="t-tutor text-ink-800">{n.text}</p>
            {n.example && (
              <p className="t-body text-ink-700">
                <span className="font-semibold">{t('tutor.example')}:</span> {n.example}
              </p>
            )}
            {n.practice && <Practice p={n.practice} onAnswer={(v) => answer(i, v)} />}
          </div>
        ))}

        {vip && status === 'thinking' && (
          <p className="t-tutor flex items-center gap-1 text-ink-500">
            {t('tutor.thinking')}
            <span className="tutor-dots" aria-hidden>
              <span>.</span>
              <span>.</span>
              <span>.</span>
            </span>
          </p>
        )}

        {vip && status === 'error' && (
          <div className="flex flex-wrap items-center gap-2">
            <p className="t-small text-warn-600">{t('tutor.busy')}</p>
            <Button size="sm" variant="secondary" onClick={() => void ask(notes.length ? (failed ?? undefined) : undefined)}>
              <RotateCcw size={16} strokeWidth={ICON.strokeWidth} aria-hidden /> {t('tutor.retry')}
            </Button>
          </div>
        )}

        {vip && status === 'ready' && notes.length > 0 && !used && (
          <div className="flex flex-wrap gap-2">
            {ASKS.map((a) => (
              <Button key={a.mode} size="sm" variant="secondary" className="h-auto whitespace-normal py-2 text-left" onClick={() => void ask(a.mode)}>
                {t(a.key)}
              </Button>
            ))}
          </div>
        )}

        {vip && status === 'ready' && notes.length > 0 && used && <p className="t-small text-ink-600">{t('tutor.done')}</p>}
      </div>
    </div>
  )
}

/** The tutor's practice item: tap an option, or write the blank; once answered it shows how it went, never red */
function Practice({ p, onAnswer }: { p: PublicTutorPractice; onAnswer: (value: number | string) => Promise<void> }) {
  const { t } = useI18n()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const done = p.given !== undefined
  const send = async (v: number | string) => {
    if (busy || done) return
    setBusy(true)
    await onAnswer(v)
    setBusy(false)
  }

  return (
    <div className="mt-1 flex flex-col gap-2 rounded-md border border-paper-300 bg-paper-100 p-3">
      <p className="t-body font-semibold text-ink-800">{p.question}</p>
      {p.options ? (
        <div className="flex flex-wrap gap-2">
          {p.options.map((o, i) => {
            const picked = done && o === p.given
            const right = done && p.answers?.includes(o)
            // Answered: plain chips, so the colours aren't dimmed like a disabled button
            if (done)
              return (
                <span
                  key={i}
                  className={`t-small inline-flex items-center rounded-full border-2 px-4 py-2 font-semibold ${right ? 'border-success-600 bg-success-100 text-success-600' : picked ? 'border-orange-500 bg-orange-100 text-ink-800' : 'border-paper-300 text-ink-500'}`}
                >
                  {o}
                </span>
              )
            return (
              <Button
                key={i}
                size="sm"
                variant="secondary"
                disabled={busy}
                className="h-auto whitespace-normal py-2"
                onClick={() => void send(i)}
              >
                {o}
              </Button>
            )
          })}
        </div>
      ) : done ? (
        <p className="t-body text-ink-700">
          {t('tutor.yourAnswer')}: <span className="font-semibold">{p.given}</span>
        </p>
      ) : (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (text.trim()) void send(text.trim())
          }}
        >
          <Input value={text} onChange={(e) => setText(e.target.value)} maxLength={200} aria-label={t('tutor.yourAnswer')} className="min-w-0 flex-1" autoComplete="off" />
          <Button size="sm" type="submit" disabled={busy || !text.trim()}>
            {t('tutor.check')}
          </Button>
        </form>
      )}
      {done && (
        <div className={`rounded-md px-3 py-2 ${p.right ? 'bg-success-100' : 'bg-orange-100'}`}>
          <p className={`t-body font-semibold ${p.right ? 'text-success-600' : 'text-ink-800'}`}>
            {p.right ? t('tutor.practiceRight') : t('tutor.practiceAnswer', { answer: p.answers?.[0] ?? '' })}
          </p>
          {p.why && <p className="t-small text-ink-700">{p.why}</p>}
        </div>
      )}
    </div>
  )
}
