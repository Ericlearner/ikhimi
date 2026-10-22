'use client'
import { X } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import type { MessageKey } from '@ikhimi/i18n'
import { Button, ICON, ProgressBar, TaskIcon } from '@ikhimi/ui/components'
import { play } from '@ikhimi/ui/sound'
import { useI18n } from '@/i18n/client'
import { localizeTf } from '@/lib/describe'
import { postJson } from '@/lib/client'
import { ExerciseView, initialValue, isAnswered, type Feedback, type PublicExercise } from './ExerciseView'

type Item = { itemId: string; homework: string; ex: PublicExercise }
type Result = Feedback & { learned: boolean; correctText: string | null; explanation: string | null }

/**
 * Old mistakes, asked again (server/review.ts): one item per screen, check → the answer and why → next. Nothing is
 * scored; the summary says how many were right and that the rest come back in a couple of days.
 */
/** `back`: where the student came from (My work, or the apps' Xatolar tab) */
export function ReviewRunner({ items, back = { href: '/work', label: 'review.back' } }: { items: Item[]; back?: { href: string; label: MessageKey } }) {
  const { t } = useI18n()
  const [index, setIndex] = useState(0)
  const [values, setValues] = useState<Record<string, unknown>>(() => Object.fromEntries(items.map((i) => [i.itemId, initialValue(i.ex)])))
  const [results, setResults] = useState<Record<string, Result>>({})
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState(false)
  const [finished, setFinished] = useState(false)

  const item = items[index]!
  const value = values[item.itemId]
  const fb = results[item.itemId] ?? null
  const right = Object.values(results).filter((r) => r.isCorrect).length

  const check = async () => {
    setChecking(true)
    setError(false)
    const { ok, json } = await postJson(`/api/review/${item.itemId}`, { value })
    setChecking(false)
    if (!ok) {
      play('error')
      return setError(true)
    }
    const r = json as unknown as Result
    play(r.isCorrect ? 'answer.correct' : 'answer.incorrect')
    setResults((x) => ({ ...x, [item.itemId]: r }))
  }

  const next = () => {
    if (index + 1 < items.length) setIndex(index + 1)
    else {
      play('result.good')
      setFinished(true)
    }
  }

  if (finished) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-2xl flex-col items-center justify-center gap-4 px-4 py-10 text-center">
        <TaskIcon name={right === items.length ? 'trophy' : 'flexed-biceps'} size={72} className="correct-pop" />
        <h1 className="t-display-2">{t('review.doneTitle', { n: right, total: items.length })}</h1>
        <p className="t-body measure text-ink-700">{t(right === items.length ? 'review.doneAll' : 'review.doneSome')}</p>
        <Link href={back.href} className="btn btn-primary btn-lg">
          <span className="btn-label">{t(back.label)}</span>
        </Link>
      </main>
    )
  }

  return (
    <div data-focus-mode className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-10 border-b border-paper-300 bg-paper-100/95 px-4 pb-2 pt-3 backdrop-blur">
        <div className="mx-auto flex max-w-2xl flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 flex-col">
              <span className="t-h3 truncate">{t('review.title')}</span>
              <span className="t-small truncate text-ink-500">{t('review.from', { title: item.homework })}</span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              <span className="t-caption t-num text-ink-500">
                {index + 1} / {items.length}
              </span>
              <Link href={back.href} aria-label={t(back.label)} className="inline-flex size-11 items-center justify-center rounded-full text-ink-500 hover:bg-paper-200">
                <X size={22} strokeWidth={ICON.strokeWidth} aria-hidden />
              </Link>
            </span>
          </div>
          <ProgressBar value={index + (fb ? 1 : 0)} max={items.length} label={`${index + (fb ? 1 : 0)} / ${items.length}`} />
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-6">
        <div key={item.itemId} className="card-enter">
          <ExerciseView ex={item.ex} value={value} onChange={(v) => setValues((x) => ({ ...x, [item.itemId]: v }))} feedback={fb} />
          {fb && !fb.isCorrect && fb.explanation && <p className="t-body mt-4 rounded-lg border border-paper-300 bg-paper-50 px-4 py-3 text-ink-700">{fb.explanation}</p>}
        </div>
      </main>

      <footer className="sticky bottom-0 z-10 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2">
        <div className="mx-auto flex max-w-2xl flex-col gap-2">
          <div aria-live="polite">
            {fb && (
              <div className={`slide-down rounded-lg border-2 px-4 py-3 ${fb.isCorrect ? 'border-success-600 bg-success-100' : 'border-orange-500 bg-orange-100'}`}>
                <p className={`t-h2 flex items-center gap-2.5 ${fb.isCorrect ? 'text-success-600' : 'text-ink-800'}`}>
                  <TaskIcon name={fb.isCorrect ? 'sparkles' : 'light-bulb'} size={32} className={fb.isCorrect ? 'correct-pop' : undefined} />
                  {fb.isCorrect ? (fb.learned ? t('review.learnedNow') : t('player.correct')) : t('review.again')}
                </p>
                {!fb.isCorrect && fb.correctText && (
                  <p className="t-body mt-1 text-ink-800">
                    {t('student.correctAnswer')}: <b>{item.ex.kind === 'true_false' ? localizeTf(t, fb.correctText) : fb.correctText}</b>
                  </p>
                )}
              </div>
            )}
            {error && <p className="t-small text-error-600">{t('error.generic')}</p>}
          </div>
          {fb ? (
            <Button size="xl" onClick={next}>
              {index + 1 < items.length ? t('action.continue') : t('review.finish')}
            </Button>
          ) : (
            <Button size="xl" onClick={check} disabled={!isAnswered(item.ex, value)} loading={checking}>
              {t('player.check')}
            </Button>
          )}
        </div>
      </footer>
    </div>
  )
}
