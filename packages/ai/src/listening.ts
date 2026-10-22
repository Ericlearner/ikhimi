/**
 * Listening items are written from the book before the recording exists in our system. When the teacher
 * attaches the audio, one multimodal call (a) confirms the recording really belongs to these items and
 * (b) takes the answers from what is actually said. A mismatch is refused, never silently attached.
 */
import { ANSWER_SCHEMA, itemsText, keyFrom, LOCALE, type Answer, type KeyedItem } from './answer-key'
import type { LlmProvider, LlmUsage } from './llm/types'
import type { InstructionLocale, Material } from './generate'

export type ListeningItem = KeyedItem

export type ListeningResult =
  | { matches: true; keys: (Record<string, unknown> | null)[]; explanations: (string | null)[]; usage: LlmUsage }
  | { matches: false; reason: string; usage: LlmUsage }

const SCHEMA = {
  type: 'object',
  properties: {
    matches: { type: 'boolean', description: 'true only if this recording is the one these exercises are about' },
    reason: { type: 'string', description: 'If it does not match: one short sentence in the instruction language saying why' },
    answers: {
      type: 'array',
      items: {
        ...ANSWER_SCHEMA,
        properties: {
          ...ANSWER_SCHEMA.properties,
          ordering: { type: 'array', items: { type: 'integer' }, description: 'item indexes in the order heard' },
          explanation: { type: 'string', description: 'One sentence in the instruction language, quoting what is said' },
        },
      },
    },
  },
  required: ['matches'],
}

export async function completeListening(
  llm: LlmProvider,
  input: { audio: Material; items: ListeningItem[]; instructionLocale: InstructionLocale },
): Promise<ListeningResult> {
  const res = await llm.generateJson({
    task: 'review',
    effort: 'high',
    system: `You check a teacher's audio recording against listening exercises and write their answer keys.
1. Listen to the whole recording. Decide whether it is the recording these exercises are about: the content must fit the exercises (and, when given, the label such as "Track 1.12"). A different track, a song, silence, or unrelated speech does NOT match — return matches=false with a reason in ${LOCALE[input.instructionLocale]}.
2. If it matches, answer every exercise strictly from what is said in the recording (never from general knowledge). Option/item indexes are 0-based positions in the arrays shown. Return JSON only.`,
    parts: [
      { text: `Audio file "${input.audio.label}":` },
      { mimeType: input.audio.mimeType, dataBase64: input.audio.dataBase64 },
      { text: `Exercises:\n${itemsText(input.items)}` },
    ],
    schema: SCHEMA,
    temperature: 0,
  })
  const json = res.json as { matches?: boolean; reason?: string; answers?: Answer[] }
  if (!json.matches) return { matches: false, reason: (json.reason ?? '').trim(), usage: res.usage }
  const answers = json.answers ?? []
  return {
    matches: true,
    keys: input.items.map((it, i) => keyFrom(it, answers.find((a) => a.n === i + 1))),
    explanations: input.items.map((_, i) => answers.find((a) => a.n === i + 1)?.explanation?.trim() || null),
    usage: res.usage,
  }
}
