'use client'
import { useState } from 'react'
import { Button } from '@ikhimi/ui/components'
import { useI18n } from '@/i18n/client'

/** Owner only: set the bot up with Telegram (buttons, Menu, the texts before Start) in one click */
export function TelegramSetup() {
  const { t } = useI18n()
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle')
  const run = async () => {
    setState('busy')
    const res = await fetch('/api/admin/telegram', { method: 'POST' }).catch(() => null)
    setState(res?.ok ? 'done' : 'error')
  }
  return (
    <div className="flex flex-col items-start gap-2">
      <Button variant="secondary" size="sm" onClick={run} loading={state === 'busy'}>
        {t('admin.tg.setup')}
      </Button>
      <p className="t-small text-ink-500">{t('admin.tg.setupHint')}</p>
      {state === 'done' && <p className="t-small text-success-600">{t('admin.tg.setupDone')}</p>}
      {state === 'error' && <p className="t-small text-error-600">{t('error.generic')}</p>}
    </div>
  )
}
