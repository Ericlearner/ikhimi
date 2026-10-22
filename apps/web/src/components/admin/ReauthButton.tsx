'use client'
import { useState } from 'react'
import { Button } from '@ikhimi/ui/components'
import { useI18n } from '@/i18n/client'
import { postJson } from '@/lib/client'

/** Sign out and come back through the code, which makes the session fresh for the admin panel */
export function ReauthButton() {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  return (
    <Button
      loading={busy}
      onClick={async () => {
        setBusy(true)
        await postJson('/api/auth/signout', {})
        window.location.href = '/signin?next=/admin'
      }}
    >
      {t('admin.verify.button')}
    </Button>
  )
}
