'use client'
import { CheckCircle2, Pencil, RefreshCw, XCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button, ICON, IconButton } from '@ikhimi/ui/components'
import { useI18n } from '@/i18n/client'
import { postJson } from '@/lib/client'

export type ReviewLine = { text: string; ok: boolean | null; correction: string; feedback: string }
/** An essay in review: the text, the exam's criteria, and the current scores (AI's or the teacher's) */
export type ReviewEssay = {
  text: string
  length: number
  min: number
  max?: number
  unit: 'words' | 'chars'
  criteria: { id: string; name: string; max: number; score: number | null; feedback: string }[]
  overallLabel: string | null
  summary: string
  byTeacher: boolean
  teacherGrades: boolean
}

/**
 * One student answer in the teacher's report: what they wrote, how it was graded, and the teacher's
 * override (points, per-sentence verdicts for writing, a note to the student). The teacher's word is final.
 */
export function ResponseReview({
  responseId,
  n,
  answerText,
  isCorrect,
  points,
  maxPoints,
  writing,
  teacherFeedback,
  overridden,
  essay = null,
  accept = null,
}: {
  responseId: string | null
  n: number
  answerText: string
  isCorrect: boolean | null
  points: number | null
  maxPoints: number
  writing: { lines: ReviewLine[]; summary: string; byTeacher: boolean } | null
  teacherFeedback: string | null
  overridden: boolean
  essay?: ReviewEssay | null
  /** Typed answers marked wrong that the teacher can accept for everyone (url: the item's accept endpoint) */
  accept?: { url: string; items: { blank: number | null; text: string }[] } | null
}) {
  const { t } = useI18n()
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [lines, setLines] = useState<boolean[]>(writing?.lines.map((l) => !!l.ok) ?? [])
  const [pts, setPts] = useState(String(points ?? 0))
  const [scores, setScores] = useState<Record<string, string>>(() => Object.fromEntries((essay?.criteria ?? []).map((c) => [c.id, c.score === null ? '' : String(c.score)])))
  const [note, setNote] = useState(teacherFeedback ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const pending = points === null

  // Flipping a sentence re-proposes the points; the teacher can still type their own
  const flip = (i: number) => {
    const next = lines.map((v, j) => (j === i ? !v : v))
    setLines(next)
    if (writing?.lines.length) setPts(String(Math.round((next.filter(Boolean).length / writing.lines.length) * maxPoints * 100) / 100))
  }

  const save = async () => {
    if (!responseId) return
    setBusy(true)
    setError(false)
    const { ok } = await postJson(
      `/api/responses/${responseId}`,
      {
        points: Math.max(0, Math.min(maxPoints, Number(pts) || 0)),
        teacherFeedback: note.trim() || null,
        ...(writing ? { lines } : {}),
        ...(essay ? { criteria: Object.fromEntries(essay.criteria.map((c) => [c.id, Math.max(0, Math.min(c.max, Number(scores[c.id]) || 0))])) } : {}),
      },
      'PATCH',
    )
    setBusy(false)
    if (!ok) return setError(true)
    setEditing(false)
    router.refresh()
  }

  const icon =
    pending ? (
      <span className="t-small mt-0.5 w-4 text-center text-warn-600" aria-label={t('report.pending')}>
        ⏳
      </span>
    ) : isCorrect ? (
      <CheckCircle2 size={16} strokeWidth={ICON.strokeWidth} className="mt-0.5 shrink-0 text-success-600" aria-label={t('result.correct')} />
    ) : isCorrect === false ? (
      <XCircle size={16} strokeWidth={ICON.strokeWidth} className="mt-0.5 shrink-0 text-error-600" aria-label={t('result.incorrect')} />
    ) : (
      <span className="w-4 text-center text-ink-400">·</span>
    )

  return (
    <li className="t-small flex flex-col gap-1 py-1">
      <div className="flex items-start gap-2">
        {icon}
        <span className="t-num text-ink-400">{n}.</span>
        <span className="min-w-0 flex-1">
          {essay ? (
            <span className="flex flex-col gap-1">
              <details>
                <summary className="cursor-pointer text-ink-700">
                  {essay.text.trim() ? `${essay.text.trim().slice(0, 90)}${essay.text.trim().length > 90 ? '…' : ''}` : '—'}{' '}
                  <span className="t-num text-ink-400">
                    ({essay.length} {t(essay.unit === 'chars' ? 'ex.chars' : 'ex.words')}, {essay.min}
                    {essay.max ? `–${essay.max}` : '+'})
                  </span>
                </summary>
                <p className="t-body mt-1 whitespace-pre-line rounded-md bg-paper-50 p-3 text-ink-800">{essay.text}</p>
              </details>
              {essay.overallLabel && <span className="t-body font-semibold">{essay.overallLabel}</span>}
              {essay.criteria.some((c) => c.score !== null) && (
                <span className="flex flex-col gap-0.5">
                  {essay.criteria.map((c) => (
                    <span key={c.id}>
                      <span className="t-num font-medium">
                        {c.name}: {c.score ?? '—'}/{c.max}
                      </span>
                      {c.feedback && <span className="text-ink-500"> — {c.feedback}</span>}
                    </span>
                  ))}
                </span>
              )}
              {essay.summary && <span className="rounded-md bg-paper-200 px-2 py-1 text-ink-700">{essay.summary}</span>}
              <span className="text-ink-400">
                {essay.byTeacher ? t('report.gradedByTeacher') : pending ? (essay.teacherGrades ? t('report.yourTurn') : t('report.pending')) : t('report.gradedByAi')}
              </span>
            </span>
          ) : writing ? (
            <span className="flex flex-col gap-1">
              {writing.lines.map((l, i) =>
                l.text.trim() ? (
                  <span key={i} className="flex flex-col">
                    <span className={l.ok === null ? 'text-ink-800' : l.ok ? 'text-success-600' : 'text-error-600'}>
                      {i + 1}. {l.text}
                    </span>
                    {l.ok === false && l.correction && l.correction !== l.text && <span className="text-ink-700">✓ {l.correction}</span>}
                    {l.ok === false && l.feedback && <span className="text-ink-500">{l.feedback}</span>}
                  </span>
                ) : null,
              )}
              {writing.summary && <span className="rounded-md bg-paper-200 px-2 py-1 text-ink-700">{writing.summary}</span>}
              <span className="text-ink-400">{writing.byTeacher ? t('report.gradedByTeacher') : pending ? t('report.pending') : t('report.gradedByAi')}</span>
            </span>
          ) : (
            answerText
          )}
          {accept && accept.items.length > 0 && <AcceptAnswers url={accept.url} items={accept.items} />}
          {teacherFeedback && !editing && <span className="mt-1 block text-orange-700">{t('result.teacherNote')}: {teacherFeedback}</span>}
        </span>
        <span className="t-num shrink-0 text-ink-500">
          {pending ? '…' : points}/{maxPoints}
          {overridden && ' ✎'}
        </span>
        {responseId && !editing && (
          <IconButton label={t('report.adjust')} size={36} onClick={() => setEditing(true)}>
            <Pencil size={16} strokeWidth={ICON.strokeWidth} aria-hidden />
          </IconButton>
        )}
      </div>

      {editing && (
        <div className="slide-down ml-6 flex flex-col gap-2 rounded-md border border-paper-300 bg-paper-50 p-3">
          {writing && (
            <div className="flex flex-col gap-1">
              {writing.lines.map((l, i) =>
                l.text.trim() ? (
                  <label key={i} className="flex min-h-10 cursor-pointer items-center gap-2">
                    <input type="checkbox" checked={lines[i] ?? false} onChange={() => flip(i)} className="size-5 accent-orange-500" />
                    <span className="text-ink-800">
                      {i + 1}. {l.text}
                    </span>
                  </label>
                ) : null,
              )}
            </div>
          )}
          {essay && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {essay.criteria.map((c) => (
                <label key={c.id} className="flex items-center justify-between gap-2">
                  <span className="text-ink-700">{c.name}</span>
                  <span className="flex items-center gap-1">
                    <input
                      type="number"
                      min={0}
                      max={c.max}
                      step={1}
                      value={scores[c.id] ?? ''}
                      onChange={(e) => setScores((x) => ({ ...x, [c.id]: e.target.value }))}
                      className="t-body min-h-10 w-16 rounded-md border border-paper-300 bg-paper-50 px-2"
                    />
                    <span className="t-num text-ink-500">/ {c.max}</span>
                  </span>
                </label>
              ))}
            </div>
          )}
          <label className={`flex items-center gap-2 ${essay ? 'hidden' : ''}`}>
            <span className="text-ink-500">{t('report.points')}</span>
            <input
              type="number"
              min={0}
              max={maxPoints}
              step={0.5}
              value={pts}
              onChange={(e) => setPts(e.target.value)}
              className="t-body min-h-10 w-24 rounded-md border border-paper-300 bg-paper-50 px-2"
            />
            <span className="t-num text-ink-500">/ {maxPoints}</span>
          </label>
          <textarea
            rows={2}
            value={note}
            maxLength={1000}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('report.notePlaceholder')}
            className="t-body w-full rounded-md border border-paper-300 bg-paper-50 px-3 py-2"
          />
          {error && <p className="font-medium text-error-600">{t('error.generic')}</p>}
          <div className="flex gap-2">
            <Button size="sm" onClick={save} loading={busy}>
              {t('action.save')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      )}
    </li>
  )
}

/** "Grade again": retry the AI on an attempt's ungraded writing. */
export function RegradeButton({ attemptId }: { attemptId: string }) {
  const { t } = useI18n()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        size="sm"
        variant="secondary"
        loading={busy}
        icon={<RefreshCw size={16} strokeWidth={ICON.strokeWidth} aria-hidden />}
        onClick={async () => {
          setBusy(true)
          const { ok, json } = await postJson(`/api/attempts/${attemptId}/regrade`, {})
          setBusy(false)
          setFailed(!ok || Number(json.failed) > 0)
          router.refresh()
        }}
      >
        {t('report.regrade')}
      </Button>
      {failed && <span className="t-small text-warn-600">{t('report.regradeFailed')}</span>}
    </span>
  )
}

/** "This is right too": adds the student's answer to the item and re-scores every student who wrote it */
function AcceptAnswers({ url, items }: { url: string; items: { blank: number | null; text: string }[] }) {
  const { t } = useI18n()
  const router = useRouter()
  const [busy, setBusy] = useState<number | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const accept = async (i: number) => {
    const it = items[i]!
    setBusy(i)
    setFailed(false)
    const { ok, json } = await postJson(url, { text: it.text, blank: it.blank })
    setBusy(null)
    if (!ok) return setFailed(true)
    setDone(t('report.acceptedFor', { n: Number(json.nowRight) || 0 }))
    router.refresh()
  }
  return (
    <span className="mt-1 flex flex-wrap items-center gap-1.5">
      {items.map((it, i) => (
        <button
          key={i}
          type="button"
          disabled={busy !== null}
          onClick={() => void accept(i)}
          className="t-small inline-flex min-h-8 items-center gap-1 rounded-pill border border-success-600 px-2.5 font-medium text-success-600 hover:bg-success-100 disabled:opacity-60"
        >
          <CheckCircle2 size={14} strokeWidth={ICON.strokeWidth} aria-hidden /> {t('report.acceptAnswer', { answer: it.text })}
        </button>
      ))}
      {done && <span className="t-small text-success-600">{done}</span>}
      {failed && <span className="t-small text-error-600">{t('error.generic')}</span>}
    </span>
  )
}
