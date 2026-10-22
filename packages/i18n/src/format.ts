import { getCountries, getCountryCallingCode, parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/min'

export type { CountryCode }

/**
 * Most users are in Korea, but any country's number is accepted. Korea is only the default when no `+country` prefix
 * is typed, so 010-1234-5678 means +82 10-1234-5678.
 *
 * Returns E.164 (`+821012345678`, `+14155552671`) or null.
 *
 * We check that the number is *possible* (right length for its country), not *valid* against operator prefixes:
 * bundled prefix tables go stale, and a stale table would lock real people out. The code proves the number is real anyway.
 */
export function normalizePhone(input: string, defaultCountry: CountryCode = 'KR'): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  let candidate = trimmed
  // "821012345678" typed without a plus
  const digits = trimmed.replace(/\D/g, '')
  if (!trimmed.startsWith('+') && /^82\d{9,10}$/.test(digits)) candidate = `+${digits}`
  const parsed = parsePhoneNumberFromString(candidate, defaultCountry)
  if (!parsed || !parsed.isPossible()) return null
  return parsed.number
}

/** `+821012345678` → `010-1234-5678`; other countries in international format, e.g. `+1 415 555 2671`. */
export function formatPhone(e164: string): string {
  const parsed = parsePhoneNumberFromString(e164)
  if (!parsed) return e164
  return parsed.country === 'KR' ? parsed.formatNational() : parsed.formatInternational()
}

/** Mask for logs: keep the country code and the last two digits. */
export function maskPhone(e164: string): string {
  const parsed = parsePhoneNumberFromString(e164)
  if (!parsed) return '***'
  const nat = parsed.nationalNumber
  return `+${parsed.countryCallingCode} ${'*'.repeat(Math.max(0, nat.length - 2))}${nat.slice(-2)}`
}

export const isKoreanPhone = (e164: string) => e164.startsWith('+82')

/** Shown first in the country picker */
export const PRIORITY_COUNTRIES: CountryCode[] = ['KR', 'US', 'JP', 'CN', 'CA', 'AU', 'GB', 'VN', 'PH', 'SG']

export function listCountries(): { code: CountryCode; dial: string }[] {
  const rest = getCountries().filter((c) => !PRIORITY_COUNTRIES.includes(c))
  return [...PRIORITY_COUNTRIES, ...rest].map((code) => ({ code, dial: getCountryCallingCode(code) }))
}

export const SEOUL_TZ = 'Asia/Seoul'

/** YYYY.MM.DD in Asia/Seoul */
export function formatDate(d: Date, timeZone = SEOUL_TZ): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(d)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return `${get('year')}.${get('month')}.${get('day')}`
}

/** MM.DD in Asia/Seoul, for chart axes */
export function formatShortDate(d: Date, timeZone = SEOUL_TZ): string {
  return formatDate(d, timeZone).slice(5)
}

/** Integer KRW with comma thousands separators: 25000 → "25,000" (suffix optional, written straight after: "25,000원"). */
export function formatKrw(amountKrw: number, suffix = ''): string {
  if (!Number.isInteger(amountKrw)) throw new Error('Money must be an integer number of KRW')
  const sign = amountKrw < 0 ? '-' : ''
  const s = Math.abs(amountKrw)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${sign}${s}${suffix}`
}

/** Monday = 0 … Sunday = 6 */
export function weekdayIndexMondayFirst(d: Date): number {
  return (d.getDay() + 6) % 7
}
