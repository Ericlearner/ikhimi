'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Switch } from '@ikhimi/ui/components'
import { useI18n } from '@/i18n/client'

/** Owner only: whether bot messages to students carry a button that opens the homework */
export function TelegramLinks({ initial }: { initial: boolean }) {
  const { t } = useI18n()
  const router = useRouter()
  const [on, setOn] = useState(initial)
  const [error, setError] = useState(false)
  const change = async (v: boolean) => {
    setOn(v)
    setError(false)
    const res = await fetch('/api/admin/telegram', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ links: v }) })
    if (!res.ok) {
      setOn(!v)
      setError(true)
    }
    router.refresh()
  }
  return (
    <div>
      <Switch checked={on} onChange={change} label={t('admin.tg.links')} description={t('admin.tg.linksHint')} />
      {error && <p className="t-small text-error-600">{t('error.generic')}</p>}
    </div>
  )
}
