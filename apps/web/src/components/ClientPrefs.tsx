'use client'
import { useEffect } from 'react'
import { configureSound, DEFAULT_LEARNER_PACK, unlockAudioOnGesture, type LearnerPack, type SoundLevel } from '@ikhimi/ui/sound'

/** Applies per-user sound prefs and Save-Data detection on the client (spec §2, §8). */
export function ClientPrefs({ sound, generationChime, soundPack }: { sound: SoundLevel; generationChime: boolean; soundPack?: LearnerPack }) {
  useEffect(() => {
    configureSound({ level: sound, generationChime, pack: soundPack ?? DEFAULT_LEARNER_PACK })
    unlockAudioOnGesture()
  }, [sound, generationChime, soundPack])
  useEffect(() => {
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
    if (conn?.saveData) document.documentElement.dataset.saveData = ''
  }, [])
  return null
}
