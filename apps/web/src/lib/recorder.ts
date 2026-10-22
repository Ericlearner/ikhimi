'use client'
/**
 * The microphone for pronunciation checks: records one sentence as a small 16 kHz mono WAV, which every AI model
 * reads. It stops by itself after a short silence once the student has spoken (or at the time limit, or on stop()).
 * Nothing is saved: the WAV is handed to the caller and goes straight to the check.
 */

export const micSupported = () => typeof window !== 'undefined' && window.isSecureContext && !!navigator.mediaDevices?.getUserMedia

const RATE = 16000

export type Recording = { stop: () => void; done: Promise<Blob | null> }

export async function startRecording(opts: { onLevel?: (level: number) => void; maxMs?: number; silenceMs?: number } = {}): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } })
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const ctx = new Ctx()
  const source = ctx.createMediaStreamSource(stream)
  // ScriptProcessor is old but works in every browser our students use (Safari included)
  const node = ctx.createScriptProcessor(4096, 1, 1)
  const chunks: Float32Array[] = []
  let spoke = false
  let quietSince = 0
  const started = performance.now()
  let finish!: (b: Blob | null) => void
  const done = new Promise<Blob | null>((r) => (finish = r))
  let stopped = false
  const stop = () => {
    if (stopped) return
    stopped = true
    node.disconnect()
    source.disconnect()
    stream.getTracks().forEach((t) => t.stop())
    void ctx.close()
    finish(spoke ? encodeWav(chunks, ctx.sampleRate) : null)
  }
  node.onaudioprocess = (e) => {
    const data = new Float32Array(e.inputBuffer.getChannelData(0))
    chunks.push(data)
    let sum = 0
    for (let i = 0; i < data.length; i++) sum += data[i]! * data[i]!
    const rms = Math.sqrt(sum / data.length)
    opts.onLevel?.(Math.min(1, rms * 8))
    const now = performance.now()
    if (rms > 0.02) {
      spoke = true
      quietSince = 0
    } else if (spoke) {
      quietSince ||= now
      if (now - quietSince > (opts.silenceMs ?? 1400)) stop()
    }
    if (now - started > (opts.maxMs ?? 15000)) stop()
  }
  source.connect(node)
  node.connect(ctx.destination)
  return { stop, done }
}

/** Float samples at the device rate → 16-bit 16 kHz mono WAV */
function encodeWav(chunks: Float32Array[], rate: number): Blob {
  const total = chunks.reduce((s, c) => s + c.length, 0)
  const ratio = rate / RATE
  const n = Math.floor(total / ratio)
  const pcm = new DataView(new ArrayBuffer(44 + n * 2))
  const all = new Float32Array(total)
  let o = 0
  for (const c of chunks) {
    all.set(c, o)
    o += c.length
  }
  for (let i = 0; i < n; i++) {
    // Average the samples that fall into this output sample (a simple low-pass before downsampling)
    const from = Math.floor(i * ratio)
    const to = Math.min(total, Math.floor((i + 1) * ratio))
    let s = 0
    for (let j = from; j < to; j++) s += all[j]!
    const v = Math.max(-1, Math.min(1, s / Math.max(1, to - from)))
    pcm.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true)
  }
  const w = (off: number, str: string) => [...str].forEach((ch, i) => pcm.setUint8(off + i, ch.charCodeAt(0)))
  w(0, 'RIFF')
  pcm.setUint32(4, 36 + n * 2, true)
  w(8, 'WAVE')
  w(12, 'fmt ')
  pcm.setUint32(16, 16, true)
  pcm.setUint16(20, 1, true)
  pcm.setUint16(22, 1, true)
  pcm.setUint32(24, RATE, true)
  pcm.setUint32(28, RATE * 2, true)
  pcm.setUint16(32, 2, true)
  pcm.setUint16(34, 16, true)
  w(36, 'data')
  pcm.setUint32(40, n * 2, true)
  return new Blob([pcm.buffer], { type: 'audio/wav' })
}
