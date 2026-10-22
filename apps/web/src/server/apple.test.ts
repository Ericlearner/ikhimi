import { createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { APPLE_ISSUER, signedToken, verifyAppleIdentityToken } from './apple'

const apple = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = { ...apple.publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' }
const fetcher = (async () => Response.json({ keys: [jwk] })) as unknown as typeof fetch

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
function idToken(claims: Record<string, unknown>, kid = 'k1', key = apple.privateKey) {
  const data = `${b64({ alg: 'RS256', kid })}.${b64(claims)}`
  return `${data}.${sign('RSA-SHA256', Buffer.from(data), key).toString('base64url')}`
}
const now = Date.now()
const good = { iss: APPLE_ISSUER, aud: 'kr.ikhimi.app', sub: '001234.abc.0001', exp: Math.floor(now / 1000) + 600 }

describe('Sign in with Apple', () => {
  it("accepts Apple's token for this app and returns Apple's user id", async () => {
    expect(await verifyAppleIdentityToken(idToken(good), 'kr.ikhimi.app', { now, fetcher })).toEqual({ sub: good.sub, email: null })
  })

  it('returns the email only when Apple verified it and it is not a hidden relay address', async () => {
    const opts = { now, fetcher }
    const mine = { ...good, email: 'jieun@example.com', email_verified: 'true' }
    expect(await verifyAppleIdentityToken(idToken(mine), 'kr.ikhimi.app', opts)).toEqual({ sub: good.sub, email: 'jieun@example.com' })
    expect(await verifyAppleIdentityToken(idToken({ ...mine, email_verified: false }), 'kr.ikhimi.app', opts)).toEqual({ sub: good.sub, email: null })
    const relay = { ...mine, email: 'x1y2@privaterelay.appleid.com', is_private_email: 'true' }
    expect(await verifyAppleIdentityToken(idToken(relay), 'kr.ikhimi.app', opts)).toEqual({ sub: good.sub, email: null })
  })

  it('refuses a token for another app, an expired one, a forged one, or garbage', async () => {
    const opts = { now, fetcher }
    expect(await verifyAppleIdentityToken(idToken({ ...good, aud: 'com.other.app' }), 'kr.ikhimi.app', opts)).toBeNull()
    expect(await verifyAppleIdentityToken(idToken({ ...good, exp: Math.floor(now / 1000) - 1 }), 'kr.ikhimi.app', opts)).toBeNull()
    expect(await verifyAppleIdentityToken(idToken({ ...good, iss: 'https://evil.example' }), 'kr.ikhimi.app', opts)).toBeNull()
    const forger = generateKeyPairSync('rsa', { modulusLength: 2048 })
    expect(await verifyAppleIdentityToken(idToken(good, 'k1', forger.privateKey), 'kr.ikhimi.app', opts)).toBeNull()
    expect(await verifyAppleIdentityToken('not.a.token', 'kr.ikhimi.app', opts)).toBeNull()
  })

  it('signs the client secret / provider token with the developer key (ES256)', () => {
    const dev = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    const pem = dev.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()
    const token = signedToken({ teamId: 'TEAM123456', keyId: 'KEY1234567', pem, bundleId: 'kr.ikhimi.app' }, { iss: 'TEAM123456', iat: 1 })
    const [h, c, s] = token.split('.')
    expect(JSON.parse(Buffer.from(h!, 'base64url').toString())).toEqual({ alg: 'ES256', kid: 'KEY1234567' })
    expect(JSON.parse(Buffer.from(c!, 'base64url').toString())).toEqual({ iss: 'TEAM123456', iat: 1 })
    const ok = verify('sha256', Buffer.from(`${h}.${c}`), { key: createPublicKey(pem), dsaEncoding: 'ieee-p1363' }, Buffer.from(s!, 'base64url'))
    expect(ok).toBe(true)
  })
})
