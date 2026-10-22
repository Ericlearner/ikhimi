import type { Metadata, Viewport } from 'next'
import { Analytics } from '@vercel/analytics/next'
import { SiteFooter } from '@/components/SiteFooter'
import '@fontsource-variable/inter'
import '@fontsource/pt-serif/700.css'
import '@fontsource-variable/nunito/wght-italic.css'
import './globals.css'
import ko from '@ikhimi/i18n/messages/ko.json'
import { HTML_LANG, type MessageKey } from '@ikhimi/i18n'
import { ToastProvider } from '@ikhimi/ui/components'
import { brand } from '@ikhimi/ui/tokens'
import { ClientPrefs } from '@/components/ClientPrefs'
import { IosAppPush } from '@/components/IosAppPush'
import { RegisterSW } from '@/components/RegisterSW'
import { I18nProvider } from '@/i18n/client'
import { messagesFor } from '@/i18n/server'
import { getLocale, getSession } from '@/server/request'
import { appShell, inIosApp } from '@/server/store-app'

export const metadata: Metadata = {
  title: '익히미',
  description: '숙제를 3분 만에 만들어요',
  icons: { icon: '/brand/app-icon.svg', apple: '/brand/app-icon.svg' },
}

export async function generateViewport(): Promise<Viewport> {
  return {
    width: 'device-width',
    initialScale: 1,
    // In the apps a page doesn't zoom like a web page (Settings → Text size makes text bigger)
    ...((await appShell()) ? { maximumScale: 1, userScalable: false } : {}),
    themeColor: [
      { media: '(prefers-color-scheme: light)', color: brand.paper100 },
      { media: '(prefers-color-scheme: dark)', color: brand.lamplight },
    ],
  }
}

const ALL_KEYS = Object.keys(ko) as MessageKey[]

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale()
  const session = await getSession().catch(() => null)
  const prefs = session?.user.prefs ?? {}
  // Defaults (§8): students hear sound, teachers don't
  const sound = prefs.sound ?? (session?.user.role === 'student' ? 'normal' : 'off')
  // Opened in an app: the app look (globals.css, [data-app])
  const app = await appShell()
  return (
    <html
      lang={HTML_LANG[locale]}
      data-theme={prefs.theme && prefs.theme !== 'system' ? prefs.theme : undefined}
      data-motion={prefs.motion && prefs.motion !== 'system' ? prefs.motion : undefined}
      data-text-size={prefs.textSize && prefs.textSize !== 'normal' ? prefs.textSize : undefined}
      data-app={app ?? undefined}
      // The teacher side wears purple where the student side is orange (tokens.css, [data-side='teacher'])
      data-side={session?.user.role === 'teacher' ? 'teacher' : undefined}
    >
      <body className="flex min-h-dvh flex-col">
        <I18nProvider locale={locale} messages={messagesFor(locale, ALL_KEYS)}>
          <ToastProvider>{children}</ToastProvider>
          <SiteFooter />
          <ClientPrefs sound={session ? sound : 'normal'} generationChime={!!prefs.generationChime} soundPack={prefs.soundPack} />
          <RegisterSW />
          {/* Vercel Web Analytics: visitors and page views, no cookies */}
          <Analytics />
          {session && (await inIosApp()) && <IosAppPush />}
        </I18nProvider>
      </body>
    </html>
  )
}
