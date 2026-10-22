import { describe, expect, it } from 'vitest'
import { pcmToWav } from '@ikhimi/ai'
import { compressSpeech, readWav } from './audio'

/** Two seconds of a voice-like tone, as the speech model returns it (24 kHz, 16-bit, mono) */
function tone(seconds = 2, rate = 24000) {
  const pcm = Buffer.alloc(seconds * rate * 2)
  for (let i = 0; i < seconds * rate; i++) pcm.writeInt16LE(Math.round(Math.sin((i / rate) * 2 * Math.PI * 220) * 8000), i * 2)
  return pcmToWav(pcm, rate)
}

describe('speech audio is stored as MP3', () => {
  it('turns the model’s WAV into an MP3 about 8× smaller', () => {
    const wav = tone()
    expect(readWav(wav)).toMatchObject({ rate: 24000 })
    const mp3 = compressSpeech({ mimeType: 'audio/wav', data: wav })
    expect(mp3.mimeType).toBe('audio/mpeg')
    expect(mp3.ext).toBe('mp3')
    // An MPEG audio frame starts with 11 set bits
    expect(mp3.data[0]).toBe(0xff)
    expect((mp3.data[1]! & 0xe0) === 0xe0).toBe(true)
    expect(mp3.data.length).toBeLessThan(wav.length / 6)
    // 48 kbps: about 6 KB a second
    expect(mp3.data.length).toBeGreaterThan(10_000)
  })

  it('keeps anything it can’t read as it is', () => {
    const odd = { mimeType: 'audio/wav', data: Buffer.from('not a wav file at all, just some bytes here......') }
    expect(compressSpeech(odd)).toEqual({ ...odd, ext: 'wav' })
    const mp3 = { mimeType: 'audio/mpeg', data: Buffer.from([0xff, 0xfb, 0, 0]) }
    expect(compressSpeech(mp3)).toEqual({ ...mp3, ext: 'mp3' })
  })
})
