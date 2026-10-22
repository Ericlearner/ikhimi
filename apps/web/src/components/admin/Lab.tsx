'use client'
/**
 * The owner's Lab (DECISIONS.md BG, BH): pick a methodology, show it real samples, feed it resources or talk to it
 * in the chat, apply what is worth keeping, and watch its brain fill up. Always in English, so its words are
 * written here rather than in the message catalogs.
 */
import { FileText, Paperclip, Send, Undo2, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, type RefObject } from 'react'
import { LAB_AREAS, LAB_LIMITS, LAB_SLOT_NAME, LAB_SLOTS, LANGUAGE_CODES, LANGUAGE_NAME, type LabArea, type LabOp, type LabPoint, type LabSample, type LabTask, type LanguageCode } from '@ikhimi/ai'
import { Badge, Button } from '@ikhimi/ui/components'
import { postJson } from '@/lib/client'
import { uploadFile, uploadLabBook } from '@/lib/upload'
import { LabBrain } from './LabBrain'

const CARD = 'rounded-2xl border-2 border-paper-300 bg-paper-50'
const field = 't-body min-h-11 w-full rounded-xl border-2 border-paper-300 bg-paper-50 px-3'

const AREA_NAME: Record<LabArea, string> = {
  general: 'General',
  reading: 'Reading',
  listening: 'Listening',
  writing: 'Writing',
  speaking: 'Speaking',
  vocabulary: 'Vocabulary',
  grammar: 'Grammar',
  pronunciation: 'Pronunciation',
}

const ERRORS: Record<string, string> = {
  too_many_pages: 'Too many pages in photos and Word files: send up to 100 at a time (a PDF can be a whole book).',
  pdf_pages: 'That PDF has more than 100 pages: send it in parts (for a test, one section per message).',
  pdf_unreadable: 'This PDF couldn’t be opened (it may be damaged or password-protected). Try saving it again, or send photos of the pages.',
  book_unreadable: 'The AI couldn’t read that PDF (Google reads up to 1,000 pages per file, and refuses damaged or locked files). Try sending it in two halves.',
  too_big: 'That file is too big for the AI to read in one go (about 13 MB at most): send the test in parts, or a smaller copy of the PDF.',
  timeout: 'Reading took longer than the server allows (5 minutes). Your message is still here: send a smaller part, such as one section of the test.',
  doc_old: 'Old .doc files can’t be read: save it as .docx or PDF.',
  doc_unreadable: 'This Word file couldn’t be read.',
  ai_not_configured: 'The AI isn’t set up on this server.',
  ai_busy: 'The strongest model is busy right now. Your message is still here: send it again in a minute.',
  ai_rejected: 'The model refused the request: check GEMINI_MODEL_LAB in Vercel (the exact model id from AI Studio).',
  gone: 'This proposal was already decided.',
  nothing_picked: 'Tick at least one change.',
  nothing_to_undo: 'Nothing to undo.',
  not_found: 'That is already gone.',
}
/** The server's error code, or what the status says when the page got no code (a timeout returns no JSON) */
const errorText = (code: unknown, status?: number) => ERRORS[String(code)] ?? (status === 504 ? ERRORS.timeout! : `Something went wrong${status ? ` (${status})` : ''}. Try again.`)

// ─── picker ─────────────────────────────────────────────────────────────────

/** `brain`: how much it understands once it has read enough real samples, else null */
export type PickerItem = { id: string; name: string; language: string; own: boolean; visible: boolean; points: number; brain: number | null }

/** Which methodology the Lab works on: the catalog's exams and the owner's own, by language */
export function LabPicker({ items, current }: { items: PickerItem[]; current: string | null }) {
  const router = useRouter()
  const languages = [...new Set(items.map((i) => i.language))]
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="flex min-w-0 flex-1 flex-col gap-1 sm:max-w-sm">
        <span className="t-small text-ink-500">Methodology</span>
        <select value={current ?? ''} onChange={(e) => router.push(`/admin/lab?m=${encodeURIComponent(e.target.value)}`)} className={field}>
          {!current && <option value="">New methodology…</option>}
          {languages.map((l) => (
            <optgroup key={l} label={LANGUAGE_NAME[l as LanguageCode] ?? l}>
              {items
                .filter((i) => i.language === l)
                .map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.own ? '★ ' : ''}
                    {i.name}
                    {i.own && !i.visible ? ' (hidden)' : ''}
                    {i.brain !== null ? ` · ${i.brain}%` : i.points ? ` · ${i.points}` : ''}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </label>
      <Button variant="secondary" onClick={() => router.push('/admin/lab?new=1')}>
        + New methodology
      </Button>
    </div>
  )
}

// ─── the owner's own methodology ────────────────────────────────────────────

export type OwnInitial = { id: string; name: string; language: string; levels: string[]; about: string; visible: boolean }

/** Create one, or edit and delete it. Teachers see the name in the Style list once it is switched on. */
export function LabMethodologyForm({ initial }: { initial?: OwnInitial }) {
  const router = useRouter()
  const [name, setName] = useState(initial?.name ?? '')
  const [language, setLanguage] = useState(initial?.language ?? 'en')
  const [levels, setLevels] = useState((initial?.levels ?? ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']).join(', '))
  const [about, setAbout] = useState(initial?.about ?? '')
  const [visible, setVisible] = useState(initial?.visible ?? false)
  const [busy, setBusy] = useState<string | null>(null)
  const [sure, setSure] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    setBusy('save')
    setError(null)
    const fields = { name: name.trim(), language, levels: levels.split(',').map((l) => l.trim()).filter(Boolean), about: about.trim(), visible }
    const { ok, json } = await postJson('/api/admin/lab', initial ? { action: 'update', methodologyId: initial.id, ...fields } : { action: 'create', ...fields })
    setBusy(null)
    if (!ok) return setError(errorText(json.error))
    if (initial) router.refresh()
    else router.push(`/admin/lab?m=${json.id as string}`)
  }
  const remove = async () => {
    if (!initial) return
    if (!sure) return setSure(true)
    setBusy('delete')
    const { ok, json } = await postJson('/api/admin/lab', { action: 'delete', methodologyId: initial.id })
    setBusy(null)
    if (!ok) return setError(errorText(json.error))
    router.push('/admin/lab')
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr]">
        <label className="flex flex-col gap-1">
          <span className="t-small text-ink-500">Name (teachers see it in the Style list)</span>
          <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} className={field} placeholder="e.g. Young learners: story first" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="t-small text-ink-500">Language taught</span>
          <select value={language} onChange={(e) => setLanguage(e.target.value)} className={field}>
            {LANGUAGE_CODES.map((l) => (
              <option key={l} value={l}>
                {LANGUAGE_NAME[l]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="flex flex-col gap-1">
        <span className="t-small text-ink-500">Levels teachers pick from (comma-separated; the first is the default)</span>
        <input value={levels} maxLength={200} onChange={(e) => setLevels(e.target.value)} className={field} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="t-small text-ink-500">What it is and how its exercises are built (the writers read this; the Lab adds to it from resources)</span>
        <textarea value={about} maxLength={3000} rows={4} onChange={(e) => setAbout(e.target.value)} className={`${field} py-2`} />
      </label>
      <label className="t-body flex items-center gap-2">
        <input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} className="size-5 accent-orange-500" />
        Teachers can choose it in the Style list
      </label>
      <div className="flex flex-wrap gap-2">
        <Button loading={busy === 'save'} disabled={!name.trim()} onClick={save}>
          {initial ? 'Save' : 'Create'}
        </Button>
        {initial && (
          <Button variant={sure ? 'danger' : 'ghost'} loading={busy === 'delete'} onClick={remove} onBlur={() => setSure(false)}>
            {sure ? 'Delete it, with its chat and knowledge?' : 'Delete'}
          </Button>
        )}
      </div>
      {error && <p className="t-small text-error-600">{error}</p>}
    </div>
  )
}

// ─── the chat ───────────────────────────────────────────────────────────────

export type ChatMessage = {
  id: string
  role: 'owner' | 'ai'
  text: string
  files: string[]
  sample: boolean
  proposal: { ops: LabOp[]; status: 'open' | 'applied' | 'dismissed'; applied?: number[]; sample?: { name: string; seen: string[] } } | null
}

/** What the Lab page shows for one methodology: the brain, the chat and the knowledge */
export function LabWorkspace({
  methodologyId,
  name,
  exam,
  messages,
  points,
  tasks,
  samples,
  history,
}: {
  methodologyId: string
  name: string
  exam: boolean
  messages: ChatMessage[]
  points: LabPoint[]
  tasks: LabTask[]
  samples: LabSample[]
  history: { id: string; note: string; at: string }[]
}) {
  // "Add a real exam" on the brain switches the chat to a sample and opens the file picker, within the click itself
  // (Safari opens a file picker only from the tap that asked for it)
  const addSample = useRef<(() => void) | null>(null)
  return (
    <>
      <LabBrain methodologyId={methodologyId} name={name} exam={exam} tasks={tasks} points={points} samples={samples} onAddSample={() => addSample.current?.()} />
      <div className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <LabChat methodologyId={methodologyId} name={name} exam={exam} messages={messages} points={points} tasks={tasks} addSample={addSample} />
        <LabKnowledge methodologyId={methodologyId} name={name} points={points} tasks={tasks} history={history} />
      </div>
    </>
  )
}

/**
 * The Lab chat for one methodology: show a real sample, give a resource (photos, PDFs, Word, or pasted text) or ask
 * something; the AI answers and proposes changes to the knowledge, which the owner ticks and applies.
 */
export function LabChat({
  methodologyId,
  name,
  exam,
  messages,
  points,
  tasks,
  addSample,
}: {
  methodologyId: string
  name: string
  exam: boolean
  messages: ChatMessage[]
  points: LabPoint[]
  tasks: LabTask[]
  addSample: RefObject<(() => void) | null>
}) {
  const router = useRouter()
  const [text, setText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [sample, setSample] = useState(false)
  const [stage, setStage] = useState<{ step: 'uploading' | 'reading'; sent: string; names: string[]; sample: boolean; progress?: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const box = useRef<HTMLElement>(null)
  const end = useRef<HTMLDivElement>(null)
  const real = exam ? 'real exam' : 'real sample'
  const modes = [
    { sample: true, label: `A ${real}`, hint: `One whole ${real} per message, all its files together: I’ll list every task type in it.` },
    { sample: false, label: 'A resource or a message', hint: 'A book, a guide, notes, or a question: I’ll keep only what’s new and useful.' },
  ]
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [messages.length, stage])
  useEffect(() => {
    addSample.current = () => {
      if (stage) return
      setSample(true)
      fileInput.current?.click()
      box.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  })

  const send = async () => {
    if (stage || (!text.trim() && !files.length)) return
    setError(null)
    const sent = text.trim()
    setStage({ step: 'uploading', sent, names: files.map((f) => f.name), sample })
    const ids: string[] = []
    const uploads: string[] = []
    for (const [i, f] of files.entries()) {
      const progress = (p: number) => setStage((s) => (s ? { ...s, progress: Math.round(((i + p) / files.length) * 100) } : s))
      // A PDF can be a whole book (up to 100 MB): it goes to Google's file store, not our database
      const pdf = f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
      const r = pdf ? await uploadLabBook(f, progress) : await uploadFile(f, progress)
      if (!r.ok) {
        setStage(null)
        return setError(
          r.error === 'file_too_large'
            ? `«${f.name}» is too big: up to ${r.maxMb ?? (pdf ? 100 : 15)} MB per file.${pdf ? ' Send the book in two halves.' : ''}`
            : r.error === 'file_type'
              ? `«${f.name}» isn’t a type the Lab can read: send photos, a PDF or a Word file.`
              : `«${f.name}» didn’t upload. Check the connection and try again.`,
        )
      }
      if ('id' in r) uploads.push(r.id)
      else ids.push(r.materialId)
    }
    setStage((s) => (s ? { ...s, step: 'reading' } : s))
    const { ok, status, json } = await postJson('/api/admin/lab/send', { methodologyId, text: sent, materialIds: ids, uploads, sample })
    setStage(null)
    if (!ok) return setError(errorText(json.error, status))
    setText('')
    setFiles([])
    setSample(false)
    router.refresh()
  }

  return (
    <section ref={box} className={`flex min-w-0 flex-col ${CARD}`} aria-label="Lab chat">
      <div className="flex min-w-0 flex-col gap-3 p-4">
        {messages.length === 0 && !stage && (
          <p className="t-body text-ink-500">
            Start with {LAB_LIMITS.samples} {real}s of <b className="text-ink-700">{name}</b>, one per message: I’ll learn every task type it asks. Then give me books and guides (photos of pages, a PDF, a Word file or pasted text): I’ll keep only what’s new and useful, and you decide what goes in. You can also ask what I know, or tell me what to change.
          </p>
        )}
        {messages.map((m) => (m.role === 'owner' ? <OwnerBubble key={m.id} text={m.text} files={m.files} sample={m.sample ? real : null} /> : <AiBubble key={m.id} m={m} points={points} tasks={tasks} real={real} />))}
        {stage && (
          <>
            <OwnerBubble text={stage.sent} files={stage.names} sample={stage.sample ? real : null} />
            <p className="t-small animate-pulse text-ink-500">{stage.step === 'uploading' ? `Uploading… ${stage.progress ?? 0}%` : stage.sample ? `Reading the ${real}… a whole test can take a few minutes.` : 'Reading… a long resource or a whole book can take a few minutes.'}</p>
          </>
        )}
        <div ref={end} />
      </div>
      <div className="flex flex-col gap-2 border-t-2 border-paper-300 p-3">
        <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="What you are sending">
          {modes.map((o) => (
            <button
              key={o.label}
              type="button"
              role="radio"
              aria-checked={sample === o.sample}
              disabled={!!stage}
              onClick={() => setSample(o.sample)}
              className={`t-small rounded-pill border-2 px-3 py-1.5 font-semibold ${sample === o.sample ? 'border-success-600 bg-success-100 text-ink-800' : 'border-paper-300 text-ink-500 hover:bg-paper-100'}`}
            >
              {o.label}
            </button>
          ))}
          <span className="t-small min-w-0 basis-full text-ink-500">{modes.find((o) => o.sample === sample)!.hint}</span>
        </div>
        {files.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="t-small inline-flex max-w-full items-center gap-1 rounded-pill bg-paper-200 py-1 pl-3 pr-1 text-ink-700">
                <FileText size={14} aria-hidden className="shrink-0" />
                <span className="truncate">{f.name}</span>
                <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles((x) => x.filter((_, j) => j !== i))} className="grid size-7 shrink-0 place-items-center rounded-full hover:bg-paper-300">
                  <X size={14} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        <textarea
          value={text}
          maxLength={LAB_LIMITS.sourceChars}
          rows={3}
          disabled={!!stage}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send()
          }}
          placeholder={sample ? `Attach the ${real}’s files (or paste it), and add a note if you like…` : `Paste a resource, or write to the Lab about ${name}…`}
          className={`${field} py-2`}
        />
        <div className="flex items-center justify-between gap-2">
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            accept="image/jpeg,image/png,image/webp,image/heic,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={(e) => {
              setFiles((x) => [...x, ...(e.target.files ?? [])].slice(0, 12))
              e.target.value = ''
            }}
          />
          <Button variant="ghost" icon={<Paperclip size={18} aria-hidden />} disabled={!!stage} onClick={() => fileInput.current?.click()}>
            Attach
          </Button>
          <Button icon={<Send size={18} aria-hidden />} loading={!!stage} disabled={!text.trim() && !files.length} onClick={send}>
            {sample ? `Send the ${real}` : 'Send'}
          </Button>
        </div>
        {error && <p className="t-small text-error-600">{error}</p>}
      </div>
    </section>
  )
}

function OwnerBubble({ text, files, sample }: { text: string; files: string[]; sample: string | null }) {
  return (
    <div className="ml-auto flex max-w-[90%] flex-col gap-1.5 rounded-2xl bg-orange-100 px-4 py-3">
      {sample && (
        <span className="self-start">
          <Badge tone="success">{sample[0]!.toUpperCase() + sample.slice(1)}</Badge>
        </span>
      )}
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {files.map((f, i) => (
            <li key={i} className="t-small inline-flex max-w-full items-center gap-1 text-ink-700">
              <FileText size={14} aria-hidden className="shrink-0" />
              <span className="truncate">{f}</span>
            </li>
          ))}
        </ul>
      )}
      {text && <p className="t-body line-clamp-[12] whitespace-pre-wrap break-words text-ink-800">{text}</p>}
    </div>
  )
}

const OP_LABEL: Record<LabOp['op'], string> = { add: 'Add', update: 'Change', remove: 'Remove', task_add: 'New task', task_update: 'Change task', task_remove: 'Remove task' }
const OP_TONE: Record<LabOp['op'], 'success' | 'warn' | 'error'> = { add: 'success', update: 'warn', remove: 'error', task_add: 'success', task_update: 'warn', task_remove: 'error' }

/** The AI's answer, and the changes it proposes: tick what goes in, apply, or dismiss. A real sample is counted on apply. */
function AiBubble({ m, points, tasks, real }: { m: ChatMessage; points: LabPoint[]; tasks: LabTask[]; real: string }) {
  const router = useRouter()
  const p = m.proposal
  const [picked, setPicked] = useState<Set<number>>(() => new Set(p?.ops.map((_, i) => i) ?? []))
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const byId = new Map(points.map((x) => [x.id, x]))
  const taskById = new Map(tasks.map((t) => [t.id, t]))
  // A point may belong to a task proposed in the same answer
  const newTask = new Map((p?.ops ?? []).flatMap((o) => (o.op === 'task_add' ? [[o.key, o.name] as const] : [])))
  const taskName = (id: string) => taskById.get(id)?.name ?? newTask.get(id) ?? id

  const decide = async (action: 'apply' | 'dismiss') => {
    setBusy(action)
    setError(null)
    const { ok, json } = await postJson('/api/admin/lab', action === 'apply' ? { action, messageId: m.id, pick: [...picked] } : { action, messageId: m.id })
    setBusy(null)
    if (!ok) return setError(errorText(json.error))
    router.refresh()
  }
  const sample = p?.sample
  const applyLabel = sample
    ? picked.size
      ? `Count this ${real} and apply ${picked.size === p.ops.length ? `all ${p.ops.length}` : `${picked.size} of ${p.ops.length}`}`
      : `Count this ${real}`
    : `Apply ${picked.size === p?.ops.length ? (p.ops.length > 1 ? `all ${p.ops.length}` : '') : `${picked.size} of ${p?.ops.length}`}`

  return (
    <div className="mr-auto flex w-full max-w-[95%] min-w-0 flex-col gap-3 rounded-2xl border-2 border-paper-300 bg-paper-100 px-4 py-3">
      <p className="t-body whitespace-pre-wrap break-words text-ink-800">{m.text}</p>
      {sample && (
        <p className="t-small text-ink-500">
          This {real} had {sample.seen.length} known task type{sample.seen.length === 1 ? '' : 's'}
          {newTask.size ? ` and ${newTask.size} new` : ''}
          {sample.seen.length ? `: ${sample.seen.map(taskName).join(', ')}` : ''}.
        </p>
      )}
      {p && (
        <div className="flex flex-col gap-2">
          <ul className="flex flex-col gap-2">
            {p.ops.map((o, i) => {
              const done = p.status === 'applied' && p.applied?.includes(i)
              const off = p.status === 'dismissed' || (p.status === 'applied' && !done)
              return (
                <li key={i} className={`flex min-w-0 gap-2 rounded-xl border-2 p-3 ${off ? 'border-paper-300 opacity-60' : done ? 'border-paper-300 bg-paper-50' : 'border-orange-500 bg-paper-50'}`}>
                  {p.status === 'open' ? (
                    <input
                      type="checkbox"
                      aria-label={`${OP_LABEL[o.op]}: apply this`}
                      checked={picked.has(i)}
                      onChange={(e) =>
                        setPicked((s) => {
                          const n = new Set(s)
                          if (e.target.checked) n.add(i)
                          else n.delete(i)
                          return n
                        })
                      }
                      className="mt-1 size-5 shrink-0 accent-orange-500"
                    />
                  ) : (
                    <span className="t-body mt-0.5 w-5 shrink-0 text-center" aria-hidden>
                      {done ? '✓' : '–'}
                    </span>
                  )}
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={OP_TONE[o.op]}>{OP_LABEL[o.op]}</Badge>
                      {'area' in o && <Badge>{AREA_NAME[o.area]}</Badge>}
                      {(o.op === 'add' || o.op === 'update') && o.task && (
                        <Badge>
                          {taskName(o.task)} · {LAB_SLOT_NAME[o.slot ?? 'build']}
                        </Badge>
                      )}
                      {(o.op === 'update' || o.op === 'remove' || o.op === 'task_update' || o.op === 'task_remove') && <span className="t-small t-num text-ink-400">{o.id}</span>}
                    </div>
                    <OpBody op={o} off={off} open={p.status === 'open'} point={'id' in o ? byId.get(o.id) : undefined} task={'id' in o ? taskById.get(o.id) : undefined} />
                    {o.why && <p className="t-small break-words italic text-ink-500">{o.why}</p>}
                  </div>
                </li>
              )
            })}
          </ul>
          {p.status === 'open' ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" loading={busy === 'apply'} disabled={(!picked.size && !sample) || !!busy} onClick={() => decide('apply')}>
                {applyLabel}
              </Button>
              <Button size="sm" variant="ghost" loading={busy === 'dismiss'} disabled={!!busy} onClick={() => decide('dismiss')}>
                {sample ? 'Don’t count it' : 'Dismiss'}
              </Button>
            </div>
          ) : (
            <p className="t-small text-ink-500">
              {p.status === 'dismissed' ? (sample ? 'Not counted' : 'Dismissed') : `${sample ? `Counted as a ${real}. ` : ''}Applied ${p.applied?.length ?? 0} of ${p.ops.length}`}
            </p>
          )}
          {error && <p className="t-small text-error-600">{error}</p>}
        </div>
      )}
    </div>
  )
}

/** What one proposed change says */
function OpBody({ op: o, off, open, point, task }: { op: LabOp; off: boolean; open: boolean; point?: LabPoint; task?: LabTask }) {
  switch (o.op) {
    case 'remove':
      return <p className={`t-body break-words text-ink-700 ${off ? '' : 'line-through decoration-error-600'}`}>{point?.text ?? 'This point is already gone.'}</p>
    case 'add':
    case 'update':
      return (
        <>
          <p className="t-body break-words text-ink-800">{o.text}</p>
          {o.op === 'update' && point && open && <p className="t-small break-words text-ink-400">Was: {point.text}</p>}
        </>
      )
    case 'task_remove':
      return <p className={`t-body break-words font-semibold text-ink-700 ${off ? '' : 'line-through decoration-error-600'}`}>{task?.name ?? 'This task is already gone.'}</p>
    case 'task_add':
    case 'task_update':
      return (
        <>
          <p className="t-body break-words font-semibold text-ink-800">{o.name}</p>
          {o.format && <p className="t-small break-words text-ink-700">{o.format}</p>}
          {o.op === 'task_update' && task && open && task.format !== o.format && <p className="t-small break-words text-ink-400">Was: {task.format}</p>}
          <p className="t-small text-ink-500">
            {o.kinds.length ? `Built with: ${o.kinds.join(', ')}` : ''}
            {!o.buildable && <span className="font-semibold text-warn-600">{o.kinds.length ? ' · ' : ''}Can’t build{o.note ? `: ${o.note}` : ''}</span>}
          </p>
        </>
      )
  }
}

// ─── the knowledge ──────────────────────────────────────────────────────────

/** What the writers follow for this methodology, by task and by area; remove a point, or undo the newest change */
export function LabKnowledge({
  methodologyId,
  name,
  points,
  tasks,
  history,
}: {
  methodologyId: string
  name: string
  points: LabPoint[]
  tasks: LabTask[]
  history: { id: string; note: string; at: string }[]
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [asking, setAsking] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const act = async (key: string, body: Record<string, unknown>) => {
    setBusy(key)
    setError(null)
    const { ok, json } = await postJson('/api/admin/lab', { methodologyId, ...body })
    setBusy(null)
    setAsking(null)
    if (!ok) return setError(errorText(json.error))
    router.refresh()
  }
  const known = new Set(tasks.map((t) => t.id))
  const general = points.filter((p) => !p.task || !known.has(p.task))
  const groups = [
    ...tasks.filter((t) => points.some((p) => p.task === t.id)).map((t) => ({ key: t.id, title: t.name, sub: AREA_NAME[t.area], list: points.filter((p) => p.task === t.id) })),
    ...LAB_AREAS.filter((a) => general.some((p) => p.area === a)).map((a) => ({ key: a, title: AREA_NAME[a], sub: 'general', list: general.filter((p) => p.area === a) })),
  ]
  const row = (p: LabPoint) => (
    <li key={p.id} className="flex min-w-0 items-start gap-2 rounded-xl bg-paper-100 px-3 py-2">
      <span className="t-small t-num mt-0.5 shrink-0 text-ink-400">{p.id}</span>
      <div className="min-w-0 flex-1">
        {p.task && known.has(p.task) && <p className="t-small font-semibold text-ink-500">{LAB_SLOT_NAME[p.slot ?? 'build']}</p>}
        <p className="t-small break-words text-ink-800">{p.text}</p>
      </div>
      <button
        type="button"
        onClick={() => (asking === p.id ? act(p.id, { action: 'remove', pointId: p.id }) : setAsking(p.id))}
        onBlur={() => setAsking((x) => (x === p.id ? null : x))}
        disabled={!!busy}
        aria-label={asking === p.id ? `Confirm removing ${p.id}` : `Remove ${p.id}`}
        className={`t-small shrink-0 rounded-lg px-2 py-1 ${asking === p.id ? 'bg-error-100 font-semibold text-error-600' : 'text-ink-400 hover:bg-paper-200'}`}
      >
        {asking === p.id ? 'Remove?' : <X size={14} aria-hidden />}
      </button>
    </li>
  )
  return (
    <section className={`flex min-w-0 flex-col gap-3 p-4 ${CARD}`} aria-label="Knowledge">
      <div className="flex items-center justify-between gap-2">
        <h2 className="t-h3">Knowledge</h2>
        <span className="t-small t-num text-ink-500">
          {points.length} point{points.length === 1 ? '' : 's'}
        </span>
      </div>
      {points.length === 0 ? (
        <p className="t-body text-ink-500">Nothing yet. What you apply from the chat appears here, by task, and the writers aim at it whenever a teacher picks {name}.</p>
      ) : (
        groups.map((g) => (
          <div key={g.key} className="flex flex-col gap-1.5">
            <h3 className="t-small font-semibold uppercase tracking-wide text-ink-500">
              {g.title} <span className="font-normal normal-case tracking-normal text-ink-400">· {g.sub}</span>
            </h3>
            <ul className="flex flex-col gap-1.5">{[...g.list].sort((a, b) => slotOrder(a) - slotOrder(b)).map(row)}</ul>
          </div>
        ))
      )}
      {history.length > 0 && (
        <div className="flex flex-col gap-2 border-t-2 border-paper-300 pt-3">
          <Button size="sm" variant="secondary" icon={<Undo2 size={16} aria-hidden />} loading={busy === 'undo'} disabled={!!busy} onClick={() => act('undo', { action: 'undo' })}>
            Undo last change ({history[0]!.note})
          </Button>
          <details>
            <summary className="t-small cursor-pointer text-ink-500">History ({history.length})</summary>
            <ul className="t-small mt-2 flex flex-col gap-1 text-ink-500">
              {history.map((h) => (
                <li key={h.id} className="flex justify-between gap-2">
                  <span className="t-num">{h.note}</span>
                  <span>{h.at}</span>
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
      {error && <p className="t-small text-error-600">{error}</p>}
    </section>
  )
}

const slotOrder = (p: LabPoint) => (p.slot ? LAB_SLOTS.indexOf(p.slot) : 0)
