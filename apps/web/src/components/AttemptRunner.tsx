'use client'
import { ChevronLeft, CloudOff, Hourglass, Volume2, VolumeX } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, ICON, IconButton, ProgressBar, TaskIcon, type TaskIconName } from '@ikhimi/ui/components'
import { configureSound, getSoundSettings, play } from '@ikhimi/ui/sound'
import { useI18n } from '@/i18n/client'
import { localizeTf } from '@/lib/describe'
import { groupPages } from '@/lib/pages'
import { TUTOR_KINDS, type ExerciseKind, type PaidPlan, type PublicTutorNote } from '@ikhimi/ai'
import { ExerciseView, initialValue, isAnswered, type Feedback, type PublicExercise } from './ExerciseView'
import { PlanTeaser } from './PlanTeaser'
import { TutorCard } from './Tutor'

type Saved = { value: unknown; revision: number }
type Local = { answers: Record<string, Saved>; pending: string[]; activeSeconds: number; index: number }
export type ItemFeedback = Feedback & { explanation: string | null; correctText: string | null; tutor?: PublicTutorNote[] | null }

/** What the AI tutor can do in this homework: off, or on with this many explanations per wrong answer */
export type TutorAccess = { on: boolean; max: number }

const IDLE_MS = 60_000

/**
 * The student player (design spec §10–§11): one item per screen, check → instant feedback → continue.
 * Every change is written to localStorage immediately and queued for the server, so a killed browser,
 * dead battery or lost signal never loses an answer (main spec §16).
 */
/** Rotating cheers for a right answer, so it doesn't feel mechanical */
const CHEERS: TaskIconName[] = ['party-popper', 'clapping-hands', 'sparkles', 'thumbs-up', 'glowing-star']

/** Right answers in a row, counting back from item `upTo` (in exercise order, which survives a reload) */
export function streakUpTo(exercises: { id: string }[], feedback: Record<string, { isCorrect: boolean }>, upTo: number) {
  let n = 0
  for (let i = upTo; i >= 0; i--) {
    const f = feedback[exercises[i]!.id]
    if (!f?.isCorrect) break
    n++
  }
  return n
}

export function AttemptRunner({
  slug,
  attemptId,
  title,
  exercises,
  initial,
  initialFeedback,
  initialActiveSeconds,
  tutor = { on: false, max: 0 },
  locked = { pro: 0, vip: 0 },
  course = null,
  storeApp = false,
}: {
  slug: string
  attemptId: string
  title: string
  exercises: PublicExercise[]
  initial: Record<string, Saved>
  initialFeedback: Record<string, ItemFeedback>
  initialActiveSeconds: number
  tutor?: TutorAccess
  /** Items of this homework on a better plan than the student's (shown as a teaser, never as items) */
  locked?: Record<PaidPlan, number>
  /** A paid course's lesson, not bought: the teaser points to the course */
  course?: { slug: string; title: string } | null
  /** The Google Play app: the teaser points to no purchase */
  storeApp?: boolean
}) {
  const { t } = useI18n()
  const router = useRouter()
  const storageKey = `tl_attempt_${attemptId}`

  const pages = useMemo(() => groupPages(exercises), [exercises])
  const firstItem = Math.max(0, exercises.findIndex((e) => !initialFeedback[e.id]))
  // state.index is the PAGE the student is on
  const firstOpen = Math.max(0, pages.findIndex((p) => p.includes(firstItem)))
  const [state, setState] = useState<Local>(() => ({ answers: initial, pending: [], activeSeconds: initialActiveSeconds, index: firstOpen }))
  const [feedback, setFeedback] = useState<Record<string, ItemFeedback>>(initialFeedback)
  const [offlineSaved, setOfflineSaved] = useState<Record<string, boolean>>({})
  /** Writing the AI couldn't read right now: saved, graded at submit (or by the teacher) */
  const [aiLater, setAiLater] = useState<Record<string, boolean>>({})
  const [checking, setChecking] = useState(false)
  const [sync, setSync] = useState<'idle' | 'saving' | 'saved' | 'offline'>('idle')
  const [confirming, setConfirming] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [muted, setMuted] = useState(false)
  const stateRef = useRef(state)
  stateRef.current = state
  const lastInput = useRef(Date.now())
  const itemStart = useRef(Date.now())
  const timeOnItem = useRef<Record<string, number>>({})

  useEffect(() => setMuted(getSoundSettings().level === 'off'), [])

  // Restore anything this phone saved that the server hasn't seen (offline answers, killed tab)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      if (!raw) return
      const local = JSON.parse(raw) as Local
      setState((s) => {
        const answers = { ...s.answers }
        for (const [id, a] of Object.entries(local.answers)) if (!initialFeedback[id] && (!answers[id] || answers[id]!.revision < a.revision)) answers[id] = a
        return { ...s, answers, pending: [...new Set([...s.pending, ...local.pending.filter((id) => !initialFeedback[id])])], activeSeconds: Math.max(s.activeSeconds, local.activeSeconds) }
      })
    } catch {}
  }, [storageKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const persist = (s: Local) => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(s))
    } catch {}
  }

  // One save at a time: the autosave and the heartbeat used to send the same new answer together
  const saving = useRef<Promise<unknown>>(Promise.resolve())
  const flush = useCallback((override?: Local): Promise<boolean> => {
    const run = saving.current.then(() => send(override))
    saving.current = run.catch(() => {})
    return run
  }, [attemptId]) // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (override?: Local): Promise<boolean> => {
    const s = override ?? stateRef.current
    const ids = [...s.pending]
    if (!navigator.onLine && ids.length) {
      setSync('offline')
      return false
    }
    setSync('saving')
    try {
      const res = await fetch(`/api/attempts/${attemptId}/answer`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          answers: ids.map((id) => ({ exerciseId: id, value: s.answers[id]!.value, revision: s.answers[id]!.revision, timeSpentSec: Math.round((timeOnItem.current[id] ?? 0) / 1000) })),
          activeSeconds: s.activeSeconds,
        }),
      })
      if (!res.ok) throw new Error(String(res.status))
      setState((cur) => {
        const next = { ...cur, pending: cur.pending.filter((id) => !ids.includes(id) || cur.answers[id]?.revision !== s.answers[id]?.revision) }
        persist(next)
        return next
      })
      setSync('saved')
      return true
    } catch {
      setSync(navigator.onLine ? 'idle' : 'offline')
      return false
    }
  }

  // Debounced autosave, retry on reconnect, heartbeat for engaged time
  useEffect(() => {
    if (!state.pending.length) return
    const id = setTimeout(() => void flush(), 800)
    return () => clearTimeout(id)
  }, [state.pending, state.answers, flush])
  useEffect(() => {
    const online = () => {
      setOfflineSaved({}) // back online: offline-saved answers can be checked now
      void flush()
    }
    window.addEventListener('online', online)
    const beat = setInterval(() => void flush(), 20_000)
    return () => {
      window.removeEventListener('online', online)
      clearInterval(beat)
    }
  }, [flush])

  // Engaged time: a second counts only if the tab is visible and there was input in the last 60 s
  useEffect(() => {
    const mark = () => (lastInput.current = Date.now())
    const events = ['pointerdown', 'keydown', 'touchstart', 'scroll'] as const
    events.forEach((e) => window.addEventListener(e, mark, { passive: true }))
    const tick = setInterval(() => {
      if (document.visibilityState === 'visible' && Date.now() - lastInput.current < IDLE_MS) setState((s) => ({ ...s, activeSeconds: s.activeSeconds + 1 }))
    }, 1000)
    return () => {
      events.forEach((e) => window.removeEventListener(e, mark))
      clearInterval(tick)
    }
  }, [])

  const pageIndex = Math.min(state.index, pages.length - 1)
  const page = pages[pageIndex]!
  const pageItems = page.map((i) => exercises[i]!)
  const single = pageItems.length === 1
  const ex = pageItems[0]!
  const lastIdx = page.at(-1)!
  const total = exercises.length
  const answeredCount = exercises.filter((e) => feedback[e.id] || isAnswered(e, state.answers[e.id]?.value)).length
  const valueOf = (e: PublicExercise) => state.answers[e.id]?.value ?? initialValue(e)
  const value = valueOf(ex)
  const fb = feedback[ex.id] ?? null
  const isLast = pageIndex === pages.length - 1
  const streak = streakUpTo(exercises, feedback, lastIdx)
  const halfway = total >= 4 && !!fb && answeredCount === Math.ceil(total / 2)

  const changeFor = (id: string) => (v: unknown) =>
    setState((s) => {
      const next: Local = {
        ...s,
        answers: { ...s.answers, [id]: { value: v, revision: (s.answers[id]?.revision ?? 0) + 1 } },
        pending: s.pending.includes(id) ? s.pending : [...s.pending, id],
      }
      persist(next)
      return next
    })

  const go = (i: number) => {
    // Time on the page is shared by its items
    const spent = Date.now() - itemStart.current
    for (const e of pageItems) timeOnItem.current[e.id] = (timeOnItem.current[e.id] ?? 0) + spent / pageItems.length
    itemStart.current = Date.now()
    setConfirming(false)
    play('item.advance')
    setState((s) => {
      const next = { ...s, index: Math.max(0, Math.min(pages.length - 1, i)) }
      persist(next)
      return next
    })
    window.scrollTo({ top: 0 })
  }

  /** Grade one item on the server; it locks from here on. */
  const checkOne = async (e: PublicExercise, seconds: number): Promise<ItemFeedback | 'later' | 'offline' | null> => {
    const saved = stateRef.current.answers[e.id]
    if (!saved) return null
    try {
      const res = await fetch(`/api/attempts/${attemptId}/check`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ exerciseId: e.id, value: saved.value, revision: saved.revision, timeSpentSec: seconds }),
      })
      if (res.status === 503) {
        setAiLater((o) => ({ ...o, [e.id]: true }))
        return 'later'
      }
      if (!res.ok) throw new Error(String(res.status))
      const r = (await res.json()) as ItemFeedback
      setFeedback((f) => ({ ...f, [e.id]: r }))
      return r
    } catch {
      // No signal: the answer is safe on the phone and will be graded at submit
      setOfflineSaved((o) => ({ ...o, [e.id]: true }))
      setSync('offline')
      return 'offline'
    } finally {
      setState((s) => {
        const next = { ...s, pending: s.pending.filter((id) => id !== e.id) }
        persist(next)
        return next
      })
    }
  }

  /** Instant feedback (spec §9) for the whole page with one press. */
  const check = async () => {
    const todo = pageItems.filter(needsCheck)
    if (!todo.length) return
    setChecking(true)
    const seconds = Math.round((Date.now() - itemStart.current) / 1000 / todo.length)
    const results = await Promise.all(todo.map((e) => checkOne(e, seconds)))
    setChecking(false)
    const graded = results.filter((r): r is ItemFeedback => !!r && typeof r === 'object')
    if (!graded.length) return
    const all = { ...feedback, ...Object.fromEntries(todo.map((e, i) => [e.id, results[i]]).filter(([, r]) => r && typeof r === 'object')) }
    const nextStreak = streakUpTo(exercises, all as Record<string, { isCorrect: boolean }>, lastIdx)
    // A graded essay isn't "wrong": no buzzer for a Band 5. Three right in a row earns the streak sound.
    play(graded.some((r) => r.essay) ? 'attempt.submitted' : graded.some((r) => !r.isCorrect) ? 'answer.incorrect' : nextStreak >= 3 ? 'streak' : 'answer.correct')
  }

  const submit = async () => {
    setSubmitting(true)
    if (!(await flush())) {
      setSubmitting(false)
      return
    }
    const res = await fetch(`/api/attempts/${attemptId}/submit`, { method: 'POST' })
    if (!res.ok) {
      play('error')
      setSubmitting(false)
      setSync('offline')
      return
    }
    try {
      localStorage.removeItem(storageKey)
    } catch {}
    play('attempt.submitted')
    router.replace(`/t/${slug}/result`)
  }

  const toggleSound = () => {
    const nextMuted = !muted
    setMuted(nextMuted)
    configureSound({ level: nextMuted ? 'off' : 'normal' })
    if (!nextMuted) play('toggle')
    // Persist server-side so it follows the student across devices (spec §8)
    void fetch('/api/profile', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prefs: { sound: nextMuted ? 'off' : 'normal' } }) })
  }

  // An essay the teacher grades by hand: nothing to check now, the student just moves on
  const isTeacherEssay = (e: PublicExercise) => e.kind === 'essay' && e.payload.grader === 'teacher'
  const needsCheck = (e: PublicExercise) => !feedback[e.id] && !offlineSaved[e.id] && !aiLater[e.id] && !isTeacherEssay(e)
  const itemDone = (e: PublicExercise) => !!feedback[e.id] || !!offlineSaved[e.id] || !!aiLater[e.id] || (isTeacherEssay(e) && isAnswered(e, valueOf(e)))
  const pageRight = pageItems.filter((e) => feedback[e.id]?.isCorrect).length
  const pageChecked = pageItems.filter((e) => feedback[e.id]).length
  const syncLabel = sync === 'saving' ? t('student.saving') : sync === 'saved' ? `✓ ${t('student.saved')}` : sync === 'offline' ? t('student.offline') : ''
  const teacherEssay = isTeacherEssay(ex)
  // The page can be checked once every item still to check has an answer
  const toCheck = pageItems.filter(needsCheck)
  const canCheck = toCheck.length > 0 && toCheck.every((e) => isAnswered(e, valueOf(e)))
  const done = pageItems.every(itemDone)
  const writing = fb?.writing ?? null
  const essay = fb?.essay ?? null
  const okLines = writing ? writing.lines.filter((l) => l.ok).length : 0

  return (
    <div data-focus-mode className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-10 border-b border-paper-300 bg-paper-100/95 px-4 pb-2 pt-3 backdrop-blur">
        <div className="mx-auto flex max-w-2xl flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <span className="t-h3 truncate">{title}</span>
            <span className="flex shrink-0 items-center gap-1">
              {streak >= 2 && (
                <span key={streak} className="correct-pop t-small t-num inline-flex items-center gap-1 rounded-pill bg-orange-100 px-2.5 py-1 font-semibold text-orange-700" aria-label={t('player.streak', { n: streak })}>
                  <TaskIcon name="fire" size={18} /> {streak}
                </span>
              )}
              <span className="t-caption t-num text-ink-500">
                {single ? page[0]! + 1 : `${page[0]! + 1}–${lastIdx + 1}`} / {total}
              </span>
              <IconButton label={muted ? t('player.soundOn') : t('player.soundOff')} size={44} onClick={toggleSound}>
                {muted ? <VolumeX size={22} strokeWidth={ICON.strokeWidth} aria-hidden /> : <Volume2 size={22} strokeWidth={ICON.strokeWidth} aria-hidden />}
              </IconButton>
            </span>
          </div>
          <ProgressBar value={answeredCount} max={total} label={`${answeredCount} / ${total}`} />
          <p className={`t-small h-4 ${sync === 'offline' ? 'text-warn-600' : 'text-ink-400'}`} aria-live="polite">
            {syncLabel}
          </p>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-6">
        {(pageIndex === 0 || isLast) && <PlanTeaser locked={locked} course={course} className="mb-5" store={storeApp} />}
        {single ? (
          <div key={ex.id} className="card-enter">
            <ExerciseView ex={ex} value={value} onChange={changeFor(ex.id)} feedback={fb} attemptId={attemptId} />
            {fb && <Explain e={ex} f={fb} attemptId={attemptId} tutor={tutor} />}
          </div>
        ) : (
          <ol key={ex.id} className="card-enter flex flex-col gap-6">
            {pageItems.map((e, k) => {
              const f = feedback[e.id] ?? null
              return (
                <li key={e.id} className={k > 0 ? 'border-t border-paper-300 pt-6' : undefined}>
                  <p className="t-caption t-num mb-2 text-ink-400">{page[k]! + 1}</p>
                  {/* The instruction and the shared reading text are shown once, on the first item */}
                  <ExerciseView ex={e} value={valueOf(e)} onChange={changeFor(e.id)} feedback={f} hideInstruction={k > 0} hidePassage={k > 0} attemptId={attemptId} />
                  {f && <ItemResult f={f} kind={e.kind} />}
                  {f && <Explain e={e} f={f} attemptId={attemptId} tutor={tutor} compact />}
                  {aiLater[e.id] && !f && <p className="t-small mt-2 text-warn-600">{t('player.aiLater')}</p>}
                  {offlineSaved[e.id] && !f && <p className="t-small mt-2 text-warn-600">{t('player.savedOffline')}</p>}
                </li>
              )
            })}
          </ol>
        )}
      </main>

      <footer className="sticky bottom-0 z-10 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2">
        <div className="mx-auto flex max-w-2xl flex-col gap-2">
          {/* Feedback panel: tint + icon + words, never colour alone; explanation slides in */}
          <div aria-live="polite">
            {!single && pageChecked > 0 && done && (
              <div className={`slide-down rounded-lg border-2 px-4 py-3 ${pageRight === pageChecked ? 'border-success-600 bg-success-100' : 'border-orange-500 bg-orange-100'}`}>
                <p className={`t-h2 flex items-center gap-2.5 ${pageRight === pageChecked ? 'text-success-600' : 'text-ink-800'}`}>
                  <TaskIcon name={pageRight === pageChecked ? (streak >= 3 ? 'fire' : CHEERS[pageIndex % CHEERS.length]!) : 'light-bulb'} size={32} className={pageRight === pageChecked ? 'correct-pop' : undefined} />
                  {t('player.pageScore', { n: pageRight, total: pageChecked })}
                </p>
              </div>
            )}
            {single && fb && (
              <div className={`slide-down rounded-lg border-2 px-4 py-3 ${essay ? 'border-orange-500 bg-orange-100' : fb.isCorrect ? 'border-success-600 bg-success-100' : 'border-error-600 bg-error-100'}`}>
                <p className={`t-h2 flex items-center gap-2.5 ${essay ? 'text-ink-800' : fb.isCorrect ? 'text-success-600' : 'text-error-600'}`}>
                  <TaskIcon name={essay ? 'memo' : fb.isCorrect ? (streak >= 3 ? 'fire' : CHEERS[pageIndex % CHEERS.length]!) : 'light-bulb'} size={32} className={fb.isCorrect ? 'correct-pop' : undefined} />
                  {essay
                    ? t('player.essayGraded', { score: essay.overallLabel })
                    : writing
                    ? t(fb.isCorrect ? 'player.writingGood' : 'player.writingWork', { n: okLines, total: writing.lines.length })
                    : fb.isCorrect
                      ? t('player.correct')
                      : t('player.incorrect')}
                  {fb.isCorrect && streak >= 3 && <span className="t-body ml-auto font-semibold text-orange-700">{t('player.streak', { n: streak })}</span>}
                </p>
                {halfway && (
                  <p className="t-body mt-1 flex items-center gap-2 font-medium text-ink-700">
                    <TaskIcon name="flexed-biceps" size={22} /> {t('player.halfway')}
                  </p>
                )}
                {!fb.isCorrect && fb.correctText && (
                  <p className="t-body mt-1 text-ink-800">
                    {t('student.correctAnswer')}: <b>{ex.kind === 'true_false' ? localizeTf(t, fb.correctText) : fb.correctText}</b>
                  </p>
                )}
                {writing?.summary && <p className="t-body mt-1 text-ink-800">{writing.summary}</p>}
              </div>
            )}
            {single && teacherEssay && !fb && isAnswered(ex, value) && (
              <p className="t-body slide-down flex items-center gap-2 rounded-lg border border-paper-300 bg-paper-50 px-4 py-3 text-ink-700">
                <Hourglass size={20} strokeWidth={ICON.strokeWidth} aria-hidden /> {t('ex.teacherGrades')}
              </p>
            )}
            {single && aiLater[ex.id] && !fb && (
              <p className="t-body slide-down flex items-center gap-2 rounded-lg border border-warn-600 bg-warn-100 px-4 py-3 text-warn-600">
                <Hourglass size={20} strokeWidth={ICON.strokeWidth} aria-hidden /> {t('player.aiLater')}
              </p>
            )}
            {single && offlineSaved[ex.id] && !fb && (
              <p className="t-body slide-down flex items-center gap-2 rounded-lg border border-warn-600 bg-warn-100 px-4 py-3 text-warn-600">
                <CloudOff size={20} strokeWidth={ICON.strokeWidth} aria-hidden /> {t('player.savedOffline')}
              </p>
            )}
          </div>

          {confirming ? (
            <div className="flex flex-col gap-2 rounded-lg border border-paper-300 bg-paper-50 p-3 shadow-e3">
              <p className="t-body text-center font-medium">{t('student.confirmSubmit', { answered: answeredCount, total })}</p>
              <div className="flex gap-2">
                <Button variant="secondary" size="lg" onClick={() => setConfirming(false)} className="flex-1" disabled={submitting}>
                  {t('common.back')}
                </Button>
                <Button size="lg" onClick={submit} loading={submitting} className="flex-1">
                  {t('action.submit')}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              {pageIndex > 0 && (
                <IconButton label={t('student.prev')} size={48} tone="filled" onClick={() => go(pageIndex - 1)}>
                  <ChevronLeft size={26} strokeWidth={ICON.strokeWidth} aria-hidden />
                </IconButton>
              )}
              {!done ? (
                <Button size="xl" onClick={check} disabled={!canCheck} loading={checking}>
                  {t('player.check')}
                </Button>
              ) : isLast ? (
                <Button size="xl" onClick={() => setConfirming(true)}>
                  {t('action.submit')}
                </Button>
              ) : (
                <Button size="xl" onClick={() => go(pageIndex + 1)}>
                  {t('action.continue')}
                </Button>
              )}
            </div>
          )}
        </div>
      </footer>
    </div>
  )
}

/** A wrong answer's explanation: the AI tutor's own (VIP) or the homework's; written work has its own feedback */
function Explain({ e, f, attemptId, tutor, compact = false }: { e: PublicExercise; f: ItemFeedback; attemptId: string; tutor: TutorAccess; compact?: boolean }) {
  if (f.isCorrect || f.writing || f.essay) return null
  const vip = tutor.on && TUTOR_KINDS.includes(e.kind as ExerciseKind)
  return <TutorCard attemptId={attemptId} exerciseId={e.id} explanation={f.explanation} vip={vip} initialNotes={f.tutor} max={tutor.max} compact={compact} />
}

/** Under each item of a multi-item page: right or not, and the right answer (the explanation comes after) */
function ItemResult({ f, kind }: { f: ItemFeedback; kind: string }) {
  const { t } = useI18n()
  if (f.essay || f.writing) return null // shown inside the item itself
  return (
    <div className={`mt-2 rounded-md px-3 py-2 ${f.isCorrect ? 'bg-success-100' : 'bg-error-100'}`}>
      <p className={`t-body font-semibold ${f.isCorrect ? 'text-success-600' : 'text-error-600'}`}>{f.isCorrect ? t('player.correct') : t('player.incorrect')}</p>
      {!f.isCorrect && f.correctText && (
        <p className="t-body text-ink-800">
          {t('student.correctAnswer')}: <b>{kind === 'true_false' ? localizeTf(t, f.correctText) : f.correctText}</b>
        </p>
      )}
    </div>
  )
}
