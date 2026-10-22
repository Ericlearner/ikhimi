'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button, Switch, useToast } from '@ikhimi/ui/components'
import { GroupDetailsFields, groupDetailsPayload, type GroupDetailsValue } from '@/components/GroupDetailsFields'
import { useI18n } from '@/i18n/client'
import { postJson } from '@/lib/client'

/** [DECIDE #4] Whether students see their own place in the class. Saves on toggle. */
export function LeaderboardToggle({ groupId, initial }: { groupId: string; initial: boolean }) {
  const { t } = useI18n()
  const toast = useToast()
  const [on, setOn] = useState(initial)
  return (
    <Switch
      checked={on}
      label={t('group.showRank')}
      description={t('group.showRankHint')}
      onChange={async (v) => {
        setOn(v)
        const { ok } = await postJson(`/api/groups/${groupId}`, { studentsSeeLeaderboard: v }, 'PATCH')
        if (!ok) {
          setOn(!v)
          toast(t('error.generic'))
        }
      }}
    />
  )
}

/** Edit a group's details in place on the group page. */
export function GroupEditForm({ groupId, initial }: { groupId: string; initial: GroupDetailsValue }) {
  const { t } = useI18n()
  const router = useRouter()
  const toast = useToast()
  const [value, setValue] = useState(initial)
  const [busy, setBusy] = useState(false)
  const dirty = JSON.stringify(value) !== JSON.stringify(initial)

  const save = async () => {
    setBusy(true)
    const { ok } = await postJson(`/api/groups/${groupId}`, groupDetailsPayload(value), 'PATCH')
    setBusy(false)
    if (!ok) return toast(t('error.generic'))
    toast(t('group.saved'))
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-3">
      <GroupDetailsFields value={value} onChange={setValue} />
      <Button onClick={save} loading={busy} disabled={!dirty || !value.name.trim()} className="self-start">
        {t('action.save')}
      </Button>
    </div>
  )
}
