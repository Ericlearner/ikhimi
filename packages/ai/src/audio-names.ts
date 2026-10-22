/**
 * Which recording belongs to which listening exercise, by file name alone (no AI, so it costs nothing and runs in
 * the browser too). The AI only listens to a file once it has been matched here or chosen by the teacher.
 */

/**
 * Does this file name belong to this listening label? "Track 1.12.mp3" ↔ "Track 1.12", "CD1_12.mp3" ↔ "1.12",
 * "ex3.mp3" ↔ "Ex. 3". Compares the number sequences, so wording and separators don't matter.
 */
export function audioNameMatches(fileName: string, label: string | null, sourceRef?: string | null): boolean {
  const nums = (s: string) => (s.match(/\d+/g) ?? []).map((n) => String(Number(n)))
  const file = nums(baseName(fileName).replace(/\.(mp3|m4a|wav|ogg|aac|webm|mp4)$/i, '').replace(/\b(19|20)\d{2}\b/g, ''))
  if (!file.length) return false
  const same = (want: string[]) => want.length > 0 && file.length >= want.length && want.every((n, i) => file[file.length - want.length + i] === n)
  if (label && same(nums(label))) return true
  // Fall back to the exercise number (last number in "Page 12, ex. 3" → 3) when the book has no track label
  const ex = nums(sourceRef ?? '').at(-1)
  return !!ex && file.length === 1 && file[0] === ex
}

/** "CD1/Track 1.12.mp3" → "Track 1.12.mp3" (a folder or a ZIP gives paths; only the file's own name counts) */
const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path

/** The file name to suggest for a label: "Track 1.12" → "Track 1.12.mp3" */
export function suggestedFileName(label: string): string {
  const clean = label.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim()
  return `${clean || 'Track'}.mp3`
}

export type WaitingTrack = { label: string | null; sourceRef: string | null }

/**
 * From many files (a whole folder, a ZIP, every track of the book's CD), the one file for each waiting recording:
 * `picks[i]` = index into `files` for `waiting[i]`, or -1. A file is used once; the rest are never uploaded.
 */
export function pickTracks(files: string[], waiting: WaitingTrack[]): number[] {
  const used = new Set<number>()
  return waiting.map((w) => {
    const i = files.findIndex((name, j) => !used.has(j) && isAudioName(name) && audioNameMatches(name, w.label, w.sourceRef))
    if (i >= 0) used.add(i)
    return i
  })
}

export const isAudioName = (name: string) => /\.(mp3|m4a|wav|ogg|aac)$/i.test(name) && !baseName(name).startsWith('.')
