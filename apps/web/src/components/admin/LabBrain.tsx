'use client'
/**
 * The Lab's brain (DECISIONS.md BH): how well the methodology knows the tasks its real test asks. Each lobe is a
 * skill (speaking in the frontal lobe, writing in the parietal, reading in the occipital, listening in the temporal,
 * grammar and vocabulary in the cerebellum) and fills with green as its tasks' five slots fill. It shows once enough
 * real samples were read; before that it waits, grey, counting them.
 */
import { FilePlus2, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useId, useState } from 'react'
import { LAB_LIMITS, LAB_SLOT_NAME, LAB_SLOTS, labCoverage, type LabArea, type LabPoint, type LabSample, type LabTask, type TaskCoverage } from '@ikhimi/ai'
import { Badge, Button } from '@ikhimi/ui/components'
import { postJson } from '@/lib/client'

const CARD = 'rounded-2xl border-2 border-paper-300 bg-paper-50'

type LobeKey = 'speaking' | 'writing' | 'reading' | 'listening' | 'language'

/** Where each skill lives, as drawn: its region (clipped by the brain's outline), its height, and its label */
const LOBES: { key: LobeKey; name: string; long?: string; areas: LabArea[]; region: string; top: number; bottom: number; dot: [number, number]; label: [number, number]; cerebellum?: boolean }[] = [
  { key: 'speaking', name: 'Speaking', areas: ['speaking'], region: 'M 0 0 L 176 0 L 176 22 C 170 48 180 70 170 92 C 164 108 166 124 160 137 C 136 141 112 150 92 156 L 0 175 Z', top: 22, bottom: 158, dot: [100, 96], label: [8, 70] },
  { key: 'writing', name: 'Writing', areas: ['writing'], region: 'M 176 0 L 262 0 L 262 30 C 256 60 264 84 256 108 C 222 122 190 131 160 137 C 166 124 164 108 170 92 C 180 70 170 48 176 22 Z', top: 20, bottom: 137, dot: [214, 66], label: [372, 20] },
  { key: 'reading', name: 'Reading', areas: ['reading'], region: 'M 262 0 L 340 0 L 340 250 L 250 250 L 250 172 C 254 150 252 130 256 108 C 264 84 256 60 262 30 Z', top: 34, bottom: 172, dot: [282, 128], label: [402, 128] },
  { key: 'listening', name: 'Listening', areas: ['listening'], region: 'M 0 175 L 92 156 C 112 150 136 141 160 137 C 190 131 222 122 256 108 C 252 130 254 150 250 172 L 250 250 L 0 250 Z', top: 108, bottom: 196, dot: [176, 172], label: [80, 246] },
  { key: 'language', name: 'Language', long: 'Grammar & vocabulary', areas: ['grammar', 'vocabulary', 'pronunciation', 'general'], region: '', top: 162, bottom: 214, dot: [262, 196], label: [402, 214], cerebellum: true },
]

const CEREBRUM = 'M 48 118 C 44 80 74 46 120 32 C 160 18 214 18 252 34 C 288 50 308 82 306 116 C 304 140 292 158 272 166 C 258 171 244 170 232 168 C 222 178 208 190 188 192 C 160 196 128 194 108 186 C 92 180 84 168 88 156 C 76 158 62 150 54 140 C 49 133 47 126 48 118 Z'
const CEREBELLUM = 'M 232 168 C 250 160 290 162 296 182 C 300 200 280 214 256 212 C 236 210 222 200 222 186 C 222 178 226 172 232 168 Z'
const STEM = 'M 200 186 C 206 204 210 222 208 242 L 226 242 C 226 222 224 204 222 190 Z'
/** Lobe borders: the lateral fissure, the central sulcus, the parieto-occipital line */
const BORDERS = ['M 92 156 C 112 150 136 141 160 137 C 190 131 222 122 256 108', 'M 176 22 C 170 48 180 70 170 92 C 164 108 166 124 160 137', 'M 262 30 C 256 60 264 84 256 108 C 252 130 254 150 250 172']
/** The folds, for texture */
const GYRI = [
  'M 84 52 C 96 60 92 72 104 76 C 116 80 122 70 134 76',
  'M 62 92 C 74 86 84 96 96 92 C 108 88 110 100 124 98 C 136 96 140 86 152 90',
  'M 58 124 C 70 118 80 128 94 122 C 106 116 116 128 130 120 C 140 114 148 122 156 116',
  'M 122 36 C 118 48 128 54 124 64',
  'M 150 28 C 144 42 156 50 150 64 C 146 74 154 80 150 92',
  'M 192 28 C 186 42 198 50 192 64 C 188 76 196 84 190 98 C 186 108 192 116 186 126',
  'M 214 40 C 226 46 222 58 234 62 C 244 66 242 78 252 82',
  'M 206 82 C 216 90 212 100 224 104 C 232 106 236 112 246 110',
  'M 228 28 C 232 38 240 36 244 46',
  'M 272 52 C 280 60 276 70 286 76 C 294 80 296 90 302 94',
  'M 264 96 C 276 98 278 108 290 110 C 298 112 300 120 304 124',
  'M 262 136 C 272 134 278 144 288 142 C 294 140 296 148 292 156',
  'M 104 168 C 118 160 130 168 146 162 C 162 156 172 164 188 158 C 204 152 214 158 230 150 C 238 146 244 148 250 144',
  'M 124 184 C 140 178 154 184 170 178 C 186 172 200 178 214 172 C 226 168 236 170 246 162',
]
const FOLIA = ['M 232 174 C 250 166 280 168 294 180', 'M 226 186 C 246 178 278 182 296 192', 'M 228 197 C 248 192 274 196 290 203', 'M 238 206 C 254 204 268 206 278 209']
/** The green's surface: a gentle wave, wider than the brain so it can drift sideways */
const WAVE = `M -40 0 ${Array.from({ length: 11 }, () => 'q 10 -3.5 20 0 t 20 0').join(' ')} V 270 H -40 Z`

type LobeState = { pct: number | null; tasks: TaskCoverage[]; cant: boolean }

function lobeState(tasks: TaskCoverage[], areas: LabArea[]): LobeState {
  const list = tasks.filter((t) => areas.includes(t.task.area))
  const ok = list.filter((t) => t.task.buildable)
  return { tasks: list, pct: ok.length ? Math.round((ok.reduce((a, t) => a + t.done, 0) / (ok.length * LAB_SLOTS.length)) * 100) : null, cant: list.length > 0 && !ok.length }
}

export function LabBrain({
  methodologyId,
  name,
  exam,
  tasks,
  points,
  samples,
  onAddSample,
}: {
  methodologyId: string
  name: string
  exam: boolean
  tasks: LabTask[]
  points: LabPoint[]
  samples: LabSample[]
  onAddSample: () => void
}) {
  const cov = labCoverage({ tasks, points, samples })
  const lobes = LOBES.map((l) => ({ ...l, state: lobeState(cov.tasks, l.areas) }))
  // Open where the most is still missing
  const weakest = [...lobes].filter((l) => l.state.pct !== null).sort((a, b) => a.state.pct! - b.state.pct!)[0] ?? lobes.find((l) => l.state.tasks.length)
  const [selected, setSelected] = useState<LobeKey>(weakest?.key ?? 'reading')
  const real = exam ? 'real exam' : 'real sample'
  const lobe = lobes.find((l) => l.key === selected)!
  const buildable = tasks.filter((t) => t.buildable).length

  return (
    <section className={`flex min-w-0 flex-col gap-4 p-4 sm:p-5 ${CARD}`} aria-label="Brain">
      <div className="grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <h2 className="t-h2">{cov.ready ? `How well it knows ${name}` : `Show me ${LAB_LIMITS.samples} ${real}s first`}</h2>
              <p className="t-small text-ink-500">
                {cov.ready
                  ? `${cov.samples} ${real}s · ${tasks.length} task type${tasks.length === 1 ? '' : 's'}${tasks.length > buildable ? ` (${tasks.length - buildable} can’t be built)` : ''} · ${points.length} point${points.length === 1 ? '' : 's'}`
                  : `Then the brain shows what it knows about every task the ${exam ? 'exam' : 'methodology'} asks, and fills up as you feed it books.`}
              </p>
            </div>
            {cov.ready && (
              <p className="flex items-baseline gap-1.5">
                <span className="t-num font-display text-5xl font-bold leading-none text-success-600">{cov.pct}%</span>
                <span className="t-small text-ink-500">understood</span>
              </p>
            )}
          </div>
          <BrainDrawing lobes={lobes} ready={cov.ready} selected={cov.ready ? selected : null} onSelect={setSelected} samples={cov.samples} />
          {cov.ready ? (
            <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {lobes.map((l) => (
                <li key={l.key}>
                  <button
                    type="button"
                    onClick={() => setSelected(l.key)}
                    aria-pressed={selected === l.key}
                    className={`flex w-full min-w-0 items-center gap-2 rounded-xl border-2 px-3 py-2 text-left ${selected === l.key ? 'border-success-600 bg-success-100' : 'border-paper-300 hover:bg-paper-100'}`}
                  >
                    <span className="t-small min-w-0 flex-1 truncate font-semibold text-ink-700">{l.long ?? l.name}</span>
                    {l.state.pct !== null ? (
                      <>
                        <span className="h-2 w-16 shrink-0 overflow-hidden rounded-pill bg-paper-200" aria-hidden>
                          <span className="block h-full rounded-pill bg-success-600 transition-[width] duration-700" style={{ width: `${l.state.pct}%` }} />
                        </span>
                        <span className="t-small t-num w-10 shrink-0 text-right font-semibold text-success-600">{l.state.pct}%</span>
                      </>
                    ) : (
                      <span className="t-small shrink-0 text-ink-400">{l.state.cant ? 'can’t build' : 'not in it'}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <SampleCounter count={cov.samples} />
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          {cov.ready ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <h3 className="t-h3">{lobe.long ?? lobe.name}</h3>
                {lobe.state.pct !== null && <span className="t-small t-num font-semibold text-success-600">{lobe.state.pct}%</span>}
              </div>
              {lobe.state.tasks.length ? (
                <TaskList methodologyId={methodologyId} tasks={lobe.state.tasks} samples={cov.samples} real={real} />
              ) : (
                <p className="t-body text-ink-500">No task of this kind in the {real}s so far.</p>
              )}
            </>
          ) : (
            <>
              <p className="t-body text-ink-700">
                Send one whole {real} per message, all its files together. I’ll find every task type in it, the format of each, and how often real {exam ? 'tests' : 'samples'} ask it. Then books and guides fill in the rest.
              </p>
              {cov.tasks.length > 0 && (
                <>
                  <h3 className="t-small font-semibold uppercase tracking-wide text-ink-500">Task types found so far ({cov.tasks.length})</h3>
                  <TaskList methodologyId={methodologyId} tasks={cov.tasks} samples={cov.samples} real={real} />
                </>
              )}
            </>
          )}
          <div className="mt-auto flex flex-col gap-2 border-t-2 border-paper-300 pt-3">
            {cov.newInLast !== null && (
              <p className="t-small text-ink-500">
                {cov.newInLast === 0 ? `The newest ${real} had no new task types: the list looks complete.` : `The newest ${real} added ${cov.newInLast} new task type${cov.newInLast === 1 ? '' : 's'}: another ${real} or two may find more.`}
              </p>
            )}
            <Button variant={cov.ready ? 'secondary' : 'primary'} icon={<FilePlus2 size={18} aria-hidden />} onClick={onAddSample}>
              Add a {real}
            </Button>
            {samples.length > 0 && (
              <details>
                <summary className="t-small cursor-pointer text-ink-500">
                  {samples.length} {real}
                  {samples.length === 1 ? '' : 's'} read
                </summary>
                <ol className="t-small mt-2 flex list-decimal flex-col gap-1 pl-5 text-ink-500">
                  {samples.map((s, i) => (
                    <li key={i} className="break-words">
                      {s.name || 'Pasted text'} <span className="t-num text-ink-400">· {s.tasks.length} tasks</span>
                    </li>
                  ))}
                </ol>
              </details>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

function SampleCounter({ count }: { count: number }) {
  return (
    <div className="flex items-center gap-3" aria-label={`${count} of ${LAB_LIMITS.samples} real samples read`}>
      <ol className="flex gap-1.5" aria-hidden>
        {Array.from({ length: LAB_LIMITS.samples }, (_, i) => (
          <li key={i} className={`h-2.5 w-9 rounded-pill ${i < count ? 'bg-success-600' : 'bg-paper-300'}`} />
        ))}
      </ol>
      <span className="t-small t-num font-semibold text-ink-700">
        {Math.min(count, LAB_LIMITS.samples)} / {LAB_LIMITS.samples}
      </span>
    </div>
  )
}

/** The tasks of one lobe: how often real samples ask each, and which of its five slots are known */
function TaskList({ methodologyId, tasks, samples, real }: { methodologyId: string; tasks: TaskCoverage[]; samples: number; real: string }) {
  const router = useRouter()
  const [asking, setAsking] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const remove = async (id: string) => {
    if (asking !== id) return setAsking(id)
    setBusy(true)
    const { ok } = await postJson('/api/admin/lab', { action: 'removeTask', methodologyId, taskId: id })
    setBusy(false)
    setAsking(null)
    if (ok) router.refresh()
  }
  return (
    <ul className="flex flex-col gap-2">
      {[...tasks]
        .sort((a, b) => Number(b.task.buildable) - Number(a.task.buildable) || b.seen - a.seen)
        .map((t) => {
          const missing = LAB_SLOTS.filter((s) => !t.filled[s])
          return (
            <li key={t.task.id} className={`flex min-w-0 flex-col gap-1.5 rounded-xl px-3 py-2.5 ${t.task.buildable ? 'bg-paper-100' : 'bg-paper-100 opacity-70'}`}>
              <div className="flex min-w-0 items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="t-body break-words font-semibold text-ink-800">{t.task.name}</p>
                  <p className="t-small t-num text-ink-500">
                    {t.task.id} · in {t.seen} of {samples} {real}
                    {samples === 1 ? '' : 's'}
                  </p>
                </div>
                {t.task.buildable ? (
                  <span className="mt-1 flex shrink-0 gap-1" role="img" aria-label={`${t.done} of ${LAB_SLOTS.length} known`}>
                    {LAB_SLOTS.map((s) => (
                      <span key={s} title={`${LAB_SLOT_NAME[s]}: ${t.filled[s] ? 'known' : 'missing'}`} className={`size-3 rounded-full border-2 ${t.filled[s] ? 'border-success-600 bg-success-600' : 'border-paper-400'}`} />
                    ))}
                  </span>
                ) : (
                  <Badge>Can’t build</Badge>
                )}
                <button
                  type="button"
                  onClick={() => remove(t.task.id)}
                  onBlur={() => setAsking((x) => (x === t.task.id ? null : x))}
                  disabled={busy}
                  aria-label={asking === t.task.id ? `Confirm removing ${t.task.name}` : `Remove ${t.task.name}`}
                  className={`t-small shrink-0 rounded-lg px-2 py-1 ${asking === t.task.id ? 'bg-error-100 font-semibold text-error-600' : 'text-ink-400 hover:bg-paper-200'}`}
                >
                  {asking === t.task.id ? 'Remove?' : <X size={14} aria-hidden />}
                </button>
              </div>
              {t.task.buildable ? (
                missing.length ? (
                  <p className="t-small text-ink-500">Missing: {missing.map((s) => LAB_SLOT_NAME[s].toLowerCase()).join(', ')}</p>
                ) : (
                  <p className="t-small font-semibold text-success-600">Fully understood</p>
                )
              ) : (
                t.task.note && <p className="t-small break-words text-ink-500">{t.task.note}</p>
              )}
            </li>
          )
        })}
    </ul>
  )
}

/** The drawing: a brain in profile, each lobe filling with green to its share */
function BrainDrawing({
  lobes,
  ready,
  selected,
  onSelect,
  samples,
}: {
  lobes: ((typeof LOBES)[number] & { state: LobeState })[]
  ready: boolean
  selected: LobeKey | null
  onSelect: (k: LobeKey) => void
  samples: number
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const id = (s: string) => `${uid}-${s}`
  // The green rises from empty when the brain first shows, and again whenever the knowledge grows
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const t = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(t)
  }, [])
  const level = (l: (typeof lobes)[number]) => {
    const pct = ready && shown && l.state.pct !== null ? l.state.pct : 0
    return l.bottom + 6 - (l.bottom + 6 - l.top) * (pct / 100)
  }
  const dim = (k: LobeKey) => (selected && selected !== k ? 0.78 : 1)
  /** One lobe's paper and its green (hatched when none of its tasks can be built), and the area that selects it */
  const fill = (l: (typeof lobes)[number]) => (
    <g key={l.key}>
      <g opacity={dim(l.key)}>
        <rect width="340" height="250" style={{ fill: l.state.cant && ready ? `url(#${id('hatch')})` : 'var(--paper-200)' }} stroke="none" />
        {ready && l.state.pct !== null && (
          <g className={`${uid}-rise`} style={{ transform: `translateY(${level(l)}px)` }}>
            <path className={`${uid}-wave`} d={WAVE} fill={`url(#${id('green')})`} stroke="none" />
          </g>
        )}
      </g>
      <rect width="340" height="250" fill="transparent" stroke="none" className={ready ? 'cursor-pointer' : undefined} onClick={ready ? () => onSelect(l.key) : undefined} />
    </g>
  )

  return (
    <svg viewBox="0 0 480 262" className="mx-auto h-auto w-full max-w-[640px]" role="img" aria-label={ready ? lobes.map((l) => `${l.name}: ${l.state.pct === null ? 'none' : `${l.state.pct}%`}`).join(', ') : `Waiting for real samples: ${samples} of ${LAB_LIMITS.samples}`}>
      <style>{`
        .${uid}-wave { animation: ${uid}-drift 6s linear infinite; }
        .${uid}-rise { transition: transform 1.4s cubic-bezier(0.22, 1, 0.36, 1); }
        @keyframes ${uid}-drift { from { transform: translateX(0); } to { transform: translateX(-40px); } }
        @media (prefers-reduced-motion: reduce) { .${uid}-wave { animation: none; } .${uid}-rise { transition: none; } }
      `}</style>
      <defs>
        <clipPath id={id('cere')}>
          <path d={CEREBRUM} />
        </clipPath>
        <clipPath id={id('cb')}>
          <path d={CEREBELLUM} />
        </clipPath>
        {lobes
          .filter((l) => !l.cerebellum)
          .map((l) => (
            <clipPath key={l.key} id={id(l.key)}>
              <path d={l.region} />
            </clipPath>
          ))}
        <linearGradient id={id('green')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: 'color-mix(in srgb, var(--success-600) 50%, #8be6b8)' }} />
          <stop offset="1" style={{ stopColor: 'var(--success-600)' }} />
        </linearGradient>
        <pattern id={id('hatch')} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" style={{ stroke: 'var(--ink-400)' }} strokeWidth="1.2" opacity="0.35" />
        </pattern>
      </defs>

      <g transform="translate(70 12)" style={{ stroke: 'var(--ink-700)' }} opacity={ready ? 1 : 0.6}>
        <path d={STEM} style={{ fill: 'var(--paper-200)' }} strokeWidth="1.8" />

        <g clipPath={`url(#${id('cb')})`}>
          {lobes.filter((l) => l.cerebellum).map(fill)}
          <g fill="none" strokeWidth="1" strokeLinecap="round" opacity="0.28" pointerEvents="none">
            {FOLIA.map((d) => (
              <path key={d} d={d} />
            ))}
          </g>
        </g>
        <path d={CEREBELLUM} fill="none" strokeWidth="1.8" strokeDasharray={ready ? undefined : '5 4'} pointerEvents="none" />

        <g clipPath={`url(#${id('cere')})`}>
          {lobes
            .filter((l) => !l.cerebellum)
            .map((l) => (
              <g key={l.key} clipPath={`url(#${id(l.key)})`}>
                {fill(l)}
              </g>
            ))}
          <g fill="none" strokeWidth="1.1" strokeLinecap="round" opacity="0.28" pointerEvents="none">
            {GYRI.map((d) => (
              <path key={d} d={d} />
            ))}
          </g>
          <g fill="none" strokeWidth="1.8" strokeLinecap="round" pointerEvents="none">
            {BORDERS.map((d) => (
              <path key={d} d={d} />
            ))}
          </g>
        </g>
        <path d={CEREBRUM} fill="none" strokeWidth="2.4" strokeLinejoin="round" strokeDasharray={ready ? undefined : '6 5'} pointerEvents="none" />
      </g>

      {ready ? (
        lobes.map((l) => {
          const [ax, ay] = [l.dot[0] + 70, l.dot[1] + 12]
          const [lx, ly] = l.label
          const left = lx < ax
          return (
            <g key={l.key} className="max-sm:hidden cursor-pointer" opacity={dim(l.key)} onClick={() => onSelect(l.key)}>
              <circle cx={ax} cy={ay} r={selected === l.key ? 4.5 : 3} style={{ fill: 'var(--ink-700)', stroke: 'var(--paper-50)' }} strokeWidth="1.5" />
              <polyline points={`${ax},${ay} ${left ? lx + 62 : lx - 6},${ly - 4}`} fill="none" style={{ stroke: 'var(--ink-700)' }} strokeWidth="1" opacity="0.6" />
              <text x={lx} y={ly - 6} fontSize="12" fontWeight="700" style={{ fill: 'var(--ink-700)' }}>
                {l.name}
              </text>
              <text x={lx} y={ly + 8} fontSize="12" fontWeight="700" style={{ fill: l.state.pct === null ? 'var(--ink-400)' : 'var(--success-600)' }}>
                {l.state.pct === null ? (l.state.cant ? 'can’t build' : '—') : `${l.state.pct}%`}
              </text>
            </g>
          )
        })
      ) : (
        <text x="246" y="100" textAnchor="middle" fontSize="30" fontWeight="700" strokeWidth="8" strokeLinejoin="round" paintOrder="stroke" style={{ fill: 'var(--ink-700)', stroke: 'var(--paper-50)' }}>
          {Math.min(samples, LAB_LIMITS.samples)} / {LAB_LIMITS.samples}
        </text>
      )}
    </svg>
  )
}
