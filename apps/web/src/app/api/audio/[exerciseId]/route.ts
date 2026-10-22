import { and, assignments, eq, exercises, getDb, isNull, materials } from '@ikhimi/db'
import { exerciseAudio } from '@/server/listening'
import { materialBytes } from '@/server/materials'
import { getSession } from '@/server/request'

/** A shadowing sentence's spoken audio (?line=n): the material its payload names, owned by the homework's teacher */
async function lineAudio(db: ReturnType<typeof getDb>, exerciseId: string, line: number) {
  const [ex] = await db.select().from(exercises).where(eq(exercises.id, exerciseId)).limit(1)
  const audioId = (ex?.payload as { lines?: { audioId?: string }[] } | undefined)?.lines?.[line]?.audioId
  if (!ex || !audioId) return null
  const [a] = await db.select({ teacherId: assignments.teacherId }).from(assignments).where(eq(assignments.id, ex.assignmentId)).limit(1)
  const [m] = await db
    .select()
    .from(materials)
    .where(and(eq(materials.id, audioId), eq(materials.teacherId, a?.teacherId ?? ''), isNull(materials.deletedAt)))
    .limit(1)
  return m ? { ex, m } : null
}

/**
 * Stream a listening exercise's recording. The teacher can always play it; anyone signed in can once the
 * homework is published (students join by its link). Supports Range so phones can seek and Safari plays it.
 */
export async function GET(req: Request, ctx: { params: Promise<{ exerciseId: string }> }) {
  const session = await getSession()
  if (!session) return new Response('unauthorized', { status: 401 })
  const db = getDb()
  const id = (await ctx.params).exerciseId
  const line = new URL(req.url).searchParams.get('line')
  const row = line !== null && /^\d{1,2}$/.test(line) ? await lineAudio(db, id, Number(line)) : await exerciseAudio(db, id)
  if (!row) return new Response('not found', { status: 404 })
  const [a] = await db.select().from(assignments).where(eq(assignments.id, row.ex.assignmentId)).limit(1)
  const allowed = a && !a.deletedAt && (a.teacherId === session.user.id || a.status !== 'draft')
  if (!allowed) return new Response('forbidden', { status: 403 })

  const data = await materialBytes(db, row.m)
  if (!data) return new Response('not found', { status: 404 })
  const type = row.m.mimeType === 'audio/mp3' ? 'audio/mpeg' : (row.m.mimeType ?? 'audio/mpeg')
  const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=3600' }

  const range = req.headers.get('range')?.match(/^bytes=(\d*)-(\d*)$/)
  if (range) {
    const size = data.length
    let start = range[1] ? Number(range[1]) : size - Number(range[2])
    let end = range[1] && range[2] ? Number(range[2]) : size - 1
    start = Math.max(0, start)
    end = Math.min(end, size - 1)
    if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
    return new Response(new Uint8Array(data.subarray(start, end + 1)), {
      status: 206,
      headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) },
    })
  }
  return new Response(new Uint8Array(data), { headers: { ...headers, 'Content-Length': String(data.length) } })
}
