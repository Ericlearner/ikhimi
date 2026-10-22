import Link from 'next/link'
import type { MessageKey } from '@ikhimi/i18n'
import { Badge } from '@ikhimi/ui/components'
import { getT } from '@/i18n/server'
import type { Permission } from '@/server/admin/permissions'

const TABS: { href: string; key: MessageKey; need?: Permission | 'staff' }[] = [
  { href: '/admin', key: 'admin.nav.overview' },
  { href: '/admin/health', key: 'admin.nav.health', need: 'health' },
  { href: '/admin/business', key: 'admin.nav.business', need: 'business' },
  { href: '/admin/money', key: 'admin.nav.money', need: 'money' },
  { href: '/admin/users', key: 'admin.nav.users', need: 'users.view' },
  { href: '/admin/content', key: 'admin.nav.content', need: 'content' },
  { href: '/admin/courses', key: 'admin.nav.courses', need: 'content' },
  { href: '/admin/lab', key: 'admin.nav.methods', need: 'staff' },
  { href: '/admin/staff', key: 'admin.nav.staff', need: 'staff' },
  { href: '/admin/audit', key: 'admin.nav.audit', need: 'audit' },
]

/** Tabs for what this staff member may open */
export async function AdminNav({ owner, permissions, roleName }: { owner: boolean; permissions: Permission[]; roleName: string | null }) {
  const { t } = await getT()
  const tabs = TABS.filter((x) => !x.need || (x.need === 'staff' ? owner : permissions.includes(x.need)))
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="t-display-2">{t('admin.title')}</h1>
        <Badge tone={owner ? 'published' : 'neutral'}>{owner ? t('admin.owner') : roleName}</Badge>
      </div>
      <nav className="-mx-1 flex gap-1 overflow-x-auto pb-1">
        {tabs.map((x) => (
          <Link key={x.href} href={x.href} className="t-h3 shrink-0 rounded-md px-3 py-2 text-ink-500 hover:bg-paper-200 hover:text-ink-800">
            {t(x.key)}
          </Link>
        ))}
      </nav>
    </div>
  )
}
