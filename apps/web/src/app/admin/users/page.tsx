import { Search } from 'lucide-react'
import Link from 'next/link'
import { getDb } from '@ikhimi/db'
import { formatDate, type MessageKey } from '@ikhimi/i18n'
import { Avatar, Badge, ICON } from '@ikhimi/ui/components'
import { getT } from '@/i18n/server'
import { pageStaff } from '@/server/admin/guard'
import { maskForStaff } from '@/server/admin/permissions'
import { searchUsers } from '@/server/admin/stats'

/** Find a teacher or student by name or part of their phone number. Numbers are masked here. */
export default async function AdminUsers({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const db = getDb()
  await pageStaff(db, 'users.view')
  const { t } = await getT()
  const q = ((await searchParams).q ?? '').slice(0, 80)
  const rows = await searchUsers(db, q)
  return (
    <div className="flex flex-col gap-4">
      <form className="flex max-w-xl items-center gap-2" action="/admin/users">
        <label className="relative flex-1">
          <span className="sr-only">{t('admin.users.search')}</span>
          <Search size={18} strokeWidth={ICON.strokeWidth} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" aria-hidden />
          <input name="q" defaultValue={q} placeholder={t('admin.users.searchPlaceholder')} className="t-body min-h-11 w-full rounded-md border border-paper-300 bg-paper-50 pl-10 pr-3" />
        </label>
        <button className="btn btn-secondary btn-md">
          <span className="btn-label">{t('admin.users.search')}</span>
        </button>
      </form>
      {rows.length === 0 ? (
        <p className="t-body text-ink-500">{t('admin.users.none')}</p>
      ) : (
        <ul className="overflow-hidden rounded-lg border border-paper-300 bg-paper-50">
          {rows.map((u) => (
            <li key={u.id} className="border-b border-paper-300 last:border-b-0">
              <Link href={`/admin/users/${u.id}`} className="press flex items-center gap-3 px-4 py-3 hover:bg-paper-100">
                <Avatar id={u.id} name={u.fullName} size={36} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="t-body truncate font-medium">{u.fullName ?? '—'}</span>
                  <span className="t-small t-num text-ink-500">
                    {maskForStaff(u.email, u.phone)} · {t('admin.users.joined', { date: formatDate(u.createdAt) })}
                    {u.lastActiveAt ? ` · ${t('admin.users.lastActive', { date: formatDate(u.lastActiveAt) })}` : ''}
                  </span>
                </span>
                <span className="flex shrink-0 flex-wrap justify-end gap-1">
                  {(u.roles.length ? u.roles : [u.role]).map((r) => (
                    <Badge key={r}>{t(`role.${r}` as MessageKey)}</Badge>
                  ))}
                  {u.blockedAt && <Badge tone="error">{t('admin.users.blocked')}</Badge>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
