'use client'
import { Link2, Link2Off } from 'lucide-react'
import { useState } from 'react'
import { Button, ICON } from '@ikhimi/ui/components'
import { useI18n } from '@/i18n/client'
import { postJson } from '@/lib/client'
import { ShareButtons } from './ShareLink'

/** The teacher's parent link for one student: make it, copy or send it, turn it off */
export function ParentLink({ studentId, initialUrl }: { studentId: string; initialUrl: string | null }) {
  const { t } = useI18n()
  const [url, setUrl] = useState(initialUrl)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const api = `/api/students/${studentId}/parent-link`

  const create = async () => {
    setBusy(true)
    setError(false)
    const { ok, json } = await postJson(api, {})
    setBusy(false)
    if (!ok) return setError(true)
    setUrl(String(json.url))
  }
  const revoke = async () => {
    setBusy(true)
    const { ok } = await postJson(api, {}, 'DELETE')
    setBusy(false)
    if (ok) setUrl(null)
    else setError(true)
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl border-2 border-paper-300 bg-paper-50 p-4">
      <div className="flex flex-col gap-1">
        <h2 className="t-h3 flex items-center gap-2">
          <Link2 size={20} strokeWidth={ICON.strokeWidth} aria-hidden /> {t('parent.title')}
        </h2>
        <p className="t-small text-ink-500">{t('parent.hint')}</p>
      </div>
      {url ? (
        <>
          <code className="t-small break-all rounded-md bg-paper-200 px-3 py-2 font-semibold text-ink-800">{url}</code>
          <div className="flex flex-wrap gap-2">
            <ShareButtons url={url} />
            <Button variant="ghost" onClick={revoke} loading={busy} icon={<Link2Off size={18} strokeWidth={ICON.strokeWidth} aria-hidden />}>
              {t('parent.revoke')}
            </Button>
          </div>
        </>
      ) : (
        <Button variant="secondary" onClick={create} loading={busy} className="self-start">
          {t('parent.create')}
        </Button>
      )}
      {error && <p className="t-small text-error-600">{t('error.generic')}</p>}
    </section>
  )
}
