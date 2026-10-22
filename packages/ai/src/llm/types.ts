/** Provider-neutral LLM interface. Gemini today; Claude is a drop-in adapter later (§6). */
/** Text, a file sent inline, or a file already uploaded to the provider (Gemini Files API: a whole book for the Lab) */
export type LlmPart = { text: string } | { mimeType: string; dataBase64: string } | { mimeType: string; fileUri: string }

export type JsonSchema = Record<string, unknown>

/**
 * What a call is for, so a provider can route it to the right model (DECISIONS.md AO):
 * generate = write homework; plan = read the pages and plan it; review = check/solve/repair it; grade = mark student
 * writing; fast = small chores; lab = the owner's Lab building a methodology's knowledge (rare, and every homework in that
 * style depends on it: the strongest model, never a weaker fallback).
 */
export type LlmTask = 'generate' | 'plan' | 'review' | 'grade' | 'fast' | 'lab'

export type LlmRequest = {
  task?: LlmTask
  /** How hard the model should think: high for writing and judging, low for mechanical checks */
  effort?: 'low' | 'high'
  system: string
  parts: LlmPart[]
  /** OpenAPI-style schema (Gemini responseSchema subset: type/properties/items/enum/required) */
  schema: JsonSchema
  temperature?: number
  maxOutputTokens?: number
  /** false: only this task's model; when it is busy the call fails instead of moving to a weaker fallback */
  fallback?: boolean
}

export type LlmUsage = {
  inputTokens: number
  outputTokens: number
  /** Tokens spent thinking (billed as output), when the model reports them */
  thoughtsTokens?: number
  /** Why the model stopped (STOP, MAX_TOKENS…), for diagnosing short answers */
  finishReason?: string
}

export interface LlmProvider {
  readonly name: string
  generateJson(req: LlmRequest): Promise<{ json: unknown; usage: LlmUsage; model: string }>
}

/**
 * Provider-neutral embedding interface, used by the pedagogy package's retrieval (§8.5). The output
 * dimensionality must match `EMBEDDING_DIMENSIONS` in @ikhimi/db's schema (1024).
 */
export interface EmbeddingProvider {
  readonly name: string
  embed(text: string): Promise<number[]>
}

/** Text-to-speech for vocabulary items: a word in, a playable audio file out */
export interface SpeechProvider {
  readonly name: string
  speak(text: string): Promise<{ mimeType: string; data: Buffer; model: string; usage: LlmUsage }>
}

export class LlmError extends Error {
  constructor(
    message: string,
    public readonly code: 'rate_limited' | 'blocked' | 'bad_output' | 'too_long' | 'unavailable' | 'config',
  ) {
    super(message)
    this.name = 'LlmError'
  }
}
