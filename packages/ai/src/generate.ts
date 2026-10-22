/**
 * Homework generation pipeline (§8), MVP shape:
 *   [1+3+4+5] one multimodal call: read materials, interpret the teacher, plan, write items (strict JSON)
 *   [6]       verify: schema, distractor rules, language/script, time budget, solve-back
 *   [7]       assemble: order, points, estimated minutes
 * Every stage's output is kept in `meta` for debugging (generationMeta).
 */
import { sanitizeForLLM } from './sanitize'
import {
  BLANK,
  countBlanks,
  estimateSeconds,
  EXERCISE_KINDS,
  gradeExercise,
  isAiGraded,
  keySchemas,
  passageSeconds,
  payloadSchemas,
  seededShuffle,
  SECONDS_PER_KIND,
  SKILLS,
  type ExerciseKind,
  type Skill,
} from './exercises'
import type { LlmPart, LlmProvider, LlmUsage } from './llm/types'
import { examById, examWriting, GENERIC_WRITING, LANGUAGE_NAME, type Exam, type LanguageCode } from './exams'
import { composeFromPlan } from './compose'
import { labSection, type StyleKnowledge } from './lab'
import { ANSWER_KEY_RULE, answerPageParts } from './answer-key'
import type { HomeworkPlan } from './plan'

/** The language instructions and explanations are written in: the interface's, Korean */
export type InstructionLocale = 'ko'
export type ProgressStage = 'reading' | 'writing' | 'checking' | 'finishing'

export type Material = {
  label: string
  mimeType: string
  dataBase64: string
  /** PDF: how many pages the file has as sent, and their page numbers in the teacher's original file */
  pages?: number
  pageNumbers?: number[]
  /** Word document: its text as simple HTML (sent instead of the file), and its pictures, marked [Picture N] in it */
  text?: string
  pictures?: { mimeType: string; dataBase64: string }[]
}

export type DraftExercise = {
  kind: ExerciseKind
  prompt: string
  payload: Record<string, unknown>
  answerKey: Record<string, unknown>
  points: number
  skill: Skill
  explanation: string
  sourceRef: string | null
  estimatedSeconds: number
  flags: string[]
  aiConfidence: number
  /** Listening: the book's label for the recording ("Track 1.12", "Ex. 3"); null for non-listening items */
  audioLabel?: string | null
  /** Listening: file name of the attached recording this item uses; null while it still needs audio */
  audioFile?: string | null
  /** The reviewer's note for the teacher when it flagged the item instead of fixing it */
  reviewNote?: string | null
  /** A picture from the materials this item needs; the server cuts it out like a screenshot (pictures.ts) */
  imageRef?: ImageRef | null
  /** Vocabulary item: the word it practises; speak = the word students hear (text-to-speech, speech.ts) */
  vocab?: { word: string; stage: 'meet' | 'recall' } | null
  speak?: string | null
  /** Copied from a book: the answer came from the book's answer pages, the recording, or the AI's own solving */
  answerSource?: AnswerSource | null
}

export type AnswerSource = 'answer_key' | 'audio' | 'ai'

/**
 * Where an item's picture is: 1-based material number, the page of a PDF (1 = first page of the file as sent) or
 * the [Picture N] of a Word document, and a 0–1000 box [ymin, xmin, ymax, xmax] on that photo, page or picture
 * ([0, 0, 1000, 1000] = all of it).
 */
export type ImageRef = { material: number; page?: number; picture?: number; box: [number, number, number, number] }

export type DraftAssignment = {
  title: string
  instructions: string
  rationale: string
  contentLanguage: string
  cefrLevel: string | null
  estimatedMinutes: number
  exercises: DraftExercise[]
  /** Digitize mode: book exercises that can't be auto-graded (essay, speaking, drawing…) — listed, never faked */
  skipped?: { ref: string; reason: string }[]
}

/** create = write new homework (materials inspire it); digitize = transcribe the book's own exercises */
export type GenerateMode = 'create' | 'digitize'

export type GenerateInput = {
  mode?: GenerateMode
  teacherText: string
  materials: Material[]
  /**
   * Digitize: the book's answer pages the teacher added beside the exercise pages (DECISIONS.md BM). Read for the
   * answers only: never copied as exercises, never a source of pictures.
   */
  answerPages?: Material[]
  instructionLocale: InstructionLocale
  targetMinutes: number
  difficulty: 1 | 2 | 3 | 4 | 5
  /** Optional skills to emphasise (composer "+" chip) */
  focusSkills?: string[]
  /** Names of real people in this context, stripped before anything leaves the server */
  knownNames?: string[]
  /** Revise an existing draft following the teacher's follow-up message */
  refine?: { previous: DraftAssignment; feedback: string }
  /** Replace one exercise (⟳) */
  single?: { previous: DraftAssignment; index: number; hint: string }
  /**
   * Retrieved from `methodologyDocs` by the caller (@ikhimi/pedagogy's retrieveMethodology, §8.5) —
   * best-effort, may be empty. `generate.ts` stays free of any DB dependency; this is plain data.
   */
  methodologyNotes?: { title: string; body: string }[]
  /** Create mode: the chosen style's knowledge from the owner's Lab (lab.ts): a catalog exam's, or the owner's own methodology */
  style?: StyleKnowledge | null
  /** A plan part's writer: only the style's general points and these skills' */
  styleSkills?: string[]
  /** A plan part's writer: the style's task (Lab blueprint) its part builds toward */
  styleTask?: string | null
  /** Create mode: the language being taught, when the teacher (or our guess) set it */
  language?: LanguageCode | null
  /** Create mode: write in this exam's style (exams.ts), at this level */
  exam?: { id: string; level: string } | null
  /** Create mode: a second pass checks every item and repairs or drops weak ones (DECISIONS.md AO) */
  review?: boolean
  seed?: number
  onProgress?: (stage: ProgressStage) => void
  /** Words can be read aloud (text-to-speech is set up): vocabulary items may ask students to listen */
  speech?: boolean
  /**
   * Create mode: the plan the teacher confirmed (plan.ts). Every part is then written at the same time with exact
   * counts (compose.ts), and onItems hears each part as soon as it is ready.
   */
  plan?: HomeworkPlan | null
  onItems?: (items: DraftExercise[]) => void
}

export type GenerateResult = {
  draft: DraftAssignment
  meta: {
    model: string
    usage: LlmUsage
    dropped: { index: number; reason: string }[]
    trimmedForTime: number
    solveBack: { index: number; agreed: boolean }[]
    /** Review pass: what it kept, fixed, dropped or flagged (absent when it didn't run) */
    review?: { kept: number; fixed: number; dropped: number; flagged: number; failed?: boolean }
    /** Why the review didn't run, when it was on */
    reviewSkipped?: 'slow'
    /** Items the model pointed at a picture itself, and items the locator found one for */
    pictures?: { pointed: number; located: number }
    /** Written from a plan: the plan, and per part how long it took and what it needed */
    plan?: { plan: HomeworkPlan; sections: { id: string; ms: number; asked: number; written: number; topUp: boolean; reviewed: number }[]; vocab: number }
    /** §8.6 gate 6: instructions came back in the requested script */
    instructionsScriptOk: boolean
    raw: unknown
  }
}

// ─── schema the model must fill ─────────────────────────────────────────────

/** Every field an item can have; each kind's schema picks its own (itemSchema below) */
const ITEM_FIELDS: Record<string, Record<string, unknown>> = {
    skill: { type: 'string', enum: [...SKILLS] },
    prompt: { type: 'string', description: 'The question or task line shown to the student' },
    options: { type: 'array', items: { type: 'string' }, description: 'mcq_single / mcq_multi options' },
    correctOptionIndexes: { type: 'array', items: { type: 'integer' }, description: '0-based indexes into options' },
    trueFalseAnswer: { type: 'string', enum: ['true', 'false', 'not_given'] },
    allowNotGiven: { type: 'boolean' },
    gapText: { type: 'string', description: `gap_fill text with one ${BLANK} per blank` },
    gapAnswers: {
      type: 'array',
      items: { type: 'object', properties: { accepted: { type: 'array', items: { type: 'string' } } }, required: ['accepted'] },
      description: 'one entry per blank, in order; list every acceptable variant (contractions etc.)',
    },
    pairs: {
      type: 'array',
      items: { type: 'object', properties: { left: { type: 'string' }, right: { type: 'string' } }, required: ['left', 'right'] },
    },
    orderedItems: { type: 'array', items: { type: 'string' }, description: 'ordering: items in the CORRECT order' },
    acceptedAnswers: { type: 'array', items: { type: 'string' }, description: 'short_answer: all acceptable answers' },
    writingLines: { type: 'integer', description: 'open_writing: how many sentences the student writes (1-20), one box each' },
    writingChecklist: {
      type: 'array',
      items: { type: 'string' },
      description: 'open_writing: 1-4 short points the student must do, shown to them, in the instruction language (e.g. "Use Present Simple", "Write a negative sentence too")',
    },
    writingRubric: {
      type: 'string',
      description: 'open_writing: hidden grading rubric for the AI grader: target structure/vocabulary, what makes a sentence acceptable, which errors count',
    },
    writingExamples: { type: 'array', items: { type: 'string' }, description: 'open_writing: 2-3 model sentences' },
    passageId: { type: 'string', description: 'Reading: id of the passage (from "passages") this item asks about; empty otherwise' },
    imageRef: {
      type: 'object',
      description: 'Only when the item needs a picture from the materials: where it is, so it can be cut out like a screenshot',
      properties: {
        material: { type: 'integer', description: 'Material number as given ("Material 2" → 2)' },
        page: { type: 'integer', description: 'PDF only: the page of that file the picture is on, 1 = the first page of the file as attached' },
        picture: { type: 'integer', description: 'Word document only: N of the [Picture N] the item needs' },
        box: { type: 'array', items: { type: 'integer' }, description: '[ymin, xmin, ymax, xmax], 0–1000 relative to that photo or PDF page, with a generous margin' },
      },
      required: ['material', 'box'],
    },
    essayTaskId: { type: 'string', description: "essay: id of the exam's writing task it practises (from the EXAM STYLE list), empty if none" },
    essayMinLength: { type: 'integer', description: 'essay: minimum length (words, or characters for Korean/Chinese/Japanese)' },
    essayMaxLength: { type: 'integer', description: 'essay: maximum length, 0 if none' },
    essayTaskLabel: { type: 'string', description: 'essay: the task name as the exam calls it, e.g. "IELTS Writing Task 2"' },
    essayRubric: { type: 'string', description: 'essay: what a strong answer to THIS task must do (content points, genre, register), for the grader' },
    essayModelAnswer: { type: 'string', description: 'essay: a model answer at the target level, within the length limits' },
    explanation: { type: 'string', description: 'One or two sentences, in the instruction language, saying why the answer is right and what to review' },
    sourceRef: { type: 'string', description: 'Where in the materials this comes from, e.g. "Page 1, ex. 4b". Empty if not from a material.' },
    listening: { type: 'boolean', description: 'true if the student must listen to a recording to answer' },
    audioLabel: { type: 'string', description: 'listening: the label the book/teacher uses for the recording, e.g. "Track 1.12" or "Ex. 3". Copy it exactly.' },
    audioFile: { type: 'string', description: 'listening: exact file name of the attached audio this item uses; empty if no matching audio is attached' },
    answerSource: { type: 'string', enum: ['answer_key', 'audio', 'ai'], description: 'Where the correct answer came from: the book answer key page, the attached audio, or your own solving' },
    speak: {
      type: 'string',
      description: 'Pronunciation/listening without a recording: exactly the word or short sentence the student HEARS (read aloud by text-to-speech). Never shown as text. Empty otherwise.',
    },
    shadowingLines: {
      type: 'array',
      items: { type: 'string' },
      description: 'shadowing: 2-6 short sentences of one connected text, in order (read aloud: the words or short phrases to read, one per line)',
    },
    readAloud: { type: 'boolean', description: 'shadowing only: true for a READ-ALOUD task (the student reads the lines first, hears the voice after)' },
}

/**
 * One schema per kind, each with only its own fields and those fields REQUIRED. A single flat object with every
 * field optional made the model drop answers (gap_fill without gapAnswers) and fill irrelevant fields with junk
 * on long homework (DECISIONS.md AP).
 */
const COMMON_FIELDS = ['skill', 'prompt', 'explanation', 'sourceRef', 'listening', 'audioLabel', 'audioFile', 'answerSource', 'passageId', 'imageRef', 'speak']
const KIND_FIELDS: Record<ExerciseKind, { fields: string[]; required: string[] }> = {
  mcq_single: { fields: ['options', 'correctOptionIndexes'], required: ['options', 'correctOptionIndexes'] },
  mcq_multi: { fields: ['options', 'correctOptionIndexes'], required: ['options', 'correctOptionIndexes'] },
  true_false: { fields: ['trueFalseAnswer', 'allowNotGiven'], required: ['trueFalseAnswer'] },
  gap_fill: { fields: ['gapText', 'gapAnswers'], required: ['gapText', 'gapAnswers'] },
  matching: { fields: ['pairs'], required: ['pairs'] },
  ordering: { fields: ['orderedItems'], required: ['orderedItems'] },
  short_answer: { fields: ['acceptedAnswers'], required: ['acceptedAnswers'] },
  open_writing: { fields: ['writingLines', 'writingChecklist', 'writingRubric', 'writingExamples'], required: ['writingLines', 'writingRubric'] },
  essay: {
    fields: ['essayTaskId', 'essayMinLength', 'essayMaxLength', 'essayTaskLabel', 'essayRubric', 'essayModelAnswer'],
    required: ['essayMinLength', 'essayRubric'],
  },
  shadowing: { fields: ['shadowingLines', 'readAloud'], required: ['shadowingLines'] },
}
/** speak: items may be heard instead of read (text-to-speech); only where the audio is made (plan parts, vocabulary) */
export function itemSchema(kinds: readonly ExerciseKind[], exclude: string[] = [], opts: { speak?: boolean; require?: string[] } = {}) {
  return {
    anyOf: kinds.map((kind) => {
      const names = [...COMMON_FIELDS, ...KIND_FIELDS[kind].fields].filter((f) => !exclude.includes(f) && (f !== 'speak' || opts.speak))
      return {
        type: 'object',
        properties: { kind: { type: 'string', enum: [kind] }, ...Object.fromEntries(names.map((f) => [f, ITEM_FIELDS[f]])) },
        required: ['kind', 'skill', 'prompt', 'explanation', ...KIND_FIELDS[kind].required, ...(opts.require ?? [])],
      }
    }),
  }
}
// Shadowing needs its lines spoken, which only planned homework does (compose.ts)
export const LLM_ITEM = itemSchema(EXERCISE_KINDS.filter((k) => k !== 'shadowing'))

const LLM_ASSIGNMENT = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    instructions: { type: 'string', description: 'Short instructions for students, in the instruction language' },
    rationale: { type: 'string', description: 'ONE line for the teacher, in the instruction language, naming the method used' },
    contentLanguage: { type: 'string', description: 'ISO code of the language being learned, e.g. en' },
    cefrLevel: { type: 'string' },
    passages: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, title: { type: 'string' }, text: { type: 'string' } },
        required: ['id', 'text'],
      },
      description: 'create mode, reading: short texts written for this homework; items refer to one by passageId',
    },
    teacherSetCount: { type: 'boolean', description: 'true if the teacher asked for a specific number of items, sentences or questions' },
    exercises: { type: 'array', items: LLM_ITEM },
    skipped: {
      type: 'array',
      items: { type: 'object', properties: { ref: { type: 'string' }, reason: { type: 'string' } }, required: ['ref', 'reason'] },
      description: 'digitize mode: book exercises you could not turn into an auto-graded kind (essay, speaking, drawing, pair work…)',
    },
  },
  required: ['title', 'instructions', 'rationale', 'contentLanguage', 'exercises'],
}

/** Digitize copies the book: no AI-graded writing and no invented passages; the book's pictures come along */
const without = (o: Record<string, unknown>, keys: string[]) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)))
const DIGITIZE_ASSIGNMENT = {
  ...LLM_ASSIGNMENT,
  properties: {
    ...without(LLM_ASSIGNMENT.properties, ['passages', 'teacherSetCount']),
    // Every copied answer says where it came from: the teacher sees which ones the AI worked out itself
    exercises: { type: 'array', items: itemSchema(EXERCISE_KINDS.filter((k) => !isAiGraded(k) && k !== 'shadowing'), ['passageId'], { require: ['answerSource'] }) },
  },
}

export const LOCALE_NAME: Record<InstructionLocale, string> = {
  ko: 'Korean (Hangul; polite 해요체 addressed to the student; words of the language being taught stay as they are)',
}

export const DIFFICULTY: Record<number, string> = {
  1: 'very easy — recognition, lots of support',
  2: 'easy',
  3: 'medium — mostly controlled practice with a little freer production',
  4: 'hard — more production, fewer cues',
  5: 'very hard — stretch items, transfer to new contexts',
}

const LISTENING_RULES = `LISTENING
- An item is listening when the student must hear a recording to answer (the book says "Listen…", shows a headphones/CD icon, or a track number).
- Set listening=true and audioLabel to the book's label for the recording exactly as printed (e.g. "Track 1.12", "CD1 12", "Ex. 3"); if there is no track number use the exercise number.
- If an attached audio file is the recording for the item (its file name or content matches the label/exercise), set audioFile to that exact file name and take the answers from what is said in it (answerSource "audio").
- If no matching audio is attached, still write the item with its full structure from the book and leave audioFile empty; give your best-guess answers — the teacher will attach the audio and the answers will be checked against it.
- Audio attached with no book (create mode): write listening items about what is said in it, audioLabel = the file name, audioFile = the file name.`

/** Both modes: the item's picture is cut out of the page like a screenshot (pictures.ts) */
const PICTURE_RULES = `PICTURES
- First decide which exercises you will use. Only then, for each of those items that needs a picture from the materials ("What is in picture 3?", "Describe the room", "Match the words to the pictures"), set imageRef so that part of the page can be cut out like a screenshot and shown to the student above the item.
- imageRef: material = the material number; for a PDF, page = the page of that file (1 = its first page as attached, NOT the number printed on the page); box = [ymin, xmin, ymax, xmax] (0–1000, relative to that photo or PDF page) around the picture or pictures the item needs, with a generous margin, including the numbers or letters printed next to them. A rough box is fine; cutting part of a picture off is not.
- Word document: set picture = N of the [Picture N] the item needs and box = [0, 0, 1000, 1000] (the whole picture), or a smaller box if only part of that picture belongs to the item.
- One box may cover all the pictures of an exercise; several items may point at the same box. Never point to pictures no item uses.
- Students see only the item and its picture: never write "look at the picture" without imageRef.`

export /** Create mode: pronunciation is practised by LISTENING; students are never recorded (decided 2026-10) */
const PRONUNCIATION_RULES = `PRONUNCIATION
- Minimal pairs, stress and dictation are done by listening: set speak to exactly the word or sentence the student hears; a clear voice reads it aloud and it is never shown as text. The prompt, in the instruction language, says what to do ("Listen and choose the word you hear", "Listen and type what you hear") and never contains the spoken word.
- Minimal pairs (mcq_single): 2-3 options that differ in ONE sound Korean speakers confuse in this language (English light/right, fan/pan, very/berry, think/sink, zoo/Sue, ship/sheep, full/pool, cap/cup; Japanese つ/す, おばさん/おばあさん; Chinese zhi/zi, shi/si, lü/lu; German Hölle/Hülle; French vous/vu; Russian был/бил…). speak = the correct option exactly.
- Word stress (mcq_single), for languages with word stress: each option is the word split into syllables with the stressed one in CAPITALS (PHO-to-graph / pho-TO-graph / pho-to-GRAPH; ЗА-мок / за-МОК). speak = the word. Tones (Chinese mā/má/mǎ/mà) and vowel length (Japanese おばさん/おばあさん) work the same way.
- Dictation (short_answer): speak = a word or a short sentence at the students' level; acceptedAnswers lists every correct spelling. The prompt only says to listen and type ("Listen and type what you hear"): never to repeat, say aloud or shadow, and the sentence is never shown.
- Pronunciation parts use only these kinds: mcq_single, short_answer, shadowing. Never ask students to write their own sentences about what they heard or said.
- shadowing: ONE item of 2-6 short natural sentences forming one little text on the lesson's topic, at the students' level, full of the sounds, stress and intonation being practised (shadowingLines, in order). prompt (instruction language): listen to each sentence, then repeat it into the microphone; the AI checks it.
- Read aloud (shadowing with readAloud=true): 3-6 of the lesson's words or short phrases, one per line, that are hard to pronounce; the student reads each aloud first and hears the voice after. prompt: read each word aloud into the microphone.
- Order: the ear first (minimal pairs, stress), then dictation, then read aloud, then shadowing.
- Students speak into the microphone only in shadowing and read-aloud items: their voice is checked by the AI and never stored.`

/** Create mode: a listening part with no recording attached is heard through text-to-speech (speak) */
const SPOKEN_LISTENING_RULES = `LISTENING WITHOUT A RECORDING (a listening part when no audio file fits; a clear voice reads aloud exactly what you put in speak)
- Every item of a listening part is answered by listening. speak = the whole sentence or short text (1-5 sentences) the student hears: never a single stray word, never just the answer, never something the question isn't about.
- Listen and complete (gap_fill): gapText = exactly the spoken sentence(s) with a few words replaced by ${BLANK}; gapAnswers = the words taken out. Prompt: "Listen and fill in the missing words" (instruction language).
- Listen and answer (mcq_single, true_false, short_answer): the question is about what was said (who, what, where, which tense the speaker used); the spoken text is not shown.
- Dictation (short_answer): speak = the sentence; acceptedAnswers = that sentence and its accepted variants.
- A question answered from the written text alone ("choose the correct form", "complete with the verb in brackets") is NOT a listening item: leave speak empty and don't say "listen".
- Students type or choose; never ask them to repeat or say anything aloud here.`

/** Writers get the pronunciation rules only when the homework practises pronunciation */
const practisesPronunciation = (input: GenerateInput) => !!input.plan?.sections.some((s) => s.skill === 'pronunciation') || !!input.focusSkills?.includes('pronunciation')

export function systemPrompt(input: GenerateInput): string {
  if (input.mode === 'digitize') return digitizePrompt(input)
  return `You are 익히미, an expert teacher who turns what was taught today into excellent homework.

OUTPUT: one homework assignment as JSON matching the schema. No prose outside JSON.

LANGUAGES
- Everything the teacher or student READS as instructions (title, instructions, rationale, explanation) is written in ${LOCALE_NAME[input.instructionLocale]}.
- Exercise content (prompts, options, sentences, answers) is in the language being learned (usually the language of the materials; e.g. English lessons → English content).

THE TEACHER'S REQUEST COMES FIRST
- What the teacher wrote is the specification. If they name a number of items or sentences, the exercise types, the skills, the topic, the format or the order, do exactly that, even where it differs from the defaults below.
- The pedagogy defaults below only fill in what the teacher left open. Never drop, shorten or "improve away" something they asked for; never add a part they excluded.
- If they asked for a specific number (e.g. "15 sentences", "10 questions"), deliver that number. The time budget does not override it.
- A number usually describes ONE part of the homework ("also make a 5-sentence drill", "5문장 드릴도 추가해 줘"). Deliver that part exactly, then fill the rest of the time budget with other items on the materials and topic. Only when the number is clearly the whole homework ("just 10 questions", "5문장만", "only this") stop there and set teacherSetCount=true.

PEDAGOGY (defaults)
- Order sections from receptive to productive: recognition/recall first, then controlled practice, then one or two freer items.
- Prefer retrieval practice over re-reading. Mix item kinds (interleave), but keep each item focused on ONE point.
- Difficulty: ${DIFFICULTY[input.difficulty]}.
${
  input.plan
    ? `- The homework was planned with the teacher and is written in parts by several writers at once. You write ONE part: exactly the items and counts asked for it, nothing else. The count is a promise to the teacher: never more, never fewer.
- Where they fit naturally, use the plan's target words in your items (in sentences, options, the passage), so students meet them again in context.`
    : `- Time budget: about ${input.targetMinutes} minutes in total. Typical seconds per item: ${Object.entries(SECONDS_PER_KIND)
    .map(([k, s]) => `${k} ${s}s`)
    .join(', ')}; a gap_fill takes ~15s per short blank and ~40s per whole sentence to type, open_writing ~60s per sentence. Choose the number of items to fit (unless the teacher set the number).`
}

SENTENCE TRANSFORMATION DRILLS (e.g. "make 15 sentences in Present Simple, then negative and question")
- Write the requested number of ORIGINAL base sentences on the topic, each with a different subject and context (I/you/he/she/they, daily life, school, family…), never the same pattern repeated.
- One gap_fill per base sentence (or per 2-3 base sentences for large counts, staying within 30 items): gapText shows the base sentence, then one line per transformation asked, each a whole-sentence blank, e.g. "He plays football on Sundays.\\nNegative: ${BLANK}\\nQuestion: ${BLANK}".
- gapAnswers list EVERY acceptable form: contracted and full ("doesn't" / "does not"), with and without final punctuation is handled for you, short/long question forms if both are correct.
- The same applies to other transformations: tense change, active↔passive, direct↔reported speech, singular↔plural, positive↔comparative.

ESSAYS (essay)
- When the teacher asks for an essay, a letter, a report or another longer piece of writing, or the exam style's writing task, use ONE essay item per writing task: prompt = the full task as the exam words it (situation, question, bullet points), essayTaskLabel, essayMinLength/essayMaxLength, essayRubric (what a strong answer to this task must contain), essayModelAnswer. Put any source the task needs (a chart as a text table, an article to respond to) in "passages" and refer to it with passageId.
- Essays are graded against the exam's official criteria (or a general grid without an exam), by the AI or the teacher. Never split an essay into sentence boxes.

STUDENTS WRITING THEIR OWN SENTENCES (open_writing)
- When the teacher asks students to write, make or compose their OWN sentences or a short text ("write 10 sentences about your family using Present Simple", "use 8 of today's words in sentences"), use open_writing: writingLines = the number of sentences (max 20; for more, split into several open_writing items), writingChecklist = what the student must do, writingRubric = how the AI grader judges each sentence (target structure/words, acceptable variation, which errors count), writingExamples = 2-3 model sentences.
- The student's sentences are graded by AI against the rubric, so make the rubric concrete. Use open_writing only for free production the teacher asked for or that the topic clearly needs; closed kinds stay the default for checking knowledge.

${PICTURE_RULES}
- When the teacher asks for exercises with the pictures ("그림 문제", "그림을 활용해서", "use the pictures", "with pictures"), picture-based items are part of the request: write them (look and answer, what is in picture N, match the words to the pictures, true/false about the picture, describe the picture) with imageRef, as many as the request implies. When the materials are built around pictures (a vocabulary page of labelled pictures, a picture story), use some of them even if the teacher didn't mention it.
- Only a picture that isn't in the materials can't be used: then describe it in words or write a different item.

READING
- Reading comprehension means a text plus questions about it. When the lesson or the teacher calls for reading, write a passage in "passages" (id "p1", "p2"…, 80-250 words at the students' level, on the lesson's topic, original text, no real people) and 3-6 items that refer to it with passageId: main idea, specific details, sequence, vocabulary in context, inference, true/false/not given.
- If a reading text is in the attached materials, you may use it as the passage (copy the needed part exactly) and set sourceRef.
- Questions must be answerable only from the passage, not from general knowledge.

ITEM RULES (hard requirements)
- Exactly one defensible answer for mcq_single; all options similar in length and grammatical form; plausible distractors based on real learner errors; never "all of the above" / "none of the above".
- No item may give away another item's answer.
- gap_fill: prompt is only the instruction; the sentences go in gapText once (never copy them into prompt). Use ${BLANK} for each blank; gapAnswers has one entry per blank listing every acceptable variant (e.g. "didn't go" and "did not go").
- short_answer: 1–15 words; list all acceptable answers.
- matching: 3–8 pairs. ordering: 3–8 items given in the correct order.
- true_false: set allowNotGiven only for reading-comprehension items.
- Kinds other than open_writing and essay must have exactly checkable answers.
- The item shows everything its prompt mentions. "The verb in brackets" → every blank is followed by its verb in brackets ("She ${BLANK} (go) to school."); "the words in the box" → the words are in the prompt; never mention a text, picture, box or recording the student doesn't get.
- Students answer by choosing or typing. Only shadowing items ask them to speak; no other prompt says to repeat, say aloud or shadow.
- If materials are attached, base items on them and fill sourceRef (e.g. "Page 1, ex. 4b"). Preserve the textbook's numbering. Never invent textbook content that is not in the materials; if the teacher asks for more than the materials contain, write new items on the same topic and leave sourceRef empty.
- Never include real people's names; use generic names (Tom, Anna, Minjun, Seoyeon) in examples.
- explanation: 1–2 sentences in the instruction language that say why, and what to review if wrong.
- Never more than 30 items; for long homework prefer richer items (a gap_fill with several gaps, matching with more pairs) over many tiny ones.

${LISTENING_RULES}
${input.plan?.sections.some((sec) => sec.skill === 'listening') ? `\n${SPOKEN_LISTENING_RULES}\n` : ''}${practisesPronunciation(input) ? `\n${PRONUNCIATION_RULES}\n` : ''}${languageSection(input)}${examSection(input)}${methodologySection(input.methodologyNotes)}${labSection(input.style, { skills: input.styleSkills, task: input.styleTask })}`
}

/** Digitize: transcribe the book's own exercises into interactive items. Nothing invented, nothing trimmed. */
function digitizePrompt(input: GenerateInput): string {
  return `You are 익히미. The teacher photographed or uploaded pages of a textbook or workbook and wants students to do EXACTLY those exercises online. You DIGITIZE; you do not create.

OUTPUT: one homework assignment as JSON matching the schema. No prose outside JSON.

LANGUAGES
- title, instructions, rationale and explanation are written in ${LOCALE_NAME[input.instructionLocale]}. Title = the book's unit/lesson name if visible.
- Exercise content is copied from the book in the book's language.

HARD RULES
- Copy every exercise word for word: the book's own instructions go in prompt (prefixed with its number, e.g. "4b. Complete the sentences with the past simple"), and its sentences, options and word boxes exactly as printed. Never paraphrase, "improve", add, merge or drop items. Keep the book's order and numbering.
- If the teacher's note limits the scope (e.g. "only 4a and 5", "page 12"), digitize only that; otherwise digitize every exercise on the pages.
- Map each book exercise to the closest kind, keeping it as ONE item where the kind allows it:
  · several gaps in sentences/a text → ONE gap_fill with ${BLANK} per gap (copy the word box into the prompt if the book has one);
  · choose/circle the correct word in each sentence → one mcq_single per sentence, or ONE gap_fill when options are shown inline;
  · match A–B → ONE matching item; put in order → ONE ordering item; true/false (/not given) → one true_false per statement;
  · answer a question in a few words → short_answer (list every acceptable answer).
- A single book exercise that becomes several items: same sourceRef on each, prompt of the first item carries the book instruction.
- sourceRef on every item: page and exercise as printed, e.g. "Page 12, ex. 4b".
${answersRule(input)}
- Exercises that cannot be auto-graded (free writing/essay, speaking, pair/group work, drawing, projects, open opinion questions) go in "skipped" with ref (e.g. "Page 12, ex. 6") and a short reason in the instruction language. Never turn them into something else.
- explanation: 1 sentence in the instruction language saying why the answer is right.
- rationale: one line for the teacher saying what was digitized (e.g. "12쪽: 4a, 4b, 5번").

${PICTURE_RULES}
- Many book exercises use pictures (look and answer, label the picture, match the words to the pictures, describe). Digitize them like any other exercise, with imageRef on each item that needs the picture. Never skip an exercise only because it has pictures, and never replace a picture with a description.

${LISTENING_RULES}`
}

/** Where a copied exercise's answers come from: the teacher's answer pages, or the AI's own careful solving */
function answersRule(input: GenerateInput): string {
  if (!input.answerPages?.length) {
    return '- Answers: if one of the materials is a page of the book\'s answer key, take the answers from it (answerSource "answer_key") and do not copy that page as exercises. Otherwise solve carefully yourself (answerSource "ai"). List every acceptable variant.'
  }
  return `- Answers: the teacher attached the book's ANSWER KEY ("Answer key 1"… after the materials). ${ANSWER_KEY_RULE} An exercise the key covers takes its answers from it (answerSource "answer_key"), listening ones included. One it doesn't cover, or whose key answers clearly don't fit: solve carefully yourself (answerSource "ai"). Never copy the answer-key pages as exercises, and never point imageRef at them.`
}

/** The language being taught, when known: exercise content is written in it */
function languageSection(input: GenerateInput): string {
  const rules = answerVariantRules(input.language ?? input.plan?.contentLanguage)
  if (!input.language) return rules ? `\n${rules}\n` : ''
  return `\nLANGUAGE BEING TAUGHT: ${LANGUAGE_NAME[input.language]}. All exercise content (texts, questions, options, answers) is in ${LANGUAGE_NAME[input.language]}; instructions, rationale and explanations stay in the instruction language. contentLanguage = "${input.language}".\n${rules ? `${rules}\n` : ''}`
}

/**
 * Which correct answers to list for typed items, per language (Create mode). What the checker already forgives
 * (answer-lang.ts: Korean spacing, Chinese scripts, kana, Arabic vowel marks) needs no listing.
 */
const ANSWER_VARIANTS: Partial<Record<LanguageCode, string>> = {
  ko: "- Korean: when the task allows any speech style, list the polite (-아요/어요), formal (-ㅂ니다/습니다) and plain (-ㄴ다) forms; list both particles where either is correct (은/는 or 이/가, 저는 or 나는). Spacing differences are accepted automatically: don't list them. A different ending or tense is a different answer.",
  zh: '- Chinese: write characters in simplified Chinese (traditional is accepted automatically). For pinyin answers write tone marks (nǐ hǎo); add a toneless variant only when the task does not test tones. List synonyms only when both fit the sentence.',
  ja: '- Japanese: list the kanji and the kana spelling when the student may write either (学校 / がっこう), and both the です/ます and the plain form when the task allows either style. Hiragana/katakana and full/half-width are accepted automatically.',
  ar: '- Arabic: write answers without vowel marks unless the task tests vowelling (marks, the alif/hamza forms, ة/ه and ى/ي are accepted automatically). List common synonyms the level allows.',
}

export function answerVariantRules(language: string | null | undefined): string {
  const rule = ANSWER_VARIANTS[(language ?? '').slice(0, 2).toLowerCase() as LanguageCode]
  return rule ? `ACCEPTED ANSWERS (gapAnswers, acceptedAnswers)\n${rule}` : ''
}

/** The selected exam's formats, writing tasks and level (exams.ts). Create mode only. */
function examSection(input: GenerateInput): string {
  const exam = examById(input.exam?.id)
  if (!exam || input.mode === 'digitize') return ''
  const level = input.exam?.level || exam.defaultLevel
  const writing = examWriting(exam, level)
  return `
EXAM STYLE: ${exam.name}, level ${level}
The students are preparing for ${exam.name}, level ${level}. Items in a real task format follow it exactly: its instruction wording (in the exam's language), its question order conventions and its distractor style; name the task type at the start of the item's prompt, e.g. "Part 4 — Key word transformation" or "Questions 1–5 — True/False/Not Given". Easier steps toward a task and preparation exercises (vocabulary, grammar, paraphrasing) are written as good practice for the level, not dressed up as exam questions; the plan's part says which it is. Never reproduce real past papers. The teacher's request still decides what to practise and how much.
${exam.guidance}
${
  writing
    ? `Writing tasks of this exam (for essay items, set essayTaskId): ${writing.tasks.map((t) => `${t.id} = ${t.name}, ${t.min}${t.max ? `–${t.max}` : '+'} ${writing.scale.unit === 'chars' ? 'characters' : 'words'}: ${t.about}`).join('; ')}.`
    : `This exam${exam.writing ? ' at this level' : ''} has no writing section: do not add essays unless the teacher explicitly asks for writing.`
}
`
}

/** Essay grading setup for this generation: the exam's grid, or a general one */
export function essayContext(input: GenerateInput) {
  const exam: Exam | null = input.mode === 'digitize' ? null : examById(input.exam?.id)
  const level = input.exam?.level || exam?.defaultLevel || ''
  const writing = examWriting(exam, level)
  return {
    scale: writing?.scale ?? GENERIC_WRITING,
    rubric: writing?.rubric ?? 'Judge against CEFR writing descriptors for the students\' level: task achievement, organisation and coherence, vocabulary, grammar.',
    tasks: writing?.tasks ?? [],
    examLabel: exam ? `${exam.name} · ${level}` : '',
  }
}
export type EssayContext = ReturnType<typeof essayContext>

/** §8.5: retrieved methodologyDocs relevant to this request, if any (best-effort, may be empty). */
function methodologySection(notes: GenerateInput['methodologyNotes']): string {
  if (!notes?.length) return ''
  return `\nMETHODOLOGY NOTES (apply these; each ends with a specific failure pattern to avoid)
${notes.map((n) => `- ${n.title}: ${n.body}`).join('\n')}`
}

/** The materials as the model sees them, numbered; the review pass gets exactly the same */
export function materialParts(materials: Material[]): LlmPart[] {
  const parts: LlmPart[] = []
  materials.forEach((m, i) => {
    // A Word document goes as its text, then its pictures, each labelled with the number used in the text
    if (m.text !== undefined) {
      parts.push({ text: `Material ${i + 1} (Word document "${m.label}"${m.pictures?.length ? `; its pictures are marked [Picture N] in the text and attached after it` : ''}):\n${m.text}` })
      m.pictures?.forEach((pic, j) => {
        parts.push({ text: `Material ${i + 1}, Picture ${j + 1}:` })
        parts.push({ mimeType: pic.mimeType, dataBase64: pic.dataBase64 })
      })
      return
    }
    const what = m.mimeType.startsWith('image/')
      ? 'photo'
      : m.mimeType.startsWith('audio/')
        ? `audio file named "${m.label}"`
        : m.mimeType === 'application/pdf' && m.pages
          ? `PDF, ${m.pages} page${m.pages > 1 ? 's' : ''}${m.pageNumbers ? `: pages ${m.pageNumbers.join(', ')} of the teacher's file, sent as pages 1–${m.pages}` : ''}`
          : 'file'
    parts.push({ text: `Material ${i + 1} (${what}):` })
    parts.push({ mimeType: m.mimeType, dataBase64: m.dataBase64 })
  })
  return parts
}

function userParts(input: GenerateInput): LlmPart[] {
  const { text: teacher } = sanitizeForLLM(input.teacherText, { knownNames: input.knownNames })
  const parts: LlmPart[] = []
  parts.push(...materialParts(input.materials))
  if (input.single) {
    const old = input.single.previous.exercises[input.single.index]
    parts.push({
      text: `Current assignment (for context):\n${JSON.stringify(summarize(input.single.previous))}\n\nWrite exactly ONE new exercise to replace item #${input.single.index + 1}${
        old ? ` (kind ${old.kind}: ${JSON.stringify(old.prompt)})` : ''
      }. Keep the same kind and skill unless the hint says otherwise. It must be different from every existing item.\nTeacher's hint: ${
        sanitizeForLLM(input.single.hint || 'make a better version', { knownNames: input.knownNames }).text
      }\nReturn the whole assignment object with "exercises" containing only this one new exercise.`,
    })
  } else if (input.refine) {
    parts.push({
      text: `Previous draft:\n${JSON.stringify(summarize(input.refine.previous))}\n\nThe teacher asked for changes: "${
        sanitizeForLLM(input.refine.feedback, { knownNames: input.knownNames }).text
      }"\nOriginal request: "${teacher}"\nReturn the complete revised assignment. Keep items that are still good.`,
    })
  } else {
    if (input.mode === 'digitize') {
      parts.push(...answerPageParts(input.answerPages ?? []))
      parts.push({ text: `Teacher's note: "${teacher || '(none — digitize every exercise on the pages)'}"\n\nDigitize the exercises.` })
    } else {
      const focus = input.focusSkills?.length ? `\nFocus mainly on these skills: ${input.focusSkills.join(', ')}.` : ''
      parts.push({ text: `The teacher wrote: "${teacher}"${focus}\n\nCreate the homework.` })
    }
  }
  return parts
}

/** Compact, key-including view of a draft for refine/regenerate context. */
function summarize(d: DraftAssignment) {
  return {
    title: d.title,
    exercises: d.exercises.map((e, i) => ({ n: i + 1, kind: e.kind, prompt: e.prompt, payload: e.payload, answerKey: e.answerKey })),
  }
}

// ─── conversion + local checks ──────────────────────────────────────────────

export type LlmItem = {
  kind?: string
  skill?: string
  prompt?: string
  options?: string[]
  correctOptionIndexes?: number[]
  trueFalseAnswer?: string
  allowNotGiven?: boolean
  gapText?: string
  gapAnswers?: { accepted?: string[] }[]
  pairs?: { left?: string; right?: string }[]
  orderedItems?: string[]
  acceptedAnswers?: string[]
  writingLines?: number
  writingChecklist?: string[]
  writingRubric?: string
  writingExamples?: string[]
  passageId?: string
  imageRef?: { material?: number; page?: number; picture?: number; box?: number[] }
  essayTaskId?: string
  essayMinLength?: number
  essayMaxLength?: number
  essayTaskLabel?: string
  essayRubric?: string
  essayModelAnswer?: string
  explanation?: string
  sourceRef?: string
  listening?: boolean
  audioLabel?: string
  audioFile?: string
  answerSource?: string
  speak?: string
  shadowingLines?: string[]
  readAloud?: boolean
}

const ALL_NONE = /\b(all|none|both|neither) of (the|these) (above|options)\b|все (вышеперечисленн|перечисленн)|ничего из|위의 모든|위 보기 모두|모두 정답|모두 맞음|정답 없음|해당 없음/i

export function convertItem(
  item: LlmItem,
  seed: number,
  passages: Record<string, string> = {},
  essay: EssayContext = { scale: GENERIC_WRITING, rubric: 'Judge against CEFR writing descriptors.', tasks: [], examLabel: '' },
): { ok: true; ex: DraftExercise } | { ok: false; reason: string } {
  const kind = item.kind as ExerciseKind
  if (!EXERCISE_KINDS.includes(kind)) return { ok: false, reason: `unknown kind ${item.kind}` }
  const skill = (SKILLS as readonly string[]).includes(item.skill ?? '') ? (item.skill as Skill) : 'grammar'
  let prompt = (item.prompt ?? '').trim()
  const flags: string[] = []
  const listening = !!item.listening || !!item.audioLabel?.trim() || !!item.audioFile?.trim()
  const audioFile = listening ? item.audioFile?.trim() || null : null
  if (listening && !audioFile) {
    // Answers of a listening item are only knowable from the recording: keep the structure, mark it waiting.
    item = withPlaceholderAnswers(item)
    flags.push('needs_audio')
  }
  let payload: unknown
  let key: unknown

  switch (kind) {
    case 'mcq_single':
    case 'mcq_multi': {
      const options = (item.options ?? []).map((o) => o.trim()).filter(Boolean)
      const correct = [...new Set(item.correctOptionIndexes ?? [])].filter((i) => i >= 0 && i < options.length)
      if (kind === 'mcq_single' && correct.length !== 1) return { ok: false, reason: 'mcq_single needs exactly one correct option' }
      if (correct.length === 0) return { ok: false, reason: 'no correct option' }
      // Shuffle so the correct answer isn't always first (models love position A)
      const order = seededShuffle(options.map((_, i) => i), seed)
      const shuffled = order.map((i) => options[i]!)
      const remap = (i: number) => order.indexOf(i)
      payload = { options: shuffled }
      key = kind === 'mcq_single' ? { correct: remap(correct[0]!) } : { correct: correct.map(remap).sort() }
      const norm = shuffled.map((o) => o.toLowerCase().replace(/\s+/g, ' '))
      if (new Set(norm).size !== norm.length) flags.push('duplicate_options')
      if (shuffled.some((o) => ALL_NONE.test(o))) flags.push('all_none_of_above')
      const lens = shuffled.map((o) => o.length)
      const correctLen = kind === 'mcq_single' ? lens[remap(correct[0]!)]! : 0
      const others = lens.filter((_, i) => kind === 'mcq_single' && i !== remap(correct[0]!))
      const avg = others.reduce((a, b) => a + b, 0) / Math.max(1, others.length)
      if (kind === 'mcq_single' && correctLen > 12 && correctLen > avg * 1.8) flags.push('length_cue')
      break
    }
    case 'true_false': {
      const answer = item.trueFalseAnswer ?? ''
      if (!['true', 'false', 'not_given'].includes(answer)) return { ok: false, reason: 'true_false without answer' }
      const allowNotGiven = !!item.allowNotGiven || answer === 'not_given'
      payload = { allowNotGiven }
      key = { answer }
      break
    }
    case 'gap_fill': {
      const text = (item.gapText ?? '').replace(/_{3,}/g, BLANK)
      const blanks = (item.gapAnswers ?? []).map((g) => (g.accepted ?? []).map((s) => s.trim()).filter(Boolean))
      if (countBlanks(text) === 0) return { ok: false, reason: 'gap_fill without blanks' }
      if (countBlanks(text) !== blanks.length || blanks.some((b) => b.length === 0)) return { ok: false, reason: 'gap_fill blanks/answers mismatch' }
      payload = { text, exactSpelling: false }
      key = { blanks }
      prompt = withoutRepeatedLines(prompt, text)
      break
    }
    case 'matching': {
      const pairs = (item.pairs ?? []).filter((p) => p.left?.trim() && p.right?.trim())
      if (pairs.length < 2) return { ok: false, reason: 'matching needs ≥2 pairs' }
      const order = seededShuffle(pairs.map((_, i) => i), seed)
      payload = { left: pairs.map((p) => p.left!.trim()), right: order.map((i) => pairs[i]!.right!.trim()) }
      key = { pairs: pairs.map((_, i) => order.indexOf(i)) }
      break
    }
    case 'ordering': {
      const items = (item.orderedItems ?? []).map((s) => s.trim()).filter(Boolean)
      if (items.length < 2) return { ok: false, reason: 'ordering needs ≥2 items' }
      let order = seededShuffle(items.map((_, i) => i), seed)
      if (order.every((v, i) => v === i)) order = [...order.slice(1), order[0]!] // never already solved
      payload = { items: order.map((i) => items[i]!) }
      key = { order: items.map((_, i) => order.indexOf(i)) }
      break
    }
    case 'short_answer': {
      const accepted = (item.acceptedAnswers ?? []).map((s) => s.trim()).filter(Boolean)
      if (!accepted.length) return { ok: false, reason: 'short_answer without accepted answers' }
      payload = { exactSpelling: false }
      key = { accepted }
      break
    }
    case 'open_writing': {
      const rubric = (item.writingRubric ?? '').trim()
      if (!rubric) return { ok: false, reason: 'open_writing without rubric' }
      if (listening) return { ok: false, reason: 'open_writing cannot be a listening item' }
      payload = {
        lines: Math.min(20, Math.max(1, Math.round(item.writingLines ?? 5))),
        checklist: (item.writingChecklist ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 6),
      }
      key = { rubric, examples: (item.writingExamples ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 5) }
      break
    }
    case 'essay': {
      if (listening) return { ok: false, reason: 'essay cannot be a listening item' }
      const task = essay.tasks.find((t) => t.id === item.essayTaskId?.trim())
      const min = Math.round(item.essayMinLength || task?.min || 150)
      const maxRaw = Math.round(item.essayMaxLength || task?.max || 0)
      const taskRubric = (item.essayRubric ?? '').trim()
      payload = {
        taskLabel: (item.essayTaskLabel ?? '').trim() || task?.name || '',
        min: Math.min(2000, Math.max(10, min)),
        ...(maxRaw > min ? { max: Math.min(3000, maxRaw) } : {}),
        scale: essay.scale,
        grader: 'ai',
        exam: essay.examLabel,
      }
      key = { rubric: [taskRubric, essay.rubric].filter(Boolean).join('\n\n'), modelAnswer: (item.essayModelAnswer ?? '').trim() }
      break
    }
    case 'shadowing': {
      if (listening) return { ok: false, reason: 'shadowing has its own voice' }
      const lines = (item.shadowingLines ?? []).map((l) => l.trim()).filter(Boolean).slice(0, 8)
      if (!lines.length) return { ok: false, reason: 'shadowing without lines' }
      payload = { lines: lines.map((text) => ({ text: text.slice(0, 300) })), mode: item.readAloud ? 'read' : 'shadow' }
      key = {}
      break
    }
  }
  // Reading: the shared passage travels with each item that asks about it
  const passage = item.passageId?.trim() ? passages[item.passageId.trim()] : undefined
  if (passage) payload = { ...(payload as object), passage }

  const p = payloadSchemas[kind].safeParse(payload)
  const k = keySchemas[kind].safeParse(key)
  if (!p.success || !k.success) return { ok: false, reason: 'schema' }
  if (!prompt && kind !== 'gap_fill') return { ok: false, reason: 'empty prompt' }
  const pd = p.data as Record<string, unknown>
  const kd = k.data as Record<string, unknown>

  return {
    ok: true,
    ex: {
      kind,
      prompt,
      payload: pd,
      answerKey: kd,
      points: pointsFor(kind, pd),
      skill,
      explanation: (item.explanation ?? '').trim(),
      sourceRef: item.sourceRef?.trim() || null,
      audioLabel: listening ? item.audioLabel?.trim() || audioFile || item.sourceRef?.trim() || null : null,
      audioFile,
      estimatedSeconds: estimateSeconds(kind, pd, kd) + (listening ? 60 : 0),
      imageRef: cleanImageRef(item.imageRef),
      // Heard, not read: an item that plays a word or sentence (never a recording item, which has its own audio)
      speak: !listening && kind !== 'shadowing' && item.speak?.trim() ? item.speak.trim().slice(0, 300) : null,
      flags,
      aiConfidence: flags.length ? 0.6 : 0.85,
    },
  }
}

/** An instruction to listen ("Listen and…", "듣고 고르세요", "Прослушайте"), not the verb inside exercise content */
const LISTEN_INSTRUCTION = /\b(listen (and|to the|carefully|again)|(what|words?|sentences?) you hear|you will hear)\b|прослушайте|послушайте|слушайте|услышите|услышали|аудиозапис|들으세요|듣고|들은 (단어|문장|내용)|들리는|잘 들어|들어 보세요/i
/** Asking the student to speak, which only shadowing and read-aloud items can check */
const SPEAK_INSTRUCTION = /shadow|aloud|out loud|repeat (it|after|the|each)|say (it|the|each)|вслух|повторите|произнесите|따라 ?말|따라 ?읽|소리 ?내어|소리 ?내서|큰 ?소리로|말해 보세요|발음해 보세요|쉐도잉/i
/** The instruction is the prompt's first line; the lines after it are exercise content, where "listen" is just a word */
const instructionLine = (prompt: string) => prompt.trim().split('\n')[0] ?? ''
/** "The verb in brackets": the item must then show a word in brackets */
const BRACKETS_MENTIONED = /bracket|parenthes|скобк|괄호|klammer|parantez/i

/** Text compared as heard: case, punctuation and syllable hyphens (com-PLAIN) don't count */
const heard = (s: string) =>
  s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[-‐‑·]/g, '')
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * Why an item the student hears doesn't fit what it shows, or null. The voice must say what the student needs to
 * answer: the word to choose or type, or the sentence whose missing words they fill in. A voice reading the answer
 * to a written grammar question, or one stray word, is wrong.
 */
function speechMismatch(e: DraftExercise): string | null {
  if (!e.speak) return null
  const said = heard(e.speak)
  const p = e.payload as { options?: string[]; text?: string }
  const k = e.answerKey as { correct?: number | number[]; accepted?: string[]; blanks?: string[][] }
  const blankInPrompt = e.prompt.includes(BLANK) || /_{3,}/.test(e.prompt)
  switch (e.kind) {
    case 'mcq_single': {
      if (blankInPrompt) return 'a written question with a blank does not need a voice'
      // Stress options all read the same word (com-PLAIN / COM-plain): only one that differs from the right one is wrong
      const options = p.options ?? []
      const right = options[k.correct as number]
      if (right !== undefined && heard(right) !== said && options.some((o) => heard(o) === said)) return 'the voice says a wrong option'
      return null
    }
    case 'mcq_multi':
    case 'true_false':
      return blankInPrompt ? 'a written question with a blank does not need a voice' : null
    case 'short_answer':
      if (blankInPrompt) return 'a written question with a blank does not need a voice'
      // Dictation types what it hears; a question about a heard sentence needs a sentence, not one word
      if (k.accepted?.some((a) => heard(a) === said) || said.split(' ').length >= 4) return null
      return 'the voice says one word that is not the answer to type'
    case 'gap_fill': {
      // Every line with a blank, filled in, must be heard in full
      let b = 0
      for (const line of (p.text ?? '').split('\n')) {
        if (!line.includes(BLANK)) continue
        const filled = line.replace(/^\s*(\d+|[a-z])[.)]\s*/i, '').split(BLANK).reduce((acc, part, j) => (j === 0 ? part : `${acc}${k.blanks?.[b++]?.[0] ?? ''}${part}`))
        if (!said.includes(heard(filled))) return 'the voice does not say the sentence with the missing words'
      }
      return null
    }
    default:
      return 'this kind of item cannot play a voice'
  }
}

/**
 * Create mode: what a student would find broken in a written item, or null. Fixable things are fixed in place (a
 * voice a written item doesn't need is removed); the rest returns a reason and the item is written again.
 */
export function itemProblem(e: DraftExercise): string | null {
  const recording = !!e.audioLabel || !!e.audioFile
  const mismatch = speechMismatch(e)
  if (mismatch) {
    if (LISTEN_INSTRUCTION.test(instructionLine(e.prompt))) return mismatch
    e.speak = null
  }
  if (!e.speak && !recording && e.kind !== 'shadowing' && LISTEN_INSTRUCTION.test(instructionLine(e.prompt))) return 'asks the student to listen but plays nothing'
  if (e.kind !== 'shadowing' && SPEAK_INSTRUCTION.test(instructionLine(e.prompt))) return 'asks the student to speak or shadow, but they can only type or choose here'
  if (e.kind === 'gap_fill' && BRACKETS_MENTIONED.test(e.prompt) && !/[([（]/.test((e.payload.text as string) ?? '')) {
    return 'the prompt mentions words in brackets but the sentences show none'
  }
  return null
}

/** Words that show an item is about a picture, in the languages teachers and books use */
const PICTURE_WORDS = /\b(pictures?|photos?|images?|illustrations?|drawings?)\b|картин|рисун|фото|изображ|그림|사진|이미지|图|絵|写真|Bild|image|imagen|resim/i

/** The student-facing text of an item, for spotting picture references */
function itemText(e: DraftExercise): string {
  const p = e.payload as { text?: string; options?: string[]; items?: string[]; left?: string[]; right?: string[] }
  return [e.prompt, p.text, ...(p.options ?? []), ...(p.left ?? []), ...(p.right ?? [])].filter(Boolean).join('\n')
}

const LOCATE_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          n: { type: 'integer' },
          needed: { type: 'boolean', description: 'true if the student must see a picture to do this item' },
          found: { type: 'boolean', description: 'true if that picture is in the materials' },
          material: { type: 'integer' },
          page: { type: 'integer', description: 'PDF: page of that file, 1 = first page as attached' },
          picture: { type: 'integer', description: 'Word document: N of [Picture N]' },
          box: { type: 'array', items: { type: 'integer' }, description: '[ymin, xmin, ymax, xmax] 0–1000 with a generous margin' },
        },
        required: ['n', 'needed', 'found'],
      },
    },
  },
  required: ['items'],
}

/**
 * Writing twenty items and giving picture coordinates in the same answer is unreliable: the model writes "Look at
 * the picture" and leaves imageRef out. So a second, focused call does only this: for every item that mentions a
 * picture without pointing at one, find that picture in the materials. An item that needs a picture that can't be
 * found is flagged image_missing (settlePictures takes it out); one that turns out not to need a picture is left.
 */
export async function locatePictures(llm: LlmProvider, input: GenerateInput, exercises: DraftExercise[]): Promise<{ usage: LlmUsage; located: number } | null> {
  const todo = exercises
    .map((e, i) => ({ e, n: i + 1 }))
    .filter(({ e }) => !e.imageRef && !(e.payload as { imageId?: string }).imageId && (e.flags.includes('image_missing') || PICTURE_WORDS.test(itemText(e))))
  if (!todo.length) return null
  const visual = input.materials.some((m) => !m.mimeType.startsWith('audio/'))
  // A revision or a regenerated item has no files: keepPictures may still give it its old picture
  if (!visual) return null
  let res: { json: unknown; usage: LlmUsage }
  try {
    res = await llm.generateJson({
      task: 'review',
      effort: 'low',
      maxOutputTokens: 4096,
      system: `You find pictures in teaching materials. For each numbered item: decide whether the student must see a picture to do it (needed). If needed, find that picture (or the group of pictures the item uses) in the materials and give its location: material number; for a PDF the page (1 = first page of that file as attached, not the printed number); for a Word document picture = N of [Picture N] and box [0, 0, 1000, 1000]; box = [ymin, xmin, ymax, xmax] (0–1000 relative to that photo, page or picture) with a generous margin, including the numbers or labels printed next to the pictures. A rough box is fine; cutting part of a picture off is not. found=false only if the picture is not in the materials. Return JSON only.`,
      parts: [...materialParts(input.materials), { text: JSON.stringify(todo.map(({ e, n }) => ({ n, kind: e.kind, text: itemText(e), sourceRef: e.sourceRef, answer: e.answerKey }))) }],
      schema: LOCATE_SCHEMA,
      temperature: 0,
    })
  } catch (e) {
    console.warn('[pictures] locating failed', e)
    for (const { e: ex } of todo) if (!ex.flags.includes('image_missing')) ex.flags.push('image_missing')
    return null
  }
  const found = new Map(((res.json as { items?: (LlmItem['imageRef'] & { n?: number; needed?: boolean; found?: boolean })[] }).items ?? []).map((x) => [x.n, x]))
  let located = 0
  for (const { e, n } of todo) {
    const r = found.get(n)
    // Not asked back about, or no picture needed: leave the item as it is
    if (!r || r.needed === false) continue
    const ref = r.found ? cleanImageRef(r) : null
    if (ref && pictureAvailable(ref, input.materials)) {
      e.imageRef = ref
      e.flags = e.flags.filter((f) => f !== 'image_missing')
      located++
    } else if (!e.flags.includes('image_missing')) e.flags.push('image_missing')
  }
  console.info(`[pictures] located ${located} of ${todo.length} items that mention a picture`)
  return { usage: res.usage, located }
}

/**
 * A picture we can't cut out of the materials: the item is flagged and goes (settlePictures), never shown without
 * it. A recording that isn't attached can't be linked: the item waits for the teacher's audio.
 */
export function checkAttachments(e: DraftExercise, materials: Material[]) {
  if (e.imageRef && !pictureAvailable(e.imageRef, materials)) {
    e.imageRef = null
    e.flags.push('image_missing')
  }
  if (e.audioFile && !materials.some((m) => m.label === e.audioFile && m.mimeType.startsWith('audio/'))) {
    e.audioFile = null
    e.flags.push('needs_audio')
  }
}

/** Whole photo or page: the fallback when the model's box is unusable */
export const WHOLE_PAGE: ImageRef['box'] = [0, 0, 1000, 1000]

/**
 * A usable picture reference. The item needs a picture either way, so a box we can't use (missing, reversed,
 * smaller than 3 % × 3 %) becomes the whole page: a screenshot of the page still makes the item doable.
 */
function cleanImageRef(r: LlmItem['imageRef']): DraftExercise['imageRef'] {
  if (!r || !Number.isInteger(r.material) || (r.material ?? 0) < 1) return null
  const page = {
    ...(Number.isInteger(r.page) && r.page! >= 1 ? { page: r.page! } : {}),
    ...(Number.isInteger(r.picture) && r.picture! >= 1 ? { picture: r.picture! } : {}),
  }
  const v = Array.isArray(r.box) && r.box.length === 4 ? r.box.map((x) => Math.max(0, Math.min(1000, Math.round(Number(x))))) : []
  if (v.some((x) => !Number.isFinite(x)) || v.length !== 4) return { material: r.material!, ...page, box: WHOLE_PAGE }
  const [y0, y1] = [Math.min(v[0]!, v[2]!), Math.max(v[0]!, v[2]!)]
  const [x0, x1] = [Math.min(v[1]!, v[3]!), Math.max(v[1]!, v[3]!)]
  if (!(y1 - y0 >= 30 && x1 - x0 >= 30)) return { material: r.material!, ...page, box: WHOLE_PAGE }
  return { material: r.material!, ...page, box: [y0, x0, y1, x1] }
}

/**
 * Can this item's picture be cut out of the materials we sent? A photo always; a PDF when the page is in the file;
 * a Word document when it has that [Picture N].
 * A PDF page given as the book's printed number (a page the teacher picked from a longer file) is mapped to its
 * position in the file we sent; a missing page means the first.
 */
export function pictureAvailable(ref: ImageRef, materials: Material[]): boolean {
  const m = materials[ref.material - 1]
  if (!m) return false
  if (m.pictures) return !!ref.picture && !!m.pictures[ref.picture - 1]
  if (m.mimeType.startsWith('image/')) return true
  if (m.mimeType !== 'application/pdf') return false
  const count = m.pages ?? 1
  if (!ref.page) ref.page = 1
  if (ref.page > count) {
    const at = m.pageNumbers?.indexOf(ref.page) ?? -1
    if (at < 0) return false
    ref.page = at + 1
  }
  return true
}

/**
 * A revision or a regenerated item is written without the original files, so it can't point at a picture again.
 * Items keep the picture they already had: a regenerated item takes the one of the item it replaces; in a
 * revision, an item with the same prompt, or else from the same book exercise (sourceRef), takes that one.
 */
function keepPictures(exercises: DraftExercise[], input: GenerateInput) {
  const pic = (e: DraftExercise | undefined) => (e?.payload as { imageId?: string } | undefined)?.imageId
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')
  let find: (e: DraftExercise) => string | undefined
  if (input.single) {
    const old = pic(input.single.previous.exercises[input.single.index])
    find = () => old
  } else if (input.refine) {
    const before = input.refine.previous.exercises.filter((e) => pic(e))
    find = (e) => pic(before.find((b) => norm(b.prompt) === norm(e.prompt))) ?? (e.sourceRef ? pic(before.find((b) => b.sourceRef === e.sourceRef)) : undefined)
  } else return
  for (const e of exercises) {
    if (pic(e) || (e.imageRef && !e.flags.includes('image_missing'))) continue
    const id = find(e)
    if (!id) continue
    e.payload = { ...e.payload, imageId: id }
    e.imageRef = null
    e.flags = e.flags.filter((f) => f !== 'image_missing')
  }
}

const NO_PICTURE: Record<InstructionLocale, string> = {
  ko: '문제의 그림을 잘라내지 못했어요',
}

/**
 * Items that need a picture we couldn't get (flag image_missing) are never shown broken: Create drops them,
 * Digitize lists the book exercise under "skipped" with the reason. The homework is never emptied: if every
 * item lacks its picture, they stay, flagged, for the teacher to see.
 */
export function settlePictures(draft: DraftAssignment, mode: GenerateMode, locale: InstructionLocale): number {
  const missing = draft.exercises.filter((e) => e.flags.includes('image_missing'))
  if (!missing.length || missing.length === draft.exercises.length) return 0
  draft.exercises = draft.exercises.filter((e) => !e.flags.includes('image_missing'))
  if (mode === 'digitize') {
    const refs = new Set<string>()
    for (const e of missing) {
      const ref = e.sourceRef ?? e.prompt.slice(0, 60)
      if (refs.has(ref)) continue
      refs.add(ref)
      draft.skipped = [...(draft.skipped ?? []), { ref, reason: NO_PICTURE[locale] }]
    }
  }
  draft.estimatedMinutes = Math.max(1, Math.round(draft.exercises.reduce((s, e) => s + e.estimatedSeconds, 0) / 60))
  return missing.length
}

/**
 * The model sometimes copies the gap text into the prompt as well, so students read every sentence twice. Lines
 * of the prompt that are gap-text lines (blanks ignored) are dropped; the instruction line stays.
 */
export function withoutRepeatedLines(prompt: string, gapText: string): string {
  const norm = (l: string) => l.replace(/_{2,}|\{\{blank\}\}/gi, '').replace(/[\s.,!?]+/g, '').toLowerCase()
  const inText = new Set(gapText.split('\n').map(norm).filter((l) => l.length >= 4))
  if (!inText.size) return prompt
  const kept = prompt.split('\n').filter((l) => !inText.has(norm(l)))
  return kept.join('\n').trim() || prompt
}

/** Weight of an item: one per blank or sentence, an essay 10, a matching/ordering 2, anything else 1 */
function pointsFor(kind: ExerciseKind, pd: Record<string, unknown>) {
  if (kind === 'gap_fill') return countBlanks(pd.text as string)
  if (kind === 'open_writing') return Math.min(10, pd.lines as number)
  if (kind === 'essay') return 10
  // One per sentence, scored by the pronunciation check
  if (kind === 'shadowing') return (pd.lines as unknown[]).length
  return kind === 'matching' || kind === 'ordering' ? 2 : 1
}

/** Fill missing answers with placeholders so a listening item waiting for audio still converts. */
function withPlaceholderAnswers(item: LlmItem): LlmItem {
  const it = { ...item }
  if ((it.kind === 'mcq_single' || it.kind === 'mcq_multi') && !it.correctOptionIndexes?.length) it.correctOptionIndexes = [0]
  if (it.kind === 'true_false' && !['true', 'false', 'not_given'].includes(it.trueFalseAnswer ?? '')) it.trueFalseAnswer = 'true'
  if (it.kind === 'gap_fill') {
    const n = countBlanks((it.gapText ?? '').replace(/_{3,}/g, BLANK))
    const given = it.gapAnswers ?? []
    it.gapAnswers = Array.from({ length: n }, (_, i) => (given[i]?.accepted?.some((a) => a.trim()) ? given[i]! : { accepted: ['?'] }))
  }
  if (it.kind === 'short_answer' && !it.acceptedAnswers?.some((a) => a.trim())) it.acceptedAnswers = ['?']
  return it
}

const HANGUL = /[가-힣]/g
const LATIN = /[A-Za-z]/g

/**
 * Instructions must be in the instruction language (§8.6 gate 6): Korean, which may quote words of the language being
 * taught. A syllable block stands for about three Latin letters.
 */
export function scriptMatches(text: string, _locale: InstructionLocale): boolean {
  const letters = text.replace(/Past Simple|Present \w+|[A-Z]{2,}/g, '')
  const hangul = (letters.match(HANGUL) ?? []).length
  const lat = (letters.match(LATIN) ?? []).length
  return hangul > 0 && hangul * 3 >= lat
}

/** What the student sees — used for solve-back (the answer key never goes in). */
export function studentView(e: DraftExercise) {
  return { kind: e.kind, prompt: e.prompt, ...e.payload }
}

const SOLVE_SCHEMA = {
  type: 'object',
  properties: {
    answers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          n: { type: 'integer' },
          optionIndexes: { type: 'array', items: { type: 'integer' } },
          trueFalse: { type: 'string', enum: ['true', 'false', 'not_given'] },
          texts: { type: 'array', items: { type: 'string' }, description: 'gap_fill: one per blank; short_answer: one' },
          matching: { type: 'array', items: { type: 'integer' }, description: 'for each left item, index of the matching right item' },
          ordering: { type: 'array', items: { type: 'integer' }, description: 'indexes of items in correct order' },
        },
        required: ['n'],
      },
    },
  },
  required: ['answers'],
}

type SolveAnswer = { n: number; optionIndexes?: number[]; trueFalse?: string; texts?: string[]; matching?: number[]; ordering?: number[] }

function solveValue(e: DraftExercise, a: SolveAnswer | undefined): unknown {
  if (!a) return null
  switch (e.kind) {
    case 'mcq_single':
      return a.optionIndexes?.[0]
    case 'mcq_multi':
      return a.optionIndexes ?? []
    case 'true_false':
      return a.trueFalse
    case 'gap_fill':
      return a.texts ?? []
    case 'short_answer':
      return a.texts?.[0] ?? ''
    case 'matching':
      return a.matching ?? []
    case 'ordering':
      return a.ordering ?? []
    case 'open_writing':
    case 'essay':
    case 'shadowing':
      return null
  }
}

// ─── review and repair (DECISIONS.md AO) ────────────────────────────────────

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          n: { type: 'integer' },
          verdict: { type: 'string', enum: ['keep', 'fix', 'drop'] },
          issues: { type: 'string', description: 'What is wrong, in the instruction language; empty when keep' },
          fixed: { ...LLM_ITEM, description: 'fix: the complete corrected item, same format as generation' },
        },
        required: ['n', 'verdict'],
      },
    },
  },
  required: ['items'],
}

type ReviewVerdict = { n?: number; verdict?: 'keep' | 'fix' | 'drop'; issues?: string; fixed?: LlmItem }

/** An item as the reviewer sees it: key included, the shared passage referred to by id */
function reviewView(e: DraftExercise, i: number, passageIds: Map<string, string>) {
  const { passage, ...payload } = e.payload as Record<string, unknown> & { passage?: string }
  return {
    n: i + 1,
    kind: e.kind,
    skill: e.skill,
    prompt: e.prompt,
    payload,
    answerKey: e.answerKey,
    explanation: e.explanation,
    ...(passage ? { passageId: passageIds.get(passage) ?? '' } : {}),
    ...(e.imageRef ? { imageRef: e.imageRef } : {}),
    ...(e.speak ? { studentHears: e.speak } : {}),
  }
}

/**
 * A senior examiner checks every item against the key, the level, the teacher's request and the exam's format,
 * and returns keep / fix (with the corrected item) / drop. Fixes go through the same conversion and checks as
 * generation. Never drops the teacher's requested count or the whole homework; any failure keeps the draft as is.
 */
export async function reviewAndRepair(
  llm: LlmProvider,
  input: GenerateInput,
  exercises: DraftExercise[],
  ctx: { passages: Record<string, string>; rawPassages: { id: string; text: string }[]; essay: EssayContext; seed: number; teacherSetCount: boolean },
): Promise<{ exercises: DraftExercise[]; usage: LlmUsage | null; stats: NonNullable<GenerateResult['meta']['review']> }> {
  const passageIds = new Map(Object.entries(ctx.passages).map(([id, text]) => [text, id]))
  const exam = examById(input.exam?.id)
  const stats = { kept: exercises.length, fixed: 0, dropped: 0, flagged: 0 }
  let res: { json: unknown; usage: LlmUsage }
  try {
    res = await llm.generateJson({
      task: 'review',
      // Checking needs far less reasoning than writing; high effort ran away to the 65k output limit
      effort: 'low',
      maxOutputTokens: 16384,
      system: `You are a senior examiner and editor. Another writer produced this homework; check EVERY item and repair what is weak.

For each item decide:
- keep: correct and fit for purpose. This should be most items: do NOT rewrite for style, taste or small wording preferences.
- fix: only a real problem (wrong or incomplete key, a second defensible answer, ambiguity, wrong level, wrong format, ignores the teacher) — return the complete corrected item in "fixed" (same JSON format as the item schema; keep the kind unless the kind itself is wrong for the task; keep passageId).
- drop: only if it cannot be fixed.${ctx.teacherSetCount ? ' The teacher set the number of items: never drop — fix instead.' : ''}

Check:
1. The answer key is right and it is the ONLY defensible answer. MCQ distractors are plausible but clearly wrong; gap_fill and short_answer list every acceptable variant (contractions, synonyms the level allows); true/false/not given is decided strictly by the passage.
2. The item is clear and unambiguous, at the target level (${DIFFICULTY[input.difficulty]}${exam ? `; exam level ${input.exam?.level || exam.defaultLevel}` : ''}), and tests one point.
3. It does what the teacher asked.${exam ? `
4. An item written as a real ${exam.name} task follows its format, instruction wording and distractor style: ${exam.guidance} Easier steps and preparation items (vocabulary, grammar, simpler versions for the level) are judged as good practice: never "fix" them into the exam format.` : ''}${input.style ? `\n4b. Where it fits, it follows the chosen style (preparation items stay free):${labSection(input.style)}` : ''}
5. Exercise content is in the language being taught${input.language ? ` (${LANGUAGE_NAME[input.language]})` : ''}; explanations are in ${LOCALE_NAME[input.instructionLocale]}; no item gives away another; no real people.${
        answerVariantRules(input.language ?? input.plan?.contentLanguage) ? `\n${answerVariantRules(input.language ?? input.plan?.contentLanguage)}` : ''
      }
6. open_writing and essay have no answer key: check that the task is clear and the rubric concrete and fair.
7. An item with studentHears plays that word or sentence aloud to the student (text-to-speech): judge it as heard, not as missing. In a fix keep what the student hears unchanged, so the item must still fit it.
9. The item shows everything its prompt mentions (verbs in brackets, a word box, a text): if "the verb in brackets" has no verbs in brackets, fix it by adding them. Only shadowing items may ask the student to speak, repeat aloud or shadow; elsewhere the student types or chooses, so fix such a prompt.
8. PICTURES: an item with imageRef shows the student that part of the material (the box on that photo, PDF page or Word picture) above the question. Judge it by looking at that part of the material. Referring to the picture ("What is in picture 3?", "Look at the picture") is correct, not ambiguous. Never drop an item or rewrite it without the picture just because it uses a picture; in a fix keep its imageRef unchanged, unless the box clearly misses the picture, then give the corrected box.
Write "issues" in ${LOCALE_NAME[input.instructionLocale]}. Return JSON only.`,
      parts: [
        ...materialParts(input.materials),
        {
          text: JSON.stringify({
            teacherRequest: sanitizeForLLM(input.teacherText, { knownNames: input.knownNames }).text,
            passages: ctx.rawPassages,
            items: exercises.map((e, i) => reviewView(e, i, passageIds)),
          }),
        },
      ],
      schema: REVIEW_SCHEMA,
      temperature: 0.2,
    })
  } catch (e) {
    console.warn('[generate] review failed; keeping the draft as written', e)
    return { exercises, usage: null, stats: { ...stats, failed: true } }
  }

  const verdicts = new Map(((res.json as { items?: ReviewVerdict[] }).items ?? []).map((v) => [v.n, v]))
  const out: DraftExercise[] = []
  exercises.forEach((e, i) => {
    const v = verdicts.get(i + 1)
    if (!v || v.verdict === 'keep' || !v.verdict) return void out.push(e)
    if (v.verdict === 'fix' && v.fixed) {
      const r = convertItem(v.fixed, ctx.seed + i * 104729, ctx.passages, ctx.essay)
      if (r.ok && (r.ex.kind === e.kind || !isAiGraded(e.kind))) {
        // A fixed listening item keeps its recording link
        r.ex.audioLabel = e.audioLabel ?? r.ex.audioLabel
        r.ex.audioFile = e.audioFile ?? r.ex.audioFile
        r.ex.sourceRef = r.ex.sourceRef ?? e.sourceRef
        r.ex.imageRef = r.ex.imageRef ?? e.imageRef
        out.push(r.ex)
        stats.fixed++
        return
      }
    }
    if (v.verdict === 'drop' && !ctx.teacherSetCount) {
      stats.dropped++
      return
    }
    // A fix that didn't convert, or a drop we won't do: keep it, but tell the teacher why
    out.push({ ...e, flags: [...e.flags, 'review_flagged'], reviewNote: (v.issues ?? '').trim().slice(0, 500) || null, aiConfidence: Math.min(e.aiConfidence, 0.5) })
    stats.flagged++
  })
  // Never review a homework away
  if (!out.length) return { exercises, usage: res.usage, stats: { ...stats, failed: true } }
  stats.kept = out.length - stats.fixed - stats.flagged
  return { exercises: out, usage: res.usage, stats }
}

/**
 * Solve-back (§8.6 gate 2): a fresh call answers the items without the key; an item it answers differently is
 * flagged solve_back_disagrees. The solver can't hear recordings (listening items are checked against the audio
 * instead), open writing has no single answer, and it can't see pictures (the review pass, which sees the
 * materials, checks those). Never blocks the homework: a failed solver leaves items at their base confidence.
 */
export async function solveBack(llm: LlmProvider, exercises: DraftExercise[]): Promise<{ usage: LlmUsage | null; results: { index: number; agreed: boolean }[] }> {
  const results: { index: number; agreed: boolean }[] = []
  const checkable = exercises.map((e, i) => ({ e, i })).filter(({ e }) => !e.audioLabel && !e.speak && !isAiGraded(e.kind) && e.kind !== 'shadowing' && !e.imageRef)
  if (!checkable.length) return { usage: null, results }
  try {
    const solved = await llm.generateJson({
      task: 'review',
      effort: 'low',
      system:
        'You are a careful top student. Answer every exercise. For option indexes use 0-based positions in the given arrays. Return JSON only.',
      parts: [{ text: JSON.stringify(checkable.map(({ e, i }) => ({ n: i + 1, ...studentView(e) }))) }],
      schema: SOLVE_SCHEMA,
      temperature: 0,
    })
    const answers = ((solved.json as { answers?: SolveAnswer[] }).answers ?? []) as SolveAnswer[]
    checkable.forEach(({ e, i }) => {
      const a = answers.find((x) => x.n === i + 1)
      const r = gradeExercise(e.kind, e.payload, e.answerKey, solveValue(e, a))
      results.push({ index: i, agreed: r.isCorrect })
      if (!r.isCorrect) {
        e.flags.push('solve_back_disagrees')
        e.aiConfidence = Math.min(e.aiConfidence, 0.4)
      } else e.aiConfidence = Math.max(e.aiConfidence, e.flags.length ? 0.6 : 0.95)
    })
    return { usage: solved.usage, results }
  } catch {
    console.warn('[generate] solve-back failed')
    return { usage: null, results }
  }
}

/** Skip the review if the first draft already took this long (the route has 300 s in total) */
const REVIEW_TIME_BUDGET_MS = 120_000

// ─── pipeline ───────────────────────────────────────────────────────────────

export async function generateAssignment(llm: LlmProvider, input: GenerateInput): Promise<GenerateResult> {
  // A new Create homework the teacher planned: its parts are written at the same time (compose.ts)
  if (input.plan && input.mode !== 'digitize' && !input.refine && !input.single) return composeFromPlan(llm, input, input.plan)
  const seed = input.seed ?? Date.now()
  const startedAt = Date.now()
  const usage: LlmUsage = { inputTokens: 0, outputTokens: 0 }
  const add = (u: LlmUsage) => {
    usage.inputTokens += u.inputTokens
    usage.outputTokens += u.outputTokens
    // Thinking is billed as output; keep it, so the stored usage shows what was paid for
    if (u.thoughtsTokens) usage.thoughtsTokens = (usage.thoughtsTokens ?? 0) + u.thoughtsTokens
  }

  input.onProgress?.(input.materials.length ? 'reading' : 'writing')
  const request = {
    task: 'generate' as const,
    effort: 'high' as const,
    system: systemPrompt(input),
    parts: userParts(input),
    schema: input.mode === 'digitize' ? DIGITIZE_ASSIGNMENT : LLM_ASSIGNMENT,
    temperature: input.single ? 0.9 : 0.7,
  }
  let gen = await llm.generateJson(request)
  add(gen.usage)
  // A reply with no exercises at all is useless: ask once more, plainly, before failing the teacher
  if (!(gen.json as { exercises?: unknown[] }).exercises?.length) {
    console.warn(`[generate] empty exercises from ${gen.model} (usage ${JSON.stringify(gen.usage)}); retrying`)
    gen = await llm.generateJson({
      ...request,
      parts: [...request.parts, { text: 'Your previous answer had an EMPTY "exercises" array. Return the complete homework with every exercise in "exercises".' }],
    })
    add(gen.usage)
  }
  input.onProgress?.('checking')

  const raw = gen.json as {
    title?: string
    instructions?: string
    rationale?: string
    contentLanguage?: string
    cefrLevel?: string
    exercises?: LlmItem[]
    skipped?: { ref: string; reason?: string }[]
    passages?: { id?: string; title?: string; text?: string }[]
    teacherSetCount?: boolean
  }
  const digitize = input.mode === 'digitize'
  const essayCtx = essayContext(input)
  const passages: Record<string, string> = {}
  if (!digitize) for (const p of raw.passages ?? []) if (p.id?.trim() && p.text?.trim()) passages[p.id.trim()] = p.title?.trim() ? `${p.title.trim()}\n\n${p.text.trim()}` : p.text.trim()
  const dropped: { index: number; reason: string }[] = []
  let exercises: DraftExercise[] = []
  ;(raw.exercises ?? []).forEach((item, i) => {
    if (digitize && isAiGraded(item.kind ?? '')) return dropped.push({ index: i, reason: 'ai-graded kind in digitize mode' })
    const r = convertItem(item, seed + i * 7919, passages, essayCtx)
    if (!r.ok) return dropped.push({ index: i, reason: r.reason })
    // Digitized answers the AI worked out itself (no answer-key page) get a "please check" note. A listening item
    // still waiting for its recording has a best guess, which the recording replaces
    if (digitize) {
      const waiting = r.ex.flags.includes('needs_audio')
      const said: AnswerSource = item.answerSource === 'answer_key' || (item.answerSource === 'audio' && !waiting) ? item.answerSource : 'ai'
      r.ex.answerSource = said
      if (said === 'ai' && !waiting) r.ex.flags.push('answer_ai_inferred')
    }
    checkAttachments(r.ex, input.materials)
    exercises.push(r.ex)
  })
  if (exercises.length === 0) {
    // Say why, so a production failure can be diagnosed from the log alone
    const kinds = (raw.exercises ?? []).map((x) => x.kind).join(',')
    throw new Error(`The model returned no usable exercises (model ${gen.model}, usage ${JSON.stringify(gen.usage)}; ${raw.exercises?.length ?? 0} items: ${kinds}; dropped: ${JSON.stringify(dropped).slice(0, 1500)}; keys: ${Object.keys(raw).join(',')}; first: ${JSON.stringify(raw.exercises?.[0] ?? null).slice(0, 800)})`)
  }

  // Items that talk about a picture but don't point at one get it found by a focused second call
  const located = await locatePictures(llm, input, exercises)
  if (located) add(located.usage)

  let review: GenerateResult['meta']['review']
  // The whole request must finish inside the server's time limit: a slow first draft skips the review
  const tooSlow = Date.now() - startedAt > REVIEW_TIME_BUDGET_MS
  if (tooSlow && input.review && !digitize) console.warn(`[generate] draft took ${Math.round((Date.now() - startedAt) / 1000)} s; skipping review`)
  if (input.review && !digitize && !tooSlow) {
    const rawPassages = Object.entries(passages).map(([id, text]) => ({ id, text }))
    const r = await reviewAndRepair(llm, input, exercises, { passages, rawPassages, essay: essayCtx, seed, teacherSetCount: !!raw.teacherSetCount })
    exercises = r.exercises
    review = r.stats
    if (r.usage) add(r.usage)
  }

  // Reading the passage once: its time goes on the first item that shows it
  const seenPassages = new Set<string>()
  for (const e of exercises) {
    const text = e.payload.passage as string | undefined
    if (text && !seenPassages.has(text)) {
      seenPassages.add(text)
      e.estimatedSeconds += passageSeconds(text)
    }
  }

  // Time budget: trim the tail if we're more than 25% over (never below 4 items)
  let trimmedForTime = 0
  // …unless the teacher set the number: their count wins over our estimate
  if (!input.single && !digitize && !raw.teacherSetCount) {
    const budget = input.targetMinutes * 60 * 1.25
    // Trim closed items from the end; an essay or writing task is what the teacher came for, never cut
    const lastClosed = () => exercises.map((e) => isAiGraded(e.kind)).lastIndexOf(false)
    while (exercises.length > 4 && lastClosed() >= 0 && exercises.reduce((s, e) => s + e.estimatedSeconds, 0) > budget) {
      exercises.splice(lastClosed(), 1)
      trimmedForTime++
    }
  }

  // Solve-back: a fresh call answers without the key; disagreement flags the item (§8.6 gate 2)
  const solved = await solveBack(llm, exercises)
  if (solved.usage) add(solved.usage)
  const solveBackResults = solved.results

  input.onProgress?.('finishing')
  const instructions = (raw.instructions ?? '').trim()
  const instructionsScriptOk = !instructions || scriptMatches(instructions, input.instructionLocale)

  const totalSeconds = exercises.reduce((s, e) => s + e.estimatedSeconds, 0)
  const draft: DraftAssignment = {
    title: (raw.title ?? '').trim() || '숙제',
    instructions,
    rationale: (raw.rationale ?? '').trim(),
    contentLanguage: (raw.contentLanguage ?? 'en').trim().slice(0, 8) || 'en',
    cefrLevel: raw.cefrLevel?.trim() || null,
    estimatedMinutes: Math.max(1, Math.round(totalSeconds / 60)),
    exercises,
    skipped: input.mode === 'digitize' ? (raw.skipped ?? []).filter((x) => x.ref?.trim()).map((x) => ({ ref: x.ref.trim(), reason: (x.reason ?? '').trim() })) : [],
  }
  keepPictures(draft.exercises, input)
  // One line per generation, so "why no pictures?" can be answered from the log alone
  const asked = (raw.exercises ?? []).filter((x) => x.imageRef).length
  if (asked || input.materials.some((m) => !m.mimeType.startsWith('audio/'))) {
    console.info(`[pictures] model pointed at ${asked} of ${raw.exercises?.length ?? 0} items; ${exercises.filter((e) => e.imageRef).length} kept after checks${review ? ` (review fixed ${review.fixed}, dropped ${review.dropped})` : ''}; unavailable ${exercises.filter((e) => e.flags.includes('image_missing')).length}`)
  }
  settlePictures(draft, input.mode ?? 'create', input.instructionLocale)
  return {
    draft,
    meta: {
      model: gen.model,
      usage,
      dropped,
      trimmedForTime,
      solveBack: solveBackResults,
      instructionsScriptOk,
      raw,
      ...(review ? { review } : {}),
      ...(tooSlow && input.review && !digitize ? { reviewSkipped: 'slow' as const } : {}),
      pictures: { pointed: asked, located: located?.located ?? 0 },
    },
  }
}
