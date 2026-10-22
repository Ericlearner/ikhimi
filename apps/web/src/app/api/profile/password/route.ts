import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb } from '@ikhimi/db'
import { PASSWORD_MAX, setPassword } from '@/server/auth/password'
import { HttpError, requireSession, route } from '@/server/request'

const body = z.object({ password: z.string().max(PASSWORD_MAX + 1), current: z.string().max(PASSWORD_MAX).optional() })

/** Profile: set or change the password; the account's other sessions end */
export const POST = route(async (req) => {
  const session = await requireSession()
  const input = body.parse(await req.json())
  const r = await setPassword(getDb(), session, { userId: session.user.id, password: input.password, current: input.current || undefined })
  if (!r.ok) throw new HttpError(r.reason === 'wrong_current' ? 403 : 400, `password_${r.reason}`)
  return NextResponse.json({ ok: true })
})
