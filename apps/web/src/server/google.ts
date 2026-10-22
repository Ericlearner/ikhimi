/**
 * Sign in with Google, on the website (OpenID Connect, authorization code + PKCE). GOOGLE_CLIENT_ID and
 * GOOGLE_CLIENT_SECRET come from Google Cloud Console → APIs & Services → Credentials → OAuth client ID (Web
 * application), with `<site>/api/auth/google/callback` as an authorized redirect URI. Unset = no Google button.
 * Not offered inside the apps: Google refuses sign-in in an app's web view.
 */
import { createHash, randomBytes } from 'node:crypto'

export const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com']
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const GOOGLE_COOKIE = 'tl_google'
export const GOOGLE_FLOW_TTL_SECONDS = 10 * 60

export function googleConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim()
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret) return null
  return { clientId, clientSecret }
}
export type GoogleConfig = NonNullable<ReturnType<typeof googleConfig>>

/** What the browser keeps (httpOnly cookie) between leaving for Google and coming back */
export type GoogleFlow = { state: string; nonce: string; verifier: string; as?: 'teacher' | 'student'; next: string }

export function startGoogleFlow(cfg: GoogleConfig, input: { redirectUri: string; as?: 'teacher' | 'student'; next: string }) {
  const flow: GoogleFlow = {
    state: randomBytes(24).toString('base64url'),
    nonce: randomBytes(24).toString('base64url'),
    verifier: randomBytes(48).toString('base64url'),
    as: input.as,
    next: input.next,
  }
  const url = new URL(AUTH_URL)
  url.search = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: input.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state: flow.state,
    nonce: flow.nonce,
    code_challenge: createHash('sha256').update(flow.verifier).digest('base64url'),
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString()
  return { url: url.toString(), flow }
}

export type GoogleIdentity = { sub: string; email: string | null; name: string | null }

/**
 * The code Google sent back → who signed in. The ID token comes straight from Google's token endpoint over TLS, so
 * its claims are checked (issuer, audience, expiry, our nonce) without verifying the signature (OpenID Connect §3.1.3.7).
 */
export async function exchangeGoogleCode(
  cfg: GoogleConfig,
  input: { code: string; redirectUri: string; flow: GoogleFlow },
  fetcher: typeof fetch = fetch,
  now = Date.now(),
): Promise<GoogleIdentity | null> {
  const res = await fetcher(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: input.code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: input.redirectUri,
      grant_type: 'authorization_code',
      code_verifier: input.flow.verifier,
    }),
  })
  if (!res.ok) return null
  const idToken = ((await res.json().catch(() => null)) as { id_token?: unknown } | null)?.id_token
  if (typeof idToken !== 'string') return null
  let claims: Record<string, unknown>
  try {
    claims = JSON.parse(Buffer.from(idToken.split('.')[1] ?? '', 'base64url').toString('utf8'))
  } catch {
    return null
  }
  const aud = claims.aud
  if (!GOOGLE_ISSUERS.includes(String(claims.iss))) return null
  if (!(aud === cfg.clientId || (Array.isArray(aud) && aud.includes(cfg.clientId)))) return null
  if (typeof claims.exp !== 'number' || claims.exp * 1000 < now) return null
  if (claims.nonce !== input.flow.nonce) return null
  if (typeof claims.sub !== 'string' || !claims.sub) return null
  const email = typeof claims.email === 'string' && claims.email_verified === true ? claims.email : null
  const name = typeof claims.name === 'string' ? claims.name.trim().slice(0, 80) || null : null
  return { sub: claims.sub, email, name }
}

/** The phone column of an account made with Google: not a number anyone can sign in with, and unique */
export const GOOGLE_PHONE_PREFIX = 'google:'
export const googlePhone = (sub: string) => `${GOOGLE_PHONE_PREFIX}${sub}`
