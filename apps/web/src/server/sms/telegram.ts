import type { SmsProvider } from './types'
import { OtpUndeliverableError } from './types'

/**
 * Telegram Gateway (https://core.telegram.org/gateway/api): login codes delivered as a Telegram message
 * from the official "Verification Codes" chat. Works for any country, far cheaper than international SMS.
 *
 * Flow: checkSendAbility (free) → sendVerificationMessage with its request_id, so we're charged once.
 * We pass our own code (we still verify it ourselves) and a ttl: undelivered within ttl = auto-refund.
 */
type GatewayResponse = { ok: boolean; result?: { request_id: string }; error?: string }

// Errors that mean *our* setup is broken, not that the user is unreachable.
const CONFIG_ERRORS = /ACCESS_TOKEN|BALANCE|FLOOD|INTERNAL/i

export class TelegramGatewayProvider implements SmsProvider {
  readonly name = 'telegram'
  private readonly base = 'https://gatewayapi.telegram.org'

  constructor(
    private readonly opts: { token: string },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  channelFor() {
    return 'telegram' as const
  }

  private async call(method: string, params: Record<string, string | number>): Promise<GatewayResponse> {
    const res = await this.fetchImpl(`${this.base}/${method}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.opts.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })
    if (!res.ok && res.status >= 500) throw new Error(`Telegram Gateway ${method}: HTTP ${res.status}`)
    return (await res.json()) as GatewayResponse
  }

  async send(phone: string, _text: string, opts: { code?: string; ttlSeconds?: number } = {}) {
    if (!opts.code) throw new Error('Telegram Gateway needs the bare OTP code')

    const check = await this.call('checkSendAbility', { phone_number: phone })
    if (!check.ok || !check.result) {
      if (check.error && CONFIG_ERRORS.test(check.error)) throw new Error(`Telegram Gateway: ${check.error}`)
      throw new OtpUndeliverableError('telegram', check.error ?? 'unknown')
    }

    const sent = await this.call('sendVerificationMessage', {
      phone_number: phone,
      request_id: check.result.request_id,
      code: opts.code,
      ttl: Math.min(3600, Math.max(30, opts.ttlSeconds ?? 300)),
    })
    if (!sent.ok || !sent.result) {
      if (sent.error && CONFIG_ERRORS.test(sent.error)) throw new Error(`Telegram Gateway: ${sent.error}`)
      throw new OtpUndeliverableError('telegram', sent.error ?? 'unknown')
    }
    return { providerMessageId: sent.result.request_id }
  }
}
