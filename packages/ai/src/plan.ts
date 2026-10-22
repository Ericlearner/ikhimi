/**
 * Create mode, step one: a quick call reads the pages and the teacher's message and returns a PLAN, not exercises:
 * the parts of the homework with exact counts, the grammar points, and the words worth repeating. The teacher sees
 * it as a card in the chat and presses "만들기"; then every part is written at the same time (generate.ts).
 * The plan is the writers' specification, so a vague or confusing message is turned into concrete settings first.
 */
import { sanitizeForLLM } from './sanitize'
import { EXERCISE_KINDS, type ExerciseKind } from './exercises'
import { examById, LANGUAGE_NAME, type LanguageCode } from './exams'
import { DIFFICULTY, LOCALE_NAME, materialParts, type InstructionLocale, type Material } from './generate'
import { labPlanSection, type StyleKnowledge } from './lab'
import type { LlmProvider, LlmUsage } from './llm/types'
import { PLAN_FOCUS, PLAN_LIMITS, PLAN_SKILLS, type HomeworkPlan, type PlanFocus, type PlanPrefs, type PlanSection, type PlanSkill, type PlanWord } from './plan-shape'

export * from './plan-shape'

export type PlanInput = {
  teacherText: string
  materials: Material[]
  instructionLocale: InstructionLocale
  targetMinutes: number
  difficulty: 1 | 2 | 3 | 4 | 5
  focusSkills?: string[]
  knownNames?: string[]
  language?: LanguageCode | null
  exam?: { id: string; level: string } | null
  prefs?: PlanPrefs | null
  /** The chosen style's knowledge from the owner's Lab: a catalog exam's, or the owner's own methodology */
  style?: StyleKnowledge | null
  /** The teacher answered a plan in the chat ("그림 문제도 넣어 줘"): change that plan */
  revise?: { previous: HomeworkPlan; feedback: string }
}

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    instructions: { type: 'string', description: 'Short instructions for students, in the instruction language' },
    rationale: { type: 'string', description: 'ONE line for the teacher, in the instruction language, naming the method used' },
    contentLanguage: { type: 'string', description: 'ISO code of the language being learned, e.g. en' },
    level: { type: 'string', description: 'CEFR level of the materials (A1…C2), or the exam level' },
    focus: { type: 'string', enum: [...PLAN_FOCUS] },
    grammarPoints: { type: 'array', items: { type: 'string' }, description: 'The grammar points the lesson teaches, short, e.g. "Past Simple of irregular verbs"' },
    words: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          word: { type: 'string', description: 'In the language being taught, as it is written in the materials (dictionary form)' },
          meaning: { type: 'string', description: 'Short translation in the instruction language' },
        },
        required: ['word', 'meaning'],
      },
    },
    sections: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short heading for the teacher, in the instruction language' },
          skill: { type: 'string', enum: [...PLAN_SKILLS] },
          kinds: {
            type: 'array',
            items: {
              type: 'object',
              properties: { kind: { type: 'string', enum: [...EXERCISE_KINDS] }, count: { type: 'integer' } },
              required: ['kind', 'count'],
            },
          },
          about: { type: 'string', description: 'In English, for the writer: exactly what these items practise and how' },
          passage: { type: 'boolean' },
          pictures: { type: 'boolean' },
          task: { type: 'string', description: 'id of the style TASK this part builds toward (t1, t2…); empty for none' },
        },
        required: ['title', 'skill', 'kinds', 'about'],
      },
    },
    vocabRepetition: { type: 'boolean' },
    teacherSetCount: { type: 'boolean' },
    notes: { type: 'string' },
  },
  required: ['title', 'instructions', 'rationale', 'contentLanguage', 'focus', 'grammarPoints', 'words', 'sections', 'vocabRepetition', 'teacherSetCount'],
}

/** What a pronunciation part can hold: choose what you hear, type what you hear, say it into the microphone */
const PRONUNCIATION_KINDS: ExerciseKind[] = ['mcq_single', 'short_answer', 'shadowing']

/** Average seconds per item, to turn the minutes into a rough item count when the teacher gave none */
const AVG_ITEM_SECONDS = 70

function planPrompt(input: PlanInput): string {
  const exam = examById(input.exam?.id)
  const bias = Object.entries(input.prefs?.kindBias ?? {}).filter(([, v]) => v)
  return `You are 익히미's lesson planner. Read the materials and the teacher's message and PLAN a homework; other writers will write the items from your plan. Return JSON only.

THE TEACHER'S REQUEST COMES FIRST
- What the teacher wrote is the specification. A number of items, exercise types, skills, topic or order they name goes into the plan exactly ("문제 10개" → the sections add up to exactly 10 items; set teacherSetCount=true).
- A number that describes only ONE part ("also 5 sentences to translate") is that part's count; plan the rest yourself.
- What the teacher left open, you decide, following the defaults below.

SECTIONS
- 2–${PLAN_LIMITS.sections} sections. Each practises ONE point with 1–2 item kinds and an exact count per kind. Order them from receptive to productive: recognition first, controlled practice next, one freer task last.
- Count ITEMS, not blanks: a gap_fill with 5 blanks is one item.${
    input.revise ? '' : `
- With no number from the teacher: about ${Math.max(4, Math.min(PLAN_LIMITS.items, Math.round((input.targetMinutes * 60) / AVG_ITEM_SECONDS)))} items in total (the homework is about ${input.targetMinutes} minutes; this is only a rough guide).`
  }
- Never more than ${PLAN_LIMITS.items} items in total.
- about: in English, precise enough for a writer who has not seen the teacher's message: the grammar point or skill, the topic, the context, and anything the teacher asked for this part.
- Reading: when the lesson or the teacher calls for reading, one section with passage=true (the writer writes or copies one text and 3–6 items ask about it: true_false, mcq_single, short_answer).
- Pictures: when the materials have pictures the homework can use (labelled vocabulary pictures, a picture story, "look and answer" tasks) or the teacher asks for picture exercises, plan a section with pictures=true. Never plan pictures that are not in the materials; we never draw new ones.
- open_writing (students write their own sentences) and essay only when the teacher asks for writing or the exam style needs it.
- No free speaking tasks. Students speak only in pronunciation parts (read aloud, shadowing), where the AI checks the voice and never stores it. If the teacher asks for speaking, plan those and written practice instead, and say so in notes.
- PRONUNCIATION (발음, or the teacher picked the pronunciation skill): plan skill "pronunciation" parts, all done by listening, in this order: minimal pairs (mcq_single: hear one word, choose it among words differing in one sound), word stress or tone (mcq_single: hear the word, choose the stressed syllable or tone), dictation (short_answer: hear a word or short sentence, type it), read aloud (one shadowing item with the hard words: the student reads them into the microphone), and ONE shadowing item last (a short text read aloud sentence by sentence; the student repeats each into the microphone and the AI scores it; they repeat until it passes). Pick the sounds and stress patterns that are hard for Korean speakers in this language (for English: r/l, f/p, v/b, th, z, short and long vowels, word stress and linking) and that fit the lesson. Pronunciation parts use only mcq_single, short_answer and shadowing.
- LISTENING with no recording attached: the items are read aloud by a voice (a sentence or short text), and students choose or type what they heard: gap_fill (listen and fill in the missing words), mcq_single, true_false, short_answer (dictation). Choosing a grammar form or putting verbs in brackets into the right tense is a grammar part, never a listening one.
- Kinds: mcq_single, mcq_multi, true_false, gap_fill, matching, ordering, short_answer, open_writing, essay, shadowing (pronunciation parts only).

WORDS (vocabulary repetition)
- Pick ${PLAN_LIMITS.wordsMin}–${PLAN_LIMITS.words} words or short phrases from the materials (or the topic, without materials) that are NEW or HARD for students at this level: the lesson's key vocabulary, not words they surely know. Write each in its dictionary form, with a short meaning in ${LOCALE_NAME[input.instructionLocale]}.
- vocabRepetition: true, unless the teacher says they don't want vocabulary tasks${input.prefs?.vocabRepetition === false ? ' (this teacher turned it off for this course before: false unless they ask for it now)' : ''}. Short vocabulary items are added for these words automatically; do NOT plan sections for them.

LANGUAGES
- title, instructions, rationale and section titles in ${LOCALE_NAME[input.instructionLocale]}. about and notes in English.
- Difficulty: ${DIFFICULTY[input.difficulty]}.${input.language ? `\n- The language being taught is ${LANGUAGE_NAME[input.language]}; contentLanguage = "${input.language}".` : ''}${
    exam
      ? `\n- Exam style: ${exam.name}, level ${input.exam?.level || exam.defaultLevel}. The homework prepares for this exam: plan parts in its task formats where the level allows, and easier steps or preparation (vocabulary, grammar) where it doesn't; name the task type in a part's about when it uses the real format.`
      : ''
  }${input.focusSkills?.length ? `\n- The teacher picked these skills: ${input.focusSkills.join(', ')}. Focus the sections on them.` : ''}${
    bias.length ? `\n- This teacher's usual choices for this course (follow them when the message doesn't say otherwise): ${bias.map(([k, v]) => `${v! > 0 ? 'likes more' : 'wants fewer'} ${k}`).join(', ')}.` : ''
  }
- notes: other wishes of the teacher the writers must respect (style, names to avoid, things to leave out), in English; empty if none.${input.style ? `\n${labPlanSection(input.style)}` : ''}`
}

function planParts(input: PlanInput) {
  const { text } = sanitizeForLLM(input.teacherText, { knownNames: input.knownNames })
  const parts = materialParts(input.materials)
  if (input.revise) {
    const feedback = sanitizeForLLM(input.revise.feedback, { knownNames: input.knownNames }).text
    parts.push({
      text: `Original message: "${text}"\n\nYour plan:\n${JSON.stringify(input.revise.previous)}\n\nThe teacher answered: "${feedback}"\nReturn the whole plan with that change. Keep everything they didn't ask to change.`,
    })
  } else parts.push({ text: `The teacher wrote: "${text || '(nothing: plan homework on the attached materials)'}"\n\nPlan the homework.` })
  return parts
}

type RawPlan = Partial<Omit<HomeworkPlan, 'sections' | 'words'>> & {
  words?: { word?: string; meaning?: string }[]
  sections?: (Partial<Omit<PlanSection, 'kinds'>> & { kinds?: { kind?: string; count?: number }[] })[]
}

const str = (v: unknown, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/**
 * A plan we can rely on, from the model or from the browser: known kinds only, counts within limits, ids s1…sN,
 * no speaking, and a passage only on a reading part. Returns null when nothing usable is left.
 */
export function normalizePlan(raw: unknown): HomeworkPlan | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as RawPlan
  const sections: PlanSection[] = []
  let total = 0
  for (const s of r.sections ?? []) {
    if (sections.length >= PLAN_LIMITS.sections) break
    const kinds = new Map<ExerciseKind, number>()
    for (const k of s.kinds ?? []) {
      if (!EXERCISE_KINDS.includes(k.kind as ExerciseKind)) continue
      const count = Math.max(0, Math.min(PLAN_LIMITS.perKind, Math.round(Number(k.count) || 0)))
      const room = PLAN_LIMITS.items - total - [...kinds.values()].reduce((a, b) => a + b, 0)
      const n = Math.min(count, room)
      if (n > 0) kinds.set(k.kind as ExerciseKind, (kinds.get(k.kind as ExerciseKind) ?? 0) + n)
    }
    if (!kinds.size) continue
    const skill = (PLAN_SKILLS as readonly string[]).includes(s.skill ?? '') ? (s.skill as PlanSkill) : 'grammar'
    // Pronunciation is done by ear and by voice: anything else becomes dictation (the count stays)
    if (skill === 'pronunciation')
      for (const [kind, n] of [...kinds]) {
        if (PRONUNCIATION_KINDS.includes(kind)) continue
        kinds.delete(kind)
        kinds.set('short_answer', Math.min(PLAN_LIMITS.perKind, (kinds.get('short_answer') ?? 0) + n))
      }
    total += [...kinds.values()].reduce((a, b) => a + b, 0)
    sections.push({
      id: `s${sections.length + 1}`,
      title: str(s.title, 120) || skill,
      skill,
      kinds: [...kinds].map(([kind, count]) => ({ kind, count })),
      about: str(s.about, 1200),
      passage: !!s.passage && skill === 'reading',
      pictures: !!s.pictures,
      // From the model or the browser; the writers look it up in the style's tasks and ignore one they don't know
      ...(/^t\d{1,3}$/.test(str(s.task, 6)) ? { task: str(s.task, 6) } : {}),
    })
  }
  if (!sections.length) return null
  const seen = new Set<string>()
  const words: PlanWord[] = []
  for (const w of r.words ?? []) {
    const word = str(w.word, 60)
    const key = word.toLowerCase()
    if (!word || seen.has(key) || words.length >= PLAN_LIMITS.words) continue
    seen.add(key)
    words.push({ word, meaning: str(w.meaning, 120) })
  }
  return {
    title: str(r.title, 200) || '숙제',
    instructions: str(r.instructions, 1000),
    rationale: str(r.rationale, 300),
    contentLanguage: str(r.contentLanguage, 8) || 'en',
    level: str(r.level, 20) || null,
    focus: (PLAN_FOCUS as readonly string[]).includes(r.focus ?? '') ? (r.focus as PlanFocus) : 'mixed',
    grammarPoints: (r.grammarPoints ?? []).map((g) => str(g, 120)).filter(Boolean).slice(0, 6),
    words,
    sections,
    vocabRepetition: r.vocabRepetition !== false && words.length > 0,
    teacherSetCount: !!r.teacherSetCount,
    notes: str(r.notes, 1000),
  }
}

/** Plan the homework (fast; the card shows while the teacher reads it) */
export async function planHomework(llm: LlmProvider, input: PlanInput): Promise<{ plan: HomeworkPlan; usage: LlmUsage; model: string }> {
  const res = await llm.generateJson({
    task: 'plan',
    effort: 'low',
    maxOutputTokens: 8192,
    system: planPrompt(input),
    parts: planParts(input),
    schema: PLAN_SCHEMA,
    temperature: 0.4,
  })
  const plan = normalizePlan(res.json)
  if (!plan) throw new Error(`The planner returned no usable sections (model ${res.model}): ${JSON.stringify(res.json).slice(0, 800)}`)
  return { plan, usage: res.usage, model: res.model }
}

/**
 * What the teacher changed on the card, folded into the course's remembered choices: a kind they added or raised
 * moves up, one they lowered or removed moves down. Small steps, so one homework doesn't decide forever.
 */
export function learnPrefs(prev: PlanPrefs | null | undefined, proposed: HomeworkPlan | null | undefined, final: HomeworkPlan): PlanPrefs {
  const bias: Partial<Record<ExerciseKind, number>> = { ...(prev?.kindBias ?? {}) }
  if (proposed) {
    const count = (p: HomeworkPlan) => {
      const m = new Map<ExerciseKind, number>()
      for (const s of p.sections) for (const k of s.kinds) m.set(k.kind, (m.get(k.kind) ?? 0) + k.count)
      return m
    }
    const a = count(proposed)
    const b = count(final)
    for (const kind of new Set([...a.keys(), ...b.keys()])) {
      const d = Math.sign((b.get(kind) ?? 0) - (a.get(kind) ?? 0))
      if (d) bias[kind] = Math.max(-3, Math.min(3, (bias[kind] ?? 0) + d))
    }
  }
  for (const k of Object.keys(bias) as ExerciseKind[]) if (!bias[k]) delete bias[k]
  return { vocabRepetition: final.vocabRepetition, kindBias: bias }
}
