/**
 * Exercise registry (§9), Tier 1. Each kind = payload schema (what the student sees) +
 * answer-key schema (never sent to students) + deterministic grader.
 */
import { z } from 'zod'
import { normalizeApostrophes } from '@ikhimi/i18n'
import { answerLanguage, normalizeForLanguage, typoAllowed } from './answer-lang'

export const EXERCISE_KINDS = [
  'mcq_single',
  'mcq_multi',
  'true_false',
  'gap_fill',
  'matching',
  'ordering',
  'short_answer',
  'open_writing',
  'essay',
  'shadowing',
] as const
export type ExerciseKind = (typeof EXERCISE_KINDS)[number]

/** Graded by the AI against a rubric when the student checks or submits, not by a fixed key (§9 Tier 2) */
export const AI_GRADED_KINDS: readonly ExerciseKind[] = ['open_writing', 'essay']
export const isAiGraded = (kind: string) => (AI_GRADED_KINDS as readonly string[]).includes(kind)

export const SKILLS = ['grammar', 'vocabulary', 'reading', 'writing', 'listening', 'speaking', 'pronunciation'] as const
export type Skill = (typeof SKILLS)[number]

const str = z.string().trim().min(1)

/** How an essay is scored: the exam's criteria and scale (exams.ts), stored with the item */
const scaleSchema = z.object({
  criteria: z.array(z.object({ id: str, name: str, max: z.number().positive().max(100) })).min(1).max(8),
  aggregate: z.enum(['mean', 'sum']),
  step: z.number().positive().max(10),
  label: z.enum(['band', 'points']),
  unit: z.enum(['words', 'chars']),
})
export type EssayScale = z.infer<typeof scaleSchema>

export { textLength } from './exams'

/**
 * Shared by every kind. Reading: the text several items ask about (create mode writes it). imageId: a picture
 * cut out of the teacher's photo (a material id), shown above the question.
 */
const passage = { passage: z.string().trim().min(1).max(4000).optional(), imageId: z.string().max(40).optional() }

export const payloadSchemas = {
  mcq_single: z.object({ options: z.array(str).min(2).max(6), ...passage }),
  mcq_multi: z.object({ options: z.array(str).min(3).max(8), ...passage }),
  true_false: z.object({ allowNotGiven: z.boolean(), ...passage }),
  /** `text` contains one `___` per blank */
  gap_fill: z.object({ text: str, exactSpelling: z.boolean().default(false), ...passage }),
  matching: z.object({ left: z.array(str).min(2).max(10), right: z.array(str).min(2).max(10), ...passage }),
  ordering: z.object({ items: z.array(str).min(2).max(10), ...passage }),
  short_answer: z.object({ exactSpelling: z.boolean().default(false), ...passage }),
  /** The student writes `lines` sentences of their own; `checklist` is what they must do (shown to them) */
  open_writing: z.object({ lines: z.number().int().min(1).max(20), checklist: z.array(str).max(6).default([]), ...passage }),
  /** One long text (IELTS Task 2, TOPIK 54…). grader: who scores it — the AI, or the teacher by hand */
  essay: z.object({
    taskLabel: z.string().trim().max(120).default(''),
    min: z.number().int().min(10).max(2000),
    max: z.number().int().min(10).max(3000).optional(),
    scale: scaleSchema,
    grader: z.enum(['ai', 'teacher']).default('ai'),
    /** e.g. "IELTS Academic · Band 6.5" — shown to the student and given to the grader */
    exam: z.string().trim().max(120).default(''),
    ...passage,
  }),
  /**
   * Pronunciation: each line is read aloud (text-to-speech, audioId = its stored audio); the student repeats it
   * into the microphone and the AI scores it (pronounce.ts). The voice is checked, never stored.
   * mode read: the student reads the words aloud first, and may hear the voice only after a try.
   */
  shadowing: z.object({
    lines: z.array(z.object({ text: str.max(300), audioId: z.string().max(40).optional() })).min(1).max(8),
    mode: z.enum(['shadow', 'read']).default('shadow'),
    ...passage,
  }),
} satisfies Record<ExerciseKind, z.ZodType>

export const keySchemas = {
  mcq_single: z.object({ correct: z.number().int().min(0) }),
  mcq_multi: z.object({ correct: z.array(z.number().int().min(0)).min(1) }),
  true_false: z.object({ answer: z.enum(['true', 'false', 'not_given']) }),
  /** accepted variants per blank */
  gap_fill: z.object({ blanks: z.array(z.array(str).min(1)).min(1) }),
  /** pairs[i] = index in payload.right matching payload.left[i] */
  matching: z.object({ pairs: z.array(z.number().int().min(0)) }),
  /** order = payload.items indices in the correct sequence */
  ordering: z.object({ order: z.array(z.number().int().min(0)) }),
  short_answer: z.object({ accepted: z.array(str).min(1) }),
  /** Hidden grading rubric (target structure, what counts as an error) + a few model sentences */
  open_writing: z.object({ rubric: str, examples: z.array(str).max(5).default([]) }),
  /** What a strong answer must do for THIS task, the exam's rubric, and a model answer */
  essay: z.object({ rubric: str, modelAnswer: z.string().max(12000).default('') }),
  shadowing: z.object({}),
} satisfies Record<ExerciseKind, z.ZodType>

export type Payload<K extends ExerciseKind> = z.infer<(typeof payloadSchemas)[K]>
export type AnswerKey<K extends ExerciseKind> = z.infer<(typeof keySchemas)[K]>

/** What a student submits per kind */
export const responseSchemas = {
  mcq_single: z.number().int(),
  mcq_multi: z.array(z.number().int()),
  true_false: z.enum(['true', 'false', 'not_given']),
  gap_fill: z.array(z.string().max(200)),
  matching: z.array(z.number().int().nullable()),
  ordering: z.array(z.number().int()),
  short_answer: z.string().max(500),
  open_writing: z.array(z.string().max(400)).max(20),
  essay: z.string().max(12000),
  /**
   * Per sentence: best score, tries, passed, wrong words — written by the server after each AI check, never by the
   * browser. `true`: no microphone, the student only said they practised (not checked, no points).
   */
  shadowing: z.union([
    z.literal(true),
    z.object({
      lines: z.array(z.object({ best: z.number().min(0).max(100), tries: z.number().int().min(0), passed: z.boolean(), missed: z.array(z.string()), tip: z.string() }).nullable()).max(8),
    }),
  ]),
} satisfies Record<ExerciseKind, z.ZodType>

export const BLANK = '___'
export const countBlanks = (text: string) => text.split(BLANK).length - 1

/** Typical seconds per item, used to fit an assignment to the requested minutes (§8.5). */
export const SECONDS_PER_KIND: Record<ExerciseKind, number> = {
  mcq_single: 45,
  mcq_multi: 70,
  true_false: 30,
  gap_fill: 60,
  matching: 90,
  ordering: 75,
  short_answer: 90,
  open_writing: 60,
  essay: 1200,
  shadowing: 90,
}

/**
 * Seconds for one item, scaled by its size: a gap_fill with 30 blanks (or whole sentences to type) takes far
 * longer than one with 2, and ten sentences to write longer than one. Reading the passage is counted separately.
 */
export function estimateSeconds(kind: ExerciseKind, payload: Record<string, unknown>, key: Record<string, unknown>): number {
  switch (kind) {
    case 'gap_fill': {
      // Typing "went" is quick; typing a whole transformed sentence is not
      const blanks = (key.blanks as string[][] | undefined) ?? []
      return Math.max(30, blanks.reduce((s, b) => s + Math.min(45, Math.max(12, 10 + 1.5 * (b[0]?.length ?? 4))), 0))
    }
    case 'matching':
      return 15 + 15 * ((payload.left as unknown[] | undefined)?.length ?? 4)
    case 'ordering':
      return 15 + 12 * ((payload.items as unknown[] | undefined)?.length ?? 4)
    case 'open_writing':
      return 60 * Math.max(1, Number(payload.lines) || 1)
    case 'shadowing':
      // Listen, then say it along, about twice per line
      return 20 + 25 * ((payload.lines as unknown[] | undefined)?.length ?? 3)
    case 'essay': {
      // Planning + writing: ~8 s a word, ~3.5 s a Korean/Chinese character
      const min = Number(payload.min) || 150
      const unit = (payload.scale as { unit?: string } | undefined)?.unit
      return Math.round(300 + min * (unit === 'chars' ? 3.5 : 8))
    }
    default:
      return SECONDS_PER_KIND[kind]
  }
}

/** Reading time for a passage at a learner's pace (~120 words a minute) */
export const passageSeconds = (text: string) => Math.round((text.trim().split(/\s+/).length / 120) * 60)

// ─── text answer comparison ─────────────────────────────────────────────────

/**
 * Forgiving normalisation (§9): case, whitespace, apostrophe variants, edge punctuation,
 * and ё/е. Korean, Chinese, Japanese and Arabic have their own rules (answer-lang.ts) when the homework's language is
 * given.
 */
export function normalizeAnswer(s: string, language?: string | null): string {
  const lang = answerLanguage(language)
  if (lang) return normalizeForLanguage(s.normalize('NFC').toLowerCase().trim(), lang)
  let out = normalizeApostrophes(s.normalize('NFC')).toLowerCase().trim()
  out = out.replace(/\s+/g, ' ').replace(/^[\s.,!?;:"'«»()-]+|[\s.,!?;:"«»()-]+$/g, '')
  out = out.replace(/ё/g, 'е')
  return out
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!
    prev[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1))
      diag = tmp
    }
  }
  return prev[b.length]!
}

export type GradeOptions = {
  /** Accept ≤1-char typos for answers longer than this. null = off. [DECIDE #9] */
  typoToleranceMinLength: number | null
  /** The language being taught (ISO code): picks the language's own comparison rules */
  language?: string | null
}

export function textMatches(given: string, accepted: string[], exact: boolean, opts: GradeOptions): boolean {
  const g = normalizeAnswer(given, opts.language)
  if (!g) return false
  const typos = typoAllowed(answerLanguage(opts.language))
  return accepted.some((a) => {
    const k = normalizeAnswer(a, opts.language)
    if (g === k) return true
    if (exact || !typos || opts.typoToleranceMinLength === null || k.length <= opts.typoToleranceMinLength) return false
    return levenshtein(g, k) <= 1
  })
}

// ─── grading ────────────────────────────────────────────────────────────────

export type GradeResult = { fraction: number; isCorrect: boolean }

export function gradeExercise(
  kind: ExerciseKind,
  payload: unknown,
  key: unknown,
  value: unknown,
  opts: GradeOptions = { typoToleranceMinLength: 4 },
): GradeResult {
  const resp = responseSchemas[kind].safeParse(value)
  if (!resp.success) return { fraction: 0, isCorrect: false }
  const done = (fraction: number): GradeResult => ({ fraction, isCorrect: fraction >= 0.999 })

  switch (kind) {
    case 'mcq_single': {
      const k = keySchemas.mcq_single.parse(key)
      return done(resp.data === k.correct ? 1 : 0)
    }
    case 'mcq_multi': {
      const k = keySchemas.mcq_multi.parse(key)
      const chosen = new Set(resp.data as number[])
      const correct = new Set(k.correct)
      const options = payloadSchemas.mcq_multi.parse(payload).options.length
      // Each option judged independently (selected iff correct)
      let right = 0
      for (let i = 0; i < options; i++) if (chosen.has(i) === correct.has(i)) right++
      return done(right === options ? 1 : Math.max(0, (right - (options - right)) / options))
    }
    case 'true_false': {
      const k = keySchemas.true_false.parse(key)
      return done(resp.data === k.answer ? 1 : 0)
    }
    case 'gap_fill': {
      const k = keySchemas.gap_fill.parse(key)
      const p = payloadSchemas.gap_fill.parse(payload)
      const given = resp.data as string[]
      const right = k.blanks.filter((acc, i) => textMatches(given[i] ?? '', acc, p.exactSpelling, opts)).length
      return done(right / k.blanks.length)
    }
    case 'matching': {
      const k = keySchemas.matching.parse(key)
      const given = resp.data as (number | null)[]
      const right = k.pairs.filter((r, i) => given[i] === r).length
      return done(right / k.pairs.length)
    }
    case 'ordering': {
      const k = keySchemas.ordering.parse(key)
      const given = resp.data as number[]
      const right = k.order.filter((idx, pos) => given[pos] === idx).length
      return done(right / k.order.length)
    }
    case 'short_answer': {
      const k = keySchemas.short_answer.parse(key)
      const p = payloadSchemas.short_answer.parse(payload)
      return done(textMatches(resp.data as string, k.accepted, p.exactSpelling, opts) ? 1 : 0)
    }
    case 'open_writing':
    case 'essay':
      // Needs the AI grader or the teacher (server/writing); callers must not grade it here
      return { fraction: 0, isCorrect: false }
    case 'shadowing': {
      // Unchecked (no microphone): no points. Checked: the average of each sentence's best score.
      if (resp.data === true) return { fraction: 0, isCorrect: false }
      const n = payloadSchemas.shadowing.parse(payload).lines.length
      const lines = (resp.data as { lines: ({ best: number; passed: boolean } | null)[] }).lines
      const sum = Array.from({ length: n }, (_, i) => lines[i]?.best ?? 0).reduce((a, b) => a + b, 0)
      const fraction = Math.round((sum / n / 100) * 1000) / 1000
      return { fraction, isCorrect: Array.from({ length: n }, (_, i) => !!lines[i]?.passed).every(Boolean) }
    }
  }
}

/** Human-readable correct answer for result screens and reports. */
export function describeAnswer(kind: ExerciseKind, payload: unknown, key: unknown): string {
  switch (kind) {
    case 'mcq_single': {
      const p = payloadSchemas.mcq_single.parse(payload)
      return p.options[keySchemas.mcq_single.parse(key).correct] ?? ''
    }
    case 'mcq_multi': {
      const p = payloadSchemas.mcq_multi.parse(payload)
      return keySchemas.mcq_multi.parse(key).correct.map((i) => p.options[i]).join('; ')
    }
    case 'true_false':
      return keySchemas.true_false.parse(key).answer
    case 'gap_fill':
      return keySchemas.gap_fill.parse(key).blanks.map((b) => b[0]).join('; ')
    case 'matching': {
      const p = payloadSchemas.matching.parse(payload)
      return keySchemas.matching.parse(key).pairs.map((r, i) => `${p.left[i]} → ${p.right[r]}`).join('; ')
    }
    case 'ordering': {
      const p = payloadSchemas.ordering.parse(payload)
      return keySchemas.ordering.parse(key).order.map((i) => p.items[i]).join(' → ')
    }
    case 'short_answer':
      return keySchemas.short_answer.parse(key).accepted[0] ?? ''
    case 'open_writing':
      return keySchemas.open_writing.parse(key).examples.join(' / ')
    case 'essay':
    case 'shadowing':
      return ''
  }
}

/** Human-readable version of a student's answer (report "common wrong answer"). */
export function describeResponse(kind: ExerciseKind, payload: unknown, value: unknown): string {
  const r = responseSchemas[kind].safeParse(value)
  if (!r.success) return '—'
  switch (kind) {
    case 'mcq_single':
      return payloadSchemas.mcq_single.parse(payload).options[r.data as number] ?? '—'
    case 'mcq_multi': {
      const p = payloadSchemas.mcq_multi.parse(payload)
      return (r.data as number[]).map((i) => p.options[i]).join('; ') || '—'
    }
    case 'true_false':
      return r.data as string
    case 'gap_fill':
      return (r.data as string[]).map((s) => s || '…').join('; ')
    case 'matching': {
      const p = payloadSchemas.matching.parse(payload)
      return (r.data as (number | null)[]).map((ri, i) => `${p.left[i]} → ${ri === null ? '…' : p.right[ri]}`).join('; ')
    }
    case 'ordering': {
      const p = payloadSchemas.ordering.parse(payload)
      return (r.data as number[]).map((i) => p.items[i]).join(' → ')
    }
    case 'short_answer':
      return (r.data as string) || '—'
    case 'open_writing':
      return (r.data as string[]).filter((x) => x.trim()).join(' / ') || '—'
    case 'essay': {
      const t = (r.data as string).trim()
      return t ? (t.length > 200 ? `${t.slice(0, 200)}…` : t) : '—'
    }
    case 'shadowing': {
      if (r.data === true) return '—'
      const lines = (r.data as { lines: ({ best: number; tries: number; passed: boolean; missed: string[] } | null)[] }).lines
      return lines.map((l, i) => (l ? `${i + 1}: ${l.best}${l.passed ? '' : ' ✗'} (${l.tries}×)${l.missed.length ? ` ${l.missed.join(', ')}` : ''}` : `${i + 1}: —`)).join(' · ')
    }
  }
}

/** Deterministic Fisher–Yates with a seed, so shuffles are reproducible in tests. */
export function seededShuffle<T>(arr: readonly T[], seed: number): T[] {
  const out = [...arr]
  let s = seed >>> 0 || 1
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

/** The correct answer expressed as a response value (so UIs can highlight it). */
export function keyAsResponse(kind: ExerciseKind, key: unknown): unknown {
  const k = key as Record<string, unknown>
  switch (kind) {
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
    case 'open_writing':
    case 'essay':
      return null
    case 'shadowing':
      return null
  }
}

/** Per-blank verdicts for gap_fill, using every accepted variant (so UIs never second-guess the grader). */
export function gapVerdicts(payload: unknown, key: unknown, value: unknown, opts: GradeOptions = { typoToleranceMinLength: 4 }): boolean[] {
  const k = keySchemas.gap_fill.parse(key)
  const p = payloadSchemas.gap_fill.parse(payload)
  const given = Array.isArray(value) ? (value as unknown[]) : []
  return k.blanks.map((acc, i) => textMatches(typeof given[i] === 'string' ? (given[i] as string) : '', acc, p.exactSpelling, opts))
}
