'use client'
import { CheckCircle2, Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button, ICON } from '@ikhimi/ui/components'
import { play } from '@ikhimi/ui/sound'
import type { MessageKey } from '@ikhimi/i18n'
import { useI18n } from '@/i18n/client'
import { postJson } from '@/lib/client'
import { CARD } from './bands'

const ERRORS: Record<string, MessageKey> = {
  invalid_code: 'joinGroup.invalid',
  code_not_found: 'joinGroup.notFound',
  own_group: 'joinGroup.ownGroup',
  removed: 'joinGroup.removed',
}

/**
 * My work's "join a group": the student types the code their teacher gave them and the group's homework appears.
 * `open` shows the field straight away (a student with no homework yet); otherwise it starts as one button.
 */
export function JoinGroup({ open: startOpen = false }: { open?: boolean }) {
  const { t } = useI18n()
  const router = useRouter()
  const [open, setOpen] = useState(startOpen)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [joined, setJoined] = useState<{ name: string; teacherName: string | null; already: boolean } | null>(null)

  if (!open) {
    return (
      <Button variant="secondary" size="lg" onClick={() => setOpen(true)} icon={<Plus size={20} strokeWidth={ICON.strokeWidth} aria-hidden />}>
        {t('joinGroup.open')}
      </Button>
    )
  }

  const join = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { ok, json } = await postJson('/api/groups/join', { code }).catch(() => ({ ok: false, json: { error: 'network' } as Record<string, unknown> }))
    setBusy(false)
    if (!ok) {
      play('error')
      return setError(t(ERRORS[String(json.error ?? '')] ?? 'error.generic'))
    }
    const g = json.group as { name: string; teacherName: string | null }
    play('publish.success')
    setJoined({ ...g, already: !!json.already })
    setCode('')
    router.refresh()
  }

  return (
    <form onSubmit={join} className={`flex flex-col gap-3 p-4 ${CARD}`}>
      <div className="flex flex-col gap-1">
        <span className="t-h3">{t('joinGroup.title')}</span>
        <span className="t-small text-ink-500">{t('joinGroup.hint')}</span>
      </div>
      {joined && (
        <p className="t-body flex items-start gap-2 rounded-lg bg-success-100 px-3 py-2 text-success-600" role="status">
          <CheckCircle2 size={20} strokeWidth={ICON.strokeWidth} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            {t(joined.already ? 'joinGroup.already' : 'joinGroup.done', { group: joined.name })}
            {joined.teacherName && <span className="text-ink-500"> · {joined.teacherName}</span>}
          </span>
        </p>
      )}
      <div className="flex gap-2">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 6))}
          placeholder="ABC234"
          aria-label={t('joinGroup.codeLabel')}
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          className="t-h3 t-num min-h-12 w-full min-w-0 flex-1 rounded-lg border border-paper-300 bg-paper-50 px-3 text-center uppercase tracking-[0.3em] text-ink-800 focus:border-ink-700 focus:outline-none"
        />
        <Button type="submit" size="lg" loading={busy} disabled={code.length !== 6}>
          {t('joinGroup.submit')}
        </Button>
      </div>
      {error && <p className="t-small text-error-600">{error}</p>}
    </form>
  )
}
