import { getDb } from '@ikhimi/db'
import { formatDate } from '@ikhimi/i18n'
import { getT } from '@/i18n/server'
import { pageStaff } from '@/server/admin/guard'
import { auditLog } from '@/server/admin/stats'

/** Who on the staff did what, newest first */
export default async function AdminAudit() {
  const db = getDb()
  await pageStaff(db, 'audit')
  const { t } = await getT()
  const rows = await auditLog(db)
  return rows.length === 0 ? (
    <p className="t-body text-ink-500">{t('admin.audit.none')}</p>
  ) : (
    <ul className="overflow-hidden rounded-lg border border-paper-300 bg-paper-50">
      {rows.map((r) => (
        <li key={r.id} className="t-small flex flex-col gap-0.5 border-b border-paper-300 px-4 py-2 last:border-b-0">
          <span className="flex flex-wrap gap-x-2">
            <span className="t-num text-ink-400">{formatDate(r.createdAt)}</span>
            <span className="font-medium">{r.actorName ?? '—'}</span>
            <span className="text-ink-700">{r.action}</span>
            {r.targetType === 'user' && r.targetId && (
              <a href={`/admin/users/${r.targetId}`} className="text-orange-600 hover:underline">
                {r.targetName ?? r.targetId}
              </a>
            )}
            {r.targetType === 'assignment' && r.targetId && (
              <a href={`/admin/content/${r.targetId}`} className="text-orange-600 hover:underline">
                {r.targetId}
              </a>
            )}
          </span>
          {Object.keys(r.details).length > 0 && <span className="break-words text-ink-500">{JSON.stringify(r.details)}</span>}
        </li>
      ))}
    </ul>
  )
}
