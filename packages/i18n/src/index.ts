import ko from '../messages/ko.json'
import type { Locale } from './locale'

export * from './locale'
export * from './format'
export { normalizeApostrophes } from './text'

export type MessageKey = keyof typeof ko
export type Messages = Record<MessageKey, string>

/** Resolve a message. `{name}` placeholders are interpolated. The locale argument is kept so callers stay uniform. */
export function t(_locale: Locale, key: MessageKey, vars?: Record<string, string | number>): string {
  const raw = ko[key] ?? key
  if (!vars) return raw
  return raw.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m))
}

export function getTranslator(locale: Locale) {
  return (key: MessageKey, vars?: Record<string, string | number>) => t(locale, key, vars)
}

export type Translator = ReturnType<typeof getTranslator>
