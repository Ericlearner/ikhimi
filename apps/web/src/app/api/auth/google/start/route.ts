import { NextResponse } from 'next/server'
import { GOOGLE_COOKIE, GOOGLE_FLOW_TTL_SECONDS, googleConfig, startGoogleFlow } from '@/server/google'
import { safeNext } from '@/server/student-pages'

/** "Continue with Google": off to Google, with the flow's secrets in a short-lived httpOnly cookie */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const next = safeNext(url.searchParams.get('next')) ?? '/app'
  const cfg = googleConfig()
  if (!cfg) return NextResponse.redirect(new URL(`/signin?next=${encodeURIComponent(next)}`, req.url))
  const as = url.searchParams.get('as')
  const { url: to, flow } = startGoogleFlow(cfg, {
    redirectUri: new URL('/api/auth/google/callback', url.origin).toString(),
    as: as === 'teacher' || as === 'student' ? as : undefined,
    next,
  })
  const res = NextResponse.redirect(to)
  res.cookies.set(GOOGLE_COOKIE, Buffer.from(JSON.stringify(flow)).toString('base64url'), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/auth/google',
    maxAge: GOOGLE_FLOW_TTL_SECONDS,
  })
  return res
}
