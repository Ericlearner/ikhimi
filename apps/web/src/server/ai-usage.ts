/**
 * AI usage and cost. Every model call made for a user goes through `metered`, which writes one ai_calls row
 * (purpose, model, tokens, time). The admin panel turns those rows into money with `costUsd`.
 *
 * Prices are estimates per million tokens: set AI_PRICES to the real price list when it changes, e.g.
 * {"gemini-3.8-flash":[0.5,3],"pro":[2,12]} — the longest matching key (substring of the model name) wins.
 * Thinking tokens are billed as output.
 */
import { aiCalls, count, gte, sql, type Db } from '@ikhimi/db'
import { LlmError, type LlmProvider } from '@ikhimi/ai'

export type AiPurpose = 'plan' | 'pronounce' | 'tutor' | 'methods' | 'generate' | 'refine' | 'regenerate' | 'check' | 'grade' | 'regrade' | 'listening' | 'answers' | 'speech' | 'help'

export function metered(llm: LlmProvider, ctx: { db: Db; userId?: string | null; purpose: AiPurpose; refId?: string | null }): LlmProvider {
  const record = async (row: Omit<typeof aiCalls.$inferInsert, 'purpose' | 'userId' | 'refId'>) => {
    try {
      await ctx.db.insert(aiCalls).values({ ...row, purpose: ctx.purpose, userId: ctx.userId ?? null, refId: ctx.refId ?? null })
    } catch (e) {
      // Bookkeeping never breaks the teacher's or student's request
      console.warn('[ai-usage] could not record a call', e)
    }
  }
  return {
    name: llm.name,
    async generateJson(req) {
      const started = Date.now()
      try {
        const res = await llm.generateJson(req)
        await record({
          task: req.task ?? null,
          model: res.model,
          inputTokens: res.usage.inputTokens,
          outputTokens: res.usage.outputTokens,
          thoughtsTokens: res.usage.thoughtsTokens ?? 0,
          durationMs: Date.now() - started,
          ok: true,
        })
        return res
      } catch (e) {
        await record({ task: req.task ?? null, model: llm.name, durationMs: Date.now() - started, ok: false, error: e instanceof LlmError ? e.code : 'error' })
        await watchFailures(ctx.db)
        throw e
      }
    },
  }
}

/**
 * Checked only when a call fails: if the last 15 minutes have at least 5 failures and they are half the calls or more,
 * the AI is in trouble (a bad key, a quota, an outage) and the owner hears about it (once an hour).
 */
async function watchFailures(db: Db) {
  try {
    const since = new Date(Date.now() - 15 * 60_000)
    const [r] = await db
      .select({ all: count(), failed: sql<number>`count(*) filter (where ${aiCalls.ok} = false)`.mapWith(Number) })
      .from(aiCalls)
      .where(gte(aiCalls.createdAt, since))
    if (!r || r.failed < 5 || r.failed * 2 < r.all) return
    const { alertOwner } = await import('./notify')
    await alertOwner(db, 'ai-failures', `AI calls are failing: ${r.failed} of ${r.all} in the last 15 minutes. Check Admin → Health.`)
  } catch (e) {
    console.warn('[ai-usage] failure check', e)
  }
}

/** USD per million tokens [input, output]. Fallbacks by family when AI_PRICES doesn't name the model. */
const DEFAULT_PRICES: Record<string, [number, number]> = {
  'flash-lite': [0.1, 0.4],
  // Text-to-speech: audio output is billed far higher than text
  tts: [0.5, 10],
  flash: [0.5, 3],
  pro: [2, 12],
  demo: [0, 0],
}

function prices(): Record<string, [number, number]> {
  try {
    const custom = JSON.parse(process.env.AI_PRICES || '{}') as Record<string, [number, number]>
    return { ...DEFAULT_PRICES, ...custom }
  } catch {
    return DEFAULT_PRICES
  }
}

export function priceFor(model: string): [number, number] {
  const table = prices()
  const key = Object.keys(table)
    .filter((k) => model.toLowerCase().includes(k.toLowerCase()))
    .sort((a, b) => b.length - a.length)[0]
  return key ? table[key]! : table.flash!
}

export function costUsd(c: { model: string; inputTokens: number; outputTokens: number; thoughtsTokens: number }): number {
  const [i, o] = priceFor(c.model)
  return (c.inputTokens * i + (c.outputTokens + c.thoughtsTokens) * o) / 1_000_000
}

/** Won per dollar for showing costs; set USD_KRW when the rate moves */
export const usdToKrw = () => Number(process.env.USD_KRW) || 1_400
