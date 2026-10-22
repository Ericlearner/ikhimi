/**
 * Seed content for the `methodologyDocs` table (§8.5). Source of truth lives in
 * `../content/methodology.json`; `scripts/seed.ts` embeds and upserts these into the DB.
 *
 * Bodies are written compact and imperative (100-200 words, ending in a named failure pattern)
 * because 2-4 of them get injected into every generation prompt — not for human reading. The
 * longer, human-readable versions of these same methodologies live outside the repo for teacher
 * review before content changes land here.
 */
import methodology from '../content/methodology.json'

export type MethodologyDocSeed = {
  subject: string
  title: string
  tags: string[]
  locale: string
  body: string
}

export const PEDAGOGY_CONTENT: MethodologyDocSeed[] = methodology
