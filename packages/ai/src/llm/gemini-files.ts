/**
 * The Gemini Files API: a file too big to send inside a request (a whole book for the owner's Lab, up to 100 MB)
 * is uploaded to Google once and read by reference. Google keeps it at most 48 hours; the Lab deletes it once read.
 * The upload is resumable: every part but the last is a multiple of the granularity Google names when it starts.
 */
const BASE = 'https://generativelanguage.googleapis.com'

export type GeminiFile = { name: string; uri: string; mimeType: string; state: 'PROCESSING' | 'ACTIVE' | 'FAILED' | string }

export class GeminiFiles {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** Start an upload; returns where its parts go and how big a part must be (a multiple of `granularity`) */
  async start(input: { bytes: number; mimeType: string; displayName: string }): Promise<{ uploadUrl: string; granularity: number }> {
    const res = await this.fetchImpl(`${BASE}/upload/v1beta/files`, {
      method: 'POST',
      headers: {
        'x-goog-api-key': this.apiKey,
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(input.bytes),
        'X-Goog-Upload-Header-Content-Type': input.mimeType,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ file: { display_name: input.displayName.slice(0, 120) } }),
    })
    const uploadUrl = res.headers.get('x-goog-upload-url')
    if (!res.ok || !uploadUrl) throw new Error(`Gemini file upload could not start (${res.status}): ${(await res.text()).slice(0, 300)}`)
    return { uploadUrl, granularity: Number(res.headers.get('x-goog-upload-chunk-granularity')) || 8 * 1024 * 1024 }
  }

  /** Send bytes at `offset`; the last part finalizes the upload and returns the file */
  async upload(uploadUrl: string, offset: number, data: Buffer, last: boolean): Promise<GeminiFile | null> {
    const res = await this.fetchImpl(uploadUrl, {
      method: 'POST',
      headers: { 'X-Goog-Upload-Command': last ? 'upload, finalize' : 'upload', 'X-Goog-Upload-Offset': String(offset), 'Content-Length': String(data.length) },
      body: new Uint8Array(data),
    })
    if (!res.ok) throw new Error(`Gemini file upload failed at ${offset} (${res.status}): ${(await res.text()).slice(0, 300)}`)
    if (!last) return null
    const json = (await res.json()) as { file?: GeminiFile }
    if (!json.file?.uri) throw new Error('Gemini file upload finished without a file')
    return json.file
  }

  async get(name: string): Promise<GeminiFile> {
    const res = await this.fetchImpl(`${BASE}/v1beta/${name}`, { headers: { 'x-goog-api-key': this.apiKey } })
    if (!res.ok) throw new Error(`Gemini file ${name}: ${res.status}`)
    return (await res.json()) as GeminiFile
  }

  /** Wait until Google has processed the file (a long PDF takes a little while) */
  async waitActive(name: string, timeoutMs = 120_000, everyMs = 2000): Promise<GeminiFile> {
    const until = Date.now() + timeoutMs
    for (;;) {
      const f = await this.get(name)
      if (f.state === 'ACTIVE') return f
      if (f.state === 'FAILED') throw new Error('Gemini could not process the file')
      if (Date.now() > until) throw new Error('Gemini is still processing the file')
      await new Promise((r) => setTimeout(r, everyMs))
    }
  }

  async remove(name: string) {
    await this.fetchImpl(`${BASE}/v1beta/${name}`, { method: 'DELETE', headers: { 'x-goog-api-key': this.apiKey } }).catch(() => {})
  }
}
