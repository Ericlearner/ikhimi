/**
 * Shadowing check: the student's voice for ONE sentence goes to the model with the sentence, and comes back as a
 * score, the words that were wrong, and one tip. The audio is never stored (decided 2026-10): the caller passes it
 * in, and nothing here keeps it. Only the result is kept.
 */
import { LANGUAGE_NAME, type LanguageCode } from './exams'
import { LOCALE_NAME, type InstructionLocale } from './generate'
import type { LlmProvider, LlmUsage } from './llm/types'
import { PASS_SCORE, type ShadowLine } from './shadow-shape'

export * from './shadow-shape'

const SCHEMA = {
  type: 'object',
  properties: {
    heard: { type: 'string', description: 'What the student actually said, as text' },
    score: { type: 'integer', description: '0-100: sounds, word stress and intonation compared with the target sentence' },
    missed: { type: 'array', items: { type: 'string' }, description: 'Words of the TARGET sentence that were mispronounced or left out, exactly as written in it' },
    tip: { type: 'string', description: 'ONE short, concrete tip in the instruction language about the biggest problem; empty if the score is 90+' },
  },
  required: ['score', 'missed', 'tip'],
}

export async function assessPronunciation(
  llm: LlmProvider,
  input: { audio: { mimeType: string; dataBase64: string }; text: string; language?: string | null; locale: InstructionLocale },
): Promise<{ score: number; missed: string[]; tip: string; usage: LlmUsage }> {
  const lang = LANGUAGE_NAME[input.language as LanguageCode] ?? 'the language of the sentence'
  const res = await llm.generateJson({
    task: 'grade',
    effort: 'low',
    maxOutputTokens: 2048,
    system: `You are a friendly pronunciation teacher for learners of ${lang} whose first language is Korean. Listen to the recording of a student repeating the TARGET sentence and judge their pronunciation. Return JSON only.

- score 0-100 for how well they said the target sentence: individual sounds, word stress, and intonation/rhythm.
- Be fair: an understandable foreign accent is fine. Lower the score only for mistakes that change a word or make it hard to understand, wrong word stress, flat or wrong intonation, and missing words.
- 90+: clear and natural. 70-89: understandable with small slips. 40-69: several words wrong or hard to follow. Below 40: mostly not the sentence.
- Silence, noise only, or a different sentence: score 0, tip asking them to say the sentence.
- missed: the target's words they got wrong or left out, written exactly as in the target.
- tip in ${LOCALE_NAME[input.locale]}: one short concrete instruction (how to place the tongue or lips, which syllable to stress, where the voice goes up), never a general "practise more".`,
    parts: [{ text: `TARGET: ${input.text}` }, { mimeType: input.audio.mimeType, dataBase64: input.audio.dataBase64 }],
    schema: SCHEMA,
    temperature: 0,
  })
  const r = res.json as { score?: number; missed?: string[]; tip?: string }
  const words = new Set(input.text.toLowerCase().match(/[\p{L}\p{M}'’-]+/gu) ?? [])
  return {
    score: Math.max(0, Math.min(100, Math.round(Number(r.score) || 0))),
    // Only words that are really in the sentence, so the red marks always land on it
    missed: [...new Set((r.missed ?? []).map((w) => w.trim()).filter((w) => words.has(w.toLowerCase())))].slice(0, 10),
    tip: (r.tip ?? '').trim().slice(0, 300),
    usage: res.usage,
  }
}

/** A new try folded into the sentence's result: the best score counts, every try is counted */
export function addTry(prev: ShadowLine | null | undefined, t: { score: number; missed: string[]; tip: string }): ShadowLine {
  const better = !prev || t.score >= prev.best
  return {
    best: Math.max(prev?.best ?? 0, t.score),
    tries: (prev?.tries ?? 0) + 1,
    passed: !!prev?.passed || t.score >= PASS_SCORE,
    missed: better ? t.missed : prev!.missed,
    tip: t.tip,
  }
}

