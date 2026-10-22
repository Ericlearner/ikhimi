/**
 * Methodology knowledge base (§8.5). Seed content in `content/methodology.json` (embed + upsert via
 * `scripts/seed.ts`); retrieval in `retrieve.ts`, wired into the generate route.
 */
export { PEDAGOGY_CONTENT, type MethodologyDocSeed } from './content'
export { retrieveMethodology, type MethodologyNote, type RetrieveMethodologyParams } from './retrieve'

export const METHOD_TAGS = [
  'ppp',
  'task_based',
  'test_teach_test',
  'guided_discovery',
  'noticing',
  'controlled_to_freer',
  'receptive_before_productive',
  'spaced_repetition',
  'retrieval_practice',
  'interleaving',
  'elaborative_interrogation',
  'desirable_difficulty',
  'worked_example_fading',
] as const
export type MethodTag = (typeof METHOD_TAGS)[number]
