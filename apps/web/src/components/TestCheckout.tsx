'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@ikhimi/ui/components'
import { useI18n } from '@/i18n/client'
import { postJson } from '@/lib/client'

/** back: where the buyer returns (the course, the plans page, the packages page); ?paid=1 after paying */
export function TestCheckout({ paymentId, back, status }: { paymentId: string; back: string; status: string }) {
  const { t } = useI18n()
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const act = async (action: 'pay' | 'cancel') => {
    setBusy(action)
    await postJson(`/api/payments/test/${paymentId}`, { action })
    router.push(`${back}${action === 'pay' ? '?paid=1' : ''}`)
  }
  const open = status === 'created' || status === 'pending'
  return (
    <div className="flex gap-2">
      <Button size="lg" className="flex-1" onClick={() => act('pay')} loading={busy === 'pay'} disabled={!open || !!busy}>
        {t('pay.test.pay')}
      </Button>
      <Button size="lg" variant="ghost" onClick={() => act('cancel')} loading={busy === 'cancel'} disabled={!open || !!busy}>
        {t('pay.test.cancel')}
      </Button>
    </div>
  )
}
