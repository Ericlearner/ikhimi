import { ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { ICON } from '@ikhimi/ui/components'
import { SITE, supportMailto } from '@/content/site'
import { getT } from '@/i18n/server'
import { apkVersion, appShell } from '@/server/store-app'

/** Every page's footer: legal pages, help and the support bot. Not in the apps: those links are in Profile there. */
export async function SiteFooter() {
  if (await appShell()) return null
  const { t } = await getT()
  const links = [
    { href: '/about', label: t('footer.about') },
    { href: '/courses', label: t('nav.courses') },
    { href: '/help', label: t('footer.help') },
    ...(apkVersion() ? [{ href: '/android', label: t('footer.androidApp') }] : []),
    { href: '/terms', label: t('footer.terms') },
    { href: '/privacy', label: t('footer.privacy') },
  ]
  return (
    <footer className="site-footer mt-auto border-t border-paper-300 bg-paper-100">
      <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-6 sm:flex-row sm:items-center sm:justify-between">
        <nav className="flex flex-wrap gap-x-4 gap-y-1" aria-label={t('footer.label')}>
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="t-small text-ink-500 hover:text-ink-800">
              {l.label}
            </Link>
          ))}
          <a href={supportMailto()} className="t-small text-ink-500 hover:text-ink-800">
            {SITE.supportEmail}
          </a>
        </nav>
        <p className="t-small text-ink-400">© {new Date().getFullYear()} 익히미</p>
      </div>
      {/* Business details Korean e-commerce law asks every shop to show */}
      <p className="t-small mx-auto max-w-5xl px-4 pb-6 text-ink-400">
        상호: {SITE.operatorName} · 대표자: {SITE.operatorCeo} · 사업자등록번호: {SITE.operatorTaxId} · 통신판매업 신고번호: {SITE.mailOrderNumber} · 주소:{' '}
        {SITE.operatorAddress} · {SITE.supportEmail}
      </p>
    </footer>
  )
}

/** The apps' Profile: what the website's footer holds (about, help, terms, privacy, the support email), as a list */
export async function AppInfoLinks() {
  if (!(await appShell())) return null
  const { t } = await getT()
  const links = [
    { href: '/about', label: t('footer.about') },
    { href: '/help', label: t('footer.help') },
    { href: '/terms', label: t('footer.terms') },
    { href: '/privacy', label: t('footer.privacy') },
  ]
  const row = 'press flex min-h-12 items-center justify-between gap-3 border-b border-paper-300 px-4 last:border-b-0 hover:bg-paper-200'
  return (
    <nav className="flex flex-col overflow-hidden rounded-lg border border-paper-300 bg-paper-50" aria-label={t('footer.label')}>
      {links.map((l) => (
        <Link key={l.href} href={l.href} className={row}>
          <span className="t-body">{l.label}</span>
          <ChevronRight size={18} strokeWidth={ICON.strokeWidth} className="shrink-0 text-ink-400" aria-hidden />
        </Link>
      ))}
      <a href={supportMailto()} className={row}>
        <span className="t-body">{SITE.supportEmail}</span>
        <ChevronRight size={18} strokeWidth={ICON.strokeWidth} className="shrink-0 text-ink-400" aria-hidden />
      </a>
      <p className="t-small px-4 py-3 text-ink-400">© {new Date().getFullYear()} 익히미</p>
    </nav>
  )
}
