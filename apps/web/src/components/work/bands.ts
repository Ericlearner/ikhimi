import type { TaskIconName } from '@ikhimi/ui/components'

/** Score levels on the student's charts (tokens --score-strong / -mid / -low): shared by the server page and the client charts */
export type Band = 'strong' | 'mid' | 'low'
/** 80+ strong, 60–79 middle, below 60 needs practice */
export const band = (percent: number): Band => (percent >= 80 ? 'strong' : percent >= 60 ? 'mid' : 'low')
export const BAND_BG: Record<Band, string> = { strong: 'bg-score-strong', mid: 'bg-score-mid', low: 'bg-score-low' }

/** Each skill's picture (Fluent Emoji), on the skill map and the skill cards */
export const SKILL_ICON: Record<string, TaskIconName> = {
  listening: 'headphone',
  reading: 'open-book',
  writing: 'writing-hand',
  speaking: 'speech-balloon',
  grammar: 'puzzle-piece',
  vocabulary: 'books',
  pronunciation: 'studio-microphone',
}

/** The outlined card look (2px stroke, soft corners) used across My work and the analytics; HOT marks what to do now */
export const CARD = 'rounded-2xl border-2 border-paper-300 bg-paper-50'
export const CARD_HOT = 'rounded-2xl border-2 border-orange-500 bg-orange-100'
