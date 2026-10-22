/**
 * Per-request helpers for Server Components and Route Handlers.
 */
import 'server-only'
import { cache } from 'react'
import { cookies, headers } from 'next/headers'
import { after, NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { getDb } from '@ikhimi/db'
import { DEFAULT_LOCALE, type Locale } from '@ikhimi/i18n'
import { SESSION_COOKIE, validateSessionToken, type ValidatedSession } from './auth/session'
import { ForbiddenError } from './policy'

export const getSession = cache(async (): Promise<ValidatedSession | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  if (!token) return null
  return validateSessionToken(getDb(), token)
})

/** The interface is Korean only */
export const getLocale = cache(async (): Promise<Locale> => DEFAULT_LOCALE)

export async function clientIp(): Promise<string | null> {
  const h = await headers()
  // Behind our own reverse proxy (nginx when self-hosted), which sets X-Real-IP.
  return h.get('x-real-ip') ?? h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
}

const isProd = process.env.NODE_ENV === 'production'

export function setSessionCookie(res: NextResponse, token: string, expiresAt: Date) {
  res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, secure: isProd, sameSite: 'lax', path: '/', expires: expiresAt })
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly extra: Record<string, unknown> = {},
  ) {
    super(code)
  }
}

/** Wrap a route handler: maps auth/validation errors to JSON responses and keeps the session cookie fresh. */
export function route<Args extends unknown[]>(handler: (req: Request, ...args: Args) => Promise<NextResponse>) {
  return async (req: Request, ...args: Args): Promise<NextResponse> => {
    try {
      const res = await handler(req, ...args)
      const session = await getSession().catch(() => null)
      const token = (await cookies()).get(SESSION_COOKIE)?.value
      if (session?.refreshed && token && !res.cookies.get(SESSION_COOKIE)) setSessionCookie(res, token, session.expiresAt)
      return res
    } catch (err) {
      if (err instanceof HttpError) return NextResponse.json({ error: err.code, ...err.extra }, { status: err.status })
      if (err instanceof ZodError) return NextResponse.json({ error: 'bad_request', issues: err.issues }, { status: 400 })
      if (err instanceof ForbiddenError) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
      console.error('[api]', err)
      reportCrash(req, err)
      return NextResponse.json({ error: 'internal' }, { status: 500 })
    }
  }
}

/** An API route crashed: the owner hears about it in Telegram (once an hour per route), after the response */
function reportCrash(req: Request, err: unknown) {
  try {
    const path = new URL(req.url).pathname
    // Ids in the path would make every crash its own topic
    const topic = `api:${req.method} ${path.replace(/\/[0-9A-Z]{26}(?=\/|$)/g, '/:id')}`
    const message = err instanceof Error ? err.message : String(err)
    after(() => import('./notify').then((m) => m.alertOwner(getDb(), topic, `${req.method} ${path} failed (500): ${message.slice(0, 500)}`)))
  } catch {}
}

export async function requireSession(): Promise<ValidatedSession> {
  const s = await getSession()
  if (!s) throw new HttpError(401, 'unauthorized')
  return s
}
