/**
 * Runs every fixture through the real Create pipeline (plan → parts written in parallel → solve-back → review), checks
 * each homework (checks.ts), prints a table and saves the details to evals/results/. Exit code 1 when a hard check
 * fails or solve-back agreement over the suite is under 95%.
 *
 *   pnpm --filter @ikhimi/evals eval                       # all fixtures
 *   pnpm --filter @ikhimi/evals eval -- --only=en-count  # some (comma-separated ids)
 *
 * Needs GEMINI_API_KEY (read from apps/web/.env.local when not set). Costs real AI calls: about 8–12 per fixture.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateAssignment, GeminiProvider, planHomework, type LlmProvider } from '@ikhimi/ai'
import { guessLanguage } from '@ikhimi/ai/exams'
import { checkHomework, plannedTotal, type Check, type Fixture } from './checks'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

/** KEY=value lines from apps/web/.env.local, without overriding what's already set */
function loadEnv(file: string) {
  if (!existsSync(file)) return
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
    if (!m || process.env[m[1]!] !== undefined) continue
    process.env[m[1]!] = m[2]!.replace(/^(['"])(.*)\1$/, '$2')
  }
}

function provider(): LlmProvider {
  loadEnv(resolve(root, '../apps/web/.env.local'))
  const e = process.env
  if (!e.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set (apps/web/.env.local or the environment)')
  return new GeminiProvider({
    apiKey: e.GEMINI_API_KEY,
    model: e.GEMINI_MODEL || 'gemini-3.8-flash',
    fallbackModels: (e.GEMINI_FALLBACK_MODELS || 'gemini-flash-latest,gemini-flash-lite-latest').split(',').map((m) => m.trim()),
    models: { generate: e.GEMINI_MODEL_GENERATE, plan: e.GEMINI_MODEL_PLAN, review: e.GEMINI_MODEL_REVIEW, grade: e.GEMINI_MODEL_GRADE, fast: e.GEMINI_MODEL_FAST },
    thinking: (e.GEMINI_THINKING as 'off' | 'level' | 'budget' | undefined) || 'off',
  })
}

type Outcome = { id: string; ms: number; items: number; planned: number; checks: Check[]; error?: string }

async function runOne(llm: LlmProvider, f: Fixture): Promise<Outcome> {
  const started = Date.now()
  // As the composer does: the language is guessed from the teacher's words
  const language = guessLanguage({ text: f.text })
  const base = { teacherText: f.text, materials: [], instructionLocale: f.locale, targetMinutes: f.minutes, difficulty: f.difficulty ?? 3, language }
  try {
    const { plan } = await planHomework(llm, base)
    const result = await generateAssignment(llm, { ...base, mode: 'create', plan, review: process.env.AI_REVIEW !== '0', speech: true })
    return { id: f.id, ms: Date.now() - started, items: result.draft.exercises.length, planned: plannedTotal(plan), checks: checkHomework(f, plan, result) }
  } catch (e) {
    return { id: f.id, ms: Date.now() - started, items: 0, planned: 0, checks: [{ name: 'generated', ok: false, detail: String(e).slice(0, 300) }], error: String(e) }
  }
}

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=') as [string, string]))
  const all = JSON.parse(readFileSync(resolve(root, 'fixtures/requests.json'), 'utf8')) as Fixture[]
  const only = args.only ? new Set(args.only.split(',')) : null
  const fixtures = only ? all.filter((f) => only.has(f.id)) : all
  if (!fixtures.length) throw new Error(`no fixture matches ${args.only}`)
  const llm = provider()
  const concurrency = Math.max(1, Number(args.concurrency) || 2)

  const outcomes: Outcome[] = []
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(concurrency, fixtures.length) }, async () => {
      while (next < fixtures.length) {
        const f = fixtures[next++]!
        const o = await runOne(llm, f)
        outcomes.push(o)
        const hard = o.checks.filter((c) => !c.ok && !c.soft)
        const soft = o.checks.filter((c) => !c.ok && c.soft)
        console.log(
          `${hard.length ? '✗' : '✓'} ${o.id.padEnd(22)} ${String(Math.round(o.ms / 1000)).padStart(4)} s  ${String(o.items).padStart(3)} items` +
            (hard.length ? `  FAIL ${hard.map((c) => `${c.name} (${c.detail})`).join('; ')}` : '') +
            (soft.length ? `  warn ${soft.map((c) => `${c.name} (${c.detail})`).join('; ')}` : ''),
        )
      }
    }),
  )

  // Suite gates: every hard check, and solve-back agreement over all items
  const failed = outcomes.filter((o) => o.checks.some((c) => !c.ok && !c.soft))
  let agreed = 0
  let total = 0
  for (const o of outcomes) {
    const m = /(\d+)\/(\d+) agreed/.exec(o.checks.find((c) => c.name === 'solve-back')?.detail ?? '')
    if (m) {
      agreed += Number(m[1])
      total += Number(m[2])
    }
  }
  const agreement = total ? agreed / total : 1
  console.log(`\n${outcomes.length - failed.length}/${outcomes.length} passed · solve-back ${Math.round(agreement * 1000) / 10}% (gate 95%)`)

  const dir = resolve(root, 'results')
  mkdirSync(dir, { recursive: true })
  const file = resolve(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), model: process.env.GEMINI_MODEL_GENERATE || process.env.GEMINI_MODEL, agreement, outcomes }, null, 2))
  console.log(`details: ${file}`)
  process.exitCode = failed.length || agreement < 0.95 ? 1 : 0
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
