'use client'
import { unzipSync } from 'fflate'
import { isAudioName } from '@ikhimi/ai/audio-names'

const MIME: Record<string, string> = { mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', aac: 'audio/aac' }
const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path
const isZip = (f: File) => /\.zip$/i.test(f.name) || f.type === 'application/zip' || f.type === 'application/x-zip-compressed'

/**
 * The recordings in what the teacher picked: audio files as they are, and the audio tracks inside a ZIP (the book's
 * CD as the publisher gives it). Only tracks `keep` wants are taken out of a ZIP, so a whole CD never fills the
 * phone's memory, and nothing else is ever uploaded. `total` counts every recording seen, for "3 of 80 were needed".
 */
export async function expandAudio(picked: File[], keep: (name: string) => boolean, onZipError: (name: string) => void): Promise<{ files: File[]; total: number; zipped: boolean }> {
  const files: File[] = []
  let total = 0
  let zipped = false
  for (const f of picked) {
    if (isZip(f)) {
      zipped = true
      try {
        const entries = unzipSync(new Uint8Array(await f.arrayBuffer()), {
          filter: (e) => {
            if (!isAudioName(e.name)) return false
            total++
            return keep(e.name)
          },
        })
        for (const [path, bytes] of Object.entries(entries)) {
          const name = baseName(path)
          files.push(new File([bytes as Uint8Array<ArrayBuffer>], name, { type: MIME[name.split('.').pop()!.toLowerCase()] ?? 'audio/mpeg' }))
        }
      } catch {
        onZipError(f.name)
      }
    } else if (f.type.startsWith('audio/') || isAudioName(f.name)) {
      total++
      files.push(f)
    }
  }
  return { files, total, zipped }
}
