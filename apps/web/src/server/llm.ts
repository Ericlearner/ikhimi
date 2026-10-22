import { GeminiEmbeddingProvider, GeminiFiles, GeminiProvider, type EmbeddingProvider, type LlmProvider } from '@ikhimi/ai'
import { getDb } from '@ikhimi/db'
import { metered, type AiPurpose } from './ai-usage'
import { env } from './env'

/** The model, with every call recorded for cost and health (ai-usage.ts) */
export function getMeteredLlm(ctx: { userId?: string | null; purpose: AiPurpose; refId?: string | null }): LlmProvider | null {
  const base = getLlm()
  return base ? metered(base, { db: getDb(), ...ctx }) : null
}

let llm: LlmProvider | undefined
export function getLlm(): LlmProvider | null {
  const e = env()
  if (e.GEMINI_API_KEY) {
    llm ??= new GeminiProvider({
      apiKey: e.GEMINI_API_KEY,
      model: e.GEMINI_MODEL,
      fallbackModels: e.GEMINI_FALLBACK_MODELS.split(',').map((m) => m.trim()),
      models: {
        generate: e.GEMINI_MODEL_GENERATE,
        plan: e.GEMINI_MODEL_PLAN,
        review: e.GEMINI_MODEL_REVIEW,
        grade: e.GEMINI_MODEL_GRADE,
        fast: e.GEMINI_MODEL_FAST,
        // A methodology is written once and used by every homework in its style: the strongest model there is
        lab: e.GEMINI_MODEL_LAB || e.GEMINI_MODEL_GENERATE || e.GEMINI_MODEL_REVIEW,
      },
      thinking: e.GEMINI_THINKING,
    })
    return llm
  }
  // Local demos/tests without a key. Never in production.
  if (process.env.LLM_FAKE === '1' && e.NODE_ENV !== 'production') return demoLlm
  return null
}

/** Methodology retrieval (§8.5). Only methodology text is ever embedded — never student/teacher content. */
let embedder: EmbeddingProvider | undefined
/** The Gemini Files API, for whole books in the owner's Lab (lab-uploads.ts); null without a key */
export function getGeminiFiles(): GeminiFiles | null {
  const key = env().GEMINI_API_KEY
  return key ? new GeminiFiles(key) : null
}

export function getEmbeddingProvider(): EmbeddingProvider | null {
  const e = env()
  if (!e.GEMINI_API_KEY) return null
  embedder ??= new GeminiEmbeddingProvider({ apiKey: e.GEMINI_API_KEY, model: e.GEMINI_EMBEDDING_MODEL })
  return embedder
}

/** Demo pronunciation checker: tries per sentence */
const demoTries = new Map<string, number>()

const demoLlm: LlmProvider = {
  name: 'demo',
  async generateJson(req) {
    await new Promise((r) => setTimeout(r, 800))
    const usage = { inputTokens: 0, outputTokens: 0 }
    if (req.system.includes('Grade ONE student essay')) {
      // Demo examiner: about two thirds of every criterion, with the exam's own criterion ids
      const criteria = [...req.system.matchAll(/^- (\w+): .*?0–(\d+)\)/gm)].map((m) => ({ id: m[1]!, score: Math.round(Number(m[2]) * 0.65), feedback: '주장은 분명하지만 예시가 부족해요.' }))
      return {
        json: {
          criteria,
          levelEstimate: 'B2',
          strengths: ['입장이 분명하게 드러나 있어요', '문단이 논리적으로 이어져요'],
          improvements: ['각 주장을 예시로 뒷받침하세요', '복문을 더 많이 써 보세요'],
          corrections: [{ original: 'peoples thinks', corrected: 'people think', why: 'people은 복수라서 동사에 -s를 붙이지 않아요' }],
          summary: '좋은 에세이예요. 생각이 분명해요. 다음에는 이유마다 예시를 들어 보세요.',
        },
        usage,
        model: 'demo',
      }
    }
    if (req.system.includes("grading a student's own sentences")) {
      // Demo grader: a he/she/it sentence without -s is wrong, everything else passes
      const sent = JSON.parse((req.parts[0] as { text: string }).text).studentSentences as { n: number; text: string }[]
      const bad = (s: string) => /\b(he|she|it)\s+(play|like|go|watch|live|work)\b/i.test(s)
      return {
        json: {
          lines: sent.map((s) => ({ n: s.n, ok: !bad(s.text), correction: s.text.replace(/\b(play|like|go|watch|live|work)\b/i, (w) => (w.toLowerCase() === 'go' ? 'goes' : `${w}s`)), feedback: bad(s.text) ? '주어가 he/she/it이면 동사에 -s를 붙여요' : '맞아요' })),
          summary: 'Present Simple을 잘 쓰고 있어요. 주어가 he/she/it일 때 동사 끝의 -s를 잊지 마세요.',
        },
        usage,
        model: 'demo',
      }
    }
    if (req.system.includes("You are 익히미's tutor")) {
      const again = req.system.includes('DIFFERENT, simpler')
      const json = req.system.includes('wants to practise')
        ? { text: '같이 하나 풀어 봐요 💪', example: '', practice: { question: 'My family ___ at home now.', options: ['is', 'are'], answers: ['is'], why: '«family»는 하나의 가족이라서 «is»를 써요.' } }
        : req.system.includes('asked for another example')
          ? { text: '여기서 «nobody»도 단수라서 «is»를 써요.', example: 'Nobody is sleeping in class.' }
          : again
            ? { text: '다르게 설명해 볼게요: «everybody»는 ‘모두’라는 뜻이지만, ‘반’처럼 한 무리를 가리켜요. ‘반이 기다리고 있다’처럼 동사는 단수예요 🙂', example: 'The whole class is waiting.' }
            : { text: '«are waiting»을 골랐어요. «everybody»는 복수처럼 느껴지지만 문법적으로는 단수라서 «is»를 써요. 지금 일어나는 일에는 is + 동사-ing를 써요.', example: 'Everybody is laughing now.' }
      return {
        json,
        usage,
        model: 'demo',
      }
    }
    if (req.system.includes("익히미's help assistant")) {
      // Demo help chat: anything about books is copying; anything else isn't in the guide
      const q = JSON.parse((req.parts[0] as { text: string }).text).question as string
      const json = /교재|책|book/i.test(q)
        ? { answer: '1. 홈에서 «교재 문제 옮기기»를 고르세요.\n2. 페이지를 찍거나 PDF를 추가하세요.\n3. 보내기 버튼을 누르세요.', topic: 'digitize', links: ['home'], gist: '' }
        : { answer: '이 내용은 가이드에 없어요. 질문을 팀에 보낼 수 있어요.', topic: 'unknown', links: [], gist: q.toLowerCase().slice(0, 60) }
      return { json, usage, model: 'demo' }
    }
    if (req.system.includes("익히미's private Lab")) {
      // Demo researcher: two new points from a resource, sharpening the first one it already knows
      const has = /^k1 /m.test(req.system)
      return {
        json: {
          reply: 'Useful for Reading and Listening: how Not Given statements are built and how answers are worded. Skipped the background on the test and the sample answers.',
          changes: [
            { op: 'add', area: 'reading', text: 'A Not Given statement reuses a topic word from the passage but makes a claim the passage never makes, so students must check the claim, not the word.', why: 'The guide’s section on T/F/NG traps' },
            { op: 'add', area: 'listening', text: 'Form-completion answers are spelled out or given as numbers once in the recording; plan a distractor the speaker corrects right after.', why: 'The listening chapter on self-corrections' },
            ...(has ? [{ op: 'update', id: 'k1', area: 'general', text: 'Every item names its task type first, the way the exam paper does.', why: 'Sharper than the current wording' }] : []),
          ],
        },
        usage,
        model: 'demo',
      }
    }
    if (req.system.includes("pages of the book's answer key")) {
      // Demo answer pages: they cover the first exercise only
      return { json: { answers: [{ n: 1, blanks: [{ accepted: ['am'] }, { accepted: ['is'] }, { accepted: ['are'] }], explanation: '교재 정답: am, is, are.' }] }, usage, model: 'demo' }
    }
    if (req.system.includes("check a teacher's audio")) {
      return { json: { matches: true, answers: [{ n: 1, blanks: [{ accepted: ['London'] }, { accepted: ['ten', '10'] }], explanation: '"I live in London, I\'m ten."' }] }, usage, model: 'demo' }
    }
    const asked = req.parts.map((p) => ('text' in p ? p.text : '')).join('\n')
    if (req.system.includes('pronunciation teacher')) {
      // Demo checker: the first try of each sentence falls short, the next one passes
      const target = asked.replace('TARGET: ', '')
      demoTries.set(target, (demoTries.get(target) ?? 0) + 1)
      const first = demoTries.get(target) === 1
      const word = target.split(/\s+/)[1]?.replace(/[^\p{L}']/gu, '') ?? ''
      return { json: first ? { score: 58, missed: [word], tip: '혀를 이 사이에 살짝 두고 천천히 말해 보세요.' } : { score: 86, missed: [], tip: '' }, usage, model: 'demo' }
    }
    if (req.task === 'plan' && /발음|pronunciation/i.test(asked)) {
      return {
        json: {
          title: '발음: /θ/와 /s/',
          instructions: '듣고 알맞은 답을 고르세요.',
          rationale: '먼저 귀로, 그다음 단어, 그다음 문장: 쉐도잉으로 마무리해요.',
          contentLanguage: 'en',
          level: 'A2',
          focus: 'mixed',
          grammarPoints: [],
          words: [],
          sections: [
            { title: '최소 대립쌍', skill: 'pronunciation', kinds: [{ kind: 'mcq_single', count: 2 }], about: 'think/sink, thank/sank' },
            { title: '받아쓰기', skill: 'pronunciation', kinds: [{ kind: 'short_answer', count: 1 }], about: 'Listen and type' },
            { title: '쉐도잉', skill: 'pronunciation', kinds: [{ kind: 'shadowing', count: 1 }], about: 'A short text with th' },
          ],
          vocabRepetition: false,
          teacherSetCount: false,
          notes: '',
        },
        usage,
        model: 'demo',
      }
    }
    if (asked.includes('(skill: pronunciation)')) {
      return {
        json: {
          exercises: [
            { kind: 'mcq_single', skill: 'pronunciation', prompt: '듣고 들은 단어를 고르세요', options: ['think', 'sink'], correctOptionIndexes: [0], speak: 'think', explanation: 'th는 혀를 이 사이에 두고 발음해요.' },
            { kind: 'mcq_single', skill: 'pronunciation', prompt: '듣고 들은 단어를 고르세요', options: ['thank', 'sank'], correctOptionIndexes: [1], speak: 'sank', explanation: 's는 혀가 이 뒤에 있어요.' },
            { kind: 'short_answer', skill: 'pronunciation', prompt: '듣고 쓰세요', acceptedAnswers: ['three'], speak: 'three', explanation: 'three — 셋.' },
            { kind: 'shadowing', skill: 'pronunciation', prompt: '문장을 하나씩 듣고 음성과 함께 따라 말하세요', shadowingLines: ['I think it is Thursday.', 'Thank you for the three books.', 'They are on the sofa.'], explanation: '' },
          ],
        },
        usage,
        model: 'demo',
      }
    }
    if (req.task === 'plan') {
      return {
        json: {
          title: 'Past Simple: 불규칙 동사',
          instructions: '문제를 순서대로 풀어 보세요.',
          rationale: '익히기에서 자유 연습으로: 떠올리기와 단어 반복.',
          contentLanguage: 'en',
          level: 'A2',
          focus: 'grammar',
          grammarPoints: ['Past Simple: irregular verbs'],
          words: [
            { word: 'journey', meaning: '여행' },
            { word: 'bought', meaning: '샀다' },
            { word: 'tired', meaning: '피곤한' },
            { word: 'early', meaning: '일찍' },
          ],
          sections: [
            { title: '동사의 알맞은 형태', skill: 'grammar', kinds: [{ kind: 'mcq_single', count: 1 }, { kind: 'gap_fill', count: 1 }], about: 'Past Simple of irregular verbs' },
            { title: '지문: 경주 여행', skill: 'reading', kinds: [{ kind: 'true_false', count: 1 }, { kind: 'short_answer', count: 1 }], about: 'A trip to Gyeongju', passage: true },
            { title: '내 문장 쓰기', skill: 'writing', kinds: [{ kind: 'open_writing', count: 1 }], about: 'Write about last weekend' },
          ],
          vocabRepetition: true,
          teacherSetCount: false,
          notes: '',
        },
        usage,
        model: 'demo',
      }
    }
    if (req.system.includes('SHORT vocabulary')) {
      const text = (req.parts[0] as { text: string }).text
      const items = [...text.matchAll(/word «(.+?)» \(meaning: (.+?)\), stage (meet|recall), listen=(true|false)/g)].map(([, word, meaning, stage, listen]) =>
        stage === 'recall'
          ? { kind: 'short_answer', word, stage, prompt: `‘${meaning}’에 해당하는 단어를 쓰세요`, acceptedAnswers: [word], explanation: `${word} — ${meaning}.` }
          : listen === 'true'
            ? { kind: 'mcq_single', word, stage, speak: word, prompt: '듣고 들은 단어를 고르세요', options: [word, `${word}s`, 'garden', 'table'], correctOptionIndexes: [0], explanation: `${word} — ${meaning}.` }
            : { kind: 'mcq_single', word, stage, prompt: `«${word}»는 무슨 뜻인가요?`, options: [meaning, '집', '책', '나무'], correctOptionIndexes: [0], explanation: `${word} — ${meaning}.` },
      )
      return { json: { items }, usage, model: 'demo' }
    }
    if (req.system.includes('You DIGITIZE')) {
      return {
        json: {
          title: 'Unit 3: My family',
          instructions: '교재 문제를 풀어 보세요.',
          rationale: '12쪽: 1, 2, 3번',
          contentLanguage: 'en',
          cefrLevel: 'A2',
          exercises: [
            { kind: 'gap_fill', skill: 'grammar', prompt: '1. Complete with am, is or are.', gapText: 'I ___ a student. She ___ my sister. They ___ at home.', gapAnswers: [{ accepted: ['am'] }, { accepted: ['is'] }, { accepted: ['are'] }], answerSource: 'ai', sourceRef: 'Page 12, ex. 1', explanation: 'I → am, she → is, they → are.' },
            { kind: 'matching', skill: 'vocabulary', prompt: '2. Match the words.', pairs: [{ left: 'mother', right: '엄마' }, { left: 'father', right: '아빠' }, { left: 'sister', right: '자매' }], answerSource: 'answer_key', sourceRef: 'Page 12, ex. 2', explanation: '가족 구성원.' },
            { kind: 'gap_fill', skill: 'listening', prompt: '3. Listen and complete.', gapText: 'Tom lives in ___. He is ___ years old.', listening: true, audioLabel: 'Track 1.12', sourceRef: 'Page 12, ex. 3', explanation: '' },
          ],
          skipped: [{ ref: 'Page 12, ex. 4', reason: '에세이: 가족에 대해 쓰기 — 자동으로 채점할 수 없어요' }],
        },
        usage,
        model: 'demo',
      }
    }
    // A part of a planned homework (compose.ts) gets the demo homework; the composer keeps the kinds it asked for
    const part = req.parts.some((p) => 'text' in p && p.text.includes('YOUR PART'))
    const solving = !part && !('properties' in req.schema && 'title' in (req.schema.properties as object))
    if (solving) return { json: { answers: [] }, usage: { inputTokens: 0, outputTokens: 0 }, model: 'demo' }
    return {
      json: {
        title: 'Past Simple: irregular verbs',
        instructions: '문제를 순서대로 풀어 보세요. 질문마다 꼼꼼히 답하세요.',
        rationale: '익히기에서 자유 연습으로: 기억에 남도록 떠올리는 연습.',
        contentLanguage: 'en',
        cefrLevel: 'A2',
        exercises: [
          { kind: 'mcq_single', skill: 'grammar', prompt: 'Yesterday I ___ to the cinema.', options: ['went', 'go', 'goed', 'gone'], correctOptionIndexes: [0], explanation: 'go → went (불규칙 동사).' },
          { kind: 'gap_fill', skill: 'grammar', prompt: '', gapText: 'She ___ (buy) a new bag and ___ (see) her friend.', gapAnswers: [{ accepted: ['bought'] }, { accepted: ['saw'] }], explanation: 'buy → bought, see → saw.' },
          { kind: 'true_false', skill: 'grammar', prompt: '"Taked" is the past form of "take".', trueFalseAnswer: 'false', explanation: 'take → took.' },
          { kind: 'matching', skill: 'vocabulary', prompt: 'Match the verbs with their past forms.', pairs: [{ left: 'eat', right: 'ate' }, { left: 'write', right: 'wrote' }, { left: 'drink', right: 'drank' }], explanation: '세 동사 모두 불규칙 동사예요.' },
          { kind: 'ordering', skill: 'grammar', prompt: 'Put the words in order.', orderedItems: ['I', "didn't", 'see', 'him', 'yesterday'], explanation: "부정문: didn't + 동사원형." },
          { kind: 'short_answer', skill: 'writing', prompt: 'Write the past form of "think".', acceptedAnswers: ['thought'], explanation: 'think → thought.' },
          { kind: 'true_false', skill: 'reading', prompt: 'Minjun went to Gyeongju by train.', trueFalseAnswer: 'true', allowNotGiven: true, passageId: 'p1', explanation: '지문: "We took the train to Gyeongju."' },
          { kind: 'short_answer', skill: 'reading', prompt: 'What did they eat for lunch?', acceptedAnswers: ['bibimbap', 'They ate bibimbap.'], passageId: 'p1', explanation: '지문: "we ate bibimbap".' },
          {
            kind: 'essay',
            skill: 'writing',
            prompt: 'Some people think that travelling is the best way to learn about history. To what extent do you agree or disagree? Give reasons and examples.',
            essayTaskId: 'task2',
            essayTaskLabel: 'Opinion essay',
            essayMinLength: 120,
            essayMaxLength: 180,
            essayRubric: 'Clear position, two developed reasons with examples, a conclusion; Past Simple used correctly for past experiences.',
            essayModelAnswer: 'I strongly agree that travelling is a good way to learn about history. Last year I visited Gyeongju…',
            explanation: '생각을 분명히 밝히고 예시로 뒷받침하세요.',
          },
          {
            kind: 'open_writing',
            skill: 'writing',
            prompt: "Write 3 sentences about what you did last weekend.",
            writingLines: 3,
            writingChecklist: ['Past Simple을 사용하세요', '불규칙 동사를 하나 이상 쓰세요 (went, saw, ate…)'],
            writingRubric: 'Each sentence is in Past Simple, correctly formed (irregular verbs right, did + base form in negatives/questions), about the weekend.',
            writingExamples: ['I visited my grandmother on Saturday.', 'We went to the park.', "I didn't watch TV."],
            explanation: '과거시제: 동사의 과거형.',
          },
        ],
        passages: [{ id: 'p1', title: 'A trip', text: 'Last summer Minjun and his family visited Gyeongju. We took the train to Gyeongju early in the morning. We saw Bulguksa Temple and ate bibimbap for lunch. In the evening we walked by Woljeong Bridge. It was a wonderful day.' }],
      },
      usage: { inputTokens: 0, outputTokens: 0 },
      model: 'demo',
    }
  },
}
