/**
 * Answer keys for exercises copied from a book, taken from a source instead of the AI's own solving: the book's
 * answer pages (here) or the recording (listening.ts). Both give answers in the same shape, checked by `keyFrom`
 * against what the student sees.
 */
import { countBlanks, keySchemas, type ExerciseKind } from './exercises'
import type { LlmPart, LlmProvider, LlmUsage } from './llm/types'
import type { InstructionLocale, Material } from './generate'

/** An exercise as the model sees it when it fills in the key */
export type KeyedItem = {
  kind: ExerciseKind
  prompt: string
  payload: Record<string, unknown>
  audioLabel: string | null
  sourceRef: string | null
}

/** One answer, in a form for every auto-graded kind */
export const ANSWER_SCHEMA = {
  type: 'object',
  properties: {
    n: { type: 'integer' },
    optionIndexes: { type: 'array', items: { type: 'integer' }, description: 'mcq: 0-based indexes of correct options' },
    trueFalse: { type: 'string', enum: ['true', 'false', 'not_given'] },
    blanks: {
      type: 'array',
      items: { type: 'object', properties: { accepted: { type: 'array', items: { type: 'string' } } }, required: ['accepted'] },
      description: 'gap_fill: one entry per blank with every acceptable variant',
    },
    accepted: { type: 'array', items: { type: 'string' }, description: 'short_answer: all acceptable answers' },
    matching: { type: 'array', items: { type: 'integer' }, description: 'for each left item, index of the right item' },
    ordering: { type: 'array', items: { type: 'integer' }, description: 'item indexes in the correct order' },
    explanation: { type: 'string' },
  },
  required: ['n'],
}

export type Answer = {
  n: number
  optionIndexes?: number[]
  trueFalse?: string
  blanks?: { accepted?: string[] }[]
  accepted?: string[]
  matching?: number[]
  ordering?: number[]
  explanation?: string
}

export const LOCALE: Record<InstructionLocale, string> = { ko: 'Korean (Hangul)' }

/** The kinds a key can be given for (not writing, essays or shadowing) */
export const KEYED_KINDS: ExerciseKind[] = ['mcq_single', 'mcq_multi', 'true_false', 'gap_fill', 'short_answer', 'matching', 'ordering']

/** The model's answer as this item's key, or null when it doesn't fit the item (wrong shape, index out of range) */
export function keyFrom(item: KeyedItem, a: Answer | undefined): Record<string, unknown> | null {
  if (!a) return null
  const clean = (xs?: string[]) => (xs ?? []).map((s) => s.trim()).filter(Boolean)
  let key: unknown = null
  switch (item.kind) {
    case 'mcq_single':
      key = { correct: a.optionIndexes?.[0] }
      break
    case 'mcq_multi':
      key = { correct: [...new Set(a.optionIndexes ?? [])].sort() }
      break
    case 'true_false':
      key = { answer: a.trueFalse }
      break
    case 'gap_fill':
      key = { blanks: (a.blanks ?? []).map((b) => clean(b.accepted)) }
      break
    case 'short_answer':
      key = { accepted: clean(a.accepted) }
      break
    case 'matching':
      key = { pairs: a.matching ?? [] }
      break
    case 'ordering':
      key = { order: a.ordering ?? [] }
      break
  }
  const k = keySchemas[item.kind].safeParse(key)
  if (!k.success) return null
  // Indexes must point inside what the student sees
  const p = item.payload as { options?: string[]; right?: string[]; items?: string[]; text?: string }
  const d = k.data as { correct?: number | number[]; pairs?: number[]; order?: number[]; blanks?: string[][] }
  if (p.options && [d.correct].flat().some((i) => (i as number) >= p.options!.length)) return null
  if (p.right && (d.pairs?.length !== (p as { left?: string[] }).left?.length || d.pairs!.some((i) => i >= p.right!.length))) return null
  if (p.items && (d.order?.length !== p.items.length || new Set(d.order).size !== p.items.length)) return null
  if (item.kind === 'gap_fill' && (d.blanks!.length !== countBlanks(p.text ?? '') || d.blanks!.some((b) => !b.length))) return null
  return k.data as Record<string, unknown>
}

/** The exercises as JSON for the model, numbered from 1 */
export const itemsText = (items: KeyedItem[]) =>
  JSON.stringify(items.map((it, i) => ({ n: i + 1, kind: it.kind, label: it.audioLabel, source: it.sourceRef, prompt: it.prompt, ...it.payload })))

/** The book's answer pages as the model sees them: never Material N, so no picture is ever cut from them */
export function answerPageParts(pages: Material[]): LlmPart[] {
  const parts: LlmPart[] = []
  pages.forEach((m, i) => {
    if (m.text !== undefined) {
      parts.push({ text: `Answer key ${i + 1} (Word document "${m.label}"):\n${m.text}` })
      return
    }
    const what = m.mimeType === 'application/pdf' && m.pages ? `PDF, ${m.pages} page${m.pages > 1 ? 's' : ''}` : 'photo'
    parts.push({ text: `Answer key ${i + 1} (${what}):` })
    parts.push({ mimeType: m.mimeType, dataBase64: m.dataBase64 })
  })
  return parts
}

/** How a book's answer key is read, in generation and here (the same rule in both) */
export const ANSWER_KEY_RULE = `The book's answer key lists answers by unit (or page) and exercise number. Find each exercise's answers by its source (page/unit and exercise number) AND check that they fit that exercise's sentences: every unit has an "ex. 4b", so a key for another unit or another exercise does not count. Copy the answers as the key gives them, with every variant it allows ("I'm / I am" → both).`

export type AnswerPagesResult = { keys: (Record<string, unknown> | null)[]; explanations: (string | null)[]; usage: LlmUsage }

/**
 * Read the teacher's answer pages for an existing copied homework: a key for each exercise the pages clearly cover,
 * null for the rest (they keep their answer). The model never answers from its own knowledge here.
 */
export async function keysFromAnswerPages(llm: LlmProvider, input: { pages: Material[]; items: KeyedItem[]; instructionLocale: InstructionLocale }): Promise<AnswerPagesResult> {
  if (!input.items.length || !input.pages.length) return { keys: input.items.map(() => null), explanations: input.items.map(() => null), usage: { inputTokens: 0, outputTokens: 0 } }
  const res = await llm.generateJson({
    task: 'review',
    system: `You fill in answer keys for exercises a teacher copied from a textbook, using the pages of the book's answer key the teacher attached.
${ANSWER_KEY_RULE}
Answer ONLY the exercises the key clearly covers; leave the others out. Never answer from your own knowledge.
Option/item indexes are 0-based positions in the arrays shown. gap_fill: one entry per blank (___), in order.
explanation: one short sentence in ${LOCALE[input.instructionLocale]} saying why the answer is right.
Return JSON only.`,
    parts: [...answerPageParts(input.pages), { text: `Exercises:\n${itemsText(input.items)}` }],
    schema: { type: 'object', properties: { answers: { type: 'array', items: ANSWER_SCHEMA } }, required: ['answers'] },
    temperature: 0,
  })
  const answers = (res.json as { answers?: Answer[] }).answers ?? []
  return {
    keys: input.items.map((it, i) => keyFrom(it, answers.find((a) => a.n === i + 1))),
    explanations: input.items.map((_, i) => answers.find((a) => a.n === i + 1)?.explanation?.trim() || null),
    usage: res.usage,
  }
}
