import { describe, expect, it } from 'vitest'
import { TelegramGatewayProvider } from './telegram'
import { OtpUndeliverableError } from './types'

const mockFetch = (responses: Record<string, unknown>) => {
  const calls: { method: string; body: Record<string, unknown>; auth: string | null }[] = []
  const f = (async (url: string, init: RequestInit) => {
    const method = url.split('/').pop()!
    calls.push({ method, body: JSON.parse(String(init.body)), auth: new Headers(init.headers).get('authorization') })
    return new Response(JSON.stringify(responses[method]), { status: 200 })
  }) as unknown as typeof fetch
  return { f, calls }
}

describe('TelegramGatewayProvider', () => {
  it('checks ability, then sends our code with the same request_id and ttl', async () => {
    const { f, calls } = mockFetch({
      checkSendAbility: { ok: true, result: { request_id: 'req-1' } },
      sendVerificationMessage: { ok: true, result: { request_id: 'req-1' } },
    })
    const p = new TelegramGatewayProvider({ token: 'tok' }, f)
    expect(await p.send('+79161234567', 'ignored', { code: '123456', ttlSeconds: 300 })).toEqual({ providerMessageId: 'req-1' })
    expect(calls.map((c) => c.method)).toEqual(['checkSendAbility', 'sendVerificationMessage'])
    expect(calls[1]!.body).toEqual({ phone_number: '+79161234567', request_id: 'req-1', code: '123456', ttl: 300 })
    expect(calls[0]!.auth).toBe('Bearer tok')
  })

  it('reports an unreachable number as undeliverable and never pays to send', async () => {
    const { f, calls } = mockFetch({ checkSendAbility: { ok: false, error: 'PHONE_NUMBER_NOT_FOUND' } })
    const p = new TelegramGatewayProvider({ token: 'tok' }, f)
    await expect(p.send('+998901234567', '', { code: '123456' })).rejects.toBeInstanceOf(OtpUndeliverableError)
    expect(calls).toHaveLength(1)
  })

  it('treats a bad token or empty balance as our failure, not the user’s', async () => {
    const { f } = mockFetch({ checkSendAbility: { ok: false, error: 'ACCESS_TOKEN_INVALID' } })
    const p = new TelegramGatewayProvider({ token: 'bad' }, f)
    const err = await p.send('+998901234567', '', { code: '123456' }).catch((e) => e)
    expect(err).not.toBeInstanceOf(OtpUndeliverableError)
    expect(String(err)).toMatch(/ACCESS_TOKEN_INVALID/)
  })
})
