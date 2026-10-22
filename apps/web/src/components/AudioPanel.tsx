'use client'
import { AlertTriangle, CheckCircle2, FolderOpen, Headphones, Upload } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { audioNameMatches, pickTracks, suggestedFileName } from '@ikhimi/ai/audio-names'
import { Button, Chip, ICON, Spinner } from '@ikhimi/ui/components'
import { play } from '@ikhimi/ui/sound'
import { useI18n } from '@/i18n/client'
import { expandAudio } from '@/lib/audio-files'
import { ERROR_KEYS, postJson } from '@/lib/client'
import { uploadFile } from '@/lib/upload'

export type ListeningExercise = { id: string; n: number; label: string | null; sourceRef: string | null; linked: boolean }

type FileState =
  | { name: string; state: 'uploading'; progress: number }
  | { name: string; state: 'checking' }
  /** Attaching without the AI's check */
  | { name: string; state: 'attaching' }
  | { name: string; state: 'done'; unchecked?: boolean }
  | { name: string; state: 'error'; message: string }
  /** The AI said it isn't the recording for these exercises: the teacher may still attach it */
  | { name: string; state: 'mismatch'; message: string; materialId: string; exerciseIds: string[] }
  /** The file name didn't point at an exercise: the teacher picks one */
  | { name: string; state: 'choose'; materialId: string }

const ACCEPT = 'audio/*,.mp3,.m4a,.wav,.ogg,.aac,.zip,application/zip'

type T = ReturnType<typeof useI18n>['t']

/** Attach an uploaded recording to exercises: the server listens once and checks it fits (or `force`: attaches it as it is) */
async function sendRecording(assignmentId: string, body: { materialId: string; exerciseIds?: string[]; force?: boolean }) {
  const { ok, json } = await postJson(`/api/assignments/${assignmentId}/audio`, body)
  return { ok, error: json.error as string | undefined, reason: String(json.reason ?? ''), exerciseIds: (json.exerciseIds as string[] | undefined) ?? body.exerciseIds ?? [] }
}

const uploadError = (t: T, r: { error: string; maxMb?: number }) =>
  r.error === 'file_too_large' ? t('error.fileTooLarge', { mb: r.maxMb ?? '' }) : r.error === 'upload' ? t('upload.failed') : t(ERROR_KEYS[r.error] ?? 'error.generic')

/**
 * Upload one file and attach it, keeping its state in `set`. Shared by the panel (many files) and the button on a
 * single exercise.
 */
function useRecording(assignmentId: string) {
  const { t } = useI18n()
  const router = useRouter()
  const [files, setFiles] = useState<FileState[]>([])
  const set = (name: string, s: FileState) => setFiles((fs) => fs.map((f) => (f.name === name ? s : f)))

  const attach = async (name: string, materialId: string, exerciseIds?: string[], force = false) => {
    set(name, force ? { name, state: 'attaching' } : { name, state: 'checking' })
    const r = await sendRecording(assignmentId, { materialId, exerciseIds, force })
    if (r.ok) {
      play('generation.complete')
      set(name, { name, state: 'done', unchecked: force })
      return router.refresh()
    }
    if (r.error === 'audio_no_match') return set(name, { name, state: 'choose', materialId })
    play('error')
    if (r.error === 'audio_mismatch') return set(name, { name, state: 'mismatch', message: t('audio.mismatch', { name, reason: r.reason }), materialId, exerciseIds: r.exerciseIds })
    set(name, { name, state: 'error', message: t(ERROR_KEYS[r.error ?? ''] ?? 'error.generic') })
  }

  const upload = async (file: File, exerciseIds?: string[]) => {
    const name = file.name
    setFiles((fs) => [...fs.filter((f) => f.name !== name), { name, state: 'uploading', progress: 0 }])
    const r = await uploadFile(file, (p) => set(name, { name, state: 'uploading', progress: p }))
    if (!r.ok) return set(name, { name, state: 'error', message: uploadError(t, r) })
    await attach(name, r.materialId, exerciseIds)
  }

  return { files, attach, upload }
}

/** One file's line: progress, the AI listening, done, or what went wrong (with "attach anyway" when the AI refused it) */
function FileLine({ f, onAnyway, children }: { f: FileState; onAnyway: (f: Extract<FileState, { state: 'mismatch' }>) => void; children?: React.ReactNode }) {
  const { t } = useI18n()
  return (
    <li className="t-small flex flex-col gap-2 rounded-md bg-paper-100 px-3 py-2">
      <span className="flex items-center gap-2">
        {f.state === 'done' ? (
          <CheckCircle2 size={16} strokeWidth={ICON.strokeWidth} className="shrink-0 text-success-600" aria-hidden />
        ) : f.state === 'error' || f.state === 'mismatch' ? (
          <AlertTriangle size={16} strokeWidth={ICON.strokeWidth} className="shrink-0 text-error-600" aria-hidden />
        ) : f.state === 'choose' ? (
          <Headphones size={16} strokeWidth={ICON.strokeWidth} className="shrink-0 text-ink-500" aria-hidden />
        ) : (
          <Spinner />
        )}
        <span className="min-w-0 flex-1 truncate font-medium" title={f.name}>
          {f.name}
        </span>
        <span className="t-num text-ink-500">
          {f.state === 'uploading' && `${Math.round(f.progress * 100)}%`}
          {f.state === 'checking' && t('audio.checking')}
        </span>
      </span>
      {f.state === 'done' && (
        <span className={f.unchecked ? 'text-warn-600' : 'text-success-600'}>{f.unchecked ? t('audio.attachedUnchecked', { name: f.name }) : t('audio.attached', { name: f.name })}</span>
      )}
      {(f.state === 'error' || f.state === 'mismatch') && (
        <span role="alert" className="text-error-600">
          {f.message}
        </span>
      )}
      {f.state === 'mismatch' && f.exerciseIds.length > 0 && (
        <Button variant="secondary" size="sm" onClick={() => onAnyway(f)} className="self-start">
          {t('audio.attachAnyway')}
        </Button>
      )}
      {children}
    </li>
  )
}

/**
 * "Audio needed" (listening items copied from the book). The teacher uploads recordings: one by one, several at
 * once, a whole folder or the book's ZIP. A file whose name carries the track number is linked by itself; from a
 * folder or a ZIP only the tracks this homework needs are uploaded. The server has the AI listen once, confirm the
 * recording fits and key it (DECISIONS.md U, BM); a file it can't place, the teacher places.
 */
export function AudioPanel({ assignmentId, exercises }: { assignmentId: string; exercises: ListeningExercise[] }) {
  const { t } = useI18n()
  const input = useRef<HTMLInputElement>(null)
  const folder = useRef<HTMLInputElement>(null)
  const { files, attach, upload } = useRecording(assignmentId)
  const [note, setNote] = useState<string | null>(null)
  // A folder can't be picked on phones (iOS has no folder picker): there, several files are chosen instead
  const [canFolder, setCanFolder] = useState(false)
  useEffect(() => setCanFolder(!window.matchMedia('(pointer: coarse)').matches), [])
  const waiting = exercises.filter((e) => !e.linked)
  const labelOf = (e: ListeningExercise) => e.label || e.sourceRef || `#${e.n}`
  // One chip per recording label ("Track 1.12" may cover several items)
  const groups = [...new Map(waiting.map((e) => [labelOf(e), e])).values()]
  const idsOf = (e: ListeningExercise) => waiting.filter((w) => labelOf(w) === labelOf(e)).map((w) => w.id)
  const examples = groups
    .map((e) => e.label)
    .filter((l): l is string => !!l)
    .slice(0, 2)
    .map(suggestedFileName)

  const onFiles = async (list: FileList | null, fromFolder: boolean) => {
    if (!list?.length) return
    setNote(null)
    const picked = Array.from(list)
    // Many files (a folder, a ZIP, the whole CD): only the tracks that match are kept, and nothing else is uploaded
    const needed = (name: string) => groups.some((g) => audioNameMatches(name, g.label, g.sourceRef))
    const many = fromFolder || picked.length > groups.length
    const { files: audio, total, zipped } = await expandAudio(picked, needed, (name) => setNote(t('audio.zipFailed', { name })))
    if (!many && !zipped) {
      for (const file of audio) await upload(file)
      return
    }
    const picks = pickTracks(
      audio.map((f) => f.name),
      groups.map((g) => ({ label: g.label, sourceRef: g.sourceRef })),
    )
    const found = picks.filter((i) => i >= 0).length
    setNote(found ? t('audio.picked', { n: found, total }) : t('audio.pickedNone'))
    for (const [gi, fi] of picks.entries()) if (fi >= 0) await upload(audio[fi]!, idsOf(groups[gi]!))
  }

  if (!waiting.length && !files.length) return null
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-l-4 border-paper-300 border-l-orange-500 bg-paper-50 p-4 shadow-e1">
      <h2 className="t-h3 flex items-center gap-2">
        <Headphones size={20} strokeWidth={ICON.strokeWidth} className="text-orange-700" aria-hidden /> {t('audio.needed.title')}
      </h2>
      {groups.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {groups.map((e) => (
            <li key={e.id} className="t-small rounded-pill bg-orange-100 px-3 py-1 font-medium text-ink-800">
              {e.n}. {labelOf(e)}
            </li>
          ))}
        </ul>
      )}
      <p className="t-small text-ink-500">{t('audio.needed.hint', { examples: (examples.length ? examples : ['Track 1.12.mp3']).join(', ') })}</p>
      {waiting.length > 0 && <p className="t-small text-ink-500">{t('audio.manyHint')}</p>}

      {(note || files.length > 0) && (
        <ul className="flex flex-col gap-2">
          {note && <li className="t-small rounded-md bg-paper-200 px-3 py-2 text-ink-700">{note}</li>}
          {files.map((f) => (
            <FileLine key={f.name} f={f} onAnyway={(m) => attach(m.name, m.materialId, m.exerciseIds, true)}>
              {f.state === 'choose' && (
                <span className="flex flex-col gap-2">
                  <span className="text-ink-700">{t('audio.chooseExercise', { name: f.name })}</span>
                  <span className="flex flex-wrap gap-2">
                    {groups.map((e) => (
                      <Chip key={e.id} onClick={() => attach(f.name, f.materialId, idsOf(e))}>
                        {e.n}. {labelOf(e)}
                      </Chip>
                    ))}
                  </span>
                </span>
              )}
            </FileLine>
          ))}
        </ul>
      )}

      {waiting.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => input.current?.click()} icon={<Upload size={18} strokeWidth={ICON.strokeWidth} aria-hidden />}>
            {t('audio.upload')}
          </Button>
          {canFolder && (
            <Button variant="ghost" onClick={() => folder.current?.click()} icon={<FolderOpen size={18} strokeWidth={ICON.strokeWidth} aria-hidden />}>
              {t('audio.folder')}
            </Button>
          )}
        </div>
      )}
      <input ref={input} type="file" accept={ACCEPT} multiple hidden onChange={(e) => void onFiles(e.target.files, false).finally(() => (e.target.value = ''))} />
      <input
        ref={folder}
        type="file"
        multiple
        hidden
        {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
        onChange={(e) => void onFiles(e.target.files, true).finally(() => (e.target.value = ''))}
      />
    </section>
  )
}

/**
 * The upload button on one listening exercise still without its recording: the file goes straight to this exercise
 * (and the others sharing its track), with no name matching. The AI listens once and checks it fits.
 */
export function ExerciseAudioUpload({ assignmentId, exerciseIds }: { assignmentId: string; exerciseIds: string[] }) {
  const { t } = useI18n()
  const input = useRef<HTMLInputElement>(null)
  const { files, attach, upload } = useRecording(assignmentId)
  const f = files.at(-1)
  const busy = f && (f.state === 'uploading' || f.state === 'checking' || f.state === 'attaching')
  return (
    <div className="flex flex-col gap-2">
      {f && (
        <ul>
          <FileLine f={f} onAnyway={(m) => attach(m.name, m.materialId, m.exerciseIds, true)} />
        </ul>
      )}
      {!busy && f?.state !== 'done' && (
        <Button variant="secondary" size="sm" onClick={() => input.current?.click()} icon={<Upload size={16} strokeWidth={ICON.strokeWidth} aria-hidden />} className="self-start">
          {f ? t('audio.otherFile') : t('audio.upload')}
        </Button>
      )}
      <input
        ref={input}
        type="file"
        accept="audio/*,.mp3,.m4a,.wav,.ogg,.aac"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void upload(file, exerciseIds)
        }}
      />
    </div>
  )
}
