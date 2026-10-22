import type { SmsProvider } from './types'

/** Development only: prints the SMS to the server log instead of sending it. */
export class ConsoleSmsProvider implements SmsProvider {
  readonly name = 'console'
  channelFor() {
    return 'sms' as const
  }
  readonly sent: { phone: string; text: string }[] = []
  async send(phone: string, text: string, _opts?: { code?: string; ttlSeconds?: number }) {
    this.sent.push({ phone, text })
    console.info(`\n[sms:console] → ${phone}\n  ${text}\n`)
    return {}
  }
}
