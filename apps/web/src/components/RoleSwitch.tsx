'use client'
import { GraduationCap, Presentation } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@ikhimi/ui/components'
import { useI18n } from '@/i18n/client'
import { postJson } from '@/lib/client'

type Side = 'student' | 'teacher'

/**
 * Profile → settings: which side of the account is open, student or teacher (the same line icons as the avatar's
 * badge). Tapping the other side asks once; an account without that side yet is asked to add it (a teacher who is
 * also learning, a student who also teaches), then the whole interface changes. The avatar menu has the same switch.
 */
export function RoleSwitch({ role, roles }: { role: Side; roles: string[] }) {
  const { t } = useI18n()
  const router = useRouter()
  const [asking, setAsking] = useState<Side | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const has = (s: Side) => roles.includes(s)

  const go = async (to: Side) => {
    setBusy(true)
    setError(false)
    const { ok } = await postJson('/api/profile/role', { role: to, add: !has(to) })
    if (!ok) {
      setBusy(false)
      return setError(true)
    }
    router.push(to === 'student' ? '/work' : '/app')
    router.refresh()
  }

  const sides: { side: Side; Icon: typeof GraduationCap }[] = [
    { side: 'student', Icon: GraduationCap },
    { side: 'teacher', Icon: Presentation },
  ]
  // Asking: switching to a side the account has, or adding one it doesn't
  const text = asking ? (has(asking) ? t(asking === 'student' ? 'role.confirmStudent' : 'role.confirmTeacher') : t(asking === 'student' ? 'becomeStudent.hint' : 'becomeTeacher.hint')) : null
  const yes = asking ? (has(asking) ? t('role.confirmYes') : t(asking === 'student' ? 'becomeStudent.yes' : 'becomeTeacher.yes')) : ''

  return (
    <div className="flex flex-col gap-3 border-b border-paper-300 py-3">
      <div className="flex flex-col">
        <span className="t-h3">{t('settings.accountType')}</span>
        <span className="t-small text-ink-400">{t('settings.accountTypeHint')}</span>
      </div>
      <div role="radiogroup" aria-label={t('settings.accountType')} className="grid grid-cols-2 gap-2">
        {sides.map(({ side, Icon }) => {
          const on = side === role
          return (
            <button
              key={side}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={busy}
              onClick={() => (on ? setAsking(null) : setAsking(side))}
              className={`press flex min-h-14 items-center justify-center gap-2 rounded-2xl border-2 px-3 font-semibold ${
                on ? 'border-orange-500 bg-orange-500 text-on-orange' : 'border-paper-300 bg-paper-50 text-ink-700'
              } ${asking === side ? 'ring-2 ring-orange-500 ring-offset-2 ring-offset-paper-100' : ''}`}
            >
              <Icon size={20} strokeWidth={2.25} aria-hidden />
              <span className="t-body">{t(`role.${side}`)}</span>
            </button>
          )
        })}
      </div>
      {asking && (
        <div className="slide-down flex flex-col gap-3 rounded-2xl border-2 border-orange-500 bg-orange-100 p-4">
          <p className="t-body text-ink-700">{text}</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => go(asking)} loading={busy}>
              {yes}
            </Button>
            <Button variant="ghost" onClick={() => setAsking(null)} disabled={busy}>
              {t('common.cancel')}
            </Button>
          </div>
          {error && <p className="t-small text-error-600">{t('error.generic')}</p>}
        </div>
      )}
    </div>
  )
}
