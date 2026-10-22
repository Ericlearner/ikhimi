'use client'
import { createContext, useContext, type ReactNode } from 'react'
import type { Locale, MessageKey, Messages } from '@ikhimi/i18n'

type Ctx = { locale: Locale; messages: Messages }
const I18nContext = createContext<Ctx | null>(null)

export function I18nProvider({ locale, messages, children }: Ctx & { children: ReactNode }) {
  return <I18nContext.Provider value={{ locale, messages }}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n outside I18nProvider')
  const t = (key: MessageKey, vars?: Record<string, string | number>) => {
    const raw = ctx.messages[key] ?? key
    return vars ? raw.replace(/\{(\w+)\}/g, (m, n: string) => (n in vars ? String(vars[n]) : m)) : raw
  }
  return { locale: ctx.locale, t }
}
