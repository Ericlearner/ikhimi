/**
 * The audio the AI speaks for listening and pronunciation items is stored as MP3, not WAV: 48 kbps mono is clear for
 * a voice and about 8× smaller, which keeps the database (where files live on Vercel) from filling up, and loads
 * faster on a student's phone. Anything that isn't plain 16-bit PCM WAV is kept as it is.
 */
import { Mp3Encoder } from '@breezystack/lamejs'

const KBPS = 48
/** lamejs reads samples in blocks of this size */
const BLOCK = 1152

/** The 16-bit mono (or first-channel) samples and rate of a WAV file, or null if it isn't one */
export function readWav(wav: Buffer): { samples: Int16Array; rate: number } | null {
  if (wav.length < 44 || wav.toString('latin1', 0, 4) !== 'RIFF' || wav.toString('latin1', 8, 12) !== 'WAVE') return null
  let pos = 12
  let fmt: { channels: number; rate: number; bits: number; format: number } | null = null
  while (pos + 8 <= wav.length) {
    const id = wav.toString('latin1', pos, pos + 4)
    const size = wav.readUInt32LE(pos + 4)
    const body = pos + 8
    if (id === 'fmt ') fmt = { format: wav.readUInt16LE(body), channels: wav.readUInt16LE(body + 2), rate: wav.readUInt32LE(body + 4), bits: wav.readUInt16LE(body + 14) }
    if (id === 'data') {
      if (!fmt || fmt.format !== 1 || fmt.bits !== 16) return null
      const end = Math.min(wav.length, body + size)
      const frames = Math.floor((end - body) / (2 * fmt.channels))
      const samples = new Int16Array(frames)
      for (let i = 0; i < frames; i++) samples[i] = wav.readInt16LE(body + i * 2 * fmt.channels)
      return { samples, rate: fmt.rate }
    }
    pos = body + size + (size % 2)
  }
  return null
}

/** WAV → MP3; returns the input unchanged when it can't be read as PCM WAV */
export function compressSpeech(audio: { mimeType: string; data: Buffer }): { mimeType: string; data: Buffer; ext: string } {
  const pcm = audio.mimeType.includes('wav') ? readWav(audio.data) : null
  if (!pcm) return { ...audio, ext: audio.mimeType.includes('mpeg') ? 'mp3' : 'wav' }
  const enc = new Mp3Encoder(1, pcm.rate, KBPS)
  const parts: Uint8Array[] = []
  for (let i = 0; i < pcm.samples.length; i += BLOCK) parts.push(enc.encodeBuffer(pcm.samples.subarray(i, i + BLOCK)))
  parts.push(enc.flush())
  return { mimeType: 'audio/mpeg', data: Buffer.concat(parts.map((p) => Buffer.from(p.buffer, p.byteOffset, p.byteLength))), ext: 'mp3' }
}
