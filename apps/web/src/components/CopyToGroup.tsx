'use client'
import { CopyPlus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button, ICON, SegmentedControl } from '@ikhimi/ui/components'
import { play } from '@ikhimi/ui/sound'
import { emptyGroupDetails, fieldClass, GroupDetailsFields, groupDetailsPayload, type GroupDetailsValue } from '@/components/GroupDetailsFields'
import { useI18n } from '@/i18n/client'
import { ERROR_KEYS, postJson } from '@/lib/client'
import { DurationPicker } from './DurationPicker'

/**
 * The same homework for another group, without generating it again: a copy with its own link and results, published
 * straight away. Opens the copy's page when done.
 */
export function CopyToGroup({ assignmentId, groups }: { assignmentId: string; groups: { id: string; name: string }[] }) {
  const { t } = useI18n()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'existing' | 'new'>(groups.length ? 'existing' : 'new')
  const [groupId, setGroupId] = useState(groups[0]?.id ?? '')
  const [newGroup, setNewGroup] = useState<GroupDetailsValue>(emptyGroupDetails())
  const [dueDays, setDueDays] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) {
    return (
      <Button variant="secondary" size="lg" onClick={() => setOpen(true)} icon={<CopyPlus size={20} strokeWidth={ICON.strokeWidth} aria-hidden />}>
        {t('copy.open')}
      </Button>
    )
  }

  const give = async () => {
    setBusy(true)
    setError(null)
    const { ok, json } = await postJson(`/api/assignments/${assignmentId}/copy`, {
      groupId: mode === 'existing' ? groupId : null,
      newGroup: mode === 'new' ? groupDetailsPayload(newGroup) : null,
      dueDays,
    })
    setBusy(false)
    if (!ok) {
      play('error')
      return setError(t(ERROR_KEYS[String(json.error ?? '')] ?? 'error.generic'))
    }
    play('publish.success')
    router.push(`/app/a/${String(json.id)}`)
  }

  return (
    <div className="slide-down flex flex-col gap-3 rounded-xl border border-paper-300 bg-paper-50 p-4">
      <div className="flex flex-col gap-1">
        <span className="t-h3">{t('copy.title')}</span>
        <p className="t-small text-ink-500">{t('copy.hint')}</p>
      </div>
      {groups.length > 0 && (
        <SegmentedControl
          label={t('publish.chooseGroup')}
          value={mode}
          onChange={setMode}
          options={[
            { value: 'existing', label: t('publish.existingGroup') },
            { value: 'new', label: `+ ${t('publish.createGroup')}` },
          ]}
        />
      )}
      {mode === 'existing' ? (
        <select value={groupId} onChange={(e) => setGroupId(e.target.value)} aria-label={t('publish.chooseGroup')} className={fieldClass}>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      ) : (
        <GroupDetailsFields value={newGroup} onChange={setNewGroup} autoFocus={groups.length > 0} />
      )}
      <DurationPicker value={dueDays} onChange={setDueDays} label={t('publish.due')} />
      {error && <p className="t-small text-error-600">{error}</p>}
      <div className="flex gap-2">
        <Button onClick={give} loading={busy} disabled={mode === 'new' ? !newGroup.name.trim() : !groupId} size="lg" className="flex-1">
          {t('copy.give')}
        </Button>
        <Button variant="ghost" size="lg" onClick={() => setOpen(false)}>
          {t('common.cancel')}
        </Button>
      </div>
    </div>
  )
}
