import Link from 'next/link'
import { getDb } from '@ikhimi/db'
import { getT } from '@/i18n/server'
import { staffAccess } from '@/server/admin/staff'
import { getSession } from '@/server/request'
import { appShell, isStoreApp } from '@/server/store-app'
import { AppTabBar } from './AppTabBar'
import { AvatarMenu } from './AvatarMenu'
import { Logo } from './Logo'

/**
 * 64px header (design spec §7): lockup, role-appropriate nav, script toggle, avatar menu.
 * Reads the session itself; the legacy `signedIn` prop is ignored.
 * In the apps (appShell): a compact title bar, and the main places move to a bottom tab bar (AppTabBar); the rest of
 * the links (a teacher's courses, earnings…) go into the avatar menu.
 */
export async function AppHeader(_props: { signedIn?: boolean } = {}) {
  const session = await getSession()
  const { t } = await getT()
  const user = session?.user
  // Staff see an "Admin panel" entry in their menu
  const admin = user ? !!(await staffAccess(getDb(), user).catch(() => null)) : false
  // The Google Play app sells nothing: no plans or packages in its menu
  const store = await isStoreApp()
  const app = await appShell()
  const nav =
    user?.role === 'teacher'
      ? [
          { href: '/app', label: t('nav.home') },
          { href: '/app/groups', label: t('nav.groups') },
          { href: '/app/assignments', label: t('nav.reports') },
          { href: '/app/courses', label: t('nav.courses') },
          ...(store ? [] : [{ href: '/app/packages', label: t('nav.packages') }]),
          { href: '/app/earnings', label: t('nav.earnings') },
        ]
      : user
        ? [
            { href: '/work', label: t('nav.myWork') },
            { href: '/courses', label: t('nav.courses') },
            ...(store ? [] : [{ href: '/plans', label: t('nav.plans') }]),
          ]
        : [{ href: '/courses', label: t('nav.courses') }]

  if (app) {
    const tabRole = user?.role === 'teacher' ? 'teacher' : user ? 'student' : null
    const tabs = tabRole === 'teacher' ? ['/app', '/app/groups', '/app/assignments'] : ['/work', '/courses']
    return (
      <>
        <header className="app-topbar">
          <Link href={user ? (user.role === 'teacher' ? '/app' : '/work') : '/'} aria-label={t('nav.home')} className="flex items-center">
            <Logo className="h-6 w-auto" />
          </Link>
          <div className="flex items-center gap-1">
            {user ? (
              <AvatarMenu id={user.id} name={user.fullName} role={user.role} roles={user.roles} admin={admin} links={nav.filter((n) => !tabs.includes(n.href))} />
            ) : (
              <Link href="/signin" className="btn btn-secondary btn-sm">
                <span className="btn-label">{t('auth.signIn')}</span>
              </Link>
            )}
          </div>
        </header>
        {tabRole && <AppTabBar role={tabRole} />}
      </>
    )
  }

  return (
    <header className="sticky top-0 z-20 border-b border-paper-300 bg-paper-100/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-3 px-4">
        <div className="flex items-center gap-6">
          <Link href={user ? (user.role === 'teacher' ? '/app' : '/work') : '/'} aria-label={t('nav.home')} className="flex items-center">
            {/* Full lockup from 480px; the cap tile alone on narrow phones so controls fit */}
            <span className="hidden min-[480px]:inline-flex">
              <Logo className="h-7 w-auto" />
            </span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/app-icon.svg" alt="익히미" className="size-9 rounded-md min-[480px]:hidden" />
          </Link>
          {nav.length > 0 && (
            <nav className="hidden items-center gap-1 md:flex">
              {nav.map((n) => (
                <Link key={n.href} href={n.href} className="t-h3 rounded-md px-3 py-2 text-ink-500 hover:bg-paper-200 hover:text-ink-800">
                  {n.label}
                </Link>
              ))}
            </nav>
          )}
        </div>
        <div className="flex items-center gap-2">
          {user ? (
            <AvatarMenu id={user.id} name={user.fullName} role={user.role} roles={user.roles} admin={admin} />
          ) : (
            <Link href="/signin" className="btn btn-secondary btn-sm">
              <span className="btn-label">{t('auth.signIn')}</span>
            </Link>
          )}
        </div>
      </div>
      {nav.length > 1 && (
        <nav className="flex gap-1 overflow-x-auto border-t border-paper-300 px-3 md:hidden">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className="t-small shrink-0 rounded-md px-3 py-2.5 font-medium text-ink-500 hover:text-ink-800">
              {n.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  )
}
