import { env } from '../env'
import { ConsoleSmsProvider } from './console'
import { TelegramGatewayProvider } from './telegram'
import { TwilioSmsProvider } from './twilio'
import type { SmsProvider } from './types'

export type { SmsProvider }
export { OtpUndeliverableError, type OtpChannel } from './types'

let provider: SmsProvider | undefined
export function getSmsProvider(): SmsProvider {
  if (provider) return provider
  const e = env()
  if (e.SMS_PROVIDER === 'telegram') {
    // One channel for every country (§ DECISIONS G)
    if (!e.TELEGRAM_GATEWAY_TOKEN) throw new Error('TELEGRAM_GATEWAY_TOKEN not set')
    provider = new TelegramGatewayProvider({ token: e.TELEGRAM_GATEWAY_TOKEN })
  } else if (e.SMS_PROVIDER === 'twilio') {
    if (!e.TWILIO_ACCOUNT_SID || !e.TWILIO_AUTH_TOKEN || !e.TWILIO_FROM) throw new Error('TWILIO_* not set')
    provider = new TwilioSmsProvider({ accountSid: e.TWILIO_ACCOUNT_SID, authToken: e.TWILIO_AUTH_TOKEN, from: e.TWILIO_FROM })
  } else {
    if (e.NODE_ENV === 'production') throw new Error('SMS_PROVIDER=console is not allowed in production')
    provider = new ConsoleSmsProvider()
  }
  return provider
}
