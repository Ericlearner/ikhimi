import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { eq, getDb, pushDevices } from '@ikhimi/db'
import { invalidateSession, SESSION_COOKIE } from '@/server/auth/session'
import { PUSH_COOKIE } from '@/server/push'
import { route } from '@/server/request'

export const POST = route(async () => {
  const jar = await cookies()
  const token = jar.get(SESSION_COOKIE)?.value
  if (token) await invalidateSession(getDb(), token)
  // Signed out in the iOS app: that iPhone stops getting this account's notifications
  const device = jar.get(PUSH_COOKIE)?.value
  if (device) await getDb().delete(pushDevices).where(eq(pushDevices.token, device))
  const res = NextResponse.json({ ok: true })
  res.cookies.delete(SESSION_COOKIE)
  res.cookies.delete(PUSH_COOKIE)
  return res
})
