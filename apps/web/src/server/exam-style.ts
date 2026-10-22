import { examById, type LanguageCode } from '@ikhimi/ai'

/**
 * The composer's language + exam choice, checked on the server: the exam must exist, have that level, and
 * belong to the chosen language — so an Arabic style can never be used for English, whatever the client sends.
 */
export function examFor(input: { language?: LanguageCode | null; exam?: { id: string; level: string } | null }) {
  if (!input.exam) return { ok: true as const, exam: null, language: input.language ?? null }
  const e = examById(input.exam.id)
  if (!e || !e.levels.includes(input.exam.level)) return { ok: false as const }
  if (input.language && input.language !== e.language) return { ok: false as const }
  return { ok: true as const, exam: { id: e.id, level: input.exam.level }, language: e.language }
}
