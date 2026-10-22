import type { SmsProvider } from './types'

/** SMS through Twilio, for every country (Korean numbers included). */
export class TwilioSmsProvider implements SmsProvider {
  readonly name = 'twilio'
  channelFor() {
    return 'sms' as const
  }
  constructor(
    private readonly opts: { accountSid: string; authToken: string; from: string },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(phone: string, text: string) {
    const res = await this.fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${this.opts.accountSid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${this.opts.accountSid}:${this.opts.authToken}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: phone, From: this.opts.from, Body: text }),
    })
    if (!res.ok) throw new Error(`Twilio send failed: ${res.status} ${await res.text()}`)
    const json = (await res.json()) as { sid?: string }
    return { providerMessageId: json.sid }
  }
}
