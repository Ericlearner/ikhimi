'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@ikhimi/ui/components'
import { useI18n } from '@/i18n/client'
import { postJson } from '@/lib/client'

/** A teacher opening someone else's homework: doing it adds the student side to their account, so they're asked */
export function JoinAsStudent({ slug }: { slug: string }) {
  const { t } = useI18n()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const yes = async () => {
    setBusy(true)
    setError(false)
    const { ok } = await postJson('/api/profile/role', { role: 'student', add: true })
    if (!ok) {
      setBusy(false)
      return setError(true)
    }
    router.push(`/t/${slug}/do`)
  }
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-paper-300 bg-paper-50 p-4">
      <p className="t-h3">{t('join.question')}</p>
      <p className="t-small text-ink-500">{t('join.hint')}</p>
      <Button size="xl" onClick={yes} loading={busy}>
        {t('join.yes')}
      </Button>
      {error && <p className="t-small text-error-600">{t('error.generic')}</p>}
    </div>
  )
}
