'use client'
import { AlertTriangle, CheckCircle2, ListChecks, Upload } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
import { Button, ICON, Spinner } from '@ikhimi/ui/components'
import { play } from '@ikhimi/ui/sound'
import { useI18n } from '@/i18n/client'
import { compressImage, ERROR_KEYS, postJson } from '@/lib/client'
import { uploadFile } from '@/lib/upload'

type Result = { found: number; changed: { n: number; ref: string | null; before: string; after: string }[] }

/**
 * A copied draft's answers (DECISIONS.md BM): how many came from the book's answer pages and how many the AI worked
 * out (marked for checking), and the answer pages added after copying. Up to `max` pages, read once and not kept.
 * `others`: answers not from the book (the AI's, or a recording's): the pages can still replace them.
 */
export function AnswerKeyPanel({ assignmentId, fromBook, byAi, others, max }: { assignmentId: string; fromBook: number; byAi: number; others: number; max: number }) {
  const { t } = useI18n()
  const router = useRouter()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<'upload' | 'reading' | null>(null)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  // A long answer PDF: its pages are asked for, then the same files are read again
  const [pending, setPending] = useState<{ ids: string[]; pdf: boolean } | null>(null)
  const [pdfPages, setPdfPages] = useState('')

  const read = async (ids: string[], pages?: string) => {
    setBusy('reading')
    setError(null)
    const { ok, json } = await postJson(`/api/assignments/${assignmentId}/answers`, { materialIds: ids, ...(pages && { pdfPages: pages }) })
    setBusy(null)
    if (!ok) {
      play('error')
      const code = String(json.error ?? '')
      if (code === 'answers_pdf_pages') setPending({ ids, pdf: true })
      return setError(t(ERROR_KEYS[code] ?? 'error.generic', { n: Number(json.n ?? max), max }))
    }
    play('generation.complete')
    setPending(null)
    setPdfPages('')
    setResult(json as unknown as Result)
    router.refresh()
  }

  const onFiles = async (list: FileList | null) => {
    if (!list?.length) return
    const picked = Array.from(list).filter((f) => !f.type.startsWith('audio/'))
    if (picked.length > max) return setError(t('error.answersTooMany', { n: max }))
    setError(null)
    setResult(null)
    setBusy('upload')
    const ids: string[] = []
    for (const [i, original] of picked.entries()) {
      const file = await compressImage(original)
      const r = await uploadFile(file, (p) => setProgress((i + p) / picked.length), undefined, { purpose: 'answers' })
      if (!r.ok) {
        setBusy(null)
        return setError(r.error === 'file_too_large' ? t('error.fileTooLarge', { mb: r.maxMb ?? '' }) : r.error === 'upload' ? t('upload.failed') : t(ERROR_KEYS[r.error] ?? 'error.generic'))
      }
      ids.push(r.materialId)
    }
    await read(ids)
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-l-4 border-paper-300 border-l-orange-500 bg-paper-50 p-4 shadow-e1">
      <h2 className="t-h3 flex items-center gap-2">
        <ListChecks size={20} strokeWidth={ICON.strokeWidth} className="text-orange-700" aria-hidden /> {t('answers.title')}
      </h2>
      <p className="t-body t-num font-medium text-ink-700">{t('answers.summary', { key: fromBook, ai: byAi })}</p>
      {byAi > 0 ? (
        <p className="t-small flex items-start gap-1.5 text-warn-600">
          <AlertTriangle size={16} strokeWidth={ICON.strokeWidth} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            {t('answers.checkAi')} {t('digitize.answers.hint', { max })}
          </span>
        </p>
      ) : (
        fromBook > 0 && (
          <p className="t-small flex items-center gap-1.5 text-success-600">
            <CheckCircle2 size={16} strokeWidth={ICON.strokeWidth} aria-hidden /> {t('answers.allFromBook')}
          </p>
        )
      )}

      {result && (
        <div className="t-small flex flex-col gap-1 rounded-md bg-paper-100 px-3 py-2 text-ink-700">
          <span className="font-medium">{result.found ? t('answers.found', { n: result.found }) : t('answers.noneFound')}</span>
          {result.changed.length > 0 && (
            <>
              <span>{t('answers.changed')}</span>
              <ul className="flex flex-col gap-0.5">
                {result.changed.map((c) => (
                  <li key={c.n}>
                    <b className="t-num">{c.n}.</b> {c.ref && <span className="text-ink-400">{c.ref} · </span>}
                    <s className="text-ink-400">{c.before || '—'}</s> → <b>{c.after}</b>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {busy && (
        <p role="status" className="t-small flex items-center gap-2 text-ink-500">
          <Spinner /> {busy === 'reading' ? t('answers.reading') : `${t('upload.uploading')} ${Math.round(progress * 100)}%`}
        </p>
      )}
      {error && (
        <p role="alert" className="t-small text-error-600">
          {error}
        </p>
      )}
      {pending?.pdf && !busy && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="t-small flex items-center gap-2 font-medium text-ink-500">
            {t('digitize.answers.pdfPages')}
            <input
              value={pdfPages}
              onChange={(e) => setPdfPages(e.target.value)}
              placeholder={t('digitize.answers.pdfPagesPlaceholder')}
              inputMode="numeric"
              maxLength={40}
              className="t-body min-h-11 w-40 rounded-md border border-paper-300 bg-paper-50 px-2 text-ink-700 focus:border-ink-700 focus:outline-none"
            />
          </label>
          <Button size="sm" onClick={() => read(pending.ids, pdfPages)} disabled={!pdfPages.trim()}>
            {t('answers.read')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setPending(null)
              setError(null)
            }}
          >
            {t('common.cancel')}
          </Button>
        </div>
      )}
      {!busy && !pending && (others > 0 || result) && (
        <Button variant="secondary" onClick={() => input.current?.click()} icon={<Upload size={18} strokeWidth={ICON.strokeWidth} aria-hidden />} className="self-start">
          {t('digitize.answers.upload')}
        </Button>
      )}
      <input
        ref={input}
        type="file"
        accept="image/*,application/pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        multiple
        hidden
        onChange={(e) => void onFiles(e.target.files).finally(() => (e.target.value = ''))}
      />
    </section>
  )
}
