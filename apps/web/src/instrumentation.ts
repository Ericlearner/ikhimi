import type { Instrumentation } from 'next'

/**
 * A page or route crashed on the server: tell the owner in Telegram (server/notify.ts alertOwner, at most once an hour
 * per route). API routes wrapped in `route()` report their own 500s; this catches the rest, pages included.
 */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const digest = typeof err === 'object' && err !== null && 'digest' in err ? String((err as { digest: unknown }).digest) : ''
  // Not-found pages and redirects travel as errors too; they aren't crashes
  if (/^(NEXT_|DYNAMIC_SERVER_USAGE)/.test(digest)) return
  const message = err instanceof Error ? err.message : String(err)
  try {
    const [{ getDb }, { alertOwner }] = await Promise.all([import('@ikhimi/db'), import('./server/notify')])
    await alertOwner(getDb(), `${context.routeType}:${context.routePath}`, `${request.method} ${request.path.split('?')[0]} crashed (${context.routeType}): ${message.slice(0, 500)}`)
  } catch (e) {
    console.warn('[instrumentation] could not report', e)
  }
}
