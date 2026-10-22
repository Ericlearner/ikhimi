import { NextResponse } from 'next/server'
import { attempts, conversations, enrollments, eq, getDb, groups, materials, responses, teacherProfiles, users, assignments, inArray } from '@ikhimi/db'
import { requireSession, route } from '@/server/request'

/** "Download my data" (design spec §12): everything stored about this user, as JSON. */
export const GET = route(async () => {
  const { user } = await requireSession()
  const db = getDb()
  const [me] = await db.select().from(users).where(eq(users.id, user.id))
  const myAttempts = await db.select().from(attempts).where(eq(attempts.studentId, user.id))
  const data = {
    exportedAt: new Date().toISOString(),
    account: me,
    teacherProfile: (await db.select().from(teacherProfiles).where(eq(teacherProfiles.userId, user.id)))[0] ?? null,
    enrollments: await db.select().from(enrollments).where(eq(enrollments.studentId, user.id)),
    groupsTaught: await db.select().from(groups).where(eq(groups.teacherId, user.id)),
    assignmentsCreated: await db.select().from(assignments).where(eq(assignments.teacherId, user.id)),
    conversations: await db.select().from(conversations).where(eq(conversations.teacherId, user.id)),
    materials: (await db.select().from(materials).where(eq(materials.teacherId, user.id))).map(({ extractedStructure: _s, ...m }) => m),
    attempts: myAttempts,
    responses: myAttempts.length ? await db.select().from(responses).where(inArray(responses.attemptId, myAttempts.map((a) => a.id))) : [],
  }
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="ikhimi-${user.id}.json"`,
    },
  })
})
