'use client'
import { AlertTriangle, ArrowUp, BookOpenCheck, Camera, FileText, FolderOpen, GraduationCap, History, Image as ImageIcon, Languages, ListChecks, Mic, Music, Plus, Sparkles, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { examsFor, guessLanguage, isLanguageSubject, LANGUAGE_CODES, type LanguageCode } from '@ikhimi/ai/exams'
import type { HomeworkPlan } from '@ikhimi/ai/plan-shape'
import type { MessageKey } from '@ikhimi/i18n'
import { Badge, Chip, ICON, IconButton, KindIcon, SegmentedControl, Textarea } from '@ikhimi/ui/components'
import { flip } from '@ikhimi/ui/motion'
import { play } from '@ikhimi/ui/sound'
import { useI18n } from '@/i18n/client'
import { compressImage, ERROR_KEYS, fetchPlan, streamGenerate, type GenEvent, type ItemPreview } from '@/lib/client'
import { uploadFile } from '@/lib/upload'
import { PlanCard } from './PlanCard'

const MINUTES = [10, 15, 20, 30, 45]
const DIFFICULTY: { v: number; key: MessageKey }[] = [
  { v: 2, key: 'param.easy' },
  { v: 3, key: 'param.medium' },
  { v: 4, key: 'param.hard' },
]
const SKILLS = ['grammar', 'vocabulary', 'reading', 'writing', 'pronunciation'] as const
const SUGGESTIONS: { key: 'review' | 'photo' | 'grammar'; icon: typeof History }[] = [
  { key: 'review', icon: History },
  { key: 'photo', icon: Camera },
  { key: 'grammar', icon: BookOpenCheck },
]
const SPEECH_LANG: Record<string, string> = { 'uz-Latn': 'uz-UZ', 'uz-Cyrl': 'uz-UZ', ru: 'ru-RU', en: 'en-US' }
const SUBJECT_NOTICE_KEY = 'ikhimi.subjectNoticeDismissed'
/** Last exam style + level per language, so a tutor who always does IELTS doesn't re-pick it */
const STYLE_KEY = 'ikhimi.examStyle'
/** The course the teacher last made homework for: its remembered choices shape the plan */
const COURSE_KEY = 'ikhimi.course'

type ChipState = 'uploading' | 'uploaded' | 'ready' | 'failed'
type Material = {
  localId: string
  materialId?: string
  /** answers: the book's answer pages (copying only), read for the answers and never copied as exercises */
  role: 'pages' | 'answers'
  name: string
  kind: 'image' | 'pdf' | 'doc' | 'audio' | 'other'
  previewUrl?: string
  progress: number
  state: ChipState
  error?: string
}
type Stage = Extract<GenEvent, { type: 'progress' }>['stage'] | 'planning' | 'replanning'

const kindOf = (f: File): Material['kind'] =>
  f.type.startsWith('image/') ? 'image' : f.type === 'application/pdf' ? 'pdf' : f.type.startsWith('audio/') ? 'audio' : f.type.includes('word') ? 'doc' : 'other'

/** Book pages per request (photos + PDFs; a long PDF is cut to the pages the teacher names) */
const isPage = (m: Pick<Material, 'kind' | 'role'>) => m.kind !== 'audio' && m.role === 'pages'

/** The owner's own methodology, made in the Lab and switched on for teachers (server/lab.ts ownStyles) */
export type OwnStyleOption = { id: string; name: string; language: string; levels: string[] }
type StyleOption = { id: string; name: string; levels: string[]; defaultLevel: string }

/** The Style list for a language: the catalog's exams, then the owner's own methodologies */
function styleOptions(language: LanguageCode | null, own: OwnStyleOption[]): StyleOption[] {
  if (!language) return []
  return [...examsFor(language), ...own.filter((s) => s.language === language).map((s) => ({ id: s.id, name: s.name, levels: s.levels, defaultLevel: s.levels[0] ?? '' }))]
}

type SpeechRec = { lang: string; interimResults: boolean; continuous: boolean; start(): void; stop(): void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null; onend: (() => void) | null }

/** The hero composer (design spec §7). */
export function Composer({
  firstName,
  defaults,
  subjects,
  recentLanguages = [],
  maxPages = 12,
  maxAnswerPages = 4,
  courses = [],
  styles = [],
  initial,
}: {
  firstName: string | null
  defaults: { minutes?: number; difficulty?: number }
  subjects: string[]
  /** contentLanguage of the teacher's recent homework, newest first */
  recentLanguages?: string[]
  /** Book pages per request (photos + PDF pages), CONFIG.maxMaterialPages */
  maxPages?: number
  /** Copying: the book's answer pages beside them, CONFIG.maxAnswerPages */
  maxAnswerPages?: number
  /** The teacher's courses, for the course chip */
  courses?: { id: string; title: string }[]
  /** The owner's own methodologies, beside the exams in the Style list */
  styles?: OwnStyleOption[]
  /** A request written for the teacher to send or edit (the group page's weak skill → practice homework) */
  initial?: { text: string; skills: string[] } | null
}) {
  const MAX_PAGES = maxPages
  const { t, locale } = useI18n()
  const router = useRouter()
  const [text, setText] = useState(initial?.text ?? '')
  const [subjectNoticeDismissed, setSubjectNoticeDismissed] = useState(true)
  const showSubjectNotice = !subjectNoticeDismissed && subjects.some((s) => !isLanguageSubject(s))
  useEffect(() => {
    try {
      setSubjectNoticeDismissed(localStorage.getItem(SUBJECT_NOTICE_KEY) === '1')
    } catch {}
  }, [])
  const dismissSubjectNotice = () => {
    setSubjectNoticeDismissed(true)
    try {
      localStorage.setItem(SUBJECT_NOTICE_KEY, '1')
    } catch {}
  }
  const [mode, setMode] = useState<'create' | 'digitize'>('create')
  const [pdfPages, setPdfPages] = useState('')
  const [answerPdfPages, setAnswerPdfPages] = useState('')
  const [answersSheet, setAnswersSheet] = useState(false)
  /** Which box the file pickers fill: the book pages, or (copying) the answer pages */
  const target = useRef<Material['role']>('pages')
  const [minutes, setMinutes] = useState(defaults.minutes ?? 20)
  const [difficulty, setDifficulty] = useState(defaults.difficulty ?? 3)
  const [skills, setSkills] = useState<string[]>(() => (initial?.skills ?? []).filter((x) => (SKILLS as readonly string[]).includes(x)))
  const [showSkills, setShowSkills] = useState(skills.length > 0)
  // Language being taught: guessed until the teacher picks one; exam styles are only that language's
  const [pickedLanguage, setPickedLanguage] = useState<LanguageCode | '' | null>(null)
  const [examId, setExamId] = useState('')
  const [examLevel, setExamLevel] = useState('')
  const [stage, setStage] = useState<Stage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [materials, setMaterials] = useState<Material[]>([])
  const guessed = useMemo(
    () => guessLanguage({ text, fileNames: materials.map((m) => m.name), recent: recentLanguages, subjects }),
    [text, materials, recentLanguages, subjects],
  )
  const language: LanguageCode | null = pickedLanguage === null ? guessed : pickedLanguage || null
  const exams = styleOptions(language, styles)
  const exam = exams.find((e) => e.id === examId) ?? null
  // Never keep another language's exam: switching English → Arabic drops IELTS
  useEffect(() => {
    if (examId && !exam) {
      let saved: { id?: string; level?: string } = {}
      try {
        saved = (JSON.parse(localStorage.getItem(STYLE_KEY) ?? '{}') as Record<string, { id?: string; level?: string }>)[language ?? ''] ?? {}
      } catch {}
      const back = styleOptions(language, styles).find((e) => e.id === saved.id)
      setExamId(back?.id ?? '')
      setExamLevel(back && saved.level && back.levels.includes(saved.level) ? saved.level : (back?.defaultLevel ?? ''))
    }
  }, [language, examId, exam, styles])
  const pickExam = (id: string, level?: string) => {
    const e = exams.find((x) => x.id === id) ?? null
    const lvl = e ? (level && e.levels.includes(level) ? level : e.defaultLevel) : ''
    setExamId(e ? e.id : '')
    setExamLevel(lvl)
    try {
      const all = JSON.parse(localStorage.getItem(STYLE_KEY) ?? '{}') as Record<string, unknown>
      if (language) all[language] = e ? { id: e.id, level: lvl } : {}
      localStorage.setItem(STYLE_KEY, JSON.stringify(all))
    } catch {}
  }
  // Restore the teacher's usual style for the guessed language once
  const restored = useRef(false)
  useEffect(() => {
    if (restored.current || !language) return
    restored.current = true
    try {
      const saved = (JSON.parse(localStorage.getItem(STYLE_KEY) ?? '{}') as Record<string, { id?: string; level?: string }>)[language]
      const e = styleOptions(language, styles).find((x) => x.id === saved?.id)
      if (e) {
        setExamId(e.id)
        setExamLevel(saved?.level && e.levels.includes(saved.level) ? saved.level : e.defaultLevel)
      }
    } catch {}
  }, [language, styles])
  // Create mode: the plan card in the chat, the plan as first proposed (what the teacher changed is remembered for
  // the course), the teacher's answers to it, and items as they are written
  const [plan, setPlan] = useState<HomeworkPlan | null>(null)
  const proposed = useRef<HomeworkPlan | null>(null)
  const [answers, setAnswers] = useState<string[]>([])
  const [previews, setPreviews] = useState<ItemPreview[]>([])
  const [courseId, setCourseId] = useState('')
  useEffect(() => {
    try {
      const saved = localStorage.getItem(COURSE_KEY) ?? ''
      if (courses.some((c) => c.id === saved)) setCourseId(saved)
    } catch {}
  }, [courses])
  const pickCourse = (id: string) => {
    setCourseId(id)
    try {
      localStorage.setItem(COURSE_KEY, id)
    } catch {}
  }
  const threadEnd = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (plan || previews.length) threadEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [plan, previews.length, answers.length])
  const [sheetOpen, setSheetOpen] = useState(false)
  const [docked, setDocked] = useState(false)
  const [sentText, setSentText] = useState('')
  const [listening, setListening] = useState(false)
  const [speechOk, setSpeechOk] = useState(false)
  const recRef = useRef<SpeechRec | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const pendingFlip = useRef<(() => void) | null>(null)
  const coarse = useRef(false)
  const inputs = {
    camera: useRef<HTMLInputElement>(null),
    gallery: useRef<HTMLInputElement>(null),
    file: useRef<HTMLInputElement>(null),
    audio: useRef<HTMLInputElement>(null),
  }

  useEffect(() => {
    coarse.current = window.matchMedia('(pointer: coarse)').matches
    setSpeechOk('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)
    // Keep the composer above the on-screen keyboard (spec §7 mobile)
    const vv = window.visualViewport
    if (!vv) return
    const update = () => document.documentElement.style.setProperty('--kb', `${Math.max(0, window.innerHeight - vv.height - vv.offsetTop)}px`)
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])

  // FLIP: measured before the state change, played after layout
  useLayoutEffect(() => {
    pendingFlip.current?.()
    pendingFlip.current = null
  }, [docked])

  useEffect(() => () => materials.forEach((m) => m.previewUrl && URL.revokeObjectURL(m.previewUrl)), []) // eslint-disable-line react-hooks/exhaustive-deps

  const patch = (id: string, p: Partial<Material>) => setMaterials((ms) => ms.map((m) => (m.localId === id ? { ...m, ...p } : m)))

  const upload = async (original: File, role: Material['role']) => {
    const localId = crypto.randomUUID()
    const file = await compressImage(original)
    const kind = kindOf(file)
    setMaterials((ms) => [...ms, { localId, role, name: file.name, kind, progress: 0, state: 'uploading', previewUrl: kind === 'image' ? URL.createObjectURL(file) : undefined }])
    const r = await uploadFile(file, (p) => patch(localId, { progress: p }), (materialId) => patch(localId, { materialId }), role === 'answers' ? { purpose: 'answers' } : {})
    if (r.ok) return patch(localId, { state: r.state, progress: 1 })
    patch(localId, {
      state: 'failed',
      error: r.error === 'upload' ? t('upload.failed') : r.error === 'file_too_large' ? t('error.fileTooLarge', { mb: r.maxMb ?? '' }) : t(ERROR_KEYS[r.error] ?? 'error.generic'),
    })
  }

  const onFiles = (files: FileList | null) => {
    const role = target.current
    target.current = 'pages'
    setSheetOpen(false)
    setAnswersSheet(false)
    if (!files) return
    let pages = materials.filter(isPage).length
    let answerPages = materials.filter((m) => m.role === 'answers').length
    for (const f of Array.from(files)) {
      // Old Word (97–2003) can't be read; say so now instead of after a long generation
      if (f.type === 'application/msword' || /\.doc$/i.test(f.name)) {
        setError(t('error.docOld'))
        continue
      }
      if (role === 'answers') {
        // Only the pages with these exercises' answers: a whole answer book is never read for one homework
        if (f.type.startsWith('audio/')) continue
        if (++answerPages > maxAnswerPages) {
          setError(t('error.answersTooMany', { n: maxAnswerPages }))
          break
        }
      } else if (!f.type.startsWith('audio/') && ++pages > MAX_PAGES) {
        setError(t('error.tooManyPages', { n: MAX_PAGES }))
        break
      }
      void upload(f, role)
    }
  }

  /** Open a file picker for the book pages or the answer pages */
  const pick = (key: keyof typeof inputs, role: Material['role']) => {
    target.current = role
    inputs[key].current?.click()
  }

  const toggleMic = () => {
    if (listening) return recRef.current?.stop()
    const W = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec }
    const Rec = W.SpeechRecognition ?? W.webkitSpeechRecognition
    if (!Rec) return
    const rec = new Rec()
    rec.lang = SPEECH_LANG[locale] ?? 'uz-UZ'
    rec.interimResults = false
    rec.continuous = true
    const base = text ? text.trimEnd() + ' ' : ''
    let heard = ''
    rec.onresult = (e) => {
      heard = Array.from(e.results)
        .map((r) => r[0]?.transcript ?? '')
        .join(' ')
      setText(base + heard)
    }
    rec.onend = () => setListening(false)
    recRef.current = rec
    rec.start()
    setListening(true)
  }

  const uploading = materials.some((m) => m.state === 'uploading')
  const isReady = (m: Material) => !!m.materialId && (m.state === 'ready' || m.state === 'uploaded')
  const readyIds = materials.filter((m) => m.role === 'pages' && isReady(m)).map((m) => m.materialId!)
  const answerFiles = materials.filter((m) => m.role === 'answers')
  const answerIds = mode === 'digitize' ? answerFiles.filter(isReady).map((m) => m.materialId!) : []
  const pageCount = materials.filter(isPage).length
  const hasPdf = materials.some((m) => m.kind === 'pdf' && m.role === 'pages')
  const answerHasPdf = answerFiles.some((m) => m.kind === 'pdf')
  // With a plan on screen, the composer answers the plan ("그림 문제도 넣어 줘")
  const canSend = !stage && !uploading && (plan ? text.trim().length > 0 : mode === 'digitize' ? readyIds.length > 0 : text.trim().length > 0 || readyIds.length > 0)

  const dock = (value: boolean) => {
    pendingFlip.current = flip(() => cardRef.current)
    setDocked(value)
  }

  const failed = (code: string, n?: number) => {
    play('error')
    setStage(null)
    setError(t(ERROR_KEYS[code] ?? 'error.generic', { n: n ?? '', max: code.startsWith('answers_') ? maxAnswerPages : MAX_PAGES }))
  }

  const settings = () => ({ materialIds: readyIds, minutes, difficulty, skills, language, exam: exam ? { id: exam.id, level: examLevel || exam.defaultLevel } : null, courseId: courseId || null })

  /** Write the homework: Digitize straight away, Create from the confirmed plan */
  const write = async (body: Record<string, unknown>) => {
    setError(null)
    setPreviews([])
    setStage(readyIds.length && !plan ? 'reading' : 'writing')
    await streamGenerate(body, (e) => {
      if (e.type === 'progress') setStage(e.stage)
      else if (e.type === 'items') setPreviews((p) => [...p, ...e.items])
      else if (e.type === 'done') {
        play('generation.complete')
        router.push(`/app/a/${e.assignmentId}`)
      } else {
        failed(e.code, e.n)
        // Digitize goes back to the composer; Create keeps its plan so "만들기" can be pressed again
        if (!plan) dock(false)
      }
    })
  }

  const create = () => plan && void write({ mode: 'create', text: [sentText, ...answers].filter(Boolean).join('\n'), ...settings(), plan, proposedPlan: proposed.current })

  /** Back from the plan to the composer, with the message as it was */
  const back = () => {
    setPlan(null)
    proposed.current = null
    setAnswers([])
    setError(null)
    setText(sentText)
    dock(false)
  }

  const generate = async () => {
    if (!canSend) return
    recRef.current?.stop()
    setError(null)
    setSheetOpen(false)
    if (plan) {
      // The teacher answered the plan: change it
      const feedback = text.trim()
      setAnswers((a) => [...a, feedback])
      setText('')
      setStage('replanning')
      const r = await fetchPlan({ text: sentText, ...settings(), revise: { previous: plan, feedback } })
      if (!r.ok) return failed(r.code, r.n)
      setStage(null)
      setPlan(r.plan)
      proposed.current = r.plan
      return
    }
    setSentText(text)
    dock(true)
    if (mode === 'digitize') {
      return write({ mode, text, materialIds: readyIds, pdfPages: hasPdf ? pdfPages : undefined, answerMaterialIds: answerIds, answerPages: answerHasPdf ? answerPdfPages : undefined })
    }
    setText('')
    setStage('planning')
    const r = await fetchPlan({ text, ...settings() })
    if (!r.ok) {
      failed(r.code, r.n)
      setText(text)
      return dock(false)
    }
    setStage(null)
    setPlan(r.plan)
    proposed.current = r.plan
  }

  const thumbList = (list: Material[], label: string) => list.length > 0 && (
    <ul className="flex gap-2 overflow-x-auto px-1 pb-2" aria-label={label}>
      {list.map((m) => (
        <li key={m.localId} className="relative flex shrink-0 items-center gap-2 rounded-md border border-paper-300 bg-paper-100 py-1.5 pl-1.5 pr-8">
          <span className="relative flex size-10 items-center justify-center overflow-hidden rounded-sm bg-paper-200 text-ink-500">
            {m.previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={m.previewUrl} alt="" className="size-full object-cover" />
            ) : m.kind === 'audio' ? (
              <Music size={20} strokeWidth={ICON.strokeWidth} aria-hidden />
            ) : (
              <FileText size={20} strokeWidth={ICON.strokeWidth} aria-hidden />
            )}
            {m.state === 'uploading' && (
              <span className="absolute inset-x-0 bottom-0 h-1 bg-paper-300">
                <span className="block h-full w-full origin-left bg-orange-500" style={{ transform: `scaleX(${m.progress})` }} />
              </span>
            )}
          </span>
          <span className="flex max-w-40 flex-col">
            <span className="t-small truncate font-medium" title={m.name}>
              {m.name}
            </span>
            <span className={`t-small ${m.state === 'failed' ? 'text-error-600' : 'text-ink-400'}`}>
              {m.state === 'uploading' && `${t('upload.uploading')} ${Math.round(m.progress * 100)}%`}
              {(m.state === 'uploaded' || m.state === 'ready') && `✓ ${t('upload.done')}`}
              {m.state === 'failed' && (m.error ?? t('upload.failed'))}
            </span>
          </span>
          {!docked && (
            <button
              type="button"
              onClick={() => setMaterials((ms) => ms.filter((x) => x.localId !== m.localId))}
              aria-label={`${t('action.delete')}: ${m.name}`}
              className="absolute right-1 top-1 flex size-7 items-center justify-center rounded-full text-ink-400 hover:bg-paper-200 hover:text-ink-700"
            >
              <X size={16} strokeWidth={ICON.strokeWidth} aria-hidden />
            </button>
          )}
        </li>
      ))}
    </ul>
  )
  const thumbs = thumbList(
    materials.filter((m) => m.role === 'pages'),
    t('compose.attach'),
  )

  const pickers = (role: Material['role']) =>
    (
      [
        ['camera', Camera, t('attach.camera')],
        ['gallery', ImageIcon, t('attach.gallery')],
        ['file', FileText, t('attach.file')],
        ...(role === 'pages' ? ([['audio', Music, t('attach.audio')]] as const) : []),
      ] as const
    ).map(([key, Icon, label]) => (
      <button
        key={key}
        type="button"
        onClick={() => pick(key, role)}
        className="press flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-paper-300 bg-paper-100 text-sm font-medium hover:bg-paper-200"
      >
        <Icon size={24} strokeWidth={ICON.strokeWidth} aria-hidden />
        {label}
      </button>
    ))

  // Copying: the book's answer pages, apart from the exercise pages. Without them the AI solves the exercises itself,
  // which the teacher is told plainly (DECISIONS.md BM)
  const answersBox = mode === 'digitize' && !docked && (
    <div className="mb-2 flex flex-col gap-2 rounded-xl border-2 border-dashed border-paper-300 bg-paper-100 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="t-small flex items-center gap-1.5 font-semibold text-ink-700">
          <ListChecks size={18} strokeWidth={ICON.strokeWidth} className="text-orange-700" aria-hidden /> {t('digitize.answers.title')}
        </span>
        {answerFiles.length > 0 && <span className="t-small t-num text-ink-400">{t('digitize.answers.count', { n: answerFiles.length, max: maxAnswerPages })}</span>}
        <button type="button" onClick={() => setAnswersSheet((o) => !o)} aria-expanded={answersSheet} className="btn btn-secondary btn-sm ml-auto">
          <span className="btn-label">{t('digitize.answers.upload')}</span>
        </button>
      </div>
      {answersSheet && <div className="slide-down grid grid-cols-3 gap-2">{pickers('answers')}</div>}
      {thumbList(answerFiles, t('digitize.answers.title'))}
      {answerHasPdf && (
        <label className="t-small flex items-center gap-2 font-medium text-ink-500">
          {t('digitize.answers.pdfPages')}
          <input
            value={answerPdfPages}
            onChange={(e) => setAnswerPdfPages(e.target.value)}
            placeholder={t('digitize.answers.pdfPagesPlaceholder')}
            inputMode="numeric"
            maxLength={40}
            className="t-body min-h-9 w-40 rounded-md border border-paper-300 bg-paper-50 px-2 text-ink-700 focus:border-ink-700 focus:outline-none"
          />
        </label>
      )}
      {answerFiles.length > 0 ? (
        <p className="t-small text-ink-500">{t('digitize.answers.hint', { max: maxAnswerPages })}</p>
      ) : (
        <p className="t-small flex items-start gap-1.5 text-warn-600">
          <AlertTriangle size={16} strokeWidth={ICON.strokeWidth} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            {t('digitize.answers.none')} {t('digitize.answers.hint', { max: maxAnswerPages })}
          </span>
        </p>
      )}
    </div>
  )

  const card = (
    <div ref={cardRef} className="rounded-2xl border-2 border-paper-300 bg-paper-50 p-3 shadow-e3 md:rounded-xl md:p-4">
      {docked && (stage || !plan) ? (
        // While generating, the docked composer becomes the streaming status line (spec §7)
        <p role="status" aria-live="polite" className="t-body-lg thinking-pulse flex min-h-12 items-center gap-3 px-2 font-medium">
          <Sparkles size={22} strokeWidth={ICON.strokeWidth} className="text-orange-700" aria-hidden />
          {stage ? (previews.length && stage === 'writing' ? t('plan.ready', { n: previews.length }) : t(`progress.${stage}` as MessageKey)) : ''}
        </p>
      ) : (
        <>
          {!docked && thumbs}
          {answersBox}
          {mode === 'digitize' && hasPdf && (
            <label className="t-small mb-2 flex items-center gap-2 px-2 font-medium text-ink-500">
              {t('compose.pdfPages')}
              <input
                value={pdfPages}
                onChange={(e) => setPdfPages(e.target.value)}
                placeholder={t('compose.pdfPagesPlaceholder')}
                inputMode="numeric"
                maxLength={40}
                className="t-body min-h-9 w-40 rounded-md border border-paper-300 bg-paper-100 px-2 text-ink-700 focus:border-ink-700 focus:outline-none"
              />
            </label>
          )}
          <Textarea
            bare
            minRows={3}
            maxRows={10}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              // Desktop: Enter sends, Shift+Enter newline. Phones: Enter is a newline; the button sends.
              if (e.key === 'Enter' && !e.shiftKey && !coarse.current) {
                e.preventDefault()
                void generate()
              }
            }}
            placeholder={t(plan ? 'plan.answerPlaceholder' : mode === 'digitize' ? 'compose.digitizePlaceholder' : 'compose.placeholder')}
            aria-label={t(plan ? 'plan.answerPlaceholder' : mode === 'digitize' ? 'compose.digitizePlaceholder' : 'compose.placeholder')}
            className="t-body-lg px-2 py-2"
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            {docked ? (
              <span />
            ) : (
              <IconButton label={sheetOpen ? t('compose.close') : t('compose.attach')} tone="filled" aria-expanded={sheetOpen} onClick={() => setSheetOpen((o) => !o)}>
                <Plus size={24} strokeWidth={ICON.strokeWidth} aria-hidden className="transition-transform" style={{ transform: sheetOpen ? 'rotate(45deg)' : undefined }} />
              </IconButton>
            )}
            <div className="flex items-center gap-2">
              {!docked && pageCount > 0 && <span className={`t-small t-num ${pageCount >= MAX_PAGES ? 'text-warn-600' : 'text-ink-400'}`}>{t('compose.pagesCount', { n: pageCount, max: MAX_PAGES })}</span>}
              {speechOk && (
                <IconButton label={listening ? t('compose.voiceStop') : t('compose.voice')} onClick={toggleMic} className={listening ? 'bg-orange-100 text-orange-700' : ''}>
                  <Mic size={22} strokeWidth={ICON.strokeWidth} aria-hidden />
                </IconButton>
              )}
              <button type="button" onClick={generate} disabled={!canSend} aria-label={t('compose.send')} title={t('compose.generate')} className="btn btn-primary btn-pill min-h-12 w-14 px-0">
                <span className="btn-label">
                  <ArrowUp size={24} strokeWidth={2.25} aria-hidden />
                </span>
              </button>
            </div>
          </div>
          {sheetOpen && !docked && <div className="slide-down mt-3 grid grid-cols-4 gap-2">{pickers('pages')}</div>}
        </>
      )}
    </div>
  )

  const modeTabs = !docked && (
    <div className="mb-3 flex flex-col items-center gap-2">
      <SegmentedControl
        label={t('compose.mode.create')}
        value={mode}
        onChange={(m) => {
          setMode(m)
          setError(null)
          // Answer pages belong to copying only
          if (m === 'create') setMaterials((ms) => ms.filter((x) => x.role !== 'answers'))
          if (m === 'digitize' && materials.length === 0) setSheetOpen(true)
        }}
        options={[
          { value: 'create', label: `✨ ${t('compose.mode.create')}` },
          { value: 'digitize', label: `📖 ${t('compose.mode.digitize')}` },
        ]}
      />
      {mode === 'digitize' && <p className="t-small max-w-md text-center text-ink-500">{t('compose.digitizeHint', { max: MAX_PAGES })}</p>}
    </div>
  )

  const chips = !docked && mode === 'create' && (
    <div className="mb-3 flex flex-wrap justify-center gap-2">
      <label className="relative">
        <Chip as="span">
          {minutes} {t('param.minutes')} ▾
        </Chip>
        <select aria-label={t('param.duration')} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className="absolute inset-0 cursor-pointer opacity-0">
          {MINUTES.map((m) => (
            <option key={m} value={m}>
              {m} {t('param.minutes')}
            </option>
          ))}
        </select>
      </label>
      <label className="relative">
        <Chip as="span">{t(DIFFICULTY.find((d) => d.v === difficulty)?.key ?? 'param.medium')} ▾</Chip>
        <select aria-label={t('param.difficulty')} value={difficulty} onChange={(e) => setDifficulty(Number(e.target.value))} className="absolute inset-0 cursor-pointer opacity-0">
          {DIFFICULTY.map((d) => (
            <option key={d.v} value={d.v}>
              {t(d.key)}
            </option>
          ))}
        </select>
      </label>
      <label className="relative">
        <Chip as="span" selected={pickedLanguage !== null && !!language}>
          <Languages size={16} strokeWidth={ICON.strokeWidth} aria-hidden /> {language ? t(`lang.${language}` as MessageKey) : t('compose.language')} ▾
        </Chip>
        <select
          aria-label={t('compose.language')}
          value={language ?? ''}
          onChange={(e) => setPickedLanguage((e.target.value || '') as LanguageCode | '')}
          className="absolute inset-0 cursor-pointer opacity-0"
        >
          <option value="">{t('compose.languageUnknown')}</option>
          {LANGUAGE_CODES.map((c) => (
            <option key={c} value={c}>
              {t(`lang.${c}` as MessageKey)}
            </option>
          ))}
        </select>
      </label>
      {exams.length > 0 && (
        <label className="relative">
          <Chip as="span" selected={!!exam}>
            <GraduationCap size={16} strokeWidth={ICON.strokeWidth} aria-hidden /> {exam ? exam.name : t('compose.styleStandard')} ▾
          </Chip>
          <select aria-label={t('compose.style')} value={exam?.id ?? ''} onChange={(e) => pickExam(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0">
            <option value="">{t('compose.styleStandard')}</option>
            {exams.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {exam && (
        <label className="relative">
          <Chip as="span" selected>
            {examLevel || exam.defaultLevel} ▾
          </Chip>
          <select aria-label={t('compose.examLevel')} value={examLevel || exam.defaultLevel} onChange={(e) => pickExam(exam.id, e.target.value)} className="absolute inset-0 cursor-pointer opacity-0">
            {exam.levels.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
      )}
      {courses.length > 0 && (
        <label className="relative">
          <Chip as="span" selected={!!courseId}>
            <FolderOpen size={16} strokeWidth={ICON.strokeWidth} aria-hidden /> {courses.find((c) => c.id === courseId)?.title ?? t('compose.courseNone')} ▾
          </Chip>
          <select aria-label={t('compose.course')} value={courseId} onChange={(e) => pickCourse(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0">
            <option value="">{t('compose.courseNone')}</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </label>
      )}
      <Chip selected={showSkills || skills.length > 0} onClick={() => setShowSkills((s) => !s)} aria-expanded={showSkills}>
        <Plus size={16} strokeWidth={ICON.strokeWidth} aria-hidden /> {t('compose.more')}
        {skills.length > 0 && ` · ${skills.length}`}
      </Chip>
      {showSkills &&
        SKILLS.map((s) => (
          <Chip key={s} selected={skills.includes(s)} onClick={() => setSkills((xs) => (xs.includes(s) ? xs.filter((x) => x !== s) : [...xs, s]))}>
            {t(`skill.${s}` as MessageKey)}
          </Chip>
        ))}
    </div>
  )

  return (
    <div className="relative flex min-h-[calc(100dvh-4rem)] flex-col overflow-hidden">
      {/* The cap mark behind everything, one step above the paper (spec §7) */}
      <svg aria-hidden viewBox="0 0 120 120" className="pointer-events-none absolute left-1/2 top-1/2 -z-0 size-80 -translate-x-1/2 -translate-y-[58%] text-paper-200">
        <path d="M30 58v16c0 8 14 14 30 14s30-6 30-14V58" fill="currentColor" />
        <path d="m60 28 48 22-48 22-48-22z" fill="currentColor" />
      </svg>

      {docked ? (
        <div className="fade-in relative mx-auto flex w-full max-w-[720px] flex-1 flex-col justify-end gap-3 px-4 pb-4">
          {/* The thread: what the teacher asked */}
          <div className="ml-auto max-w-[85%] rounded-lg rounded-br-sm bg-ink-700 px-4 py-3 text-paper-50">
            {sentText && <p className="t-body whitespace-pre-line">{sentText}</p>}
            {materials.length > 0 && <p className="t-small mt-1 opacity-80">📎 {materials.map((m) => m.name).join(', ')}</p>}
          </div>
          {answers.map((a, i) => (
            <p key={i} className="t-body ml-auto max-w-[85%] whitespace-pre-line rounded-lg rounded-br-sm bg-ink-700 px-4 py-3 text-paper-50">
              {a}
            </p>
          ))}
          {plan && <PlanCard plan={plan} onChange={setPlan} onCreate={create} onBack={back} busy={!!stage} />}
          {previews.length > 0 && (
            <ul aria-label={t('plan.ready', { n: previews.length })} className="mr-auto flex w-full max-w-[92%] flex-col gap-1.5">
              {previews.map((p, i) => (
                <li key={i} className="fade-in t-small flex items-center gap-2 rounded-md border border-paper-300 bg-paper-50 px-3 py-2">
                  <KindIcon kind={p.kind} size={16} className="shrink-0 text-ink-500" />
                  <span className="min-w-0 flex-1 truncate">{p.prompt || t(`draft.kind.${p.kind}` as MessageKey)}</span>
                  {p.vocab && <Badge tone="orange">{t('skill.vocabulary')}</Badge>}
                  {p.picture && <ImageIcon size={14} strokeWidth={ICON.strokeWidth} className="shrink-0 text-ink-400" aria-hidden />}
                </li>
              ))}
            </ul>
          )}
          {error && (
            <p role="alert" className="t-body rounded-md border border-error-600 bg-error-100 px-4 py-3 text-error-600">
              {error}
            </p>
          )}
          <div ref={threadEnd} />
        </div>
      ) : (
        <div className="relative flex flex-1 flex-col md:items-center md:justify-center md:pb-[8vh]">
          <div className="fade-in px-4 pt-10 text-center md:pt-0">
            <h1 className="t-display-1">{firstName ? t('home.greeting', { name: firstName }) : t('auth.welcome')}</h1>
            <p className="t-body-lg mt-2 text-ink-500">{t('home.subtitle')}</p>
          </div>
          {showSubjectNotice && (
            <div className="mx-auto mt-5 flex w-full max-w-[720px] items-start gap-2 rounded-md border border-paper-300 bg-paper-50 px-4 py-3">
              <p className="t-small flex-1 text-ink-500">{t('compose.subjectNotice')}</p>
              <IconButton onClick={dismissSubjectNotice} label={t('compose.subjectNotice.dismiss')} size={36}>
                <X size={16} strokeWidth={ICON.strokeWidth} aria-hidden />
              </IconButton>
            </div>
          )}
          {error && (
            <p role="alert" className="mx-auto mt-5 w-full max-w-[720px] px-4">
              <span className="t-body block rounded-md border border-error-600 bg-error-100 px-4 py-3 text-error-600">{error}</span>
            </p>
          )}
          <div className={`mx-auto mt-6 w-full max-w-[720px] grid-cols-1 gap-2 px-4 sm:grid-cols-3 md:order-3 md:mt-5 ${mode === 'create' ? 'grid' : 'hidden'}`}>
            {SUGGESTIONS.map(({ key, icon: Icon }, i) => (
              <button
                key={key}
                type="button"
                style={{ ['--i' as string]: i }}
                onClick={() => {
                  setText(t(`suggest.${key}.text` as MessageKey))
                  if (key === 'photo') setSheetOpen(true)
                }}
                className="card-enter press flex items-center gap-3 rounded-2xl border-2 border-paper-300 bg-paper-50 px-4 py-3 text-left hover:bg-paper-200"
              >
                <Icon size={20} strokeWidth={ICON.strokeWidth} className="shrink-0 text-orange-700" aria-hidden />
                <span className="t-body font-medium">{t(`suggest.${key}.label` as MessageKey)}</span>
              </button>
            ))}
          </div>
          <div data-bottom-dock className="sticky bottom-[var(--kb,0px)] z-10 mx-auto mt-auto w-full max-w-[720px] bg-linear-to-t from-paper-100 via-paper-100 to-transparent px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-6 md:static md:order-2 md:mt-6 md:bg-none md:p-0 md:px-4">
            {modeTabs}
            {chips}
            {card}
          </div>
        </div>
      )}

      {docked && <div data-bottom-dock className="sticky bottom-[var(--kb,0px)] z-10 mx-auto w-full max-w-[720px] px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{card}</div>}

      {/* Camera first: photographing the textbook page is the dominant input */}
      <input ref={inputs.camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => onFiles(e.target.files)} />
      <input ref={inputs.gallery} type="file" accept="image/*" multiple hidden onChange={(e) => onFiles(e.target.files)} />
      <input ref={inputs.audio} type="file" accept="audio/*,.mp3,.m4a,.wav,.ogg" multiple hidden onChange={(e) => onFiles(e.target.files)} />
      <input
        ref={inputs.file}
        type="file"
        accept="application/pdf,.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        multiple
        hidden
        onChange={(e) => onFiles(e.target.files)}
      />
    </div>
  )
}
