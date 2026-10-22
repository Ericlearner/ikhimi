'use client'

/** A part of a file sent to Postgres in one request: below Vercel's 4.5 MB limit */
const PART = 3.5 * 1024 * 1024

/** XHR rather than fetch: upload progress on slow 3G. */
function send(url: string, body: XMLHttpRequestBodyInit, onProgress: (p: number) => void, contentType?: string) {
  return new Promise<boolean>((resolve) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url)
    if (contentType) xhr.setRequestHeader('content-type', contentType)
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total)
    xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300)
    xhr.onerror = () => resolve(false)
    xhr.send(body)
  })
}

export type UploadResult =
  | { ok: true; materialId: string; state: 'ready' | 'uploaded' }
  /** error: server error code (file_too_large, file_type…) or 'upload' for a network failure */
  | { ok: false; error: string; maxMb?: number; materialId?: string }

/** Upload one file: to Postgres directly (no S3) or to the object store via presigned POST. */
export async function uploadFile(file: File, onProgress: (p: number) => void, onCreated?: (materialId: string) => void, opts: { purpose?: 'answers' } = {}): Promise<UploadResult> {
  try {
    const res = await fetch('/api/uploads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ filename: file.name, mimeType: file.type || 'application/octet-stream', bytes: file.size, ...(opts.purpose && { purpose: opts.purpose }) }),
    })
    const json = (await res.json()) as { materialId?: string; direct?: boolean; upload?: { url: string; fields: Record<string, string> }; error?: string; maxMb?: number }
    if (!res.ok || !json.materialId || (!json.upload && !json.direct)) return { ok: false, error: json.error ?? 'generic', maxMb: json.maxMb }
    const materialId = json.materialId
    onCreated?.(materialId)
    if (json.direct) {
      // Vercel refuses a request over 4.5 MB: a bigger file goes in parts, one after another (a part is tried twice)
      for (let at = 0; at < file.size || at === 0; at += PART) {
        const part = file.slice(at, at + PART)
        const sent = async () => send(`/api/uploads/${materialId}/direct?offset=${at}`, part, (p) => onProgress((at + p * part.size) / file.size), file.type)
        if (!(await sent()) && !(await sent())) return { ok: false, error: 'upload', materialId }
        if (file.size === 0) break
      }
      return { ok: true, materialId, state: 'ready' }
    }
    const form = new FormData()
    for (const [k, v] of Object.entries(json.upload!.fields)) form.append(k, v)
    form.append('file', file) // must be last for S3 POST
    if (!(await send(json.upload!.url, form, onProgress))) return { ok: false, error: 'upload', materialId }
    if (!(await fetch(`/api/uploads/${materialId}/complete`, { method: 'POST' })).ok) return { ok: false, error: 'upload', materialId }
    return { ok: true, materialId, state: 'uploaded' }
  } catch {
    return { ok: false, error: 'upload' }
  }
}

/**
 * A whole book for the owner's Lab (up to 100 MB): started on our server, then sent in parts that the server passes on
 * to the Gemini Files API, never kept in our database (server/lab-uploads.ts).
 */
export async function uploadLabBook(file: File, onProgress: (p: number) => void): Promise<{ ok: true; id: string } | { ok: false; error: string; maxMb?: number }> {
  try {
    const res = await fetch('/api/admin/lab/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ filename: file.name, mimeType: file.type || 'application/pdf', bytes: file.size }),
    })
    const json = (await res.json().catch(() => ({}))) as { id?: string; error?: string; maxMb?: number }
    if (!res.ok || !json.id) return { ok: false, error: json.error ?? 'upload', maxMb: json.maxMb }
    for (let at = 0; at < file.size; at += PART) {
      const part = file.slice(at, at + PART)
      const sent = () => send(`/api/admin/lab/upload/${json.id}?offset=${at}`, part, (p) => onProgress((at + p * part.size) / file.size), 'application/octet-stream')
      if (!(await sent()) && !(await sent())) return { ok: false, error: 'upload' }
    }
    return { ok: true, id: json.id }
  } catch {
    return { ok: false, error: 'upload' }
  }
}
