/**
 * Foreign languages taught in Korea and the standard exams for each (Create mode "exam style").
 * Pure data + pure functions, no imports: the composer imports it in the browser via `@ikhimi/ai/exams`.
 *
 * Each exam says how its real task formats map onto our item kinds, and — if the exam has a writing section —
 * the official criteria and scale the essay grader uses. Every entry must be reviewed by a tutor who teaches
 * that exam before we promise it to users (DECISIONS.md AM). We write ORIGINAL material in the exam's style;
 * never real past papers.
 */

export type LanguageCode = 'en' | 'ja' | 'zh' | 'de' | 'fr' | 'es' | 'ru' | 'tr' | 'ar' | 'ko'

/** Teacher profile subjects. Languages first (with the language they teach), then non-language subjects. */
export const SUBJECT_LANGUAGE = {
  english: 'en',
  japanese: 'ja',
  chinese: 'zh',
  german: 'de',
  french: 'fr',
  spanish: 'es',
  russian: 'ru',
  turkish: 'tr',
  arabic: 'ar',
  /** Korean as a foreign language (for learners in Korea whose first language isn't Korean) */
  korean: 'ko',
} as const satisfies Record<string, LanguageCode>
export const SUBJECTS = ['english', 'japanese', 'chinese', 'german', 'french', 'spanish', 'russian', 'turkish', 'arabic', 'korean', 'math', 'other'] as const
export type Subject = (typeof SUBJECTS)[number]
export const isLanguageSubject = (s: string) => s in SUBJECT_LANGUAGE
export const LANGUAGE_CODES = Object.values(SUBJECT_LANGUAGE) as LanguageCode[]

/** English names for prompts; UI names come from i18n (`lang.<code>`) */
export const LANGUAGE_NAME: Record<LanguageCode, string> = {
  en: 'English',
  ru: 'Russian',
  ko: 'Korean',
  zh: 'Chinese (Mandarin, simplified characters)',
  ja: 'Japanese',
  tr: 'Turkish',
  de: 'German',
  fr: 'French',
  es: 'Spanish',
  ar: 'Arabic (Modern Standard)',
}

// ─── writing (essay) specs ──────────────────────────────────────────────────

export type Criterion = { id: string; name: string; max: number }
export type WritingScale = {
  criteria: Criterion[]
  /** mean: overall = average of criteria (IELTS band); sum: overall = total points (TOPIK /50) */
  aggregate: 'mean' | 'sum'
  /** Rounding of the overall score, e.g. 0.5 for IELTS half bands */
  step: number
  /** How the overall is shown: "Band 6.5", "38/50", "4/5" */
  label: 'band' | 'points'
  /** Text length is counted in words, or in characters (Korean, Chinese, Japanese) */
  unit: 'words' | 'chars'
}
export type WritingTask = { id: string; name: string; min: number; max?: number; about: string }

/** Used when no exam is selected, or the exam has no specific grid */
export const GENERIC_WRITING: WritingScale = {
  criteria: [
    { id: 'task', name: 'Task achievement', max: 5 },
    { id: 'organisation', name: 'Organisation and coherence', max: 5 },
    { id: 'vocabulary', name: 'Vocabulary', max: 5 },
    { id: 'grammar', name: 'Grammar', max: 5 },
  ],
  aggregate: 'mean',
  step: 0.5,
  label: 'points',
  unit: 'words',
}

export type Exam = {
  id: string
  language: LanguageCode
  name: string
  /** What the teacher picks as "level"; the first is a sensible default when unsure */
  levels: string[]
  defaultLevel: string
  /** Prompt text: the exam's sections and task formats, mapped to our kinds */
  guidance: string
  /** null = the exam has no writing section (e.g. JLPT) */
  writing: { scale: WritingScale; tasks: WritingTask[]; rubric: string } | null
  /** Levels that have no writing section (TOPIK I) */
  noWritingLevels?: string[]
}

const CAMBRIDGE_WRITING: WritingScale = {
  criteria: [
    { id: 'content', name: 'Content', max: 5 },
    { id: 'communicative', name: 'Communicative Achievement', max: 5 },
    { id: 'organisation', name: 'Organisation', max: 5 },
    { id: 'language', name: 'Language', max: 5 },
  ],
  aggregate: 'sum',
  step: 1,
  label: 'points',
  unit: 'words',
}

const IELTS_SCALE: WritingScale = {
  criteria: [
    { id: 'task', name: 'Task Achievement / Task Response', max: 9 },
    { id: 'coherence', name: 'Coherence and Cohesion', max: 9 },
    { id: 'lexical', name: 'Lexical Resource', max: 9 },
    { id: 'grammar', name: 'Grammatical Range and Accuracy', max: 9 },
  ],
  aggregate: 'mean',
  step: 0.5,
  label: 'band',
  unit: 'words',
}

const IELTS_READING_LISTENING = `Reading/Listening task formats → our kinds: True/False/Not Given (academic: facts) or Yes/No/Not Given (writer's views) → true_false with allowNotGiven, statements paraphrase the text, never copy it; matching headings to paragraphs, matching information/features/sentence endings → matching; sentence, summary, note, table, flow-chart and form completion → gap_fill with the instruction "Write NO MORE THAN TWO WORDS AND/OR A NUMBER" (or ONE WORD ONLY), answers taken word-for-word from the passage; multiple choice → mcq_single/mcq_multi ("Choose TWO letters"); short-answer questions → short_answer with the same word limit. Questions follow the order of the passage except matching headings. Distractors are paraphrase traps: options that repeat words from the text but change the meaning. Label items like "Questions 1–5" and keep IELTS instruction wording.`

export const EXAMS: Exam[] = [
  {
    id: 'csat_english',
    language: 'en',
    name: '수능 영어 (CSAT English)',
    levels: ['고1 모의고사', '고2 모의고사', '고3 모의고사 / 수능'],
    defaultLevel: '고3 모의고사 / 수능',
    guidance:
      "The English section of Korea's College Scholastic Ability Test (대학수학능력시험, 수능): 45 five-option multiple-choice items, 17 listening and 28 reading. Every item is mcq_single with exactly five options. Reading item types, in the order the test uses them: the writer's purpose; a character's feelings or change of mood; the writer's claim; the gist; the topic; the best title; a chart (give its data as a text table in the passage) with one statement that doesn't match it; details that do or don't match the text; grammar (어법: five underlined parts, choose the incorrect one); vocabulary in context (어휘: five underlined words, choose the one that doesn't fit); blank inference (빈칸 추론: a key phrase or clause removed from a dense academic passage, five paraphrased options); the sentence that doesn't belong; ordering paragraphs (A), (B), (C) after a given opening (mcq_single with the five possible orders); inserting a given sentence at the right one of five marked positions; a one-sentence summary with two blanks (A) and (B); and a long passage with two or three questions. Passages are 120–180 words of academic or essay-style English (science, psychology, economics, the arts, society) at the level chosen, with challenging vocabulary; distractors are plausible paraphrases and partial truths, never obviously wrong. Question stems are in Korean as on the real test (e.g. 다음 글의 주제로 가장 적절한 것은?), the passage in English, and options in English (Korean for the purpose, claim and feelings items, as on the test). Listening: short dialogues and monologues with purpose, opinion, relationship, place, numbers and prices, and the most appropriate response.",
    writing: null,
  },
  {
    id: 'toeic',
    language: 'en',
    name: 'TOEIC',
    levels: ['500점대', '600점대', '700점대', '800점대', '900점 이상'],
    defaultLevel: '700점대',
    guidance:
      'TOEIC Listening & Reading: English in the workplace and everyday business. Reading: Part 5 incomplete sentences (one business sentence with a blank; four options testing word form, verb tense and voice, prepositions, conjunctions, pronouns or vocabulary) → mcq_single with four options; Part 6 text completion (an email, memo, notice or advertisement with four blanks, one of them for a whole sentence) → the text as a passage and one mcq_single per blank; Part 7 reading comprehension (single, double and triple passages: emails, advertisements, articles, forms, text-message chains, schedules) with questions on the purpose, details, inference, a word in context ("The word X in paragraph 1 is closest in meaning to") and "In which of the positions marked [1], [2], [3] and [4] does the following sentence best belong?" → mcq_single with four options. Listening: Part 1 photographs (describe the scene in text, as no photo is shown), Part 2 question–response (three responses), Part 3 conversations and Part 4 talks with three questions each. Use names, companies and situations of an international workplace; keep the options of an item the same length and grammatically parallel.',
    writing: null,
  },
  {
    id: 'ielts_academic',
    language: 'en',
    name: 'IELTS Academic',
    levels: ['Band 5.0', 'Band 5.5', 'Band 6.0', 'Band 6.5', 'Band 7.0', 'Band 7.5', 'Band 8.0+'],
    defaultLevel: 'Band 6.5',
    guidance: `IELTS Academic. Reading: long academic passages (textbook/journal style, 700–900 words in the real test; for homework 250–450), 13–14 questions per passage. ${IELTS_READING_LISTENING} Writing Task 1: describe a graph, table, chart, process or map (give the data as a text table in the passage) in at least 150 words; Task 2: an argument/discussion essay of at least 250 words.`,
    writing: {
      scale: IELTS_SCALE,
      tasks: [
        { id: 'task1', name: 'Writing Task 1', min: 150, about: 'Summarise the main features of a graph/table/chart/process/map and make comparisons. Give the data as a text table in a passage.' },
        { id: 'task2', name: 'Writing Task 2', min: 250, about: 'Opinion, discussion, advantages/disadvantages, problem/solution or two-part question essay.' },
      ],
      rubric:
        'Apply the public IELTS Writing band descriptors. Task 1 is judged on Task Achievement (overview, key features, accurate data), Task 2 on Task Response (all parts answered, clear position, developed ideas). Under the minimum length the Task Achievement/Response band is lowered. Memorised or off-topic text is penalised. Give whole bands per criterion.',
    },
  },
  {
    id: 'ielts_general',
    language: 'en',
    name: 'IELTS General Training',
    levels: ['Band 4.5', 'Band 5.0', 'Band 5.5', 'Band 6.0', 'Band 6.5', 'Band 7.0+'],
    defaultLevel: 'Band 5.5',
    guidance: `IELTS General Training. Reading: everyday texts (notices, adverts, timetables), workplace texts (job descriptions, policies) and one longer general-interest text. ${IELTS_READING_LISTENING} Writing Task 1: a letter (informal, semi-formal or formal) with three bullet points to cover, at least 150 words; Task 2: an essay of at least 250 words on a general topic.`,
    writing: {
      scale: IELTS_SCALE,
      tasks: [
        { id: 'task1', name: 'Writing Task 1 (letter)', min: 150, about: 'A letter covering the three bullet points, with the right tone (informal, semi-formal or formal).' },
        { id: 'task2', name: 'Writing Task 2', min: 250, about: 'Opinion, discussion or problem/solution essay on a general topic.' },
      ],
      rubric:
        'Apply the public IELTS Writing band descriptors. For the letter, Task Achievement includes covering all three bullet points and a consistent, appropriate tone. Under the minimum length the Task band is lowered. Give whole bands per criterion.',
    },
  },
  {
    id: 'toefl_ibt',
    language: 'en',
    name: 'TOEFL iBT',
    levels: ['Band 3 (B1)', 'Band 4 (B2)', 'Band 5 (C1)', 'Band 6 (C2)'],
    defaultLevel: 'Band 4 (B2)',
    guidance:
      'TOEFL iBT (current format, scores on a 1–6 band scale aligned to CEFR). Reading: "Complete the Words" (a short academic paragraph where the second half of some words is missing → gap_fill, one blank per word, the answer is the whole word), "Read in Daily Life" (emails, notices, menus → mcq_single), "Read an Academic Passage" (about 200 words → mcq_single on detail, inference, vocabulary in context, purpose). Listening: choose a response, conversations, announcements, academic talks → mcq_single (use a passage as the transcript only when the teacher attaches audio; otherwise prefer reading). Writing: "Build a Sentence" (put words in order to make a correct response in a conversation → ordering), "Write an Email" (about 7 minutes, ~100–150 words) and "Write for an Academic Discussion" (respond to a professor\'s question and two classmates\' posts, 100+ words).',
    writing: {
      scale: { criteria: [{ id: 'overall', name: 'Overall (TOEFL writing rubric)', max: 5 }], aggregate: 'mean', step: 1, label: 'points', unit: 'words' },
      tasks: [
        { id: 'email', name: 'Write an Email', min: 80, max: 150, about: 'Reply to a situation, covering every point asked, with a suitable tone.' },
        { id: 'discussion', name: 'Write for an Academic Discussion', min: 100, about: 'Give and support your own opinion, adding to the classmates\' posts.' },
      ],
      rubric:
        'Score holistically on the public TOEFL writing rater scale 0–5: 5 = relevant, well elaborated, clear, varied and accurate language with only minor errors; 3 = mostly relevant but partly unclear or underdeveloped, noticeable errors; 1 = little relevance, serious language problems; 0 = blank, copied or off topic. Explain the score by content, development and language.',
    },
  },
  {
    id: 'cambridge',
    language: 'en',
    name: 'Cambridge English',
    levels: ['A2 Key', 'B1 Preliminary', 'B2 First', 'C1 Advanced', 'C2 Proficiency'],
    defaultLevel: 'B2 First',
    guidance:
      'Cambridge English (Key/Preliminary/First/Advanced/Proficiency). Reading and Use of English parts → our kinds: multiple-choice cloze (a text with gaps, four options each → one mcq_single per gap, or ONE gap_fill if you list options in the prompt); open cloze (a text with gaps, one word each, no options → ONE gap_fill); word formation (a text with gaps and a stem word in CAPITALS at the end of each line → ONE gap_fill, e.g. "…great ___ (HAPPY)"); key word transformation (a sentence, a key word in CAPITALS that must not be changed, and a second sentence with a gap to complete in 3–6 words (2–5 at B1) including the key word → one gap_fill per item, accept every correct 3–6-word variant); multiple choice on a text → mcq_single; gapped text (sentences removed from a text → matching: gap → sentence, with one extra sentence); multiple matching (questions → sections of a text) → matching. Label items like "Part 4 — Key word transformation" and use the level\'s typical length and vocabulary. Writing: B1: email ~100 words, article/story ~100 words; B2: essay 140–190 words (compulsory) plus article/email/letter/review/report 140–190; C1: essay 220–260, plus letter/proposal/report/review 220–260; C2: essay 240–280.',
    writing: {
      scale: CAMBRIDGE_WRITING,
      tasks: [
        { id: 'essay', name: 'Essay', min: 140, max: 190, about: 'Essay on a statement or question with two given notes plus the student\'s own idea (B2 First). Adjust the length to the level.' },
        { id: 'other', name: 'Article / email / letter / review / report', min: 140, max: 190, about: 'One of the level\'s other writing genres with a clear target reader.' },
      ],
      rubric:
        'Apply the public Cambridge English Writing Assessment Scale for the chosen level: Content (all content points, reader fully informed), Communicative Achievement (genre conventions, register, holding the reader\'s attention), Organisation (linking, paragraphing), Language (range and control of vocabulary and grammar), each 0–5, total /20. Judge against the level, not against native speakers.',
    },
  },
  {
    id: 'torfl',
    language: 'ru',
    name: 'ТРКИ / TORFL',
    levels: ['ТЭУ (A1)', 'ТБУ (A2)', 'ТРКИ-1 (B1)', 'ТРКИ-2 (B2)', 'ТРКИ-3 (C1)', 'ТРКИ-4 (C2)'],
    defaultLevel: 'ТРКИ-1 (B1)',
    guidance:
      'ТРКИ (Test of Russian as a Foreign Language). Subtests: «Лексика. Грамматика» (many short items: choose the correct form of a word — case, verb aspect, verbs of motion, prepositions, participles — from 3–4 options → mcq_single; write the correct form → gap_fill), «Чтение» (texts with multiple-choice questions → mcq_single), «Аудирование» (prefer reading unless audio is attached), «Письмо» (a letter, note or short essay based on a situation or a read text). Instructions in Russian as in the test ("Выберите правильный вариант").',
    writing: {
      scale: {
        criteria: [
          { id: 'task', name: 'Решение коммуникативной задачи', max: 5 },
          { id: 'logic', name: 'Логичность и связность', max: 5 },
          { id: 'lexis', name: 'Лексика', max: 5 },
          { id: 'grammar', name: 'Грамматика', max: 5 },
        ],
        aggregate: 'mean',
        step: 0.5,
        label: 'points',
        unit: 'words',
      },
      tasks: [
        { id: 'letter', name: 'Письмо', min: 60, max: 120, about: 'A letter or note answering a situation, covering every point asked.' },
        { id: 'essay', name: 'Сочинение / изложение', min: 120, max: 200, about: 'A text based on a read passage or a topic, giving information and an opinion.' },
      ],
      rubric: 'Judge as a ТРКИ rater for the chosen level: communicative task, logic and cohesion, vocabulary, grammar (case endings, aspect, agreement).',
    },
  },
  {
    id: 'topik',
    language: 'ko',
    name: 'TOPIK',
    levels: ['TOPIK I (1–2급)', 'TOPIK II (3–4급)', 'TOPIK II (5–6급)'],
    defaultLevel: 'TOPIK I (1–2급)',
    noWritingLevels: ['TOPIK I (1–2급)'],
    guidance:
      'TOPIK (Test of Proficiency in Korean). TOPIK I (levels 1–2): Listening and Reading only, all four-option multiple choice → mcq_single: choose the topic, choose the word that fits the blank, choose what matches the text, order sentences (→ ordering), read notices/ads. TOPIK II (levels 3–6): Listening, Writing and Reading; reading adds choosing the main idea, filling a blank in a longer text, inserting a sentence, inferring the writer\'s attitude. Instructions in Korean as in the test (e.g. "( )에 들어갈 가장 알맞은 것을 고르십시오."). Writing (TOPIK II only): Q51–52 complete the sentences in a short text (→ gap_fill with whole-clause blanks), Q53 describe a graph/survey in 200–300 characters, Q54 an argumentative essay in 600–700 characters, in written style (-ㄴ다/-는다 endings, not -요).',
    writing: {
      scale: {
        criteria: [
          { id: 'content', name: '내용 및 과제 수행 (Content and task)', max: 12 },
          { id: 'structure', name: '글의 전개 구조 (Organisation)', max: 12 },
          { id: 'language', name: '언어 사용 (Language use)', max: 26 },
        ],
        aggregate: 'sum',
        step: 1,
        label: 'points',
        unit: 'chars',
      },
      tasks: [
        { id: 'q53', name: '53번 (graph description)', min: 200, max: 300, about: 'Describe the data of a survey/graph given as a text table, in written style.' },
        { id: 'q54', name: '54번 (essay)', min: 600, max: 700, about: 'Argumentative essay answering the three guiding questions, in written style (-ㄴ다/-는다).' },
      ],
      rubric:
        'Grade as a TOPIK II rater for question 54 (/50; scale down proportionally for question 53). Content and task (all guiding questions answered, relevant), organisation (introduction–body–conclusion, connectives), language use (range and accuracy of grammar and vocabulary, written style -ㄴ다/-는다 instead of polite -요 endings). Count characters including spaces.',
    },
  },
  {
    id: 'hsk',
    language: 'zh',
    name: 'HSK',
    levels: ['HSK 1', 'HSK 2', 'HSK 3', 'HSK 4', 'HSK 5', 'HSK 6'],
    defaultLevel: 'HSK 3',
    noWritingLevels: ['HSK 1', 'HSK 2'],
    guidance:
      'HSK (汉语水平考试). Use only the vocabulary of the chosen level. Listening (prefer reading unless audio is attached) and Reading: judge a statement true/false (→ true_false), choose the word that fills the blank (→ mcq_single or gap_fill), match sentences to replies or pictures described in words (→ matching), order three sentences (→ ordering), short passages with multiple choice. Show pinyin above characters only at HSK 1–2. Writing: HSK 3 write the missing character from pinyin (→ gap_fill); HSK 4 put words in order to make a sentence (→ ordering) and write a sentence with a given word; HSK 5 order words, and a short essay of about 80 characters using given words; HSK 6 rewrite a 1000-character story as a ~400-character summary.',
    writing: {
      scale: {
        criteria: [
          { id: 'content', name: 'Content and task', max: 5 },
          { id: 'organisation', name: 'Organisation', max: 5 },
          { id: 'language', name: 'Characters, vocabulary and grammar', max: 5 },
        ],
        aggregate: 'mean',
        step: 0.5,
        label: 'points',
        unit: 'chars',
      },
      tasks: [
        { id: 'hsk5', name: 'HSK 5 短文', min: 80, max: 100, about: 'A short text of about 80 characters using all the given words.' },
        { id: 'hsk6', name: 'HSK 6 缩写', min: 350, max: 450, about: 'Summarise a longer story (given as a passage) in about 400 characters, without adding opinions.' },
      ],
      rubric: 'Grade as an HSK writing rater for the chosen level: task completed (all given words used / story fully summarised), clear order, correct characters, vocabulary and grammar of the level.',
    },
  },
  {
    id: 'jlpt',
    language: 'ja',
    name: 'JLPT',
    levels: ['N5', 'N4', 'N3', 'N2', 'N1'],
    defaultLevel: 'N4',
    guidance:
      'JLPT (日本語能力試験). There is NO writing or speaking section: do not create essays or open writing in JLPT style unless the teacher explicitly asks. Everything is four-option multiple choice → mcq_single, in Japanese as in the test: 漢字読み (reading of an underlined kanji), 表記 (the kanji for a word in hiragana), 文脈規定 (the word that fits the context), 言い換え類義 (closest meaning), 用法 (correct usage of a word), 文法形式の判断 (grammar form), 文の組み立て (★ question: put four words in order and choose the one in the ★ position → mcq_single, show the blanks as ＿＿ ＿＿ ★ ＿＿), 文章の文法, 読解 (short, mid-length and long texts, information retrieval). Use only the kanji, vocabulary and grammar of the chosen level.',
    writing: null,
  },
  {
    id: 'goethe',
    language: 'de',
    name: 'Goethe-Zertifikat',
    levels: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'],
    defaultLevel: 'B1',
    guidance:
      'Goethe-Zertifikat. Lesen: short texts with richtig/falsch (→ true_false), multiple choice a/b/c (→ mcq_single), matching situations to adverts/texts (→ matching, one with no match "0"), opinions on a topic (ja/nein → true_false). Hören: prefer reading unless audio is attached. Schreiben: A1 fill in a form and a short message; A2 SMS and e-mail; B1 Aufgabe 1 informal e-mail (~80 words) covering three points, Aufgabe 2 a forum opinion (~80 words), Aufgabe 3 a short formal message (~40 words); B2 forum post (~150 words) and formal message (~100 words). Instructions in German as in the test.',
    writing: {
      scale: {
        criteria: [
          { id: 'task', name: 'Erfüllung der Aufgabenstellung', max: 5 },
          { id: 'coherence', name: 'Kohärenz', max: 5 },
          { id: 'lexis', name: 'Wortschatz', max: 5 },
          { id: 'structures', name: 'Strukturen', max: 5 },
        ],
        aggregate: 'mean',
        step: 0.5,
        label: 'points',
        unit: 'words',
      },
      tasks: [
        { id: 'email', name: 'E-Mail (informell)', min: 70, max: 100, about: 'Informal e-mail covering all three given points.' },
        { id: 'forum', name: 'Forumsbeitrag / Meinung', min: 70, max: 160, about: 'State and justify an opinion on a forum topic (length by level).' },
      ],
      rubric: 'Grade with the Goethe-Zertifikat writing criteria for the chosen level: task fulfilment (all points, text type, register), coherence, vocabulary, structures.',
    },
  },
  {
    id: 'testdaf',
    language: 'de',
    name: 'TestDaF',
    levels: ['TDN 3', 'TDN 4', 'TDN 5'],
    defaultLevel: 'TDN 4',
    guidance:
      'TestDaF (German for university study, B2–C1). Leseverstehen: matching short texts to people (→ matching), a longer text with multiple choice (→ mcq_single), a text with statements ja/nein/Text sagt dazu nichts (→ true_false with allowNotGiven). Schreiben: an argumentative text on a university/society topic that describes a graph (given as a text table) and weighs two positions, about 200+ words.',
    writing: {
      scale: {
        criteria: [
          { id: 'overall', name: 'Gesamteindruck', max: 5 },
          { id: 'task', name: 'Behandlung der Aufgabe', max: 5 },
          { id: 'language', name: 'Sprachliche Realisierung', max: 5 },
        ],
        aggregate: 'mean',
        step: 0.5,
        label: 'points',
        unit: 'words',
      },
      tasks: [{ id: 'argument', name: 'Schreiben (Argumentation)', min: 200, max: 350, about: 'Describe the given data, compare two positions and give a reasoned own view.' }],
      rubric: 'Grade as a TestDaF rater and say whether the text is at TDN 3, 4 or 5: overall impression (fluency, structure), task handling (data described, positions weighed, own view), language (range and accuracy).',
    },
  },
  {
    id: 'delf_dalf',
    language: 'fr',
    name: 'DELF / DALF',
    levels: ['DELF A1', 'DELF A2', 'DELF B1', 'DELF B2', 'DALF C1', 'DALF C2'],
    defaultLevel: 'DELF B1',
    guidance:
      "DELF/DALF. Compréhension écrite: documents (annonces, articles, courriels) with multiple choice (→ mcq_single), vrai/faux with the justification taken from the text (→ true_false; put the justification in the explanation), short written answers (→ short_answer). Compréhension de l'oral: prefer reading unless audio is attached. Production écrite: A1 form + short message (40–50 mots); A2 two short texts (60–80 mots); B1 an essay/letter/article giving your opinion (160–180 mots); B2 an argued text (lettre formelle, article critique, contribution à un forum, 250 mots); C1 synthèse + essai argumenté. Consignes in French as in the exam.",
    writing: {
      scale: {
        criteria: [
          { id: 'consigne', name: 'Respect de la consigne', max: 5 },
          { id: 'coherence', name: 'Cohérence et cohésion', max: 5 },
          { id: 'lexique', name: 'Compétence lexicale', max: 5 },
          { id: 'grammaire', name: 'Compétence grammaticale', max: 5 },
        ],
        aggregate: 'mean',
        step: 0.5,
        label: 'points',
        unit: 'words',
      },
      tasks: [
        { id: 'b1', name: 'Production écrite B1', min: 160, max: 180, about: 'Give and justify your opinion (essai, courrier ou article).' },
        { id: 'b2', name: 'Production écrite B2', min: 250, max: 300, about: 'Argued text: formal letter, critical article or forum contribution.' },
      ],
      rubric: 'Grade with the DELF/DALF production écrite grid for the chosen level: respect of the task (genre, length, register), argumentation and coherence, vocabulary (range, accuracy), morphosyntax.',
    },
  },
  {
    id: 'dele',
    language: 'es',
    name: 'DELE',
    levels: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'],
    defaultLevel: 'B1',
    guidance:
      'DELE (Instituto Cervantes). Comprensión de lectura: texts with multiple choice (→ mcq_single), matching people/texts to statements (→ matching), gapped text with fragments removed (→ matching gap → fragment, one extra fragment), cloze with three options per gap (→ mcq_single per gap or ONE gap_fill). Comprensión auditiva: prefer reading unless audio is attached. Expresión e interacción escritas: B1 a letter/email (100–120 palabras) and a short text/diary/blog entry (130–150 palabras); B2 a letter (150–180) and a text with opinion (150–180). Instructions in Spanish as in the exam.',
    writing: {
      scale: {
        criteria: [
          { id: 'adecuacion', name: 'Adecuación al contexto', max: 3 },
          { id: 'coherencia', name: 'Coherencia', max: 3 },
          { id: 'correccion', name: 'Corrección', max: 3 },
          { id: 'alcance', name: 'Alcance', max: 3 },
        ],
        aggregate: 'mean',
        step: 0.5,
        label: 'points',
        unit: 'words',
      },
      tasks: [
        { id: 'carta', name: 'Carta / correo', min: 100, max: 120, about: 'Letter or email answering every point, with the right register.' },
        { id: 'texto', name: 'Texto de opinión', min: 130, max: 180, about: 'Text giving an opinion or describing an experience.' },
      ],
      rubric: 'Grade with the DELE analytic scale for the chosen level (0–3 each): adecuación (task, genre, register), coherencia, corrección, alcance (range).',
    },
  },
  {
    id: 'tomer',
    language: 'tr',
    name: 'TÖMER / Yunus Emre TYS',
    levels: ['A1', 'A2', 'B1', 'B2', 'C1'],
    defaultLevel: 'B1',
    guidance:
      "Turkish proficiency exams (Ankara Üniversitesi TÖMER, Yunus Emre Türkçe Yeterlik Sınavı), CEFR-based. Okuma: short texts with multiple choice (→ mcq_single), doğru/yanlış (→ true_false), matching headings/texts (→ matching). Dil bilgisi: choose the correct suffix (case, tense, possessive, vowel harmony) → mcq_single or gap_fill. Yazma: a letter/e-mail and an opinion text, length by level. Instructions in Turkish as in the exam.",
    writing: {
      scale: GENERIC_WRITING,
      tasks: [
        { id: 'mektup', name: 'Mektup / e-posta', min: 80, max: 120, about: 'A letter or e-mail answering a situation.' },
        { id: 'gorus', name: 'Görüş yazısı', min: 150, max: 250, about: 'An opinion text with reasons and examples.' },
      ],
      rubric: 'Judge against CEFR writing descriptors for the chosen level: task and register, organisation, vocabulary, grammar (suffix order, vowel harmony, agreement).',
    },
  },
  {
    id: 'arabic_cefr',
    language: 'ar',
    name: 'Arabic proficiency (CEFR)',
    levels: ['A1', 'A2', 'B1', 'B2', 'C1'],
    defaultLevel: 'A2',
    guidance:
      'CEFR-aligned Arabic proficiency test style (Modern Standard Arabic). Reading: short texts with multiple choice (→ mcq_single), صح/خطأ (→ true_false), matching words or sentences (→ matching). Grammar and morphology: choose the correct form (verb pattern, case ending, agreement, dual/plural) → mcq_single or gap_fill. Writing: a short message and a paragraph/essay by level. Fully vowel (tashkīl) texts at A1–A2 only. Instructions in Arabic.',
    writing: {
      scale: GENERIC_WRITING,
      tasks: [
        { id: 'message', name: 'رسالة قصيرة (short message)', min: 40, max: 80, about: 'A short message answering a situation.' },
        { id: 'essay', name: 'فقرة / مقال (paragraph / essay)', min: 100, max: 200, about: 'A paragraph or short essay on a topic, length by level.' },
      ],
      rubric: 'Judge against CEFR writing descriptors for the chosen level: task, organisation, vocabulary, grammar (agreement, case, verb forms), spelling (hamza, tāʾ marbūṭa).',
    },
  },
]

export const examById = (id: string | null | undefined) => EXAMS.find((e) => e.id === id) ?? null

/** The exam styles offered for a language — never another language's exams */
export const examsFor = (language: LanguageCode | null | undefined) => (language ? EXAMS.filter((e) => e.language === language) : [])

/** The exam's writing spec at a level, or null when that level (or the whole exam) has no writing */
export function examWriting(exam: Exam | null, level?: string | null) {
  if (!exam) return null
  if (!exam.writing || (level && exam.noWritingLevels?.includes(level))) return null
  return exam.writing
}

// ─── language guess (composer default; the teacher can always change it) ────

/**
 * Teachers write in Korean, so Hangul alone says nothing about the language being taught: only a language's name, its
 * exams, or its own script count.
 */
const HINTS: Record<LanguageCode, RegExp> = {
  en: /\b(english|ielts|toefl|toeic|teps|csat|cambridge|fce|cae|past simple|present (simple|perfect|continuous))\b|영어|영문법|토익|토플|텝스|아이엘츠/i,
  ru: /\b(russian|torfl|trki)\b|러시아어|[Ѐ-ӿ]/i,
  ko: /\b(korean|topik)\b|토픽|한국어능력시험|한국어 ?교육|한국어 ?수업/i,
  zh: /\b(chinese|hsk|mandarin)\b|중국어|[一-鿿]/i,
  ja: /\b(japanese|jlpt)\b|일본어|[぀-ヿ]/i,
  tr: /\b(turkish|tömer|tomer)\b|터키어|튀르키예어|türkçe/i,
  de: /\b(german|deutsch|goethe|testdaf)\b|독일어/i,
  fr: /\b(french|français|francais|delf|dalf)\b|프랑스어|불어/i,
  es: /\b(spanish|español|espanol|dele)\b|스페인어/i,
  ar: /\b(arabic)\b|아랍어|[؀-ۿ]/i,
}

/**
 * Best guess of the language being taught, strongest signal first: the teacher's own words, then file names,
 * then what their recent homework was in, then their profile subjects. null = don't know (no exam styles).
 */
export function guessLanguage(input: { text?: string; fileNames?: string[]; recent?: string[]; subjects?: string[] }): LanguageCode | null {
  const scan = (s: string) => {
    // Chinese characters also appear in Japanese: kana decides
    if (HINTS.ja.test(s)) return 'ja' as LanguageCode
    for (const code of LANGUAGE_CODES) if (code !== 'ja' && HINTS[code].test(s)) return code
    return null
  }
  const fromText = input.text ? scan(input.text) : null
  if (fromText) return fromText
  for (const f of input.fileNames ?? []) {
    const hit = scan(f.replace(/[_\-.]+/g, ' '))
    if (hit) return hit
  }
  const recent = (input.recent ?? []).map((l) => l.slice(0, 2).toLowerCase()).filter((l): l is LanguageCode => (LANGUAGE_CODES as string[]).includes(l))
  if (recent.length) {
    const counts = new Map<LanguageCode, number>()
    for (const l of recent) counts.set(l, (counts.get(l) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0]
  }
  const fromProfile = (input.subjects ?? []).map((s) => SUBJECT_LANGUAGE[s as keyof typeof SUBJECT_LANGUAGE]).filter(Boolean)
  // Korean is also the instruction language: only guess it when it's the teacher's only language
  const foreign = fromProfile.filter((l) => l !== 'ko')
  return foreign[0] ?? fromProfile[0] ?? null
}

// ─── essay score arithmetic (in code, not left to the model) ────────────────

/** Words, or characters (spaces included, as TOPIK counts) for Korean/Chinese/Japanese */
export function textLength(text: string, unit: 'words' | 'chars') {
  const t = text.trim()
  if (!t) return 0
  return unit === 'chars' ? t.length : t.split(/\s+/).length
}

export const overallMax = (s: WritingScale) => (s.aggregate === 'sum' ? s.criteria.reduce((a, c) => a + c.max, 0) : Math.max(...s.criteria.map((c) => c.max)))

/**
 * Overall from per-criterion scores. IELTS-style mean: rounded to the nearest half band, with .25 → .5 and
 * .75 → next whole band (the public IELTS rounding rule). Sum: plain total.
 */
export function overallScore(s: WritingScale, scores: Record<string, number>): number {
  const vals = s.criteria.map((c) => Math.max(0, Math.min(c.max, scores[c.id] ?? 0)))
  if (s.aggregate === 'sum') return Math.round(vals.reduce((a, v) => a + v, 0) / s.step) * s.step
  const mean = vals.reduce((a, v) => a + v, 0) / vals.length
  // +1e-9 so that exactly .25/.75 round up, as IELTS does
  return Math.min(overallMax(s), Math.round(mean / s.step + 1e-9) * s.step)
}

export function formatOverall(s: WritingScale, overall: number) {
  const max = overallMax(s)
  const v = Number.isInteger(overall) ? String(overall) : overall.toFixed(1)
  return s.label === 'band' ? `Band ${v}` : `${v}/${max}`
}
