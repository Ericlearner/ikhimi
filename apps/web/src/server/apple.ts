/**
 * Apple, for the iOS app (apps/ios): Sign in with Apple and push notifications (APNs). One key from the Apple
 * developer account (Keys → "+" with both Sign in with Apple and Apple Push Notifications service) does both:
 * APPLE_TEAM_ID, APPLE_KEY_ID, and APPLE_PRIVATE_KEY (the .p8 file's text; "\n" may stand for line breaks).
 * APPLE_BUNDLE_ID is the app's id (default kr.ikhimi.app). Unset = no Apple button and no pushes.
 */
import { createPrivateKey, createPublicKey, sign, verify, type JsonWebKey, type KeyObject } from 'node:crypto'

export const APPLE_ISSUER = 'https://appleid.apple.com'

export function appleConfig() {
  const teamId = process.env.APPLE_TEAM_ID?.trim()
  const keyId = process.env.APPLE_KEY_ID?.trim()
  const pem = process.env.APPLE_PRIVATE_KEY?.replace(/\\n/g, '\n').trim()
  const bundleId = process.env.APPLE_BUNDLE_ID?.trim() || 'kr.ikhimi.app'
  if (!teamId || !keyId || !pem) return null
  return { teamId, keyId, pem, bundleId }
}
export type AppleConfig = NonNullable<ReturnType<typeof appleConfig>>

const b64url = (v: Buffer | string) => Buffer.from(v).toString('base64url')
const json64 = (o: unknown) => b64url(JSON.stringify(o))

/** An ES256 token signed with the developer key: APNs' provider token and Sign in with Apple's client secret */
export function signedToken(cfg: AppleConfig, claims: Record<string, unknown>) {
  const data = `${json64({ alg: 'ES256', kid: cfg.keyId })}.${json64(claims)}`
  const sig = sign('sha256', Buffer.from(data), { key: createPrivateKey(cfg.pem), dsaEncoding: 'ieee-p1363' })
  return `${data}.${b64url(sig)}`
}

// ─── Sign in with Apple ─────────────────────────────────────────────────────

type Jwk = JsonWebKey & { kid: string }
let keysCache: { at: number; keys: Jwk[] } | null = null

async function applePublicKey(kid: string, fetcher: typeof fetch): Promise<KeyObject | null> {
  const find = () => keysCache?.keys.find((k) => k.kid === kid)
  // Apple rotates its keys now and then: an unknown kid refetches, at most once a minute
  if (!keysCache || (!find() && Date.now() - keysCache.at > 60_000) || Date.now() - keysCache.at > 3600_000) {
    const res = await fetcher(`${APPLE_ISSUER}/auth/keys`)
    if (!res.ok) throw new Error(`apple keys ${res.status}`)
    keysCache = { at: Date.now(), keys: ((await res.json()) as { keys: Jwk[] }).keys }
  }
  const jwk = find()
  return jwk ? createPublicKey({ key: jwk, format: 'jwk' }) : null
}

/**
 * Checks the identity token the iPhone got from Apple: Apple's signature, issued by Apple for this app, not expired.
 * Returns Apple's stable user id (`sub`) and the person's own email when Apple verified it (not a hidden relay
 * address), or null when anything is off.
 */
export async function verifyAppleIdentityToken(token: string, bundleId: string, opts: { now?: number; fetcher?: typeof fetch } = {}) {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const header = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString()) as { alg?: string; kid?: string }
    const claims = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString()) as {
      iss?: string
      aud?: string
      exp?: number
      sub?: string
      email?: string
      email_verified?: boolean | string
      is_private_email?: boolean | string
    }
    if (header.alg !== 'RS256' || !header.kid) return null
    const key = await applePublicKey(header.kid, opts.fetcher ?? fetch)
    if (!key) return null
    const ok = verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2]!, 'base64url'))
    const now = (opts.now ?? Date.now()) / 1000
    if (!ok || claims.iss !== APPLE_ISSUER || claims.aud !== bundleId || !claims.exp || claims.exp < now || !claims.sub) return null
    const verified = String(claims.email_verified) === 'true' && String(claims.is_private_email) !== 'true'
    return { sub: claims.sub, email: verified && typeof claims.email === 'string' ? claims.email : null }
  } catch {
    return null
  }
}

const clientSecret = (cfg: AppleConfig) => {
  const iat = Math.floor(Date.now() / 1000)
  return signedToken(cfg, { iss: cfg.teamId, iat, exp: iat + 300, aud: APPLE_ISSUER, sub: cfg.bundleId })
}

/** The one-time authorization code → Apple's refresh token (kept only to revoke it later). Null if Apple says no. */
export async function exchangeAppleCode(cfg: AppleConfig, code: string, fetcher: typeof fetch = fetch) {
  const res = await fetcher(`${APPLE_ISSUER}/auth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: cfg.bundleId, client_secret: clientSecret(cfg), code, grant_type: 'authorization_code' }),
  })
  if (!res.ok) return null
  return ((await res.json()) as { refresh_token?: string }).refresh_token ?? null
}

/** The account was deleted: Apple forgets that it signed in to 익히미 (App Store rule 5.1.1) */
export async function revokeAppleToken(cfg: AppleConfig, refreshToken: string, fetcher: typeof fetch = fetch) {
  const res = await fetcher(`${APPLE_ISSUER}/auth/revoke`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: cfg.bundleId, client_secret: clientSecret(cfg), token: refreshToken, token_type_hint: 'refresh_token' }),
  })
  return res.ok
}

/** The phone column of an account made with Sign in with Apple: not a number anyone can sign in with, and unique */
export const APPLE_PHONE_PREFIX = 'apple:'
export const applePhone = (sub: string) => `${APPLE_PHONE_PREFIX}${sub}`
