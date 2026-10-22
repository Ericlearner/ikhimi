'use client'
import { useEffect, useState } from 'react'
import type { MessageKey } from '@ikhimi/i18n'
import { Button, Spinner } from '@ikhimi/ui/components'
import { useI18n } from '@/i18n/client'
import { postJson } from '@/lib/client'

const ERRORS: Record<string, MessageKey> = {
  expired: 'tg.expired',
  both_have_work: 'link.bothHaveWork',
  other_apple: 'link.otherApple',
  other_google: 'link.otherGoogle',
  blocked: 'error.accountBlocked',
}

/**
 * Profile, an account made with Apple or Google: link Telegram, like the Telegram sign-in (share the number with the bot). If the
 * number already has an account, the page moves to it (server/auth/link.ts): one person, one account.
 */
export function LinkTelegram({ onLinked }: { onLinked: () => void }) {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [wait, setWait] = useState<{ token: string; botUrl: string } | null>(null)

  const start = async () => {
    setError(null)
    // Opened in the click itself so it isn't blocked; the address follows
    const win = window.open('', '_blank')
    setBusy(true)
    const { ok, json } = await postJson('/api/profile/telegram/link', {}).finally(() => setBusy(false))
    if (!ok) {
      win?.close()
      return setError(t(json.error === 'rate_limited' ? 'error.tooManyRequests' : 'error.generic', { minutes: 10 }))
    }
    const next = { token: String(json.token), botUrl: String(json.botUrl) }
    if (win) win.location.href = next.botUrl
    setWait(next)
  }

  // Asks until the number was shared in Telegram
  useEffect(() => {
    if (!wait) return
    let stopped = false
    const check = async () => {
      if (stopped) return
      const { json } = await postJson('/api/profile/telegram/link', { token: wait.token }).catch(() => ({ json: {} as Record<string, unknown> }))
      if (stopped || !json.status || json.status === 'pending') return
      stopped = true
      setWait(null)
      if (json.status === 'linked') onLinked()
      else if (json.status === 'switched') window.location.href = String(json.to ?? '/')
      else setError(t(ERRORS[String(json.status)] ?? 'error.generic'))
    }
    const id = setInterval(check, 2000)
    const onVisible = () => document.visibilityState === 'visible' && void check()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [wait]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col items-end gap-2">
      {wait ? (
        <span className="t-small inline-flex items-center gap-2 text-ink-500">
          <Spinner className="size-4" />
          <a href={wait.botUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">
            {t('auth.telegramOpenAgain')}
          </a>
        </span>
      ) : (
        <Button variant="telegram" size="sm" onClick={start} loading={busy}>
          {t('link.telegram')}
        </Button>
      )}
      {error && <span className="t-small text-error-600">{error}</span>}
    </div>
  )
}
