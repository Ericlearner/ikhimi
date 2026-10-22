/**
 * The iOS app's native side (apps/ios, Bridge.swift), seen from the page: Sign in with Apple, notifications and the
 * share sheet. Each call is answered by the app; outside the app there is no bridge and these return null.
 */
type Bridge = { postMessage(message: Record<string, unknown>): Promise<unknown> }

function bridge(): Bridge | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { webkit?: { messageHandlers?: { ikhimi?: Bridge } } }
  return w.webkit?.messageHandlers?.ikhimi ?? null
}

export const inIosShell = () => bridge() !== null

export type AppleSignIn = { identityToken: string; authorizationCode?: string; fullName?: string }

/** Apple's sheet. Null when the person closed it; throws when Apple failed. */
export async function appleSignIn(): Promise<AppleSignIn | null> {
  const b = bridge()
  if (!b) return null
  const r = (await b.postMessage({ type: 'appleSignIn' })) as (AppleSignIn & { canceled?: boolean }) | null
  return r && !r.canceled && r.identityToken ? r : null
}

/** Asks for notification permission (once; later calls return the token silently). Null if not allowed. */
export async function pushToken(): Promise<{ token: string; env: 'sandbox' | 'production' } | null> {
  const b = bridge()
  if (!b) return null
  const r = (await b.postMessage({ type: 'push' }).catch(() => null)) as { token?: string; env?: string } | null
  return r?.token && (r.env === 'sandbox' || r.env === 'production') ? { token: r.token, env: r.env } : null
}

/** The phone's own share sheet: the app's, or the browser's where it has one */
export const canShareNatively = () => inIosShell() || (typeof navigator !== 'undefined' && typeof navigator.share === 'function')

export async function shareNatively(data: { url: string; title?: string }) {
  const b = bridge()
  if (b) return void (await b.postMessage({ type: 'share', ...data }).catch(() => {}))
  await navigator.share?.(data).catch(() => {})
}
