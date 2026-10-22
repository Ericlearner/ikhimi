/**
 * Create mode, step two: write the homework from the plan the teacher confirmed (plan.ts).
 *
 *   every part at the same time: write → exact count (one top-up call if short) → pictures → solve-back →
 *   review of the risky items only
 *   vocabulary items for the plan's words, in parallel with the parts
 *   assemble: parts in plan order, vocabulary items spread between them (placeVocab)
 *
 * A homework takes about as long as its slowest part instead of the sum of everything, and each writer gets a
 * narrow job ("3 gap fills on the past tense using these words"), which is where most mistakes came from before.
 */
import { sanitizeForLLM } from './sanitize'
import { BLANK, isAiGraded, passageSeconds, type ExerciseKind } from './exercises'
import { LANGUAGE_NAME, type LanguageCode } from './exams'
import {
  answerVariantRules,
  checkAttachments,
  convertItem,
  essayContext,
  itemProblem,
  itemSchema,
  locatePictures,
  LOCALE_NAME,
  materialParts,
  reviewAndRepair,
  scriptMatches,
  settlePictures,
  solveBack,
  systemPrompt,
  type DraftAssignment,
  type DraftExercise,
  type EssayContext,
  type GenerateInput,
  type GenerateResult,
  type InstructionLocale,
  type LlmItem,
} from './generate'
import { vocabCounts, type HomeworkPlan, type PlanSection } from './plan'
import type { LlmProvider, LlmUsage } from './llm/types'

/** Parts written at once; Gemini's paid tier takes far more, this only keeps one homework from hogging it */
const PARALLEL = 5

type SectionStats = NonNullable<GenerateResult['meta']['plan']>['sections'][number]

/** Run jobs with at most `limit` at a time, results in order */
async function pool<T>(jobs: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const out = new Array<T>(jobs.length)
  let next = 0
  const worker = async () => {
    while (next < jobs.length) {
      const i = next++
      out[i] = await jobs[i]!()
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker))
  return out
}

const PASSAGES = {
  type: 'array',
  items: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, text: { type: 'string' } }, required: ['id', 'text'] },
}

/** The whole plan as every writer sees it, so parts fit together without repeating each other */
function planBrief(plan: HomeworkPlan, teacherText: string): string {
  const kinds = (s: PlanSection) => s.kinds.map((k) => `${k.count} ${k.kind}`).join(' + ')
  return `HOMEWORK PLAN (agreed with the teacher)
Title: ${plan.title}${plan.level ? `\nLevel: ${plan.level}` : ''}
Focus: ${plan.focus}${plan.grammarPoints.length ? `\nGrammar points: ${plan.grammarPoints.join('; ')}` : ''}${
    plan.words.length ? `\nTarget words (use them in your items where they fit naturally): ${plan.words.map((w) => w.word).join(', ')}` : ''
  }${plan.notes ? `\nThe teacher's other wishes: ${plan.notes}` : ''}
The teacher's message: "${teacherText || '(none)'}"
All parts (other writers write the others at the same time; don't repeat their content):
${plan.sections.map((s) => `- ${s.id} "${s.title}" (${kinds(s)}): ${s.about}`).join('\n')}`
}

function partTask(section: PlanSection, want: { kind: ExerciseKind; count: number }[]): string {
  const total = want.reduce((a, k) => a + k.count, 0)
  return `YOUR PART: ${section.id} "${section.title}" (skill: ${section.skill})
Write exactly ${want.map((k) => `${k.count} ${k.kind}`).join(' and ')} (${total} item${total > 1 ? 's' : ''} in total), no more and no fewer.
What to practise: ${section.about}${
    section.passage
      ? `\nREADING: first write ONE passage in "passages" with id "${section.id}" (or copy the reading text from the materials), then every item asks about it with passageId "${section.id}".`
      : ''
  }${section.pictures ? '\nThese items use pictures from the materials: set imageRef on every item that shows one.' : ''}
Return {"passages": [...], "exercises": [...]} with exactly these items.`
}

/** Keep `want` items per kind, in the model's order; the rest are extra */
function takeCounts(items: DraftExercise[], want: { kind: ExerciseKind; count: number }[]): { kept: DraftExercise[]; missing: { kind: ExerciseKind; count: number }[] } {
  const left = new Map(want.map((k) => [k.kind, k.count]))
  const kept = items.filter((e) => {
    const n = left.get(e.kind) ?? 0
    if (n <= 0) return false
    left.set(e.kind, n - 1)
    return true
  })
  // A wrong kind stands in for a missing one rather than leaving the part short
  for (const e of items) {
    if (kept.includes(e)) continue
    const gap = [...left].find(([, n]) => n > 0)
    if (!gap || isAiGraded(e.kind) !== isAiGraded(gap[0])) continue
    left.set(gap[0], gap[1] - 1)
    kept.push(e)
  }
  return { kept, missing: [...left].filter(([, n]) => n > 0).map(([kind, count]) => ({ kind, count })) }
}

/** An item is risky when a check found something, or when only the reviewer can judge it */
const risky = (e: DraftExercise) => e.flags.length > 0 || !!e.imageRef || isAiGraded(e.kind) || !!e.payload.passage || !!e.speak

/**
 * Solve-back on every item, then the review on the risky ones only: an item the solver agreed with, without a
 * picture, passage or rubric, is already checked. The review never drops an item here (the count is a promise);
 * it fixes it or flags it for the teacher.
 */
async function checkItems(
  llm: LlmProvider,
  input: GenerateInput,
  items: DraftExercise[],
  ctx: { passages: Record<string, string>; essay: EssayContext; seed: number },
  add: (u: LlmUsage) => void,
): Promise<{ items: DraftExercise[]; reviewed: number; review: GenerateResult['meta']['review'] }> {
  const solved = await solveBack(llm, items)
  if (solved.usage) add(solved.usage)
  const todo = items.map((e, i) => ({ e, i })).filter(({ e }) => risky(e))
  if (!input.review || !todo.length) return { items, reviewed: 0, review: undefined }
  const rawPassages = Object.entries(ctx.passages).map(([id, text]) => ({ id, text }))
  const r = await reviewAndRepair(
    llm,
    input,
    todo.map(({ e }) => e),
    { passages: ctx.passages, rawPassages, essay: ctx.essay, seed: ctx.seed, teacherSetCount: true },
  )
  if (r.usage) add(r.usage)
  const out = [...items]
  // Same length and order back (never drops with teacherSetCount); anything else keeps the items as written.
  // A fix that no longer fits its sound (or breaks another rule) keeps the item as it was.
  if (r.exercises.length === todo.length)
    todo.forEach(({ e, i }, j) => {
      const fixed = { ...r.exercises[j]!, vocab: e.vocab, speak: e.speak }
      if (!itemProblem(fixed) && fixed.speak === e.speak) out[i] = fixed
    })
  return { items: out, reviewed: todo.length, review: r.stats }
}

type PartResult = { items: DraftExercise[]; passages: Record<string, string>; stats: SectionStats; review: GenerateResult['meta']['review'] }

/** One part of the plan: written, counted, pictures found, checked */
async function writeSection(
  llm: LlmProvider,
  input: GenerateInput,
  plan: HomeworkPlan,
  section: PlanSection,
  si: number,
  ctx: { essay: EssayContext; seed: number; brief: string; pictures: { located: number } },
  add: (u: LlmUsage) => void,
): Promise<PartResult> {
  const started = Date.now()
  const passages: Record<string, string> = {}
  // Why written items were turned away, so the top-up doesn't repeat it
  const rejected = new Set<string>()
  // The chosen style's knowledge: each writer gets the general points of its skill and the task its part builds toward
  const system = systemPrompt({ ...input, plan, styleSkills: [section.skill], styleTask: section.task ?? null })
  const schema = (kinds: ExerciseKind[]) => ({
    type: 'object',
    // Pronunciation and listening parts may play words and sentences instead of showing them
    properties: { passages: PASSAGES, exercises: { type: 'array', items: itemSchema(kinds, [], { speak: section.skill === 'pronunciation' || section.skill === 'listening' }) } },
    required: section.passage ? ['passages', 'exercises'] : ['exercises'],
  })
  const convert = (raw: { exercises?: LlmItem[]; passages?: { id?: string; title?: string; text?: string }[] }, salt: number) => {
    // Passages are renamed after the part ("s2", "s2:2"…), so two parts' passages never mix
    const ids = new Map<string, string>()
    for (const p of raw.passages ?? []) {
      if (!p.text?.trim()) continue
      const id = passages[section.id] === undefined ? section.id : `${section.id}:${Object.keys(passages).length + 1}`
      passages[id] = p.title?.trim() ? `${p.title.trim()}\n\n${p.text.trim()}` : p.text.trim()
      if (p.id?.trim()) ids.set(p.id.trim(), id)
    }
    const out: DraftExercise[] = []
    ;(raw.exercises ?? []).forEach((item, i) => {
      const pid = item.passageId?.trim() ?? ''
      // A reading part's item without a passage id asks about the part's passage
      const passageId = ids.get(pid) ?? (passages[pid] !== undefined ? pid : section.passage && passages[section.id] !== undefined ? section.id : '')
      const r = convertItem({ ...item, passageId }, ctx.seed + salt + i * 7919, passages, ctx.essay)
      if (!r.ok) return console.warn(`[compose] ${section.id} item ${i + 1} dropped: ${r.reason}`)
      checkAttachments(r.ex, input.materials)
      const problem = itemProblem(r.ex)
      if (problem) {
        rejected.add(problem)
        return console.warn(`[compose] ${section.id} item ${i + 1} rewritten: ${problem}`)
      }
      out.push(r.ex)
    })
    return out
  }
  const want = section.kinds
  const task = partTask(section, want)
  const gen = await llm.generateJson({
    task: 'generate',
    effort: 'high',
    system,
    parts: [...materialParts(input.materials), { text: `${ctx.brief}\n\n${task}` }],
    schema: schema(want.map((k) => k.kind)),
    temperature: 0.7,
  })
  add(gen.usage)
  let { kept, missing } = takeCounts(convert(gen.json as never, si * 1_000_003), want)

  // Pictures the items talk about but didn't point at; one we can't find takes the item out (and a new one in)
  const located = await locatePictures(llm, input, kept)
  if (located) {
    add(located.usage)
    ctx.pictures.located += located.located
  }
  const noPicture = kept.filter((e) => e.flags.includes('image_missing'))
  if (noPicture.length) {
    kept = kept.filter((e) => !noPicture.includes(e))
    for (const e of noPicture) {
      const m = missing.find((x) => x.kind === e.kind)
      if (m) m.count++
      else missing.push({ kind: e.kind, count: 1 })
    }
  }

  // Short of the count: one more call for exactly what is missing
  let topUp = false
  if (missing.length) {
    topUp = true
    const passage = passages[section.id]
    const more = await llm
      .generateJson({
        task: 'generate',
        effort: 'high',
        system,
        parts: [
          ...materialParts(input.materials),
          {
            text: `${ctx.brief}\n\n${task}\n\nThese items are already written:\n${JSON.stringify(kept.map((e) => e.prompt + (e.payload.text ? `\n${e.payload.text as string}` : '')))}\n${
              passage ? `They ask about this passage (id "${section.id}"); yours must too:\n${passage}\n` : ''
            }Write ONLY the ${missing.map((k) => `${k.count} ${k.kind}`).join(' and ')} still missing, different from the ones above.${
              noPicture.length ? ' The needed picture is not in the materials: these items must not need a picture.' : ''
            }${rejected.size ? `\nEarlier items were turned away because: ${[...rejected].join('; ')}. Don't repeat that.` : ''}`,
          },
        ],
        schema: schema(missing.map((k) => k.kind)),
        temperature: 0.7,
      })
      .catch((e) => {
        console.warn(`[compose] ${section.id} top-up failed`, e)
        return null
      })
    if (more) {
      add(more.usage)
      const extra = takeCounts(convert(more.json as never, si * 1_000_003 + 500_009), missing).kept
      const relocated = await locatePictures(llm, input, extra)
      if (relocated) {
        add(relocated.usage)
        ctx.pictures.located += relocated.located
      }
      kept = [...kept, ...extra.filter((e) => !e.flags.includes('image_missing'))]
    }
  }
  if (!kept.length) throw new Error(`Part ${section.id} has no usable items`)

  const checked = await checkItems(llm, input, kept, { passages, essay: ctx.essay, seed: ctx.seed + si * 31 }, add)
  const asked = want.reduce((a, k) => a + k.count, 0)
  if (checked.items.length !== asked) console.warn(`[compose] ${section.id}: asked ${asked}, written ${checked.items.length}`)
  return {
    items: checked.items,
    passages,
    review: checked.review,
    stats: { id: section.id, ms: Date.now() - started, asked, written: checked.items.length, topUp, reviewed: checked.reviewed },
  }
}

// ─── vocabulary items ───────────────────────────────────────────────────────

const VOCAB_KINDS: ExerciseKind[] = ['mcq_single', 'short_answer', 'gap_fill']

/** Built on first use: generate.ts imports this module, so its helpers aren't ready while this one loads */
const vocabSchema = () => ({
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        anyOf: itemSchema(VOCAB_KINDS, ['passageId', 'imageRef', 'listening', 'audioLabel', 'audioFile', 'answerSource']).anyOf.map((v) => ({
          ...v,
          properties: {
            ...v.properties,
            word: { type: 'string', description: 'The target word this item practises, exactly as given' },
            stage: { type: 'string', enum: ['meet', 'recall'] },
            speak: { type: 'string', description: 'Listen items only: the word the student hears, exactly as written in the correct option; empty otherwise' },
          },
          required: [...v.required, 'word', 'stage'],
        })),
      },
    },
  },
  required: ['items'],
})

type VocabTask = { word: string; meaning: string; stage: 'meet' | 'recall'; listen: boolean }

/** Which words get which item: every word is met, every other word is recalled, every other meeting is heard */
export function vocabTasks(plan: HomeworkPlan, speech: boolean): VocabTask[] {
  const { meet, recall } = vocabCounts(plan)
  const words = plan.words.slice(0, meet)
  return [
    ...words.map((w, i) => ({ ...w, stage: 'meet' as const, listen: speech && i % 2 === 1 })),
    // Every other recall is heard and typed (dictation) instead of recalled from its meaning
    ...words.filter((_, i) => i % 2 === 0).slice(0, recall).map((w, i) => ({ ...w, stage: 'recall' as const, listen: speech && i % 2 === 1 })),
  ]
}

function vocabPrompt(input: GenerateInput, plan: HomeworkPlan, language: string): string {
  return `You write SHORT vocabulary practice items (5–15 seconds each) that are mixed into a homework in ${language}. Return JSON only.

- Instructions in the prompt and every explanation are in ${LOCALE_NAME[input.instructionLocale]}. Words, options, sentences and answers are in ${language}, except where a meaning is shown.
- Write exactly the items asked, one per line of the task, each with its word and stage.
- meet, listen=false: mcq_single "What does «word» mean?" (in the instruction language): the right meaning and 3 plausible wrong meanings, all in the instruction language, similar in length.
- meet, listen=true: mcq_single, prompt "Listen and choose the word you hear" (in the instruction language). Options: the word and 3 words of ${language} that look or sound similar to it. speak = the word exactly as written in the correct option. Never write the word in the prompt.
- recall, listen=true: short_answer, prompt "Listen and type the word you hear" (in the instruction language), acceptedAnswers = the word and every accepted spelling, speak = the word. Never write the word in the prompt.
- recall, listen=false: make the student produce the word. Either short_answer "Write the word for: «meaning»" (in the instruction language; acceptedAnswers lists the word and every accepted spelling), or gap_fill with ONE short sentence where the word fills the ${BLANK}, the meaning in brackets right after the blank, e.g. "Every morning I ${BLANK} (yugurmoq) in the park." (accepted: every correct form in that sentence).
- Exactly one defensible answer. No real people's names. explanation: one sentence.${answerVariantRules(input.language ?? plan.contentLanguage) ? `\n${answerVariantRules(input.language ?? plan.contentLanguage)}` : ''}`
}

/** Short vocabulary items for the plan's words, written in parallel with the parts */
async function writeVocab(
  llm: LlmProvider,
  input: GenerateInput,
  plan: HomeworkPlan,
  ctx: { essay: EssayContext; seed: number },
  add: (u: LlmUsage) => void,
): Promise<{ items: DraftExercise[]; review: GenerateResult['meta']['review'] }> {
  const tasks = vocabTasks(plan, !!input.speech)
  if (!tasks.length) return { items: [], review: undefined }
  const lang = LANGUAGE_NAME[plan.contentLanguage as LanguageCode] ?? (input.language ? LANGUAGE_NAME[input.language] : plan.contentLanguage)
  const res = await llm.generateJson({
    task: 'generate',
    effort: 'low',
    maxOutputTokens: 16384,
    system: vocabPrompt(input, plan, lang),
    parts: [{ text: `Level: ${plan.level ?? 'as the words suggest'}. Topic: ${plan.title}.\nItems to write:\n${tasks.map((t, i) => `${i + 1}. word «${t.word}» (meaning: ${t.meaning}), stage ${t.stage}, listen=${t.listen}`).join('\n')}` }],
    schema: vocabSchema(),
    temperature: 0.6,
  })
  add(res.usage)
  const norm = (s: string) => s.trim().toLowerCase()
  const items: DraftExercise[] = []
  const used = new Set<string>()
  ;((res.json as { items?: (LlmItem & { word?: string; stage?: string; speak?: string })[] }).items ?? []).forEach((raw, i) => {
    const t = tasks.find((x) => !used.has(`${x.word}:${x.stage}`) && norm(x.word) === norm(raw.word ?? '') && x.stage === raw.stage)
    if (!t) return
    const r = convertItem({ ...raw, skill: 'vocabulary' }, ctx.seed + 77_777 + i * 7919, {}, ctx.essay)
    if (!r.ok) return console.warn(`[compose] vocabulary item for «${t.word}» dropped: ${r.reason}`)
    used.add(`${t.word}:${t.stage}`)
    const ex = r.ex
    ex.vocab = { word: t.word, stage: t.stage }
    ex.speak = null
    if (t.listen) {
      // The word students hear is the right answer, whatever the model put in speak
      const options = (ex.payload.options as string[] | undefined) ?? []
      const right = ex.kind === 'mcq_single' ? options[(ex.answerKey as { correct?: number }).correct ?? -1] : ex.kind === 'short_answer' ? (ex.answerKey as { accepted: string[] }).accepted[0] : undefined
      if (!right) return
      ex.speak = right
    }
    const problem = itemProblem(ex)
    if (problem) return console.warn(`[compose] vocabulary item for «${t.word}» dropped: ${problem}`)
    items.push(ex)
  })
  const checked = await checkItems(llm, input, items, { passages: {}, essay: ctx.essay, seed: ctx.seed + 991 }, add)
  return { items: checked.items, review: checked.review }
}

const NO_AUDIO_PROMPT: Record<InstructionLocale, (m: string) => string> = {
  ko: (m) => `‘${m}’에 해당하는 단어는 무엇인가요?`,
}
const NO_AUDIO_TYPE: Record<InstructionLocale, (m: string) => string> = {
  ko: (m) => `‘${m}’에 해당하는 단어를 쓰세요`,
}

/**
 * A listen item whose word couldn't be turned into speech asks for the word by its meaning instead: the same
 * options and the same answer, so it still works without sound.
 */
export function withoutSpeech(e: DraftExercise, plan: Pick<HomeworkPlan, 'words'>, locale: InstructionLocale) {
  const meaning = plan.words.find((w) => w.word.toLowerCase() === e.vocab?.word.toLowerCase())?.meaning
  e.prompt = (e.kind === 'short_answer' ? NO_AUDIO_TYPE : NO_AUDIO_PROMPT)[locale](meaning || e.vocab?.word || '')
  e.speak = null
}

/**
 * Vocabulary items between the parts' items: a warm-up first, then one after every second block (every block when
 * there are many), the rest at the end. A reading passage and its questions are one block, never split. Every word
 * is met before it is recalled, and recall starts with a different word than the last one met.
 */
export function placeVocab(main: DraftExercise[], vocab: DraftExercise[]): DraftExercise[] {
  if (!vocab.length) return main
  const meet = vocab.filter((v) => v.vocab?.stage !== 'recall')
  let recall = vocab.filter((v) => v.vocab?.stage === 'recall')
  const last = meet.at(-1)?.vocab?.word
  if (recall.length > 1 && recall[0]!.vocab?.word === last) recall = [...recall.slice(1), recall[0]!]
  const queue = [...meet, ...recall]
  const blocks: DraftExercise[][] = []
  for (const e of main) {
    const prev = blocks.at(-1)
    if (prev && e.payload.passage && prev[0]!.payload.passage === e.payload.passage) prev.push(e)
    else blocks.push([e])
  }
  const step = queue.length <= Math.ceil((blocks.length + 1) / 2) ? 2 : 1
  const out: DraftExercise[] = [queue.shift()!]
  blocks.forEach((b, i) => {
    out.push(...b)
    if ((i + 1) % step === 0 && queue.length && i < blocks.length - 1) out.push(queue.shift()!)
  })
  return [...out, ...queue]
}

function mergeReview(all: GenerateResult['meta']['review'][]): GenerateResult['meta']['review'] {
  const ran = all.filter((r): r is NonNullable<typeof r> => !!r)
  if (!ran.length) return undefined
  return {
    kept: ran.reduce((s, r) => s + r.kept, 0),
    fixed: ran.reduce((s, r) => s + r.fixed, 0),
    dropped: ran.reduce((s, r) => s + r.dropped, 0),
    flagged: ran.reduce((s, r) => s + r.flagged, 0),
    ...(ran.some((r) => r.failed) ? { failed: true } : {}),
  }
}

export async function composeFromPlan(llm: LlmProvider, input: GenerateInput, plan: HomeworkPlan): Promise<GenerateResult> {
  const seed = input.seed ?? Date.now()
  const usage: LlmUsage = { inputTokens: 0, outputTokens: 0 }
  const add = (u: LlmUsage) => {
    usage.inputTokens += u.inputTokens
    usage.outputTokens += u.outputTokens
    if (u.thoughtsTokens) usage.thoughtsTokens = (usage.thoughtsTokens ?? 0) + u.thoughtsTokens
  }
  input.onProgress?.('writing')
  const essay = essayContext(input)
  const brief = planBrief(plan, sanitizeForLLM(input.teacherText, { knownNames: input.knownNames }).text)
  const model = { name: '' }
  const pictures = { located: 0 }
  const tracked: LlmProvider = {
    name: llm.name,
    generateJson: async (req) => {
      const r = await llm.generateJson(req)
      if (req.task === 'generate' && !model.name) model.name = r.model
      return r
    },
  }

  // A part that fails is tried once more; a second failure fails the homework (counts are a promise)
  const retry = <T>(job: () => Promise<T>) => () => job().catch((e) => (console.warn('[compose] part failed, retrying', e), job()))
  const vocabJob = retry(async () => {
    const v = await writeVocab(tracked, input, plan, { essay, seed }, add)
    if (v.items.length) input.onItems?.(v.items)
    return v
  })
  const [vocab, ...parts] = await pool<{ items: DraftExercise[]; review: GenerateResult['meta']['review'] } & Partial<PartResult>>(
    [
      // Vocabulary is extra: if it fails twice, the homework goes on without it
      () => vocabJob().catch((e) => (console.warn('[compose] vocabulary items failed', e), { items: [], review: undefined })),
      ...plan.sections.map((s, i) =>
        retry(async () => {
          const r = await writeSection(tracked, input, plan, s, i, { essay, seed, brief, pictures }, add)
          input.onItems?.(r.items)
          return r
        }),
      ),
    ],
    PARALLEL,
  )
  input.onProgress?.('finishing')

  let exercises = placeVocab(
    parts.flatMap((p) => p.items),
    vocab!.items,
  )
  // Reading the passage once: its time goes on the first item that shows it
  const seen = new Set<string>()
  for (const e of exercises) {
    const text = e.payload.passage as string | undefined
    if (text && !seen.has(text)) {
      seen.add(text)
      e.estimatedSeconds += passageSeconds(text)
    }
  }
  const draft: DraftAssignment = {
    title: plan.title,
    instructions: plan.instructions,
    rationale: plan.rationale,
    contentLanguage: plan.contentLanguage,
    cefrLevel: plan.level,
    estimatedMinutes: Math.max(1, Math.round(exercises.reduce((s, e) => s + e.estimatedSeconds, 0) / 60)),
    exercises,
    skipped: [],
  }
  settlePictures(draft, 'create', input.instructionLocale)
  exercises = draft.exercises
  const sections = parts.map((p) => p.stats!)
  console.info(`[compose] ${sections.map((s) => `${s.id} ${s.written}/${s.asked} in ${Math.round(s.ms / 1000)}s${s.topUp ? ' +top-up' : ''}, reviewed ${s.reviewed}`).join('; ')}; vocabulary ${vocab!.items.length}`)
  return {
    draft,
    meta: {
      model: model.name || llm.name,
      usage,
      dropped: [],
      trimmedForTime: 0,
      solveBack: [],
      instructionsScriptOk: !plan.instructions || scriptMatches(plan.instructions, input.instructionLocale),
      raw: null,
      ...(input.review ? { review: mergeReview([vocab!.review, ...parts.map((p) => p.review)]) } : {}),
      pictures: { pointed: exercises.filter((e) => e.imageRef).length, located: pictures.located },
      plan: { plan, sections, vocab: vocab!.items.length },
    },
  }
}
