/** The interface is Korean only. */
export const LOCALES = ['ko'] as const
export type Locale = (typeof LOCALES)[number]

export const DEFAULT_LOCALE: Locale = 'ko'

/** BCP-47 tag for the <html lang> attribute. */
export const HTML_LANG: Record<Locale, string> = { ko: 'ko' }

export function isLocale(v: unknown): v is Locale {
  return typeof v === 'string' && (LOCALES as readonly string[]).includes(v)
}
