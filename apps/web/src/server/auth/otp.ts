/**
 * Phone OTP (§16): 6-digit codes, 5-minute expiry, 3 sends per phone per 15 min,
 * 5 verification attempts per code, constant-time comparison, hashed at rest.
 */
import { createHash, randomInt, timingSafeEqual } from 'node:crypto'
import { AUTH, and, desc, eq, gt, isNull, otpCodes, sql, type Db } from '@ikhimi/db'
import { maskPhone } from '@ikhimi/i18n'
import type { SmsProvider } from '../sms/types'

export type OtpDeps = { db: Db; pepper: string; now?: () => Date }

export const hashWithPepper = (value: string, pepper: string) =>
  createHash('sha256').update(`${pepper}:${value}`).digest('hex')

export function generateOtpCode(): string {
  return randomInt(0, 10 ** AUTH.otpLength)
    .toString()
    .padStart(AUTH.otpLength, '0')
}

export type RequestOtpResult =
  | { ok: true; resendAfterSeconds: number }
  | { ok: false; reason: 'rate_limited'; retryAfterSeconds: number }

export async function requestOtp(
  deps: OtpDeps & { sms: SmsProvider },
  input: { phone: string; ip: string | null; smsText: (code: string) => string },
): Promise<RequestOtpResult> {
  const now = deps.now?.() ?? new Date()
  const windowStart = new Date(now.getTime() - AUTH.otpSendWindowSeconds * 1000)
  const ipHash = input.ip ? hashWithPepper(input.ip, deps.pepper) : null

  const recent = await deps.db
    .select({ createdAt: otpCodes.createdAt })
    .from(otpCodes)
    .where(and(eq(otpCodes.phone, input.phone), gt(otpCodes.createdAt, windowStart)))
    .orderBy(otpCodes.createdAt)

  if (recent.length >= AUTH.otpMaxSendsPerPhone) {
    const oldest = recent[0]!.createdAt.getTime()
    const retryAfterSeconds = Math.ceil((oldest + AUTH.otpSendWindowSeconds * 1000 - now.getTime()) / 1000)
    return { ok: false, reason: 'rate_limited', retryAfterSeconds }
  }
  const last = recent.at(-1)
  if (last) {
    const since = (now.getTime() - last.createdAt.getTime()) / 1000
    if (since < AUTH.otpResendCooldownSeconds) {
      return { ok: false, reason: 'rate_limited', retryAfterSeconds: Math.ceil(AUTH.otpResendCooldownSeconds - since) }
    }
  }

  if (ipHash) {
    const [row] = await deps.db
      .select({ n: sql<number>`count(*)::int` })
      .from(otpCodes)
      .where(and(eq(otpCodes.ipHash, ipHash), gt(otpCodes.createdAt, windowStart)))
    if ((row?.n ?? 0) >= AUTH.otpMaxSendsPerIp) {
      // Many different phones from one IP = enumeration or SMS-pumping. Alert, don't send.
      console.warn(`[auth] OTP enumeration suspected: ip=${ipHash.slice(0, 12)} sends=${row?.n} phone=${maskPhone(input.phone)}`)
      return { ok: false, reason: 'rate_limited', retryAfterSeconds: AUTH.otpSendWindowSeconds }
    }
  }

  const code = generateOtpCode()
  const [row] = await deps.db.insert(otpCodes).values({
    phone: input.phone,
    codeHash: hashWithPepper(`${input.phone}:${code}`, deps.pepper),
    ipHash,
    expiresAt: new Date(now.getTime() + AUTH.otpTtlSeconds * 1000),
    createdAt: now,
  }).returning({ id: otpCodes.id })
  try {
    await deps.sms.send(input.phone, input.smsText(code), { code, ttlSeconds: AUTH.otpTtlSeconds })
  } catch (err) {
    // Undelivered codes must not eat into the user's 3-per-15-min allowance
    await deps.db.delete(otpCodes).where(eq(otpCodes.id, row!.id))
    throw err
  }
  return { ok: true, resendAfterSeconds: AUTH.otpResendCooldownSeconds }
}

export type VerifyOtpResult = { ok: true } | { ok: false; reason: 'invalid' | 'expired' | 'too_many_attempts' }

export async function verifyOtp(deps: OtpDeps, input: { phone: string; code: string }): Promise<VerifyOtpResult> {
  const now = deps.now?.() ?? new Date()
  const [row] = await deps.db
    .select()
    .from(otpCodes)
    .where(and(eq(otpCodes.phone, input.phone), isNull(otpCodes.consumedAt)))
    .orderBy(desc(otpCodes.createdAt))
    .limit(1)

  if (!row) return { ok: false, reason: 'expired' }
  if (row.expiresAt <= now) return { ok: false, reason: 'expired' }
  if (row.attempts >= AUTH.otpMaxVerifyAttempts) return { ok: false, reason: 'too_many_attempts' }

  // Count the attempt before comparing, so concurrent guesses can't exceed the limit.
  await deps.db
    .update(otpCodes)
    .set({ attempts: sql`${otpCodes.attempts} + 1` })
    .where(eq(otpCodes.id, row.id))

  const candidate = /^\d+$/.test(input.code) ? input.code : ''
  const expected = Buffer.from(row.codeHash, 'hex')
  const actual = Buffer.from(hashWithPepper(`${input.phone}:${candidate}`, deps.pepper), 'hex')
  if (!timingSafeEqual(expected, actual)) {
    return { ok: false, reason: row.attempts + 1 >= AUTH.otpMaxVerifyAttempts ? 'too_many_attempts' : 'invalid' }
  }

  // Single use: only the request that flips consumedAt wins.
  const consumed = await deps.db
    .update(otpCodes)
    .set({ consumedAt: now })
    .where(and(eq(otpCodes.id, row.id), isNull(otpCodes.consumedAt)))
    .returning({ id: otpCodes.id })
  if (consumed.length === 0) return { ok: false, reason: 'expired' }
  return { ok: true }
}
