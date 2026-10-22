import { describe, expect, it } from 'vitest'
import { exchangeGoogleCode, startGoogleFlow } from './google'

const cfg = { clientId: 'cid.apps.googleusercontent.com', clientSecret: 'sec' }
const redirectUri = 'https://ikhimi.kr/api/auth/google/callback'
const token = (claims: Record<string, unknown>) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`
const replying = (body: unknown, ok = true) => (async () => ({ ok, json: async () => body })) as unknown as typeof fetch

describe('Sign in with Google', () => {
  const { url, flow } = startGoogleFlow(cfg, { redirectUri, next: '/work' })
  const good = { iss: 'https://accounts.google.com', aud: cfg.clientId, exp: Date.now() / 1000 + 600, nonce: flow.nonce, sub: '1089', email: 'a@gmail.com', email_verified: true, name: 'Aziz Karimov' }

  it('sends the person to Google with state, nonce and PKCE', () => {
    const u = new URL(url)
    expect(u.origin).toBe('https://accounts.google.com')
    expect(u.searchParams.get('state')).toBe(flow.state)
    expect(u.searchParams.get('nonce')).toBe(flow.nonce)
    expect(u.searchParams.get('code_challenge_method')).toBe('S256')
    expect(u.searchParams.get('code_challenge')).not.toBe(flow.verifier)
    expect(u.searchParams.get('redirect_uri')).toBe(redirectUri)
  })

  it('reads who signed in from the ID token', async () => {
    expect(await exchangeGoogleCode(cfg, { code: 'c', redirectUri, flow }, replying({ id_token: token(good) }))).toEqual({ sub: '1089', email: 'a@gmail.com', name: 'Aziz Karimov' })
  })

  it('refuses a token for another app, another sign-in, from elsewhere or expired', async () => {
    for (const bad of [{ aud: 'other' }, { nonce: 'replayed' }, { iss: 'https://evil.example' }, { exp: Date.now() / 1000 - 10 }, { sub: '' }]) {
      expect(await exchangeGoogleCode(cfg, { code: 'c', redirectUri, flow }, replying({ id_token: token({ ...good, ...bad }) }))).toBeNull()
    }
    expect(await exchangeGoogleCode(cfg, { code: 'c', redirectUri, flow }, replying({ error: 'invalid_grant' }, false))).toBeNull()
  })

  it('keeps an email only when Google has verified it', async () => {
    const r = await exchangeGoogleCode(cfg, { code: 'c', redirectUri, flow }, replying({ id_token: token({ ...good, email_verified: false }) }))
    expect(r?.email).toBeNull()
  })
})
