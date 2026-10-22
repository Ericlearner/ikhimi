'use client'
import type { HomeworkPlan } from '@ikhimi/ai/plan-shape'
import type { MessageKey } from '@ikhimi/i18n'

export async function postJson(url: string, body: unknown, method = 'POST') {
  const res = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  return { ok: res.ok, status: res.status, json }
}

/** An item as the chat shows it while the rest of the homework is still being written */
export type ItemPreview = { kind: string; skill: string; prompt: string; vocab: boolean; picture: boolean }

export type GenEvent =
  | { type: 'progress'; stage: 'reading' | 'writing' | 'checking' | 'finishing' }
  | { type: 'items'; items: ItemPreview[] }
  | { type: 'done'; assignmentId: string }
  | { type: 'error'; code: string; n?: number }

/**
 * POST /api/generate and read the NDJSON progress stream. The homework is made on the server whether or not this page
 * keeps listening: if the connection drops (a locked phone, the app in the background), this asks
 * /api/generate/runs/<id> until the draft is saved or the run failed, and finishes the same way.
 */
export async function streamGenerate(body: unknown, onEvent: (e: GenEvent) => void) {
  let res: Response
  try {
    res = await fetch('/api/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  } catch {
    return onEvent({ type: 'error', code: 'generic' })
  }
  if (!res.ok || !res.body) {
    const j = (await res.json().catch(() => ({}))) as { error?: string }
    return onEvent({ type: 'error', code: res.status === 401 ? 'unauthorized' : (j.error ?? 'generic') })
  }
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  let finished = false
  let runId: string | null = null
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line) continue
        const e = JSON.parse(line) as GenEvent | { type: 'started'; runId: string }
        if (e.type === 'started') {
          runId = e.runId
          continue
        }
        if (e.type === 'done' || e.type === 'error') finished = true
        onEvent(e)
      }
    }
  } catch {
    // The connection dropped; the server goes on
  }
  if (finished) return
  if (!runId) return onEvent({ type: 'error', code: 'generic' })
  onEvent(await waitForRun(runId))
}

/** Asks every few seconds how the homework is going, for up to 6 minutes (the server allows 5) */
async function waitForRun(runId: string): Promise<GenEvent> {
  const until = Date.now() + 6 * 60_000
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 3000))
    try {
      const res = await fetch(`/api/generate/runs/${runId}`, { cache: 'no-store' })
      if (res.status === 404 || res.status === 401) break
      if (!res.ok) continue
      const j = (await res.json()) as { status: string; assignmentId: string | null; errorCode: string | null }
      if (j.status === 'ok' && j.assignmentId) return { type: 'done', assignmentId: j.assignmentId }
      if (j.status === 'failed') return { type: 'error', code: j.errorCode ?? 'generic' }
    } catch {
      // Still offline: try again
    }
  }
  return { type: 'error', code: 'generic' }
}

export type PlanReply = { plan: HomeworkPlan; minutes: number; vocab: { meet: number; recall: number } }

/** POST /api/generate/plan: Create mode's plan card (or a changed one, when the teacher answered it) */
export async function fetchPlan(body: unknown): Promise<({ ok: true } & PlanReply) | { ok: false; code: string; n?: number }> {
  try {
    const res = await fetch('/api/generate/plan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const j = (await res.json().catch(() => ({}))) as Partial<PlanReply> & { error?: string; n?: number }
    if (!res.ok || !j.plan) return { ok: false, code: res.status === 401 ? 'unauthorized' : (j.error ?? 'generic'), n: j.n }
    return { ok: true, plan: j.plan, minutes: j.minutes ?? 0, vocab: j.vocab ?? { meet: 0, recall: 0 } }
  } catch {
    return { ok: false, code: 'network' }
  }
}

export const ERROR_KEYS: Record<string, MessageKey> = {
  ai_not_configured: 'error.aiNotConfigured',
  ai_busy: 'error.aiBusy',
  ai_rejected: 'error.aiRejected',
  daily_cap: 'error.dailyCap',
  describe_first: 'error.describeFirst',
  audio_later: 'error.audioLater',
  file_type: 'error.fileType',
  rate_limited: 'error.tooManyRequests',
  text_too_long: 'error.textTooLong',
  ai_too_long: 'error.aiTooLong',
  ai_bad_output: 'error.aiBadOutput',
  digitize_needs_pages: 'error.digitizeNeedsPages',
  too_many_pages: 'error.tooManyPages',
  pdf_pages: 'error.pdfPages',
  answers_too_many_pages: 'error.answersTooMany',
  answers_pdf_pages: 'error.answersPdfPages',
  pdf_unreadable: 'error.pdfUnreadable',
  doc_old: 'error.docOld',
  doc_unreadable: 'error.docUnreadable',
  needs_audio: 'error.needsAudio',
}

/**
 * Shrink phone photos before upload (§16: metered 3G data; Vercel's 4.5 MB body limit).
 * 1600px long edge at JPEG 0.82 keeps textbook text crisp for the model at ~200–400 KB.
 */
export async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.size < 400_000) return file
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bmp.width * scale)
    canvas.height = Math.round(bmp.height * scale)
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.82))
    if (!blob || blob.size >= file.size) return file
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' })
  } catch {
    return file // e.g. HEIC on a browser that can't decode it
  }
}
