import { and, assignments, eq, exercises, getDb, isNull, materials } from '@ikhimi/db'
import { can, staffAccess } from '@/server/admin/staff'
import { materialBytes } from '@/server/materials'
import { getSession } from '@/server/request'

/**
 * The picture an exercise shows (cut from the teacher's photo). Same rule as listening audio: the teacher can
 * always see it; anyone signed in can once the homework is published (students join by its link).
 */
export async function GET(_req: Request, ctx: { params: Promise<{ exerciseId: string }> }) {
  const session = await getSession()
  if (!session) return new Response('unauthorized', { status: 401 })
  const db = getDb()
  const [row] = await db
    .select({ payload: exercises.payload, a: assignments })
    .from(exercises)
    .innerJoin(assignments, eq(assignments.id, exercises.assignmentId))
    .where(eq(exercises.id, (await ctx.params).exerciseId))
    .limit(1)
  const imageId = (row?.payload as { imageId?: string } | undefined)?.imageId
  if (!row || !imageId) return new Response('not found', { status: 404 })
  // Staff who may open homework (admin panel) see drafts' pictures too
  const staff = async () => {
    const access = await staffAccess(db, session.user)
    return !!access && can(access, 'content')
  }
  const allowed = !row.a.deletedAt && (row.a.teacherId === session.user.id || row.a.status !== 'draft' || (await staff()))
  if (!allowed) return new Response('forbidden', { status: 403 })

  // The picture must be the assignment teacher's own material
  const [m] = await db
    .select()
    .from(materials)
    .where(and(eq(materials.id, imageId), eq(materials.teacherId, row.a.teacherId), isNull(materials.deletedAt)))
    .limit(1)
  const data = m ? await materialBytes(db, m) : null
  if (!data) return new Response('not found', { status: 404 })
  return new Response(new Uint8Array(data), {
    headers: { 'Content-Type': m!.mimeType ?? 'image/jpeg', 'Content-Length': String(data.length), 'Cache-Control': 'private, max-age=86400' },
  })
}
