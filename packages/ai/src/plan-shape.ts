/**
 * The shape of a homework plan and the sums the plan card shows (plan.ts makes plans). No model code here: the
 * composer imports it in the browser via `@ikhimi/ai/plan-shape`.
 */
import { SECONDS_PER_KIND, type ExerciseKind } from './exercises'

/** Skills a plan part can practise. No speaking: students are never recorded (pronunciation is practised by ear). */
export const PLAN_SKILLS = ['grammar', 'vocabulary', 'reading', 'writing', 'listening', 'pronunciation'] as const
export type PlanSkill = (typeof PLAN_SKILLS)[number]
export const PLAN_FOCUS = ['grammar', 'vocabulary', 'reading', 'writing', 'listening', 'mixed'] as const
export type PlanFocus = (typeof PLAN_FOCUS)[number]

/** One part of the homework, written by one writer: a few items of one or two kinds on one point */
export type PlanSection = {
  id: string
  /** Short heading for the teacher, in the instruction language */
  title: string
  skill: PlanSkill
  /** Exactly how many items of each kind */
  kinds: { kind: ExerciseKind; count: number }[]
  /** What exactly the items practise, for the writer */
  about: string
  /** Reading: one passage is written first and the items ask about it */
  passage: boolean
  /** The items use pictures from the materials */
  pictures: boolean
  /** The chosen style's task this part builds toward (the Lab's t1, t2…), when it has one */
  task?: string | null
}

/** A word worth repeating: in the language being taught, with a short meaning in the instruction language */
export type PlanWord = { word: string; meaning: string }

export type HomeworkPlan = {
  title: string
  instructions: string
  rationale: string
  contentLanguage: string
  level: string | null
  focus: PlanFocus
  grammarPoints: string[]
  /** The AI's pick of new and difficult words; the teacher never has to edit them */
  words: PlanWord[]
  sections: PlanSection[]
  /** Short vocabulary items mixed into the homework (on unless the teacher turns it off) */
  vocabRepetition: boolean
  /** The teacher named the number of items: never drop one */
  teacherSetCount: boolean
  /** Anything else the teacher asked for that the writers must respect, in English */
  notes: string
}

/** What the teacher chose for this course before, so the next plan starts from it */
export type PlanPrefs = {
  vocabRepetition?: boolean
  /** Kinds the teacher keeps adding (+) or removing (−), from −3 to 3 */
  kindBias?: Partial<Record<ExerciseKind, number>>
}

/** Limits that keep a homework doable and the writers' jobs small */
export const PLAN_LIMITS = { sections: 6, perKind: 15, items: 30, words: 10, wordsMin: 4 }

/** Items the sections add up to (vocabulary items not included) */
export const planItemCount = (p: Pick<HomeworkPlan, 'sections'>) => p.sections.reduce((s, x) => s + x.kinds.reduce((a, k) => a + k.count, 0), 0)

/**
 * The short vocabulary items for the plan's words: every word is met once early (pick the meaning, or hear it and
 * pick it), and about half come back near the end to be recalled (type it, or put it in a sentence).
 */
export function vocabCounts(p: Pick<HomeworkPlan, 'words' | 'vocabRepetition'>): { meet: number; recall: number } {
  if (!p.vocabRepetition || !p.words.length) return { meet: 0, recall: 0 }
  const meet = Math.min(8, p.words.length)
  return { meet, recall: Math.ceil(meet / 2) }
}

/** Rough minutes for the plan, for the card; the real estimate comes from the written items */
export function planMinutes(p: HomeworkPlan): number {
  const v = vocabCounts(p)
  const secs = p.sections.reduce((s, x) => s + x.kinds.reduce((a, k) => a + k.count * SECONDS_PER_KIND[k.kind], 0) + (x.passage ? 120 : 0), 0) + (v.meet + v.recall) * 20
  return Math.max(1, Math.round(secs / 60))
}

