'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useI18n } from '@/i18n/client'

/** Which class's students take this package's seats */
export function PackageGroup({ packageId, groupId, groups }: { packageId: string; groupId: string | null; groups: { id: string; name: string }[] }) {
  const { t } = useI18n()
  const router = useRouter()
  const [value, setValue] = useState(groupId ?? '')
  const [saving, setSaving] = useState(false)
  const change = async (id: string) => {
    setValue(id)
    if (!id) return
    setSaving(true)
    await fetch(`/api/packages/${packageId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ groupId: id }) })
    setSaving(false)
    router.refresh()
  }
  if (!groups.length) return <p className="t-small text-ink-500">{t('packages.noGroups')}</p>
  return (
    <label className="t-small flex flex-wrap items-center gap-2 text-ink-700">
      {t('plans.forGroup')}:
      <select value={value} disabled={saving} onChange={(e) => void change(e.target.value)} className="t-body min-h-11 rounded-md border border-paper-300 bg-paper-50 px-3">
        {!value && <option value="">{t('packages.pickGroup')}</option>}
        {groups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </select>
    </label>
  )
}
