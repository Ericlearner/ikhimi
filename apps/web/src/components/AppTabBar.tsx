'use client'
import { BarChart3, BookOpen, Brain, ClipboardList, House, UserRound, Users, type LucideIcon } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { MessageKey } from '@ikhimi/i18n'
import { ICON } from '@ikhimi/ui/components'
import { useI18n } from '@/i18n/client'

/** `exact`: only that page; `also`: other pages that belong to the tab (a course opened from Courses) */
type Tab = { href: string; label: MessageKey; icon: LucideIcon; exact?: boolean; also?: string[] }

const TEACHER: Tab[] = [
  { href: '/app', label: 'nav.home', icon: House, exact: true },
  { href: '/app/groups', label: 'nav.groups', icon: Users },
  { href: '/app/assignments', label: 'nav.reports', icon: BarChart3, also: ['/app/a/'] },
  { href: '/profile', label: 'nav.profile', icon: UserRound },
]
const STUDENT: Tab[] = [
  { href: '/work', label: 'nav.myWork', icon: ClipboardList, exact: true },
  { href: '/courses', label: 'nav.courses', icon: BookOpen, also: ['/course/'] },
  { href: '/work/mistakes', label: 'nav.mistakes', icon: Brain },
  { href: '/profile', label: 'nav.profile', icon: UserRound },
]

/**
 * The apps' bottom tab bar (AppHeader draws it when the page is opened in an app): the main places of the account's
 * side, always one tap away, like any phone app. The website keeps its header links instead.
 */
export function AppTabBar({ role }: { role: 'teacher' | 'student' }) {
  const { t } = useI18n()
  const path = usePathname()
  const tabs = role === 'teacher' ? TEACHER : STUDENT
  const active = (tab: Tab) =>
    (tab.exact ? path === tab.href : path === tab.href || path.startsWith(`${tab.href}/`)) || !!tab.also?.some((p) => path.startsWith(p))
  return (
    <nav className="app-tabbar">
      {tabs.map((tab) => {
        const on = active(tab)
        const Icon = tab.icon
        return (
          <Link key={tab.href} href={tab.href} aria-current={on ? 'page' : undefined} className="app-tab press">
            <Icon size={24} strokeWidth={on ? 2.25 : ICON.strokeWidth} aria-hidden />
            <span>{t(tab.label)}</span>
          </Link>
        )
      })}
    </nav>
  )
}
