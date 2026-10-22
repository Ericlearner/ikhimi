import { NextResponse } from 'next/server'
import { and, eq, getDb, groups, isNull } from '@ikhimi/db'
import { requireSession, route } from '@/server/request'

export const GET = route(async () => {
  const { user } = await requireSession()
  const rows = await getDb()
    .select({ id: groups.id, name: groups.name })
    .from(groups)
    .where(and(eq(groups.teacherId, user.id), isNull(groups.archivedAt), isNull(groups.deletedAt)))
  return NextResponse.json({ groups: rows })
})
