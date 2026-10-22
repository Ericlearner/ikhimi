/**
 * What a generated homework must get right, checked without a person: the language being taught, the teacher's exact
 * counts and kinds, every planned item written, no item that breaks a rule (asks to speak where students type, "listen"
 * with nothing to hear…), instructions in the teacher's script. Soft checks (time, solve-back) are reported, not failed
 * per request; solve-back agreement is gated over the whole suite.
 */
import { itemProblem, type ExerciseKind, type GenerateResult, type HomeworkPlan, type InstructionLocale } from '@ikhimi/ai'

export type Expect = {
  /** ISO code of the language being taught */
  contentLanguage: string
  /** The teacher named a number of items: the plan's parts add up to exactly this (vocabulary repetition comes on top) */
  total?: number
  /** Exactly this many of each kind */
  kinds?: Partial<Record<ExerciseKind, number>>
  /** At least this many of each kind (the teacher named one part, the planner chose the rest) */
  kindsAtLeast?: Partial<Record<ExerciseKind, number>>
  /** Vocabulary repetition on or off */
  vocab?: boolean
  /** Skills the plan must have a part for */
  skillsInclude?: string[]
}

export type Fixture = { id: string; locale: InstructionLocale; text: string; minutes: number; difficulty?: 1 | 2 | 3 | 4 | 5; expect: Expect }

export type Check = { name: string; ok: boolean; detail?: string; soft?: boolean }

/** Items per kind across the plan's parts */
export function plannedKinds(plan: HomeworkPlan): Map<string, number> {
  const by = new Map<string, number>()
  for (const s of plan.sections) for (const k of s.kinds) by.set(k.kind, (by.get(k.kind) ?? 0) + k.count)
  return by
}
export const plannedTotal = (plan: HomeworkPlan) => [...plannedKinds(plan).values()].reduce((a, b) => a + b, 0)

const lang = (s: string | null | undefined) => (s ?? '').toLowerCase().split(/[-_]/)[0]

export function checkHomework(f: Fixture, plan: HomeworkPlan, result: GenerateResult): Check[] {
  const e = f.expect
  const draft = result.draft
  const items = draft.exercises
  const main = items.filter((x) => !x.vocab)
  const kinds = plannedKinds(plan)
  const total = plannedTotal(plan)
  const checks: Check[] = []

  const gotLang = `${lang(plan.contentLanguage)}/${lang(draft.contentLanguage)}`
  checks.push({ name: 'language', ok: lang(plan.contentLanguage) === e.contentLanguage && lang(draft.contentLanguage) === e.contentLanguage, detail: `want ${e.contentLanguage}, got ${gotLang}` })

  if (e.total !== undefined) {
    checks.push({ name: 'count', ok: total === e.total && plan.teacherSetCount, detail: `want ${e.total}, planned ${total}${plan.teacherSetCount ? '' : ' (teacherSetCount off)'}` })
  }
  for (const [kind, n] of Object.entries(e.kinds ?? {})) {
    checks.push({ name: `kind:${kind}`, ok: (kinds.get(kind) ?? 0) === n, detail: `want ${n}, planned ${kinds.get(kind) ?? 0}` })
  }
  for (const [kind, n] of Object.entries(e.kindsAtLeast ?? {})) {
    checks.push({ name: `kind≥:${kind}`, ok: (kinds.get(kind) ?? 0) >= n!, detail: `want ≥${n}, planned ${kinds.get(kind) ?? 0}` })
  }
  if (e.vocab !== undefined) checks.push({ name: 'vocab', ok: plan.vocabRepetition === e.vocab, detail: `want ${e.vocab}, got ${plan.vocabRepetition}` })
  for (const skill of e.skillsInclude ?? []) {
    checks.push({ name: `skill:${skill}`, ok: plan.sections.some((s) => s.skill === skill), detail: `parts: ${plan.sections.map((s) => s.skill).join(', ')}` })
  }

  // Every planned item was written (counts are a promise to the teacher)
  const sections = result.meta.plan?.sections ?? []
  const short = sections.filter((s) => s.written < s.asked)
  checks.push({ name: 'written', ok: main.length === total && !short.length, detail: `${main.length}/${total} items${short.length ? `; short: ${short.map((s) => `${s.id} ${s.written}/${s.asked}`).join(', ')}` : ''}` })

  const problems = items.map((x, i) => ({ i, p: itemProblem(structuredClone(x)) })).filter((x) => x.p)
  checks.push({ name: 'structure', ok: !problems.length, detail: problems.length ? problems.map((x) => `#${x.i + 1}: ${x.p}`).join('; ') : `${items.length} items` })

  checks.push({ name: 'script', ok: result.meta.instructionsScriptOk, detail: `instructions in ${f.locale}` })

  // Soft: about the time asked for (only when the teacher didn't fix the counts), and the solver agreeing with the key
  if (e.total === undefined && !e.kinds) {
    const off = Math.abs(draft.estimatedMinutes - f.minutes) / f.minutes
    checks.push({ name: 'time', ok: off <= 0.25, soft: true, detail: `${draft.estimatedMinutes} min for ${f.minutes}` })
  }
  const disagree = items.filter((x) => x.flags.includes('solve_back_disagrees')).length
  checks.push({ name: 'solve-back', ok: disagree === 0, soft: true, detail: `${items.length - disagree}/${items.length} agreed` })
  return checks
}
