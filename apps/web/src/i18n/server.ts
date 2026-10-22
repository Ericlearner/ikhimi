import 'server-only'
import { t as translate, type Locale, type MessageKey, type Messages } from '@ikhimi/i18n'
import { getLocale } from '@/server/request'

/** UI strings for display */
export function displayT(locale: Locale) {
  return (key: MessageKey, vars?: Record<string, string | number>) => translate(locale, key, vars)
}

export async function getT() {
  const locale = await getLocale()
  return { locale, t: displayT(locale) }
}

/** Full resolved catalog for the client provider (≈100 short strings — cheap to ship). */
export function messagesFor(locale: Locale, keys: readonly MessageKey[]): Messages {
  const out = {} as Messages
  const t = displayT(locale)
  for (const k of keys) out[k] = t(k)
  return out
}
