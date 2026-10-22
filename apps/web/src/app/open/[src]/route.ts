import { NextResponse } from 'next/server'
import { STORE_COOKIE } from '@/server/store-app'
import { safeNext } from '@/server/student-pages'

/**
 * Where the apps start: /open/play (Google Play) and /open/ios (the App Store): no purchases shown; /open/apk (the
 * website's Android download): everything. Marks the device, then opens the app's home, or `?next=` (the iOS app
 * started by a link or a notification).
 */
export async function GET(req: Request, ctx: { params: Promise<{ src: string }> }) {
  const src = (await ctx.params).src
  const next = safeNext(new URL(req.url).searchParams.get('next')) ?? '/app'
  const res = NextResponse.redirect(new URL(next, req.url))
  if (src === 'play' || src === 'apk' || src === 'ios') {
    res.cookies.set(STORE_COOKIE, src, { maxAge: 365 * 86400, path: '/', sameSite: 'lax', secure: process.env.NODE_ENV === 'production' })
  } else res.cookies.delete(STORE_COOKIE)
  return res
}
