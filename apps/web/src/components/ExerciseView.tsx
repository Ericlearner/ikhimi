'use client'
import { BookOpen, CheckCircle2, Headphones, Mic, Pause, Play, Square, Undo2, Volume2, XCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { lineFinished, MAX_TRIES, shadowFinished, type ShadowLine, type ShadowValue } from '@ikhimi/ai/shadow-shape'
import type { MessageKey } from '@ikhimi/i18n'
import { ICON, KIND_TASK_ICON, TaskIcon } from '@ikhimi/ui/components'
import { play, type SoundEvent } from '@ikhimi/ui/sound'
import { textLength } from '@ikhimi/ai/exams'
import { useI18n } from '@/i18n/client'
import { micSupported, startRecording, type Recording } from '@/lib/recorder'

export type PublicExercise = {
  id: string
  kind: string
  prompt: string
  payload: Record<string, unknown>
  points: number
  /** Listening: the recording to play before answering */
  audioUrl?: string | null
  /** A picture from the teacher's material the question is about */
  imageUrl?: string | null
}

/** The AI's (or teacher's) verdict on each written sentence; `correction` is null when answers are hidden */
export type WritingView = { lines: { ok: boolean; feedback: string; correction: string | null }[]; summary: string; byTeacher?: boolean }

/** An essay's grade: per-criterion scores on the exam's scale, overall ("Band 6.5"), and advice */
export type EssayView = {
  criteria: { name: string; score: number; max: number; feedback: string }[]
  overallLabel: string
  overall: number
  overallMax: number
  levelEstimate: string
  strengths: string[]
  improvements: string[]
  corrections: { original: string; corrected: string; why: string }[]
  summary: string
  length: number
  byTeacher?: boolean
}

/** What the student sees after checking (spec §9). `correctValue` is null when answers are hidden. */
export type Feedback = { isCorrect: boolean; correctValue: unknown | null; parts?: boolean[] | null; writing?: WritingView | null; essay?: EssayView | null }

type EssayPayload = {
  taskLabel?: string
  exam?: string
  min: number
  max?: number
  grader?: 'ai' | 'teacher'
  scale: { criteria: { id: string; name: string; max: number }[]; unit: 'words' | 'chars' }
}



const INSTRUCTION: Record<string, MessageKey> = {
  mcq_single: 'ex.pickOne',
  mcq_multi: 'ex.pickMany',
  true_false: 'ex.tf',
  gap_fill: 'ex.fill',
  matching: 'player.tapToMatch',
  ordering: 'player.tapToOrder',
  short_answer: 'ex.type',
  open_writing: 'ex.write',
  essay: 'ex.essay',
  shadowing: 'ex.shadow',
}

export function initialValue(ex: PublicExercise): unknown {
  switch (ex.kind) {
    case 'mcq_multi':
      return []
    case 'gap_fill':
      return new Array(((ex.payload.text as string) ?? '').split('___').length - 1).fill('')
    case 'matching':
      return new Array((ex.payload.left as string[]).length).fill(null)
    case 'ordering':
      return []
    case 'short_answer':
      return ''
    case 'open_writing':
      return new Array(Number(ex.payload.lines) || 1).fill('')
    case 'essay':
      return ''
    default:
      return null
  }
}

export function isAnswered(ex: PublicExercise, v: unknown): boolean {
  if (v === null || v === undefined) return false
  if (ex.kind === 'shadowing') return v === true || shadowFinished(v as ShadowValue, ((ex.payload.lines as unknown[] | undefined) ?? []).length)
  if (typeof v === 'string') return v.trim().length > 0
  if (Array.isArray(v)) {
    if (ex.kind === 'ordering') return v.length === (ex.payload.items as string[]).length
    if (ex.kind === 'matching') return v.every((x) => x !== null)
    if (ex.kind === 'gap_fill' || ex.kind === 'open_writing') return v.length > 0 && v.every((x) => typeof x === 'string' && x.trim())
    return v.length > 0
  }
  return true
}

type OptState = 'idle' | 'selected' | 'correct' | 'wrong' | 'reveal'

/** Full-width answer card; state = tint + border + icon + text, never colour alone. */
function Option({
  state,
  onClick,
  disabled,
  children,
  role,
  checked,
  marker,
}: {
  state: OptState
  onClick?: () => void
  disabled?: boolean
  children: React.ReactNode
  role: 'radio' | 'checkbox'
  checked: boolean
  marker?: React.ReactNode
}) {
  const { t } = useI18n()
  const cls: Record<OptState, string> = {
    idle: 'border-paper-300 bg-paper-50 hover:bg-paper-200',
    selected: 'border-2 border-orange-500 bg-orange-100',
    correct: 'border-2 border-success-600 bg-success-100 correct-pop',
    wrong: 'border-2 border-error-600 bg-error-100 incorrect-nudge',
    reveal: 'border-2 border-success-600 bg-success-100',
  }
  return (
    <button
      type="button"
      role={role}
      aria-checked={checked}
      disabled={disabled}
      onClick={onClick}
      className={`press flex min-h-14 w-full items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors disabled:cursor-default ${cls[state]}`}
    >
      {marker}
      <span className="t-body-lg flex-1">{children}</span>
      {(state === 'correct' || state === 'reveal') && (
        <span className="flex items-center gap-1 text-success-600">
          <CheckCircle2 size={22} strokeWidth={ICON.strokeWidth} aria-hidden />
          <span className="sr-only">{t('result.correct')}</span>
        </span>
      )}
      {state === 'wrong' && (
        <span className="flex items-center gap-1 text-error-600">
          <XCircle size={22} strokeWidth={ICON.strokeWidth} aria-hidden />
          <span className="sr-only">{t('result.incorrect')}</span>
        </span>
      )}
    </button>
  )
}

/**
 * Renders one exercise. Player mode: editable until `feedback` arrives, then locked and annotated.
 * Teacher preview: `feedback={{ isCorrect: true, correctValue: key }}` shows the key in place.
 */
export function ExerciseView({
  ex,
  value,
  onChange,
  disabled = false,
  feedback = null,
  hideInstruction = false,
  hidePassage = false,
  attemptId,
}: {
  ex: PublicExercise
  value: unknown
  onChange?: (v: unknown) => void
  disabled?: boolean
  feedback?: Feedback | null
  /** Later items on a page of the same kind: the instruction was already shown on the first */
  hideInstruction?: boolean
  /** …and so was the shared reading text */
  hidePassage?: boolean
  /** The student's attempt: shadowing sends each try to /api/attempts/{id}/pronounce. Absent in the teacher's preview. */
  attemptId?: string
}) {
  const { t } = useI18n()
  const locked = disabled || !!feedback
  /** Every tap answers with its own sound (select, snap, place…); typing stays silent */
  const set = (v: unknown, sound: SoundEvent | null = 'option.select') => {
    if (locked) return
    if (sound) play(sound)
    onChange?.(v)
  }
  const p = ex.payload
  const key = feedback?.correctValue

  const stateFor = (isSelected: boolean, isKey: boolean): OptState => {
    if (!feedback) return isSelected ? 'selected' : 'idle'
    // Answers hidden: no key to compare with, so the student's choice shows the verdict (never red when right)
    if (key === null || key === undefined) return isSelected ? (feedback.isCorrect ? 'correct' : 'wrong') : 'idle'
    if (isSelected && isKey) return 'correct'
    if (isSelected && !isKey) return 'wrong'
    return isKey && key !== null ? 'reveal' : 'idle'
  }

  return (
    <div className="flex flex-col gap-4">
      {ex.audioUrl && (
        <div className="flex flex-col gap-2 rounded-lg border border-paper-300 bg-paper-100 p-3">
          <span className="t-small inline-flex items-center gap-1.5 font-semibold text-ink-700">
            <Headphones size={18} strokeWidth={ICON.strokeWidth} aria-hidden /> {t('student.listen')}
          </span>
          {/* Native controls: play/pause/seek work with screen readers and on every phone */}
          <audio controls preload="metadata" src={ex.audioUrl} className="w-full" />
        </div>
      )}
      {typeof p.passage === 'string' && !hidePassage && <Passage text={p.passage} />}
      {ex.imageUrl && <Picture src={ex.imageUrl} />}
      <p className={`t-small flex items-center gap-2.5 font-medium text-ink-500 ${hideInstruction ? 'hidden' : ''}`}>
        <TaskIcon name={ex.audioUrl ? 'headphone' : (KIND_TASK_ICON[ex.kind] ?? 'memo')} size={30} className="shrink-0" />
        {t(INSTRUCTION[ex.kind] ?? 'ex.type')}
      </p>
      {ex.prompt && <p className="t-body-lg measure whitespace-pre-line font-medium text-ink-800">{ex.prompt}</p>}

      {ex.kind === 'mcq_single' && (
        <div role="radiogroup" className="flex flex-col gap-2">
          {(p.options as string[]).map((o, i) => (
            <Option
              key={i}
              role="radio"
              checked={value === i}
              disabled={locked}
              onClick={() => set(i)}
              state={stateFor(value === i, key === i)}
              marker={<span className="t-caption flex size-7 shrink-0 items-center justify-center rounded-full border border-current">{String.fromCharCode(65 + i)}</span>}
            >
              {o}
            </Option>
          ))}
        </div>
      )}

      {ex.kind === 'mcq_multi' && (
        <div className="flex flex-col gap-2">
          {(p.options as string[]).map((o, i) => {
            const sel = Array.isArray(value) && (value as number[]).includes(i)
            const isKey = Array.isArray(key) && (key as number[]).includes(i)
            return (
              <Option
                key={i}
                role="checkbox"
                checked={sel}
                disabled={locked}
                onClick={() => {
                  const cur = Array.isArray(value) ? (value as number[]) : []
                  set(sel ? cur.filter((x) => x !== i) : [...cur, i].sort(), sel ? 'option.deselect' : 'option.select')
                }}
                state={stateFor(sel, isKey)}
                marker={<span className="flex size-6 shrink-0 items-center justify-center rounded-sm border border-current text-sm">{sel ? '✓' : ''}</span>}
              >
                {o}
              </Option>
            )
          })}
        </div>
      )}

      {ex.kind === 'true_false' && (
        <div role="radiogroup" className="grid grid-cols-2 gap-2">
          {(['true', 'false', ...(p.allowNotGiven ? ['not_given'] : [])] as const).map((v) => (
            <div key={v} className={v === 'not_given' ? 'col-span-2' : undefined}>
              <Option role="radio" checked={value === v} disabled={locked} onClick={() => set(v)} state={stateFor(value === v, key === v)}>
                {t(`tf.${v}` as MessageKey)}
              </Option>
            </div>
          ))}
        </div>
      )}

      {ex.kind === 'gap_fill' && <GapFill text={(p.text as string) ?? ''} value={value} onChange={(v) => set(v, null)} locked={locked} feedback={feedback} />}

      {ex.kind === 'matching' && (
        <Matching left={p.left as string[]} right={p.right as string[]} value={value as (number | null)[] | null} onChange={set} locked={locked} feedback={feedback} />
      )}

      {ex.kind === 'ordering' && <Ordering items={p.items as string[]} value={value as number[] | null} onChange={set} locked={locked} feedback={feedback} />}

      {ex.kind === 'short_answer' && (
        <div className="flex flex-col gap-2">
          <input
            type="text"
            disabled={locked}
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => !locked && onChange?.(e.target.value)}
            aria-invalid={feedback ? !feedback.isCorrect : undefined}
            className={`t-body-lg min-h-14 w-full rounded-lg border-2 bg-paper-50 px-4 focus:outline-none ${
              !feedback ? 'border-paper-300 focus:border-orange-500' : feedback.isCorrect ? 'border-success-600 bg-success-100' : 'incorrect-nudge border-error-600 bg-error-100'
            }`}
          />
          {feedback && !feedback.isCorrect && typeof key === 'string' && (
            <p className="t-body flex items-center gap-2 text-success-600">
              <CheckCircle2 size={18} strokeWidth={ICON.strokeWidth} aria-hidden /> {key}
            </p>
          )}
        </div>
      )}

      {ex.kind === 'essay' && (
        <Essay payload={p as unknown as EssayPayload} value={typeof value === 'string' ? value : ''} onChange={(v) => !locked && onChange?.(v)} locked={locked} essay={feedback?.essay ?? null} />
      )}

      {ex.kind === 'shadowing' && (
        <Shadowing
          attemptId={attemptId}
          exerciseId={ex.id}
          lines={(p.lines as { text: string; audioId?: string }[] | undefined) ?? []}
          mode={p.mode === 'read' ? 'read' : 'shadow'}
          value={value}
          onChange={(v) => !locked && onChange?.(v)}
          locked={locked}
        />
      )}

      {ex.kind === 'open_writing' && (
        <OpenWriting
          lines={Number(p.lines) || 1}
          checklist={(p.checklist as string[] | undefined) ?? []}
          value={value}
          onChange={(v) => !locked && onChange?.(v)}
          locked={locked}
          writing={feedback?.writing ?? null}
        />
      )}
    </div>
  )
}

/** One long text: the exam's task, a length counter against its limits, the criteria, then the grade */
function Essay({ payload, value, onChange, locked, essay }: { payload: EssayPayload; value: string; onChange: (v: string) => void; locked: boolean; essay: EssayView | null }) {
  const { t } = useI18n()
  const unit = payload.scale.unit
  const n = textLength(value, unit)
  const under = n < payload.min
  const over = !!payload.max && n > payload.max
  const unitLabel = t(unit === 'chars' ? 'ex.chars' : 'ex.words')
  return (
    <div className="flex flex-col gap-3">
      {(payload.taskLabel || payload.exam) && (
        <p className="t-small flex flex-wrap gap-2">
          {payload.exam && <span className="rounded-pill bg-orange-100 px-2.5 py-0.5 font-semibold text-orange-700">{payload.exam}</span>}
          {payload.taskLabel && <span className="rounded-pill bg-paper-200 px-2.5 py-0.5 font-medium text-ink-700">{payload.taskLabel}</span>}
        </p>
      )}
      <details className="rounded-md bg-paper-200 px-4 py-2">
        <summary className="t-small cursor-pointer font-medium text-ink-700">{t('ex.essayCriteria')}</summary>
        <ul className="t-small mt-1 flex flex-col gap-0.5 text-ink-700">
          {payload.scale.criteria.map((c) => (
            <li key={c.id}>
              {c.name} <span className="t-num text-ink-400">(0–{c.max})</span>
            </li>
          ))}
        </ul>
      </details>
      <textarea
        disabled={locked}
        value={value}
        maxLength={12000}
        onChange={(e) => onChange(e.target.value)}
        aria-label={t('ex.essay')}
        className="t-body-lg field-sizing-content min-h-72 w-full resize-y rounded-lg border-2 border-paper-300 bg-paper-50 px-4 py-3 leading-relaxed focus:border-orange-500 focus:outline-none"
      />
      <p className={`t-small t-num ${under ? 'text-ink-500' : over ? 'text-warn-600' : 'text-success-600'}`} aria-live="polite">
        {t('ex.length', { n, min: payload.min, max: payload.max ? `–${payload.max}` : '+', unit: unitLabel })}
      </p>
      {payload.grader === 'teacher' && !essay && <p className="t-small text-ink-500">{t('ex.teacherGrades')}</p>}
      {essay && <EssayResult essay={essay} />}
    </div>
  )
}

/** The graded essay: overall score, each criterion with its reason, what went well, what to fix */
export function EssayResult({ essay }: { essay: EssayView }) {
  const { t } = useI18n()
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-paper-300 bg-paper-50 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="t-display-2 t-num">{essay.overallLabel}</span>
        <span className="t-small text-ink-500">
          {essay.levelEstimate && `${essay.levelEstimate} · `}
          {essay.byTeacher ? t('report.gradedByTeacher') : t('ex.gradedByAi')}
        </span>
      </div>
      {essay.summary && <p className="t-body text-ink-800">{essay.summary}</p>}
      <ul className="flex flex-col gap-3">
        {essay.criteria.map((c) => (
          <li key={c.name} className="flex flex-col gap-1">
            <span className="t-body flex justify-between gap-3">
              <span className="font-medium">{c.name}</span>
              <span className="t-num shrink-0 font-semibold">
                {c.score}/{c.max}
              </span>
            </span>
            <span className="relative block h-2 rounded-pill bg-paper-200">
              <span
                className={`absolute inset-y-0 left-0 rounded-pill ${c.score / c.max >= 0.7 ? 'bg-success-600' : c.score / c.max >= 0.5 ? 'bg-orange-500' : 'bg-error-600'}`}
                style={{ width: `${Math.max(3, (c.score / c.max) * 100)}%` }}
              />
            </span>
            {c.feedback && <span className="t-small text-ink-500">{c.feedback}</span>}
          </li>
        ))}
      </ul>
      {essay.strengths.length > 0 && (
        <div>
          <h4 className="t-small font-semibold text-success-600">{t('ex.strengths')}</h4>
          <ul className="t-small mt-0.5 flex list-disc flex-col gap-0.5 pl-5 text-ink-700">
            {essay.strengths.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </div>
      )}
      {essay.improvements.length > 0 && (
        <div>
          <h4 className="t-small font-semibold text-orange-700">{t('ex.improvements')}</h4>
          <ul className="t-small mt-0.5 flex list-disc flex-col gap-0.5 pl-5 text-ink-700">
            {essay.improvements.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </div>
      )}
      {essay.corrections.length > 0 && (
        <div>
          <h4 className="t-small font-semibold text-ink-700">{t('ex.corrections')}</h4>
          <ul className="mt-1 flex flex-col gap-2">
            {essay.corrections.map((c, i) => (
              <li key={i} className="t-small flex flex-col">
                <span className="text-error-600 line-through decoration-1">{c.original}</span>
                <span className="text-success-600">{c.corrected}</span>
                {c.why && <span className="text-ink-500">{c.why}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/** Reading: the text the question is about, open by default and collapsible on small screens */
function Passage({ text }: { text: string }) {
  const { t } = useI18n()
  return (
    <details open className="group rounded-lg border border-paper-300 bg-paper-50">
      <summary className="t-small flex cursor-pointer list-none items-center gap-2 px-4 py-3 font-semibold text-ink-700">
        <BookOpen size={18} strokeWidth={ICON.strokeWidth} aria-hidden /> {t('ex.passage')}
      </summary>
      <p className="t-body-lg measure whitespace-pre-line border-t border-paper-300 px-4 py-3 text-ink-800">{text}</p>
    </details>
  )
}

type ShadowProps = {
  attemptId?: string
  exerciseId: string
  lines: { text: string; audioId?: string }[]
  mode: 'shadow' | 'read'
  value: unknown
  onChange: (v: unknown) => void
  locked: boolean
}

/**
 * Shadowing and read-aloud: each sentence is read by the voice (▶/⏸); the student repeats it into the microphone,
 * the AI scores it (sounds, stress, intonation), and they try again until it passes (or move on after the last
 * try). The voice is checked and dropped, never saved. Without a microphone the student can only mark it
 * practised, which earns no points.
 */
function Shadowing({ attemptId, exerciseId, lines, mode, value, onChange, locked }: ShadowProps) {
  const { t } = useI18n()
  const audio = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState<{ i: number; paused: boolean; all: boolean } | null>(null)
  const [rec, setRec] = useState<{ i: number; state: 'recording' | 'checking'; level: number } | null>(null)
  const recording = useRef<Recording | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [noMic, setNoMic] = useState(false)
  useEffect(() => setNoMic(!micSupported()), [])
  useEffect(() => () => audio.current?.pause(), [])
  const v: ShadowValue = value && value !== true ? (value as ShadowValue) : { lines: [] }
  const active = lines.findIndex((_, i) => !lineFinished(v.lines[i]))

  const playLine = (i: number, all: boolean) => {
    if (!lines[i]?.audioId) return setPlaying(null)
    audio.current ??= new Audio()
    const a = audio.current
    a.src = `/api/audio/${exerciseId}?line=${i}`
    a.onended = () => {
      const next = lines.findIndex((l, j) => j > i && l.audioId)
      // "Listen to all": the next sentence after a pause long enough to say this one
      if (all && next >= 0) setTimeout(() => setPlaying((p) => (p?.all && !p.paused ? (playLine(next, true), p) : p)), Math.min(4000, 800 + lines[i]!.text.length * 60))
      else setPlaying(null)
    }
    setPlaying({ i, paused: false, all })
    void a.play().catch(() => setPlaying(null))
  }
  /** ▶ starts, ⏸ pauses, ▶ again continues where it stopped */
  const toggle = (i: number, all = false) => {
    const a = audio.current
    if (playing && a && (playing.i === i || all) && playing.all === all) {
      if (playing.paused) {
        void a.play()
        setPlaying({ ...playing, paused: false })
      } else {
        a.pause()
        setPlaying({ ...playing, paused: true })
      }
      return
    }
    playLine(i, all)
  }

  const speak = async (i: number) => {
    setErr(null)
    if (rec?.state === 'recording') return recording.current?.stop()
    audio.current?.pause()
    setPlaying(null)
    let r: Recording
    try {
      r = await startRecording({ onLevel: (level) => setRec((x) => (x && x.state === 'recording' ? { ...x, level } : x)) })
    } catch {
      setNoMic(true)
      return setErr(t('shadow.micBlocked'))
    }
    recording.current = r
    setRec({ i, state: 'recording', level: 0 })
    const wav = await r.done
    if (!wav) {
      setRec(null)
      return setErr(t('shadow.heardNothing'))
    }
    setRec({ i, state: 'checking', level: 0 })
    try {
      const res = await fetch(`/api/attempts/${attemptId}/pronounce?exerciseId=${exerciseId}&line=${i}`, { method: 'POST', headers: { 'content-type': 'audio/wav' }, body: wav })
      if (!res.ok) throw new Error(String(res.status))
      const j = (await res.json()) as { value: ShadowValue; line: ShadowLine }
      play(j.line.passed ? 'answer.correct' : 'answer.incorrect')
      onChange(j.value)
    } catch {
      setErr(t('shadow.checkFailed'))
    } finally {
      setRec(null)
    }
  }

  const canSpeak = !!attemptId && !locked && !noMic
  const anyAudio = lines.some((l) => l.audioId)
  const playAllOn = playing?.all && !playing.paused
  return (
    <div className="flex flex-col gap-3">
      <p className="t-small rounded-md bg-paper-200 px-4 py-2 text-ink-700">
        {!attemptId ? t('shadow.previewTip') : noMic ? t('shadow.tipNoMic') : t(mode === 'read' ? 'shadow.tipRead' : 'shadow.tip')}
      </p>
      {anyAudio && mode === 'shadow' && (
        <button
          type="button"
          onClick={() => toggle(lines.findIndex((l) => l.audioId), true)}
          className="press t-body inline-flex min-h-12 items-center gap-2 self-start rounded-pill border border-ink-700 bg-paper-50 px-4 font-medium hover:bg-paper-200"
        >
          {playAllOn ? <Pause size={20} strokeWidth={ICON.strokeWidth} aria-hidden /> : <Volume2 size={20} strokeWidth={ICON.strokeWidth} aria-hidden />}
          {playAllOn ? t('shadow.pause') : t('shadow.playAll')}
        </button>
      )}
      <ol className="flex flex-col gap-2">
        {lines.map((l, i) => {
          const r = v.lines[i]
          const isActive = canSpeak && i === active
          // Read aloud: the voice is heard only after the student tried it themselves
          const canHear = !!l.audioId && (mode === 'shadow' || !!r || locked || !attemptId)
          const on = playing?.i === i && !playing.paused
          const missed = new Set((r?.missed ?? []).map((w) => w.toLowerCase()))
          return (
            <li key={i} className={`flex flex-col gap-2 rounded-lg border px-3 py-2 ${on ? 'border-2 border-orange-500 bg-orange-100' : isActive ? 'border-2 border-ink-700 bg-paper-50' : 'border-paper-300 bg-paper-50'}`}>
              <div className="flex items-center gap-3">
                {canHear ? (
                  <button
                    type="button"
                    onClick={() => toggle(i)}
                    aria-label={on ? t('shadow.pause') : t('shadow.playLine', { n: i + 1 })}
                    className="press flex size-11 shrink-0 items-center justify-center rounded-full bg-ink-700 text-paper-50"
                  >
                    {on ? <Pause size={18} strokeWidth={2} aria-hidden /> : <Play size={18} strokeWidth={2} aria-hidden />}
                  </button>
                ) : (
                  <span className="t-num w-11 shrink-0 text-center font-semibold text-ink-500">{i + 1}.</span>
                )}
                <span className="t-body-lg flex-1 text-ink-800">
                  {l.text.split(/(\s+)/).map((w, k) => (
                    <span key={k} className={missed.has(w.replace(/[^\p{L}\p{M}'’-]/gu, '').toLowerCase()) ? 'font-semibold text-error-600 underline decoration-2' : undefined}>
                      {w}
                    </span>
                  ))}
                </span>
                {r && (
                  <span className={`t-num shrink-0 rounded-pill px-2.5 py-1 text-sm font-semibold ${r.passed ? 'bg-success-100 text-success-600' : 'bg-error-100 text-error-600'}`}>
                    {r.passed && <CheckCircle2 size={14} strokeWidth={2} className="mr-1 inline" aria-hidden />}
                    {r.best}
                  </span>
                )}
              </div>
              {r && !r.passed && r.tip && <p className="t-small text-ink-700">💡 {r.tip}</p>}
              {isActive && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={rec?.state === 'checking' || (!!rec && rec.i !== i)}
                    onClick={() => void speak(i)}
                    className={`btn btn-pill min-h-12 px-5 ${rec?.i === i && rec.state === 'recording' ? 'btn-secondary' : 'btn-primary'}`}
                  >
                    <span className="btn-label">
                      {rec?.i === i && rec.state === 'recording' ? (
                        <>
                          <Square size={16} strokeWidth={2} aria-hidden /> {t('shadow.stop')}
                          <span className="ml-1 inline-block h-2 w-10 overflow-hidden rounded-pill bg-paper-300">
                            <span className="block h-full bg-orange-500" style={{ width: `${Math.round(rec.level * 100)}%` }} />
                          </span>
                        </>
                      ) : rec?.i === i && rec.state === 'checking' ? (
                        t('shadow.checking')
                      ) : (
                        <>
                          <Mic size={18} strokeWidth={2} aria-hidden /> {r ? t('shadow.again') : t('shadow.speak')}
                        </>
                      )}
                    </span>
                  </button>
                  {r && <span className="t-small t-num text-ink-500">{t('shadow.tries', { n: r.tries, max: MAX_TRIES })}</span>}
                </div>
              )}
            </li>
          )
        })}
      </ol>
      {err && (
        <p role="alert" className="t-small text-error-600">
          {err}
        </p>
      )}
      {value === true && (
        <p className="t-body flex items-center gap-2 font-medium text-ink-500">
          <CheckCircle2 size={20} strokeWidth={ICON.strokeWidth} aria-hidden /> {t('shadow.notChecked')}
        </p>
      )}
      {!!attemptId && !locked && noMic && value !== true && (
        <button type="button" onClick={() => onChange(true)} className="btn btn-secondary min-h-12 self-start px-5">
          <span className="btn-label">
            <CheckCircle2 size={18} strokeWidth={ICON.strokeWidth} aria-hidden /> {t('shadow.markDone')}
          </span>
        </button>
      )}
      {!!attemptId && noMic && /KAKAOTALK|Telegram|Instagram|FBAN|FBAV|Line\//i.test(typeof navigator !== 'undefined' ? navigator.userAgent : '') && <p className="t-small text-ink-500">{t('shadow.openInBrowser')}</p>}
    </div>
  )
}

/** The student's own sentences, one numbered box each; after grading, a verdict and a hint per sentence. */
function OpenWriting({
  lines,
  checklist,
  value,
  onChange,
  locked,
  writing,
}: {
  lines: number
  checklist: string[]
  value: unknown
  onChange: (v: unknown) => void
  locked: boolean
  writing: WritingView | null
}) {
  const { t } = useI18n()
  const vals = Array.isArray(value) ? (value as string[]) : []
  const set = (i: number, s: string) => {
    const next = Array.from({ length: lines }, (_, j) => vals[j] ?? '')
    next[i] = s
    onChange(next)
  }
  const done = vals.filter((x) => typeof x === 'string' && x.trim()).length
  return (
    <div className="flex flex-col gap-3">
      {checklist.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-md bg-paper-200 px-4 py-3">
          {checklist.map((c, i) => (
            <li key={i} className="t-body flex items-start gap-2 text-ink-700">
              <CheckCircle2 size={18} strokeWidth={ICON.strokeWidth} className="mt-0.5 shrink-0 text-ink-400" aria-hidden /> {c}
            </li>
          ))}
        </ul>
      )}
      <ol className="flex flex-col gap-2">
        {Array.from({ length: lines }, (_, i) => {
          const v = writing?.lines[i]
          return (
            <li key={i} className="flex flex-col gap-1">
              <label className="flex items-start gap-2">
                <span className="t-body t-num mt-3 w-6 shrink-0 text-right font-semibold text-ink-500">{i + 1}.</span>
                <textarea
                  rows={1}
                  disabled={locked}
                  value={vals[i] ?? ''}
                  maxLength={400}
                  onChange={(e) => set(i, e.target.value)}
                  aria-label={t('ex.sentenceN', { n: i + 1 })}
                  aria-invalid={v ? !v.ok : undefined}
                  className={`t-body-lg field-sizing-content min-h-12 w-full resize-none rounded-lg border-2 bg-paper-50 px-3 py-2.5 focus:outline-none ${
                    !v ? 'border-paper-300 focus:border-orange-500' : v.ok ? 'border-success-600 bg-success-100' : 'border-error-600 bg-error-100'
                  }`}
                />
              </label>
              {v && (v.feedback || v.correction) && (
                <div className={`t-small ml-8 flex flex-col gap-0.5 ${v.ok ? 'text-success-600' : 'text-error-600'}`}>
                  {v.correction && (
                    <span className="flex items-start gap-1.5 text-ink-800">
                      <CheckCircle2 size={16} strokeWidth={ICON.strokeWidth} className="mt-0.5 shrink-0 text-success-600" aria-hidden /> {v.correction}
                    </span>
                  )}
                  {v.feedback && (
                    <span className="flex items-start gap-1.5">
                      {v.ok ? (
                        <CheckCircle2 size={16} strokeWidth={ICON.strokeWidth} className="mt-0.5 shrink-0" aria-hidden />
                      ) : (
                        <XCircle size={16} strokeWidth={ICON.strokeWidth} className="mt-0.5 shrink-0" aria-hidden />
                      )}
                      {v.feedback}
                    </span>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ol>
      {!writing && !locked && (
        <p className="t-small t-num text-ink-500" aria-live="polite">
          {t('ex.sentencesDone', { n: done, total: lines })}
        </p>
      )}
    </div>
  )
}

/** Inline gaps, underlined not boxed, sized to the text; Enter/Tab moves to the next gap. */
function GapFill({ text, value, onChange, locked, feedback }: { text: string; value: unknown; onChange: (v: unknown) => void; locked: boolean; feedback: Feedback | null }) {
  const refs = useRef<(HTMLInputElement | null)[]>([])
  const parts = text.split('___')
  const vals = Array.isArray(value) ? (value as string[]) : []
  const keys = Array.isArray(feedback?.correctValue) ? (feedback!.correctValue as string[]) : null
  return (
    <p className="t-body-lg measure leading-[2.8] text-ink-800">
      {parts.map((part, i) => {
        const v = vals[i] ?? ''
        const k = keys?.[i]
        // The server's per-blank verdict (all accepted variants); fall back to the overall verdict
        const ok = feedback ? (feedback.parts?.[i] ?? feedback.isCorrect) : null
        return (
          <span key={i}>
            <span className="whitespace-pre-line">{part}</span>
            {i < parts.length - 1 && (
              <span className="inline-flex flex-col items-center align-top">
                <input
                  ref={(el) => {
                    refs.current[i] = el
                  }}
                  type="text"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  disabled={locked}
                  aria-label={`${i + 1}`}
                  value={v}
                  size={Math.max(6, v.length + 1)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      refs.current[i + 1]?.focus()
                    }
                  }}
                  onChange={(e) => {
                    const cur = [...vals]
                    while (cur.length < parts.length - 1) cur.push('')
                    cur[i] = e.target.value
                    onChange(cur)
                  }}
                  className={`mx-1 border-0 border-b-2 bg-transparent px-1 text-center leading-normal focus:outline-none ${
                    ok === null ? 'border-ink-700 focus:border-orange-600' : ok ? 'border-success-600 text-success-600' : 'incorrect-nudge border-error-600 text-error-600'
                  }`}
                />
                {ok === false && k && <span className="t-small mt-1 text-center leading-tight text-success-600">✓ {k}</span>}
              </span>
            )}
          </span>
        )
      })}
    </p>
  )
}

/** Tap a left item, then tap its match (no drag needed; works with keyboard and cheap touchscreens). */
function Matching({
  left,
  right,
  value,
  onChange,
  locked,
  feedback,
}: {
  left: string[]
  right: string[]
  value: (number | null)[] | null
  onChange: (v: unknown, sound?: SoundEvent | null) => void
  locked: boolean
  feedback: Feedback | null
}) {
  const { t } = useI18n()
  const vals = value ?? new Array(left.length).fill(null)
  const [active, setActive] = useState<number | null>(vals.findIndex((v) => v === null) === -1 ? null : vals.findIndex((v) => v === null))
  const keys = Array.isArray(feedback?.correctValue) ? (feedback!.correctValue as number[]) : null
  const place = (r: number) => {
    if (active === null || locked) return
    const next = vals.map((v) => (v === r ? null : v)) // each right item used once
    next[active] = r
    onChange(next, 'match.pair')
    const nextEmpty = next.findIndex((v, i) => v === null && i !== active)
    setActive(nextEmpty === -1 ? null : nextEmpty)
  }
  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-2">
        {left.map((l, i) => {
          const r = vals[i]
          const verdict = feedback && keys ? r === keys[i] : feedback ? feedback.isCorrect : null
          return (
            <li key={i}>
              <button
                type="button"
                disabled={locked}
                aria-pressed={active === i}
                onClick={() => {
                  if (r !== null && active === i) return onChange(vals.map((v, j) => (j === i ? null : v)), 'option.deselect')
                  play('tap')
                  setActive(i)
                }}
                className={`press flex min-h-14 w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-4 py-3 text-left ${
                  verdict === null
                    ? active === i
                      ? 'border-2 border-orange-500 bg-orange-100'
                      : 'border-paper-300 bg-paper-50'
                    : verdict
                      ? 'border-2 border-success-600 bg-success-100'
                      : 'incorrect-nudge border-2 border-error-600 bg-error-100'
                }`}
              >
                <span className="t-body-lg font-medium">{l}</span>
                <span className="text-ink-400" aria-hidden>
                  →
                </span>
                <span className={`t-body-lg ${r === null ? 'text-ink-400' : ''}`}>{r === null ? '…' : right[r]}</span>
                {verdict === false && keys && <span className="t-small w-full text-success-600">✓ {right[keys[i]!]}</span>}
              </button>
            </li>
          )
        })}
      </ul>
      {!locked && (
        <div className="flex flex-wrap gap-2" aria-label={t('player.tapToMatch')}>
          {right.map((r, j) => {
            const used = vals.includes(j)
            return (
              <button
                key={j}
                type="button"
                disabled={active === null}
                onClick={() => place(j)}
                className={`press min-h-12 rounded-pill border px-4 t-body transition-colors ${used ? 'border-paper-300 bg-paper-200 text-ink-400' : 'border-ink-700 bg-paper-50 text-ink-800 hover:bg-paper-200'}`}
              >
                {r}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** Tap items in order to build the answer; tap a placed item to send it back. */
function Ordering({
  items,
  value,
  onChange,
  locked,
  feedback,
}: {
  items: string[]
  value: number[] | null
  onChange: (v: unknown, sound?: SoundEvent | null) => void
  locked: boolean
  feedback: Feedback | null
}) {
  const { t } = useI18n()
  const placed = Array.isArray(value) ? value : []
  const keys = Array.isArray(feedback?.correctValue) ? (feedback!.correctValue as number[]) : null
  return (
    <div className="flex flex-col gap-4">
      <ol className="flex min-h-16 flex-col gap-2 rounded-lg border-2 border-dashed border-paper-400 p-2">
        {placed.map((idx, pos) => {
          const verdict = feedback && keys ? keys[pos] === idx : feedback ? feedback.isCorrect : null
          return (
            <li key={idx}>
              <button
                type="button"
                disabled={locked}
                onClick={() => onChange(placed.filter((x) => x !== idx), 'option.deselect')}
                className={`press flex min-h-12 w-full items-center gap-3 rounded-md border px-3 text-left ${
                  verdict === null ? 'border-paper-300 bg-paper-50' : verdict ? 'border-success-600 bg-success-100' : 'border-error-600 bg-error-100'
                }`}
              >
                <span className="t-caption w-5 text-ink-500">{pos + 1}</span>
                <span className="t-body-lg flex-1">{items[idx]}</span>
                {verdict === true && <CheckCircle2 size={20} strokeWidth={ICON.strokeWidth} className="text-success-600" aria-label={t('result.correct')} />}
                {verdict === false && <XCircle size={20} strokeWidth={ICON.strokeWidth} className="text-error-600" aria-label={t('result.incorrect')} />}
              </button>
            </li>
          )
        })}
      </ol>
      {feedback && !feedback.isCorrect && keys && (
        <p className="t-body text-success-600">✓ {keys.map((i) => items[i]).join(' → ')}</p>
      )}
      {!locked && (
        <div className="flex flex-wrap items-center gap-2">
          {items.map((it, i) =>
            placed.includes(i) ? null : (
              <button key={i} type="button" onClick={() => onChange([...placed, i], 'order.place')} className="press t-body min-h-12 rounded-pill border border-ink-700 bg-paper-50 px-4 hover:bg-paper-200">
                {it}
              </button>
            ),
          )}
          {placed.length > 0 && (
            <button type="button" onClick={() => onChange([], 'option.deselect')} className="t-small ml-auto inline-flex min-h-11 items-center gap-1 px-2 text-ink-500 hover:text-ink-800">
              <Undo2 size={16} strokeWidth={ICON.strokeWidth} aria-hidden /> {t('player.reset')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** The item's picture; a tap opens it full screen, as small labels in a book picture can be hard to read */
function Picture({ src }: { src: string }) {
  const { t } = useI18n()
  const dialog = useRef<HTMLDialogElement>(null)
  return (
    <>
      <button type="button" onClick={() => dialog.current?.showModal()} className="press mx-auto flex max-w-full flex-col items-center gap-1" aria-label={t('ex.pictureZoom')}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a private, per-exercise image; next/image adds nothing here */}
        <img src={src} alt={t('ex.picture')} loading="lazy" className="max-h-80 w-auto max-w-full rounded-lg border border-paper-300 bg-paper-50 object-contain" />
        <span className="t-small text-ink-400">{t('ex.pictureZoom')}</span>
      </button>
      <dialog
        ref={dialog}
        onClick={() => dialog.current?.close()}
        aria-label={t('ex.picture')}
        className="m-auto max-h-none max-w-none bg-transparent p-2 backdrop:bg-ink-900/80"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- same picture, full size */}
        <img src={src} alt={t('ex.picture')} className="max-h-[92vh] max-w-[96vw] rounded-lg bg-paper-50 object-contain" />
        <button type="button" className="t-small mx-auto mt-2 block rounded-pill bg-paper-50 px-4 py-2 font-medium text-ink-800">
          {t('ex.pictureClose')}
        </button>
      </dialog>
    </>
  )
}
