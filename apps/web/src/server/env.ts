import { z } from 'zod'

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  // Storage settings are read by @ikhimi/db/storage when an upload happens; optional here so a
  // deployment without storage (e.g. a Vercel preview) can still serve login.
  /** AI for homework generation and grading: https://aistudio.google.com/apikey */
  GEMINI_API_KEY: z.string().optional(),
  /** Default model for every task (and the first fallback when a task's own model is busy) */
  GEMINI_MODEL: z.string().default('gemini-3.8-flash'),
  /** Per-task models (DECISIONS.md AO). Unset = GEMINI_MODEL. On a paid plan: the strongest model for GENERATE, REVIEW and GRADE. */
  GEMINI_MODEL_GENERATE: z.string().optional(),
  GEMINI_MODEL_PLAN: z.string().optional(),
  GEMINI_MODEL_REVIEW: z.string().optional(),
  GEMINI_MODEL_GRADE: z.string().optional(),
  GEMINI_MODEL_FAST: z.string().optional(),
  /** The owner's Lab (DECISIONS.md BG). Unset = the strongest one set: GENERATE, then REVIEW, then GEMINI_MODEL */
  GEMINI_MODEL_LAB: z.string().optional(),
  /** Text-to-speech for vocabulary pronunciation (Create mode); "off" = vocabulary items without sound */
  GEMINI_MODEL_TTS: z.string().default('gemini-3.8-flash-lite-tts'),
  GEMINI_TTS_VOICE: z.string().optional(),
  /** Model reasoning: 'level' for Gemini 3 models, 'budget' for Gemini 2.5, 'off' = provider default */
  GEMINI_THINKING: z.enum(['off', 'level', 'budget']).default('off'),
  /** Second pass that checks and repairs each generated item (Create mode). '0' turns it off. */
  AI_REVIEW: z.enum(['0', '1']).default('1'),
  /** Comma-separated models tried in order when the main one is overloaded (Gemini 503/429) */
  GEMINI_FALLBACK_MODELS: z.string().default('gemini-flash-latest,gemini-flash-lite-latest'),
  /** Embeds methodologyDocs for retrieval (§8.5). Dimensions must match @ikhimi/db's EMBEDDING_DIMENSIONS. */
  GEMINI_EMBEDDING_MODEL: z.string().default('gemini-embedding-001'),
  S3_ENDPOINT: z.string().url().optional(),
  /** Endpoint the *browser* uploads to, if different from the server's (e.g. the store behind a proxy) */
  S3_PUBLIC_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('ikhimi'),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
})

export type Env = z.infer<typeof schema>

let cached: Env | undefined
export function env(): Env {
  cached ??= schema.parse(process.env)
  return cached
}
