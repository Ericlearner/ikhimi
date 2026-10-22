'use client'
import { CalendarClock } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button, ICON } from '@ikhimi/ui/components'
import { play } from '@ikhimi/ui/sound'
import { useI18n } from '@/i18n/client'
import { postJson } from '@/lib/client'
import { durationText, DurationPicker } from './DurationPicker'

/** "10월 25일 23:59" in Seoul time (the same on the server and in the browser) */
const whenText = (iso: string) => {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(iso))
  const get = (k: string) => p.find((x) => x.type === k)?.value ?? ''
  return `${Number(get('month'))}월 ${Number(get('day'))}일 ${get('hour')}:${get('minute')}`
}

/**
 * A published homework's duration, which the teacher can change or remove at any time (DECISIONS.md BK). `groupDue`
 * is when it ends for the students who were in the group when it was published; a student who joins later gets the
 * same number of days from their joining.
 */
export function DueEditor({ assignmentId, dueDays, groupDue }: { assignmentId: string; dueDays: number | null; groupDue: string | null }) {
  const { t } = useI18n()
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState<number | null>(dueDays)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)

  const save = async () => {
    setBusy(true)
    setError(false)
    const { ok } = await postJson(`/api/assignments/${assignmentId}/due`, { dueDays: value }, 'PATCH').catch(() => ({ ok: false }))
    setBusy(false)
    if (!ok) {
      play('error')
      return setError(true)
    }
    setEditing(false)
    router.refresh()
  }

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="t-body flex items-center gap-2 text-ink-700">
          <CalendarClock size={18} strokeWidth={ICON.strokeWidth} className="shrink-0 text-ink-500" aria-hidden />
          <span>
            {dueDays ? t('due.label', { duration: durationText(t, dueDays) }) : t('due.noneLabel')}
            {dueDays && groupDue && <span className="t-small text-ink-500"> · {t('due.groupUntil', { when: whenText(groupDue) })}</span>}
          </span>
        </span>
        <button
          type="button"
          onClick={() => {
            setValue(dueDays)
            setEditing(true)
          }}
          className="t-small min-h-11 font-semibold text-orange-700 underline-offset-2 hover:underline"
        >
          {dueDays ? t('due.change') : t('due.set')}
        </button>
      </div>
    )
  }

  return (
    <div className="slide-down flex flex-col gap-3 rounded-xl border border-paper-300 bg-paper-100 p-4">
      <DurationPicker value={value} onChange={setValue} />
      {error && <p className="t-small text-error-600">{t('error.generic')}</p>}
      <div className="flex flex-wrap gap-2">
        <Button onClick={save} loading={busy}>
          {t('action.save')}
        </Button>
        <Button variant="ghost" onClick={() => setEditing(false)} disabled={busy}>
          {t('common.cancel')}
        </Button>
      </div>
    </div>
  )
}
