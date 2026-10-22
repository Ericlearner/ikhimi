'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Badge, Button, Input } from '@ikhimi/ui/components'
import { useI18n } from '@/i18n/client'
import { postJson } from '@/lib/client'

type Sub = { id: string; plan: string; status: string; priceKrw: number; createdAt: string }

/** What staff can do for one user. Each button is one logged action (/api/admin/users/[id]). */
export function UserActions(props: {
  userId: string
  blocked: boolean
  isTeacher: boolean
  isStudent: boolean
  dailyCap: number | null
  defaultCap: number
  canManage: boolean
  canRevealEmail: boolean
  /** Plans and packages may be given here (also on an owner's own account) */
  canPlan: boolean
  /** The user's student plan now, and its end (formatted) */
  plan: 'free' | 'pro' | 'vip'
  planUntil: string | null
  subscriptions: Sub[]
}) {
  const { t } = useI18n()
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [email, setEmail] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [cap, setCap] = useState(props.dailyCap == null ? '' : String(props.dailyCap))
  const [course, setCourse] = useState('')
  const [pkgPlan, setPkgPlan] = useState<'pro' | 'vip'>('pro')
  const [pkgSeats, setPkgSeats] = useState('10')
  const [pkgDays, setPkgDays] = useState('30')
  const [roles, setRoles] = useState({ teacher: props.isTeacher, student: props.isStudent })
  const rolesChanged = roles.teacher !== props.isTeacher || roles.student !== props.isStudent

  /** key: which button shows the spinner, when one action has several buttons */
  const act = async (action: string, extra: Record<string, unknown> = {}, confirmText?: string, key = action) => {
    if (confirmText && !window.confirm(confirmText)) return
    setBusy(key)
    setError(null)
    setDone(null)
    const { ok, json } = await postJson(`/api/admin/users/${props.userId}`, { action, ...extra })
    setBusy(null)
    if (!ok) return setError(json.error === 'reauth' ? t('admin.verify.title') : json.error === 'course_not_found' ? t('admin.users.courseNotFound') : t('error.generic'))
    if (action === 'reveal_email') return setEmail(String(json.email))
    setDone(action)
    router.refresh()
  }

  if (!props.canManage && !props.canRevealEmail && !props.canPlan) return null
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-paper-300 bg-paper-50 p-4">
      <h3 className="t-h3">{t('admin.users.actions')}</h3>
      {props.canRevealEmail && (
        <div className="flex flex-wrap items-center gap-2">
          {email ? (
            <span className="t-body font-medium">{email}</span>
          ) : (
            <Button size="sm" variant="secondary" loading={busy === 'reveal_email'} onClick={() => act('reveal_email')}>
              {t('admin.users.showEmail')}
            </Button>
          )}
          <span className="t-small text-ink-400">{t('admin.users.showEmailNote')}</span>
        </div>
      )}

      {props.canManage && (
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-3">
            <span className="t-body font-semibold">{t('admin.users.roles')}:</span>
            {(['teacher', 'student'] as const).map((r) => (
              <label key={r} className="t-body flex items-center gap-1.5">
                <input type="checkbox" checked={roles[r]} onChange={(e) => setRoles({ ...roles, [r]: e.target.checked })} className="size-4 accent-orange-500" />
                {t(`role.${r}`)}
              </label>
            ))}
            <Button
              size="sm"
              variant="secondary"
              disabled={!rolesChanged || (!roles.teacher && !roles.student)}
              loading={busy === 'set_roles'}
              onClick={() => act('set_roles', { roles: (['teacher', 'student'] as const).filter((r) => roles[r]) }, t('admin.users.rolesConfirm'))}
            >
              {t('action.save')}
            </Button>
          </div>
          <span className="t-small text-ink-400">{t('admin.users.rolesHint')}</span>
        </div>
      )}

      {props.canPlan && (
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="t-body font-semibold">{t('admin.users.plan')}:</span>
            <span className="t-body t-num text-ink-700">
              {t(`plans.name.${props.plan}`)}
              {props.planUntil ? ` · ${t('plans.until', { date: props.planUntil })}` : ''}
            </span>
            <Button size="sm" variant="secondary" loading={busy === 'set_plan:pro'} onClick={() => act('set_plan', { plan: 'pro', days: 30 }, undefined, 'set_plan:pro')}>
              {t('admin.users.planAdd', { plan: t('plans.name.pro') })}
            </Button>
            <Button size="sm" variant="secondary" loading={busy === 'set_plan:vip'} onClick={() => act('set_plan', { plan: 'vip', days: 30 }, undefined, 'set_plan:vip')}>
              {t('admin.users.planAdd', { plan: t('plans.name.vip') })}
            </Button>
            <Button size="sm" variant="secondary" loading={busy === 'set_plan:off'} onClick={() => act('set_plan', { plan: null }, t('admin.users.planOffConfirm'), 'set_plan:off')}>
              {t('admin.users.planOff')}
            </Button>
          </div>
          <span className="t-small text-ink-400">{t('admin.users.planNote')}</span>
        </div>
      )}

      {props.canPlan && props.isTeacher && (
        <div className="flex flex-wrap items-end gap-2">
          <span className="t-body font-semibold">{t('admin.users.package')}:</span>
          <select value={pkgPlan} onChange={(e) => setPkgPlan(e.target.value as 'pro' | 'vip')} className="t-body min-h-9 rounded-md border border-paper-300 bg-paper-50 px-2">
            <option value="pro">{t('plans.name.pro')}</option>
            <option value="vip">{t('plans.name.vip')}</option>
          </select>
          <label className="flex flex-col gap-1">
            <span className="t-small text-ink-500">{t('plans.seats')}</span>
            <Input type="number" min={1} max={500} value={pkgSeats} onChange={(e) => setPkgSeats(e.target.value)} className="w-20" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="t-small text-ink-500">{t('admin.users.days')}</span>
            <Input type="number" min={1} max={366} value={pkgDays} onChange={(e) => setPkgDays(e.target.value)} className="w-20" />
          </label>
          <Button
            size="sm"
            variant="secondary"
            loading={busy === 'grant_package'}
            onClick={() => act('grant_package', { plan: pkgPlan, seats: Math.max(1, Math.min(500, Number(pkgSeats) || 1)), days: Math.max(1, Math.min(366, Number(pkgDays) || 30)) })}
          >
            {t('admin.users.give')}
          </Button>
        </div>
      )}

      {props.canManage && props.isTeacher && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="t-small text-ink-500">{t('admin.users.dailyLimit', { n: props.defaultCap })}</span>
            <Input type="number" min={0} max={500} value={cap} onChange={(e) => setCap(e.target.value)} placeholder={String(props.defaultCap)} className="w-28" />
          </label>
          <Button size="sm" variant="secondary" loading={busy === 'set_cap'} onClick={() => act('set_cap', { cap: cap.trim() === '' ? null : Math.max(0, Math.min(500, Number(cap) || 0)) })}>
            {t('action.save')}
          </Button>
          <Button size="sm" variant="secondary" loading={busy === 'reset_cap'} onClick={() => act('reset_cap')}>
            {t('admin.users.resetToday')}
          </Button>
        </div>
      )}

      {props.canManage && props.isStudent && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="t-small text-ink-500">{t('admin.users.grantCourse')}</span>
              <Input value={course} onChange={(e) => setCourse(e.target.value)} placeholder={t('admin.users.courseSlug')} className="w-64" />
            </label>
            <Button size="sm" variant="secondary" disabled={!course.trim()} loading={busy === 'grant_course'} onClick={() => act('grant_course', { courseSlug: course.trim().replace(/^.*\/kurs\//, '') })}>
              {t('admin.users.grant')}
            </Button>
          </div>
          {props.subscriptions.length > 0 && (
            <ul className="t-small flex flex-col gap-1">
              {props.subscriptions.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-2">
                  <Badge tone={s.status === 'active' ? 'success' : 'neutral'}>{s.status}</Badge>
                  <span className="t-num text-ink-500">
                    {s.plan} · {s.priceKrw}원 · {s.createdAt.slice(0, 10)}
                  </span>
                  {s.plan === 'staff_grant' && s.status === 'active' && (
                    <button type="button" className="font-medium text-error-600 hover:underline" onClick={() => act('revoke_subscription', { subscriptionId: s.id }, t('admin.users.revokeConfirm'))}>
                      {t('admin.users.revoke')}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {props.canManage &&
        (props.blocked ? (
          <div>
            <Button size="sm" variant="secondary" loading={busy === 'unblock'} onClick={() => act('unblock')}>
              {t('admin.users.unblock')}
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="t-small text-ink-500">{t('admin.users.blockReason')}</span>
              <Input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} className="w-72" />
            </label>
            <Button size="sm" variant="danger" loading={busy === 'block'} onClick={() => act('block', { reason }, t('admin.users.blockConfirm'))}>
              {t('admin.users.block')}
            </Button>
          </div>
        ))}

      {error && <p className="t-small font-medium text-error-600">{error}</p>}
      {done && <p className="t-small font-medium text-success-600">{t('admin.saved')}</p>}
    </div>
  )
}
