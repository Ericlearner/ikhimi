import { NextResponse } from 'next/server'
import { assignments, eq, getDb } from '@ikhimi/db'
import { LlmError } from '@ikhimi/ai'
import { checkPronunciation } from '@/server/assignments'
import { ownAttempt } from '@/server/attempt-access'
import { getMeteredLlm } from '@/server/llm'
import { HttpError, requireSession, route } from '@/server/request'

/** A few seconds of a 16 kHz mono WAV is ~32 KB a second; 15 s at most */
const MAX_BYTES = 600_000

export const maxDuration = 60

/**
 * POST ?exerciseId=…&line=n, body = the student's WAV recording of that sentence. Returns the sentence's result.
 * The recording is checked and dropped; it is never written anywhere (see checkPronunciation).
 */
export const POST = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const { user } = await requireSession()
  const at = await ownAttempt(user, (await ctx.params).id)
  if (at.status !== 'in_progress') throw new HttpError(409, 'submitted')
  const url = new URL(req.url)
  const exerciseId = url.searchParams.get('exerciseId') ?? ''
  const line = Number(url.searchParams.get('line'))
  if (!exerciseId || exerciseId.length > 40 || !Number.isInteger(line) || line < 0 || line > 7) throw new HttpError(400, 'bad_request')
  const type = (req.headers.get('content-type') ?? '').split(';')[0]!.trim()
  if (type !== 'audio/wav') throw new HttpError(415, 'file_type')
  const bytes = new Uint8Array(await req.arrayBuffer())
  if (bytes.length < 1000) throw new HttpError(400, 'too_short')
  if (bytes.length > MAX_BYTES) throw new HttpError(413, 'too_large')
  const llm = getMeteredLlm({ userId: user.id, purpose: 'pronounce', refId: at.id })
  if (!llm) throw new HttpError(503, 'ai_not_configured')
  const [a] = await getDb().select().from(assignments).where(eq(assignments.id, at.assignmentId)).limit(1)
  try {
    const r = await checkPronunciation(getDb(), at, a!, { exerciseId, line, audio: { mimeType: 'audio/wav', dataBase64: Buffer.from(bytes).toString('base64') } }, llm)
    if (!r.ok) throw new HttpError(r.reason === 'not_found' ? 404 : r.reason === 'plan' ? 403 : 409, r.reason)
    return NextResponse.json(r)
  } catch (e) {
    if (e instanceof LlmError) throw new HttpError(503, 'ai_busy')
    throw e
  }
})
