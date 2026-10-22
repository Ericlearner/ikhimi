'use client'
import { useState } from 'react'
import type { MessageKey } from '@ikhimi/i18n'
import { useI18n } from '@/i18n/client'
import { postJson } from '@/lib/client'
import { Button } from '@ikhimi/ui/components'

export type TeacherExercise = {
  id: string
  kind: string
  prompt: string
  payload: Record<string, unknown>
  answerKey: Record<string, unknown>
}

const area = 't-body w-full rounded-md border border-paper-300 bg-paper-50 px-3 py-2 text-ink-700 focus:border-ink-700 focus:outline-none'
const lines = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean)
const csv = (s: string) => s.split(',').map((l) => l.trim()).filter(Boolean)

/** ✎ Inline editor. Builds a new payload + key for the item's kind; the server re-validates. */
export function ExerciseEditor({
  assignmentId,
  ex,
  onDone,
}: {
  assignmentId: string
  ex: TeacherExercise
  onDone: (saved: boolean) => void
}) {
  const { t } = useI18n()
  const p = ex.payload
  const k = ex.answerKey
  const [prompt, setPrompt] = useState(ex.prompt)
  const [options, setOptions] = useState(((p.options as string[]) ?? []).join('\n'))
  const [correct, setCorrect] = useState<number[]>(
    ex.kind === 'mcq_single' ? [k.correct as number] : ex.kind === 'mcq_multi' ? (k.correct as number[]) : [],
  )
  const [tf, setTf] = useState((k.answer as string) ?? 'true')
  const [gapText, setGapText] = useState((p.text as string) ?? '')
  const [blanks, setBlanks] = useState<string[]>(((k.blanks as string[][]) ?? []).map((b) => b.join(', ')))
  const [accepted, setAccepted] = useState(((k.accepted as string[]) ?? []).join(', '))
  const [pairs, setPairs] = useState(
    ex.kind === 'matching' ? (p.left as string[]).map((l, i) => `${l} = ${(p.right as string[])[(k.pairs as number[])[i]!]}`).join('\n') : '',
  )
  const [ordered, setOrdered] = useState(
    ex.kind === 'ordering' ? (k.order as number[]).map((i) => (p.items as string[])[i]).join('\n') : '',
  )
  const [passage, setPassage] = useState((p.passage as string) ?? '')
  const [writingLines, setWritingLines] = useState(Number(p.lines) || 5)
  const [checklist, setChecklist] = useState(((p.checklist as string[]) ?? []).join('\n'))
  const [rubric, setRubric] = useState((k.rubric as string) ?? '')
  const [examples, setExamples] = useState(((k.examples as string[]) ?? []).join('\n'))
  const [taskLabel, setTaskLabel] = useState((p.taskLabel as string) ?? '')
  const [minLen, setMinLen] = useState(String(p.min ?? 150))
  const [maxLen, setMaxLen] = useState(p.max ? String(p.max) : '')
  const [grader, setGrader] = useState<'ai' | 'teacher'>((p.grader as 'ai' | 'teacher') ?? 'ai')
  const [modelAnswer, setModelAnswer] = useState((k.modelAnswer as string) ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)

  // The reading passage travels with the item whatever its kind
  const build = (): { payload: Record<string, unknown>; answerKey: Record<string, unknown> } => {
    const b = buildKind()
    return { ...b, payload: { ...b.payload, ...(passage.trim() ? { passage: passage.trim() } : {}), ...(p.imageId ? { imageId: p.imageId } : {}) } }
  }
  const buildKind = (): { payload: Record<string, unknown>; answerKey: Record<string, unknown> } => {
    switch (ex.kind) {
      case 'mcq_single':
        return { payload: { options: lines(options) }, answerKey: { correct: correct[0] ?? 0 } }
      case 'mcq_multi':
        return { payload: { options: lines(options) }, answerKey: { correct } }
      case 'true_false':
        return { payload: { allowNotGiven: tf === 'not_given' || !!p.allowNotGiven }, answerKey: { answer: tf } }
      case 'gap_fill': {
        const n = gapText.split('___').length - 1
        return { payload: { text: gapText, exactSpelling: !!p.exactSpelling }, answerKey: { blanks: Array.from({ length: n }, (_, i) => csv(blanks[i] ?? '')) } }
      }
      case 'short_answer':
        return { payload: { exactSpelling: !!p.exactSpelling }, answerKey: { accepted: csv(accepted) } }
      case 'matching': {
        const rows = lines(pairs).map((l) => l.split('=').map((x) => x.trim()))
        const left = rows.map((r) => r[0] ?? '')
        const right = rows.map((r) => r[1] ?? '')
        // Reverse the right column so it isn't already aligned
        const order = right.map((_, i) => right.length - 1 - i)
        return { payload: { left, right: order.map((i) => right[i]!) }, answerKey: { pairs: right.map((_, i) => order.indexOf(i)) } }
      }
      case 'ordering': {
        const items = lines(ordered)
        const rotated = [...items.slice(1), items[0]!]
        return { payload: { items: rotated }, answerKey: { order: items.map((_, i) => (i + items.length - 1) % items.length) } }
      }
      case 'essay': {
        const min = Math.max(10, Math.round(Number(minLen) || 150))
        const max = Math.round(Number(maxLen) || 0)
        // The exam's scale and name stay as generated; the teacher sets the task, limits and who grades
        const { max: _old, ...rest } = p
        void _old
        return {
          payload: { ...rest, taskLabel: taskLabel.trim(), min, ...(max > min ? { max } : {}), grader },
          answerKey: { rubric: rubric.trim(), modelAnswer: modelAnswer.trim() },
        }
      }
      case 'open_writing':
        return {
          payload: { lines: Math.min(20, Math.max(1, writingLines)), checklist: lines(checklist).slice(0, 6) },
          answerKey: { rubric: rubric.trim(), examples: lines(examples).slice(0, 5) },
        }
      default:
        return { payload: p, answerKey: k }
    }
  }

  const save = async () => {
    setBusy(true)
    setError(false)
    const { ok } = await postJson(`/api/assignments/${assignmentId}/exercises/${ex.id}`, { prompt, ...build() }, 'PATCH')
    setBusy(false)
    if (ok) onDone(true)
    else setError(true)
  }

  const optionList = lines(options)
  const gapCount = gapText.split('___').length - 1

  return (
    <div className="slide-down flex flex-col gap-3 rounded-lg border-2 border-ink-700 bg-paper-100 p-3">
      {'passage' in p && (
        <label className="flex flex-col gap-1">
          <span className="t-small font-medium text-ink-500">{t('ex.passage')}</span>
          <textarea rows={5} value={passage} onChange={(e) => setPassage(e.target.value)} className={area} />
        </label>
      )}
      {ex.kind !== 'gap_fill' && <textarea rows={2} value={prompt} onChange={(e) => setPrompt(e.target.value)} className={area} />}

      {ex.kind === 'essay' && (
        <>
          <input value={taskLabel} onChange={(e) => setTaskLabel(e.target.value)} placeholder={t('draft.essayTaskLabel')} className={`${area} min-h-10`} />
          <div className="flex flex-wrap items-center gap-3">
            <label className="t-small flex items-center gap-2 font-medium text-ink-500">
              {t('draft.essayMin')}
              <input type="number" min={10} value={minLen} onChange={(e) => setMinLen(e.target.value)} className={`${area} min-h-10 w-24`} />
            </label>
            <label className="t-small flex items-center gap-2 font-medium text-ink-500">
              {t('draft.essayMax')}
              <input type="number" min={0} value={maxLen} onChange={(e) => setMaxLen(e.target.value)} className={`${area} min-h-10 w-24`} />
            </label>
          </div>
          <fieldset className="flex flex-col gap-1">
            <legend className="t-small mb-1 font-medium text-ink-500">{t('draft.essayGrader')}</legend>
            {(['ai', 'teacher'] as const).map((g) => (
              <label key={g} className="t-body flex min-h-10 cursor-pointer items-center gap-2">
                <input type="radio" name={`grader-${ex.id}`} checked={grader === g} onChange={() => setGrader(g)} className="size-5 accent-orange-500" />
                {t(g === 'ai' ? 'draft.essayGraderAi' : 'draft.essayGraderTeacher')}
              </label>
            ))}
          </fieldset>
          <label className="flex flex-col gap-1">
            <span className="t-small font-medium text-ink-500">{t('draft.writingRubric')}</span>
            <textarea rows={4} value={rubric} onChange={(e) => setRubric(e.target.value)} className={area} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="t-small font-medium text-ink-500">{t('draft.essayModel')}</span>
            <textarea rows={6} value={modelAnswer} onChange={(e) => setModelAnswer(e.target.value)} className={area} />
          </label>
        </>
      )}

      {ex.kind === 'open_writing' && (
        <>
          <label className="t-small flex items-center gap-2 font-medium text-ink-500">
            {t('draft.writingLines')}
            <input type="number" min={1} max={20} value={writingLines} onChange={(e) => setWritingLines(Number(e.target.value))} className={`${area} min-h-10 w-20`} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="t-small font-medium text-ink-500">{t('draft.writingChecklist')}</span>
            <textarea rows={3} value={checklist} onChange={(e) => setChecklist(e.target.value)} className={area} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="t-small font-medium text-ink-500">{t('draft.writingRubric')}</span>
            <textarea rows={3} value={rubric} onChange={(e) => setRubric(e.target.value)} className={area} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="t-small font-medium text-ink-500">{t('draft.writingExamples')}</span>
            <textarea rows={3} value={examples} onChange={(e) => setExamples(e.target.value)} className={area} />
          </label>
        </>
      )}

      {(ex.kind === 'mcq_single' || ex.kind === 'mcq_multi') && (
        <>
          <p className="t-small text-ink-500">{t('draft.editHint')}</p>
          <textarea rows={Math.max(3, optionList.length)} value={options} onChange={(e) => setOptions(e.target.value)} className={area} />
          <div className="flex flex-wrap gap-2">
            {optionList.map((o, i) => (
              <label key={i} className="t-small flex min-h-11 items-center gap-2 rounded-md border border-paper-300 bg-paper-50 px-3">
                <input
                  type={ex.kind === 'mcq_single' ? 'radio' : 'checkbox'}
                  name={`c-${ex.id}`}
                  checked={correct.includes(i)}
                  onChange={() =>
                    setCorrect(ex.kind === 'mcq_single' ? [i] : correct.includes(i) ? correct.filter((x) => x !== i) : [...correct, i].sort())
                  }
                />
                {o}
              </label>
            ))}
          </div>
        </>
      )}

      {ex.kind === 'true_false' && (
        <select value={tf} onChange={(e) => setTf(e.target.value)} className={`${area} min-h-11`}>
          {['true', 'false', 'not_given'].map((v) => (
            <option key={v} value={v}>
              {t(`tf.${v}` as MessageKey)}
            </option>
          ))}
        </select>
      )}

      {ex.kind === 'gap_fill' && (
        <>
          <textarea rows={3} value={gapText} onChange={(e) => setGapText(e.target.value)} className={area} />
          {Array.from({ length: gapCount }, (_, i) => (
            <label key={i} className="t-small flex items-center gap-2">
              <span className="w-6 font-bold">{i + 1}.</span>
              <input
                value={blanks[i] ?? ''}
                onChange={(e) => {
                  const b = [...blanks]
                  b[i] = e.target.value
                  setBlanks(b)
                }}
                placeholder={t('draft.acceptedHint')}
                className={`${area} min-h-10`}
              />
            </label>
          ))}
        </>
      )}

      {ex.kind === 'short_answer' && (
        <input value={accepted} onChange={(e) => setAccepted(e.target.value)} placeholder={t('draft.acceptedHint')} className={`${area} min-h-11`} />
      )}

      {ex.kind === 'matching' && <textarea rows={5} value={pairs} onChange={(e) => setPairs(e.target.value)} placeholder="go = went" className={area} />}
      {ex.kind === 'ordering' && <textarea rows={5} value={ordered} onChange={(e) => setOrdered(e.target.value)} className={area} />}

      {error && <p className="t-small font-medium text-error-600">{t('error.generic')}</p>}
      <div className="flex gap-2">
        <Button onClick={save} loading={busy} className="flex-1">
          {t('action.save')}
        </Button>
        <Button variant="ghost" onClick={() => onDone(false)}>
          {t('common.cancel')}
        </Button>
      </div>
    </div>
  )
}
