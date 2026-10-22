export type OtpChannel = 'sms' | 'telegram'

export interface SmsProvider {
  readonly name: string
  /** Where a code sent to this number arrives — shown to the user so they know where to look. */
  channelFor(phone: string): OtpChannel
  /**
   * `phone` is E.164. `text` is the full localized message (SMS gateways send it as-is);
   * `code` is the bare OTP for channels that render their own message (Telegram Gateway).
   * Throws OtpUndeliverableError when the number can't receive on this channel; other errors on failure.
   */
  send(phone: string, text: string, opts?: { code?: string; ttlSeconds?: number }): Promise<{ providerMessageId?: string }>
}

/** The number exists but can't be reached on this channel (e.g. no Telegram account). */
export class OtpUndeliverableError extends Error {
  constructor(public readonly channel: OtpChannel, detail: string) {
    super(`Cannot deliver OTP via ${channel}: ${detail}`)
    this.name = 'OtpUndeliverableError'
  }
}
