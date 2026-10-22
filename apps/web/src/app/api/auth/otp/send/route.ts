import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb } from '@ikhimi/db'
import { normalizePhone, type CountryCode, t } from '@ikhimi/i18n'
import { requestOtp } from '@/server/auth/otp'
import { isReviewPhone } from '@/server/auth/review'
import { env } from '@/server/env'
import { clientIp, getLocale, HttpError, route } from '@/server/request'
import { getSmsProvider, OtpUndeliverableError } from '@/server/sms'

const body = z.object({ phone: z.string().max(40), country: z.string().regex(/^[A-Z]{2}$/).optional() })

export const POST = route(async (req) => {
  const { phone: raw, country } = body.parse(await req.json())
  const phone = normalizePhone(raw, (country as CountryCode | undefined) ?? 'UZ')
  if (!phone) throw new HttpError(400, 'phone_invalid')
  // The store reviewers' number: nothing is sent, the fixed code works (server/auth/review.ts)
  if (isReviewPhone(phone)) return NextResponse.json({ phone, channel: 'sms', resendAfterSeconds: 60 })
  // No SMS service yet in production: say so instead of a code that never comes
  if (env().SMS_PROVIDER === 'console' && env().NODE_ENV === 'production') throw new HttpError(400, 'sms_unavailable')
  const locale = await getLocale()
  const sms = getSmsProvider()
  const result = await requestOtp(
    { db: getDb(), pepper: env().AUTH_PEPPER, sms },
    { phone, ip: await clientIp(), smsText: (code) => t(locale, 'sms.otp', { code }) },
  ).catch((err) => {
    if (err instanceof OtpUndeliverableError) throw new HttpError(400, `${err.channel}_unavailable`)
    throw err
  })
  if (!result.ok) throw new HttpError(429, 'rate_limited', { retryAfterSeconds: result.retryAfterSeconds })
  return NextResponse.json({ phone, channel: sms.channelFor(phone), resendAfterSeconds: result.resendAfterSeconds })
})
