'use client'
import { AlertTriangle, ArrowDown, ArrowLeft, ArrowUp, Headphones, Lightbulb, Pencil, RefreshCw, Send, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import type { MessageKey } from '@ikhimi/i18n'
import { Badge, Button, Chip, ICON, IconButton, Input, KindIcon, SegmentedControl, Textarea, useToast } from '@ikhimi/ui/components'
import { play } from '@ikhimi/ui/sound'
import { AnswerKeyPanel } from '@/components/AnswerKeyPanel'
import { AudioPanel, ExerciseAudioUpload } from '@/components/AudioPanel'
import { emptyGroupDetails, GroupDetailsFields, groupDetailsPayload, type GroupDetailsValue } from '@/components/GroupDetailsFields'
import { useI18n } from '@/i18n/client'
import { ERROR_KEYS, postJson, streamGenerate, type GenEvent } from '@/lib/client'
import { ExerciseEditor, type TeacherExercise } from './ExerciseEditor'
import { ExerciseView } from './ExerciseView'
import { DurationPicker } from './DurationPicker'

export type EditorExercise = TeacherExercise & {
  points: number
  explanation: string | null
  sourceRef: string | null
  flags: string[]
  /** Why the AI reviewer flagged this item */
  reviewNote?: string | null
  skill: string
  audioLabel: string | null
  audioUrl: string | null
  audioName: string | null
  /** Copied from a book: where the answer came from (the book's answer pages, the recording, the AI) */
  answerSource?: string | null
}

type Props = {
  assignment: {
    id: string
    title: string
    instructions: string | null
    rationale: string
    /** Exam style it was written in, e.g. "Cambridge English · B2 First" */
    examStyle?: string | null
    estimatedMinutes: number
    totalPoints: number
    status: 'draft' | 'published' | 'closed'
    showAnswersAfter: 'submit' | 'never'
  }
  exercises: EditorExercise[]
  groups: { id: string; name: string }[]
  /** Digitize mode: book exercises that couldn't be made interactive */
  skipped?: { ref: string; reason: string }[]
  /** Copied from a book: the answers panel (book answers vs the AI's), with the answer pages limit */
  digitized?: boolean
  maxAnswerPages?: number
}

/** Kinds a book's answer key can give the answer for (the server's KEYED_KINDS) */
const KEYED = ['mcq_single', 'mcq_multi', 'true_false', 'gap_fill', 'short_answer', 'matching', 'ordering']

/** The correct answer expressed as a response value, so the preview shows it selected. */
function keyAsValue(ex: TeacherExercise): unknown {
  const k = ex.answerKey
  switch (ex.kind) {
    case 'mcq_single':
    case 'mcq_multi':
      return k.correct
    case 'true_false':
      return k.answer
    case 'gap_fill':
      return (k.blanks as string[][]).map((b) => b[0])
    case 'matching':
      return k.pairs
    case 'ordering':
      return k.order
    case 'short_answer':
      return (k.accepted as string[])[0]
    case 'essay':
      // Preview the model answer in the box
      return (k.modelAnswer as string | undefined) ?? ''
    case 'shadowing':
      return true
    case 'open_writing':
      // Preview the model sentences in the boxes
      return Array.from({ length: Number(ex.payload.lines) || 1 }, (_, i) => (k.examples as string[] | undefined)?.[i] ?? '')
  }
}

/** The homework's name, edited in place; saved as the teacher types (spec §12: autosave, no Save buttons). */
function EditableTitle({ assignmentId, initial }: { assignmentId: string; initial: string }) {
  const { t } = useI18n()
  const [title, setTitle] = useState(initial)
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const save = (v: string) => {
    if (timer.current) clearTimeout(timer.current)
    if (!v.trim()) return
    timer.current = setTimeout(async () => {
      setState('saving')
      const { ok } = await postJson(`/api/assignments/${assignmentId}`, { title: v.trim() }, 'PATCH')
      setState(ok ? 'saved' : 'error')
    }, 600)
  }
  return (
    <div className="flex flex-col gap-1">
      <label className="t-small font-medium text-ink-500" htmlFor="hw-title">
        {t('draft.titleLabel')}
      </label>
      <input
        id="hw-title"
        value={title}
        maxLength={160}
        onChange={(e) => {
          setTitle(e.target.value)
          save(e.target.value)
        }}
        className="t-display-2 w-full rounded-md border border-transparent bg-transparent px-1 -mx-1 hover:border-paper-300 focus:border-ink-700 focus:bg-paper-50 focus:outline-none"
      />
      <span className="t-small h-4 text-ink-400" aria-live="polite">
        {state === 'saving' ? t('student.saving') : state === 'saved' ? `✓ ${t('student.saved')}` : state === 'error' ? t('error.generic') : !title.trim() ? t('draft.titleEmpty') : ''}
      </span>
    </div>
  )
}

/** Draft review (design spec §11 screen 2): rendered exactly as students see it, every item editable. */
export function AssignmentEditor({ assignment: a, exercises: serverExercises, groups, skipped = [], digitized = false, maxAnswerPages = 4 }: Props) {
  const { t } = useI18n()
  const router = useRouter()
  const toast = useToast()
  const [items, setItems] = useState(serverExercises)
  const [editing, setEditing] = useState<string | null>(null)
  const [busyItem, setBusyItem] = useState<string | null>(null)
  const [regenFor, setRegenFor] = useState<string | null>(null)
  const [refine, setRefine] = useState('')
  const [stage, setStage] = useState<Extract<GenEvent, { type: 'progress' }>['stage'] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [publishBusy, setPublishBusy] = useState(false)
  // Every homework belongs to a group: an existing one, or a new one created here with its details
  const [groupMode, setGroupMode] = useState<'existing' | 'new'>(groups.length ? 'existing' : 'new')
  const [groupId, setGroupId] = useState<string>(groups[0]?.id ?? '')
  const [newGroup, setNewGroup] = useState<GroupDetailsValue>(emptyGroupDetails())
  const [dueDays, setDueDays] = useState<number | null>(null)
  const [showAnswers, setShowAnswers] = useState(a.showAnswersAfter)
  const pendingDeletes = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const isDraft = a.status === 'draft'

  // Server truth wins whenever it changes (after refresh), except items with a pending delete
  useEffect(() => setItems(serverExercises.filter((e) => !pendingDeletes.current.has(e.id))), [serverExercises])

  const skills = [...new Set(items.map((e) => e.skill))]
  const points = items.reduce((s, e) => s + e.points, 0)

  const regenerate = async (id: string, hint: string) => {
    setRegenFor(null)
    setBusyItem(id)
    setError(null)
    const { ok, json } = await postJson(`/api/assignments/${a.id}/exercises/${id}/regenerate`, { hint })
    setBusyItem(null)
    if (!ok) {
      play('error')
      setError(t(ERROR_KEYS[String(json.error)] ?? 'error.generic'))
    }
    router.refresh()
  }

  /** Optimistic delete with a 3.2 s undo window (spec §9 toasts). */
  const remove = (id: string) => {
    const snapshot = items
    setItems((xs) => xs.filter((x) => x.id !== id))
    const timer = setTimeout(async () => {
      pendingDeletes.current.delete(id)
      const res = await fetch(`/api/assignments/${a.id}/exercises/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        setItems(snapshot)
        toast(t('error.generic'))
      }
      router.refresh()
    }, 3200)
    pendingDeletes.current.set(id, timer)
    toast(t('action.delete'), {
      label: t('common.cancel'),
      run: () => {
        clearTimeout(timer)
        pendingDeletes.current.delete(id)
        setItems(snapshot)
      },
    })
  }

  /** Optimistic reorder; rolled back with a toast on failure. */
  const move = async (index: number, dir: -1 | 1) => {
    const j = index + dir
    if (j < 0 || j >= items.length) return
    const snapshot = items
    const next = [...items]
    ;[next[index], next[j]] = [next[j]!, next[index]!]
    setItems(next)
    const { ok } = await postJson(`/api/assignments/${a.id}/order`, { ids: next.map((x) => x.id) })
    if (!ok) {
      setItems(snapshot)
      toast(t('error.generic'))
    }
  }

  const sendRefine = async () => {
    if (!refine.trim() || stage) return
    setError(null)
    setStage('writing')
    await streamGenerate({ text: refine, refineAssignmentId: a.id }, (e) => {
      if (e.type === 'progress') setStage(e.stage)
      else if (e.type === 'items') return
      else if (e.type === 'done') {
        play('generation.complete')
        setStage(null)
        setRefine('')
        router.refresh()
      } else {
        play('error')
        setStage(null)
        setError(t(ERROR_KEYS[e.code] ?? 'error.generic', { n: e.n ?? '' }))
      }
    })
  }

  const publish = async () => {
    setError(null)
    setPublishBusy(true)
    const { ok, json } = await postJson(`/api/assignments/${a.id}/publish`, {
      groupId: groupMode === 'existing' ? groupId : null,
      newGroup: groupMode === 'new' ? groupDetailsPayload(newGroup) : null,
      dueDays,
      showAnswersAfter: showAnswers,
    })
    setPublishBusy(false)
    if (!ok) {
      play('error')
      return setError(t(ERROR_KEYS[String(json.error ?? '')] ?? 'error.generic'))
    }
    play('publish.success')
    router.refresh()
  }

  const flagText = (f: string) => t(`draft.flag.${f}` as MessageKey)
  const listening = items.map((ex, i) => ({ ex, i })).filter(({ ex }) => ex.audioLabel)
  const waitingAudio = listening.some(({ ex }) => !ex.audioUrl)
  const detachAudio = async (exerciseId: string) => {
    const res = await fetch(`/api/assignments/${a.id}/audio?exerciseId=${encodeURIComponent(exerciseId)}`, { method: 'DELETE' })
    if (res.ok) router.refresh()
    else setError(t('error.generic'))
  }
  const field = 't-body min-h-12 w-full rounded-2xl border-2 border-paper-300 bg-paper-50 px-3 text-ink-700 focus:border-ink-700 focus:outline-none'

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 px-4 pb-56 pt-6">
      <Link href="/app" className="t-small inline-flex items-center gap-1 self-start font-medium text-ink-500 hover:text-ink-800">
        <ArrowLeft size={16} strokeWidth={ICON.strokeWidth} aria-hidden /> {t('compose.newAssignment')}
      </Link>

      <header className="flex flex-col gap-3">
        <Badge tone={isDraft ? 'neutral' : 'published'} className="self-start">{t(isDraft ? 'state.draft' : 'state.published')}</Badge>
        <EditableTitle assignmentId={a.id} initial={a.title} />
        <p className="t-small t-num text-ink-500">
          {t('draft.items', { n: items.length })} · {t('draft.points', { n: points })} · {t('draft.minutes', { n: a.estimatedMinutes })}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {skills.map((s) => (
            <Badge key={s} tone="orange">
              {t(`skill.${s}` as MessageKey)}
            </Badge>
          ))}
        </div>
        {a.examStyle && (
          <p className="t-small inline-flex items-center gap-1.5 self-start rounded-pill bg-orange-100 px-3 py-1 font-semibold text-orange-700">🎓 {a.examStyle}</p>
        )}
        {a.rationale && <p className="t-body italic text-ink-500">{a.rationale}</p>}
        {a.instructions && <p className="t-body-lg measure rounded-md bg-paper-200 px-4 py-3">{a.instructions}</p>}
      </header>

      {error && (
        <p role="alert" className="t-body rounded-md border border-error-600 bg-error-100 px-4 py-3 text-error-600">
          {error}
        </p>
      )}

      {isDraft && listening.length > 0 && (
        <AudioPanel assignmentId={a.id} exercises={listening.map(({ ex, i }) => ({ id: ex.id, n: i + 1, label: ex.audioLabel, sourceRef: ex.sourceRef, linked: !!ex.audioUrl }))} />
      )}

      {isDraft && digitized && items.some((ex) => KEYED.includes(ex.kind)) && (
        <AnswerKeyPanel
          assignmentId={a.id}
          fromBook={items.filter((ex) => ex.answerSource === 'answer_key').length}
          byAi={items.filter((ex) => ex.flags.includes('answer_ai_inferred')).length}
          others={items.filter((ex) => KEYED.includes(ex.kind) && ex.answerSource !== 'answer_key').length}
          max={maxAnswerPages}
        />
      )}

      {skipped.length > 0 && (
        <details className="rounded-2xl border-2 border-paper-300 bg-paper-50 p-4">
          <summary className="t-h3 cursor-pointer">{t('draft.skipped.title', { n: skipped.length })}</summary>
          <p className="t-small mt-2 text-ink-500">{t('draft.skipped.hint')}</p>
          <ul className="mt-2 flex flex-col gap-1">
            {skipped.map((x) => (
              <li key={x.ref} className="t-body">
                <b>{x.ref}</b>
                {x.reason && <span className="text-ink-500"> — {x.reason}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}

      <ol className="flex flex-col gap-4">
        {items.map((ex, i) => {
          const flagged = ex.flags.length > 0
          return (
            <li
              key={ex.id}
              style={{ ['--i' as string]: i }}
              className={`card-enter group flex flex-col gap-3 rounded-2xl border-2 border-paper-300 bg-paper-50 p-4 transition-opacity ${
                flagged ? 'border-l-4 border-l-warn-600' : ''
              } ${busyItem === ex.id ? 'opacity-50' : ''}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="t-h3 t-num text-ink-500">{i + 1}</span>
                <span className="t-small inline-flex items-center gap-1.5 text-ink-500">
                  <KindIcon kind={ex.kind} size={20} /> {t(`draft.kind.${ex.kind}` as MessageKey)}
                </span>
                <Badge>{t('draft.points', { n: ex.points })}</Badge>
                {ex.sourceRef && <span className="t-small text-ink-400">{ex.sourceRef}</span>}
                {ex.audioLabel && (
                  <Badge tone={ex.audioUrl ? 'neutral' : 'orange'} icon={<Headphones size={14} strokeWidth={ICON.strokeWidth} aria-hidden />}>
                    {t('audio.label', { label: ex.audioName ?? ex.audioLabel })}
                  </Badge>
                )}
                {isDraft && ex.audioUrl && (
                  <button type="button" onClick={() => detachAudio(ex.id)} className="t-small font-medium text-ink-500 underline hover:text-error-600">
                    {t('audio.remove')}
                  </button>
                )}
                {isDraft && (
                  // Always visible on touch; on hover-capable screens they appear on hover/focus
                  <span className="ml-auto flex gap-0.5 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:transition-opacity [@media(hover:hover)]:group-focus-within:opacity-100 [@media(hover:hover)]:group-hover:opacity-100">
                    <IconButton label={t('action.edit')} size={36} onClick={() => setEditing(ex.id)}>
                      <Pencil size={18} strokeWidth={ICON.strokeWidth} aria-hidden />
                    </IconButton>
                    <IconButton label={t('action.regenerate')} size={36} aria-expanded={regenFor === ex.id} onClick={() => setRegenFor(regenFor === ex.id ? null : ex.id)}>
                      <RefreshCw size={18} strokeWidth={ICON.strokeWidth} aria-hidden />
                    </IconButton>
                    <IconButton label={`↑ ${i + 1}`} size={36} disabled={i === 0} onClick={() => move(i, -1)}>
                      <ArrowUp size={18} strokeWidth={ICON.strokeWidth} aria-hidden />
                    </IconButton>
                    <IconButton label={`↓ ${i + 1}`} size={36} disabled={i === items.length - 1} onClick={() => move(i, 1)}>
                      <ArrowDown size={18} strokeWidth={ICON.strokeWidth} aria-hidden />
                    </IconButton>
                    <IconButton label={t('action.delete')} size={36} onClick={() => remove(ex.id)} className="hover:text-error-600">
                      <Trash2 size={18} strokeWidth={ICON.strokeWidth} aria-hidden />
                    </IconButton>
                  </span>
                )}
              </div>

              {/* A recording not linked yet: uploaded here, it goes to this exercise (and others on the same track) */}
              {isDraft && ex.audioLabel && !ex.audioUrl && items.findIndex((x) => x.audioLabel === ex.audioLabel && !x.audioUrl) === i && (
                <ExerciseAudioUpload assignmentId={a.id} exerciseIds={items.filter((x) => x.audioLabel === ex.audioLabel && !x.audioUrl).map((x) => x.id)} />
              )}

              {/* Verification flags: inline reason, never a scary modal (spec §11) */}
              {flagged && (
                <p className="t-small flex items-start gap-2 rounded-md bg-warn-100 px-3 py-2 text-warn-600">
                  <AlertTriangle size={16} strokeWidth={ICON.strokeWidth} className="mt-0.5 shrink-0" aria-hidden />
                  <span>
                    <b>{t('draft.verifyNote')}:</b> {ex.flags.map(flagText).join('; ')}
                    {ex.reviewNote && <span className="mt-1 block text-ink-700">{ex.reviewNote}</span>}
                  </span>
                </p>
              )}

              {regenFor === ex.id && (
                <div className="slide-down flex flex-wrap gap-2">
                  {(
                    [
                      ['', 'action.regenerate'],
                      ['make it easier', 'draft.easier'],
                      ['make it harder', 'draft.harder'],
                    ] as const
                  ).map(([hint, key]) => (
                    <Chip key={key} onClick={() => regenerate(ex.id, hint)}>
                      <RefreshCw size={14} strokeWidth={ICON.strokeWidth} aria-hidden /> {t(key)}
                    </Chip>
                  ))}
                </div>
              )}

              {editing === ex.id ? (
                <ExerciseEditor
                  assignmentId={a.id}
                  ex={ex}
                  onDone={(saved) => {
                    setEditing(null)
                    if (saved) router.refresh()
                  }}
                />
              ) : (
                <ExerciseView ex={{ ...ex, points: ex.points }} value={keyAsValue(ex)} feedback={{ isCorrect: true, correctValue: keyAsValue(ex) }} />
              )}
              {(ex.kind === 'open_writing' || ex.kind === 'essay') && editing !== ex.id && typeof ex.answerKey.rubric === 'string' && (
                <p className="t-small whitespace-pre-line rounded-md bg-paper-200 px-3 py-2 text-ink-700">
                  {ex.kind === 'essay' && (
                    <b className="mb-1 block">{ex.payload.grader === 'teacher' ? t('draft.essayGraderTeacher') : t('draft.essayGraderAi')}</b>
                  )}
                  <b>{t('draft.writingRubric')}:</b> {ex.answerKey.rubric}
                </p>
              )}
              {ex.explanation && editing !== ex.id && (
                <p className="t-small flex gap-2 text-ink-500">
                  <Lightbulb size={16} strokeWidth={ICON.strokeWidth} className="mt-0.5 shrink-0" aria-hidden /> {ex.explanation}
                </p>
              )}
            </li>
          )
        })}
      </ol>

      {isDraft && (
        <div data-bottom-dock className="fixed inset-x-0 bottom-0 z-10 border-t border-paper-300 bg-paper-100/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
          <div className="mx-auto flex max-w-3xl flex-col gap-3 px-4 py-3">
            {stage ? (
              <p role="status" aria-live="polite" className="t-body-lg thinking-pulse flex min-h-12 items-center gap-3 font-medium">
                {t(`progress.${stage}` as MessageKey)}
              </p>
            ) : publishing ? (
              <div className="slide-down flex max-h-[75dvh] flex-col gap-3 overflow-y-auto">
                <div className="flex flex-col gap-2">
                  <span className="t-h3">{t('publish.chooseGroup')}</span>
                  {groups.length > 0 && (
                    <SegmentedControl
                      label={t('publish.chooseGroup')}
                      value={groupMode}
                      onChange={setGroupMode}
                      options={[
                        { value: 'existing', label: t('publish.existingGroup') },
                        { value: 'new', label: `+ ${t('publish.createGroup')}` },
                      ]}
                    />
                  )}
                  <p className="t-small text-ink-500">{t('publish.groupHint')}</p>
                </div>
                {groupMode === 'existing' ? (
                  <select value={groupId} onChange={(e) => setGroupId(e.target.value)} aria-label={t('publish.chooseGroup')} className={field}>
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <GroupDetailsFields value={newGroup} onChange={setNewGroup} autoFocus={groups.length > 0} />
                )}
                <DurationPicker value={dueDays} onChange={setDueDays} label={t('publish.due')} />
                <div className="flex flex-wrap items-end gap-3">
                  <div className="flex flex-col gap-1">
                    <span className="t-small font-medium text-ink-500">{t('profile.showAnswers')}</span>
                    <SegmentedControl
                      label={t('profile.showAnswers')}
                      value={showAnswers}
                      onChange={setShowAnswers}
                      options={[
                        { value: 'submit', label: t('profile.showAnswers.submit') },
                        { value: 'never', label: t('profile.showAnswers.never') },
                      ]}
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button onClick={publish} loading={publishBusy} disabled={groupMode === 'new' ? !newGroup.name.trim() : !groupId} size="lg" className="flex-1">
                    {t('action.publish')}
                  </Button>
                  <Button variant="ghost" size="lg" onClick={() => setPublishing(false)}>
                    {t('common.cancel')}
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-end gap-2 rounded-2xl border-2 border-paper-300 bg-paper-50 pl-4 focus-within:border-ink-700">
                  <Textarea
                    bare
                    minRows={3}
                    maxRows={8}
                    value={refine}
                    onChange={(e) => setRefine(e.target.value)}
                    onKeyDown={(e) => {
                      // Desktop: Enter sends, Shift+Enter newline. Phones: Enter is a newline; the button sends.
                      if (e.key === 'Enter' && !e.shiftKey && !window.matchMedia('(pointer: coarse)').matches) {
                        e.preventDefault()
                        void sendRefine()
                      }
                    }}
                    placeholder={t('draft.refinePlaceholder')}
                    aria-label={t('draft.refinePlaceholder')}
                    className="t-body flex-1 py-3"
                  />
                  <IconButton label={t('compose.send')} onClick={sendRefine} disabled={!refine.trim()} className="m-1">
                    <Send size={20} strokeWidth={ICON.strokeWidth} aria-hidden />
                  </IconButton>
                </div>
                {waitingAudio && <p className="t-small text-warn-600">{t('error.needsAudio')}</p>}
                <Button size="lg" onClick={() => setPublishing(true)} disabled={items.length === 0 || waitingAudio}>
                  {t('action.publish')}
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
