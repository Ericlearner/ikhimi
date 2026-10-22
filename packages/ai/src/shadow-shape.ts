/**
 * Shadowing results and pass rules, shared by the server (pronounce.ts) and the player in the browser
 * (`@ikhimi/ai/shadow-shape`, no imports).
 */

/** A sentence passes at this score (0–100) */
export const PASS_SCORE = 70
/** After this many tries the student may move on; the sentence stays "not passed" */
export const MAX_TRIES = 5

/** One sentence's result, kept on the student's response (written by the server only) */
export type ShadowLine = { best: number; tries: number; passed: boolean; missed: string[]; tip: string }
export type ShadowValue = { lines: (ShadowLine | null)[] }

/** A sentence is finished when it passed, or was tried enough times to move on */
export const lineFinished = (l: ShadowLine | null | undefined) => !!l && (l.passed || l.tries >= MAX_TRIES)

/** Every sentence finished */
export const shadowFinished = (v: ShadowValue | null | undefined, lines: number) => !!v && Array.from({ length: lines }, (_, i) => v.lines[i]).every(lineFinished)
