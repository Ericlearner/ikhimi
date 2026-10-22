import { NextResponse } from 'next/server'
import { z } from 'zod'
import { SUBJECTS } from '@ikhimi/ai/exams'
import { eq, getDb, teacherProfiles, users } from '@ikhimi/db'
import { chooseFirstRole } from '@/server/auth/users'
import { HttpError, requireSession, route } from '@/server/request'


const body = z.object({
  fullName: z.string().trim().min(2).max(80),
  subject: z.enum(SUBJECTS).optional(),
  /** A new account's answer to "teacher or student?" (only while it has no role) */
  role: z.enum(['teacher', 'student']).optional(),
})

export const POST = route(async (req) => {
  const { user } = await requireSession()
  const input = body.parse(await req.json())
  const db = getDb()
  let role = user.role
  if (user.roleChosen === false) {
    if (!input.role) throw new HttpError(400, 'role_required')
    await chooseFirstRole(db, user.id, input.role)
    role = input.role
  }
  await db.update(users).set({ fullName: input.fullName }).where(eq(users.id, user.id))
  if (role === 'teacher') {
    await db
      .update(teacherProfiles)
      .set({
        subjects: input.subject ? [input.subject] : [],
        defaultContentLanguage: input.subject === 'english' ? 'en' : input.subject === 'russian' ? 'ru' : null,
        onboardedAt: new Date(),
      })
      .where(eq(teacherProfiles.userId, user.id))
  }
  return NextResponse.json({ ok: true, role })
})
