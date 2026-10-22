/**
 * Sound system (design spec §8), voiced by UI SFX (github.com/romainsimon/uisfx: MIT code, CC0 audio).
 * Its sounds are synthesised in the browser from tiny recipes, so learners download nothing and nothing
 * waits on the network; the AudioContext starts only on a real user gesture.
 *
 * Our events stay semantic (answer.correct, streak…); each maps to a UI SFX cue. The two temperatures use
 * different packs: learners hear the pack they chose (lively by default), teachers a near-silent one.
 */
import { createUISFX, type CueName, type PackName, type UISFXPlayer } from 'uisfx'

export type SoundEvent =
  | 'tap'
  | 'toggle'
  | 'option.select'
  | 'option.deselect'
  | 'match.pair'
  | 'order.place'
  | 'answer.correct'
  | 'answer.incorrect'
  | 'streak'
  | 'item.advance'
  | 'attempt.submitted'
  | 'result.great'
  | 'result.good'
  | 'result.ok'
  | 'saved'
  | 'error'
  | 'generation.complete'
  | 'publish.success'
  | 'copy'

export type SoundLevel = 'off' | 'quiet' | 'normal'
export type Temperature = 'warm' | 'calm'

/** Packs offered to learners in settings (the rest of UI SFX's twelve suit apps more than homework) */
export const LEARNER_PACKS = ['arcade', 'rubber', 'glass', 'soft', 'organic', 'zen'] as const satisfies readonly PackName[]
export type LearnerPack = (typeof LEARNER_PACKS)[number]
export const DEFAULT_LEARNER_PACK: LearnerPack = 'arcade'
const TEACHER_PACK: PackName = 'minimal'

/** Event → cue, volume, and which temperature it plays in (student = warm, teacher = calm). */
export const SOUND_EVENTS: Record<SoundEvent, { cue: CueName; volume: number; warm: boolean; calm: boolean }> = {
  tap: { cue: 'press', volume: 0.35, warm: true, calm: false },
  toggle: { cue: 'toggle-on', volume: 0.45, warm: true, calm: false },
  'option.select': { cue: 'select', volume: 0.55, warm: true, calm: false },
  'option.deselect': { cue: 'deselect', volume: 0.45, warm: true, calm: false },
  'match.pair': { cue: 'snap', volume: 0.6, warm: true, calm: false },
  'order.place': { cue: 'drop', volume: 0.55, warm: true, calm: false },
  'answer.correct': { cue: 'success', volume: 0.8, warm: true, calm: false },
  // Soft, never a buzzer (spec §8)
  'answer.incorrect': { cue: 'error', volume: 0.45, warm: true, calm: false },
  streak: { cue: 'streak', volume: 0.85, warm: true, calm: false },
  'item.advance': { cue: 'forward', volume: 0.4, warm: true, calm: false },
  'attempt.submitted': { cue: 'complete', volume: 0.8, warm: true, calm: false },
  'result.great': { cue: 'achievement', volume: 0.9, warm: true, calm: false },
  'result.good': { cue: 'level-up', volume: 0.85, warm: true, calm: false },
  'result.ok': { cue: 'reward', volume: 0.75, warm: true, calm: false },
  saved: { cue: 'check', volume: 0.2, warm: true, calm: false },
  error: { cue: 'warning', volume: 0.5, warm: true, calm: true },
  'generation.complete': { cue: 'success', volume: 0.6, warm: false, calm: true },
  'publish.success': { cue: 'complete', volume: 0.6, warm: false, calm: true },
  copy: { cue: 'copy', volume: 0.4, warm: false, calm: true },
}

const LEVEL_GAIN: Record<SoundLevel, number> = { off: 0, quiet: 0.5, normal: 1 }

type Settings = { level: SoundLevel; temperature: Temperature; generationChime: boolean; pack: LearnerPack }

let settings: Settings = { level: 'off', temperature: 'calm', generationChime: false, pack: DEFAULT_LEARNER_PACK }
let player: UISFXPlayer | null = null
let unlockBound = false

const packFor = (s: Settings): PackName => (s.temperature === 'warm' ? s.pack : TEACHER_PACK)

export function configureSound(next: Partial<Settings>) {
  settings = { ...settings, ...next }
  if (next.pack && !LEARNER_PACKS.includes(next.pack)) settings.pack = DEFAULT_LEARNER_PACK
  player?.setPack(packFor(settings))
}
export function getSoundSettings(): Settings {
  return settings
}

/** Browsers block audio before a gesture: create and unlock the player on the first real interaction. */
export function unlockAudioOnGesture() {
  if (typeof window === 'undefined' || unlockBound) return
  unlockBound = true
  const unlock = () => {
    try {
      // Safari and the iOS app mute Web Audio on silent ("ambient"); the app's other sound (listening) plays, so these do too
      const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession
      if (session) session.type = 'playback'
    } catch {}
    try {
      player ??= createUISFX({ pack: packFor(settings), volume: 1, enabled: true })
      void player.unlock()
    } catch {}
    window.removeEventListener('pointerdown', unlock, true)
    window.removeEventListener('keydown', unlock, true)
  }
  window.addEventListener('pointerdown', unlock, true)
  window.addEventListener('keydown', unlock, true)
}

function allowed(event: SoundEvent): boolean {
  if (settings.level === 'off' && !(event === 'generation.complete' && settings.generationChime)) return false
  const def = SOUND_EVENTS[event]
  if (event === 'generation.complete') return settings.generationChime || (settings.level !== 'off' && def.calm)
  return settings.temperature === 'warm' ? def.warm : def.calm
}

/** The iOS app's native side (apps/ios, NativeBridge.swift): iPhones ignore navigator.vibrate */
type Bridge = { postMessage(m: Record<string, unknown>): Promise<unknown> }
const iosBridge = () =>
  typeof window === 'undefined' ? null : ((window as unknown as { webkit?: { messageHandlers?: { ikhimi?: Bridge } } }).webkit?.messageHandlers?.ikhimi ?? null)

/** Haptics: ≤20 ms, answer feedback only. The iOS app's Taptic Engine there, navigator.vibrate elsewhere (Android). */
function haptic(event: SoundEvent) {
  const kind = event === 'answer.correct' ? 'success' : event === 'answer.incorrect' ? 'error' : event === 'streak' || event === 'result.great' ? 'celebrate' : null
  const bridge = iosBridge()
  if (bridge) {
    if (kind) bridge.postMessage({ type: 'haptic', kind }).catch(() => {})
    return
  }
  if (typeof navigator === 'undefined' || !('vibrate' in navigator)) return
  if (event === 'answer.correct') navigator.vibrate(10)
  else if (event === 'answer.incorrect') navigator.vibrate([12, 40, 12])
  else if (event === 'streak' || event === 'result.great') navigator.vibrate([10, 30, 10, 30, 18])
}

export function play(event: SoundEvent) {
  haptic(event)
  if (!allowed(event) || !player) return
  const level = event === 'generation.complete' && settings.level === 'off' ? 1 : LEVEL_GAIN[settings.level]
  try {
    player.play(SOUND_EVENTS[event].cue, { volume: SOUND_EVENTS[event].volume * level })
  } catch {}
}

/** Settings preview: play one cue of a pack regardless of temperature */
export function previewPack(pack: LearnerPack) {
  try {
    player ??= createUISFX({ pack, volume: 1, enabled: true })
    void player.unlock()
    player.setPack(pack)
    player.play('success', { volume: 0.8 })
    setTimeout(() => player?.setPack(packFor(settings)), 900)
  } catch {}
}
