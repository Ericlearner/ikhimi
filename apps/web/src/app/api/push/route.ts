import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb, pushDevices } from '@ikhimi/db'
import { PUSH_COOKIE } from '@/server/push'
import { requireSession, route } from '@/server/request'

const body = z.object({ token: z.string().regex(/^[0-9a-f]{32,200}$/i), env: z.enum(['sandbox', 'production']) })

/**
 * The iOS app, after sign-in: this iPhone gets notifications for the signed-in account. A device that someone else
 * signed in on before moves to the new account.
 */
export const POST = route(async (req) => {
  const { user } = await requireSession()
  const { token, env } = body.parse(await req.json())
  await getDb()
    .insert(pushDevices)
    .values({ token, userId: user.id, env })
    .onConflictDoUpdate({ target: pushDevices.token, set: { userId: user.id, env, updatedAt: new Date() } })
  const res = NextResponse.json({ ok: true })
  res.cookies.set(PUSH_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 365 * 86400 })
  return res
})
