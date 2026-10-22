'use client'
import { BellRing } from 'lucide-react'
import { useState } from 'react'
import { Button, ICON } from '@ikhimi/ui/components'
import { play } from '@ikhimi/ui/sound'
import { useI18n } from '@/i18n/client'
import { postJson } from '@/lib/client'

type Result = { sent: number; already: number; unreachable: number; pending: number }

/** The report's "remind them": an iOS app notification to every student of the group who hasn't handed it in */
export function RemindButton({ assignmentId, pending }: { assignmentId: string; pending: number }) {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState(false)

  const remind = async () => {
    setBusy(true)
    setError(false)
    const { ok, json } = await postJson(`/api/assignments/${assignmentId}/remind`, {})
    setBusy(false)
    if (!ok) {
      play('error')
      return setError(true)
    }
    play('copy')
    setResult(json as unknown as Result)
  }

  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border-2 border-paper-300 bg-paper-50 px-4 py-3">
      <div className="flex min-w-0 flex-col">
        <span className="t-body font-medium text-ink-800">{t('remind.pending', { n: pending })}</span>
        <span className="t-small text-ink-500" aria-live="polite">
          {error
            ? t('error.generic')
            : result
              ? [
                  t('remind.sent', { n: result.sent }),
                  result.already ? t('remind.already', { n: result.already }) : '',
                  result.unreachable ? t('remind.unreachable', { n: result.unreachable }) : '',
                ]
                  .filter(Boolean)
                  .join(' · ')
              : t('remind.hint')}
        </span>
      </div>
      <Button variant="secondary" onClick={remind} loading={busy} disabled={!!result} icon={<BellRing size={18} strokeWidth={ICON.strokeWidth} aria-hidden />}>
        {t('remind.button')}
      </Button>
    </section>
  )
}
