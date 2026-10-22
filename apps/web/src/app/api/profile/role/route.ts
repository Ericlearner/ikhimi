import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { eq, getDb, sessions, users } from '@ikhimi/db'
import { hashToken, SESSION_COOKIE } from '@/server/auth/session'
import { addRole } from '@/server/auth/users'
import { HttpError, requireSession, route } from '@/server/request'

const body = z.object({
  role: z.enum(['teacher', 'student']),
  /** The person asked for this role: Profile → "also work as a teacher", or "yes, do this homework as a student" */
  add: z.boolean().optional(),
})

/**
 * Switch the session's active role (dual-role accounts, design spec §12). With `add`, the account takes that role
 * first: the only way a role is added besides the welcome screen; signing in or opening a link never adds one.
 */
export const POST = route(async (req) => {
  const { user } = await requireSession()
  const { role, add } = body.parse(await req.json())
  if (!user.roles.includes(role)) {
    if (!add || user.roleChosen === false) throw new HttpError(403, 'forbidden')
    const [row] = await getDb().select().from(users).where(eq(users.id, user.id)).limit(1)
    await addRole(getDb(), row!, role)
  }
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  if (!token) throw new HttpError(401, 'unauthorized')
  await getDb().update(sessions).set({ activeRole: role }).where(eq(sessions.id, hashToken(token)))
  return NextResponse.json({ role })
})
