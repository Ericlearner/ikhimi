import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { CONFIG, getDb } from '@ikhimi/db'
import { formatDate, formatKrw, type MessageKey } from '@ikhimi/i18n'
import { Avatar, Badge, ICON, StatTile } from '@ikhimi/ui/components'
import { UserActions } from '@/components/admin/UserActions'
import { panel, Section, seconds, usd } from '@/components/admin/Bars'
import { getT } from '@/i18n/server'
import { usdToKrw } from '@/server/ai-usage'
import { pageStaff } from '@/server/admin/guard'
import { maskForStaff } from '@/server/admin/permissions'
import { can, isOwner } from '@/server/admin/staff'
import { userDetail } from '@/server/admin/stats'
import { studentPlanInfo } from '@/server/plans'

/** One person: who they are, what they do, what they cost, and what staff can do for them */
export default async function AdminUser({ params }: { params: Promise<{ id: string }> }) {
  const db = getDb()
  const { access, session } = await pageStaff(db, 'users.view')
  const { t } = await getT()
  const d = await userDetail(db, (await params).id)
  if (!d) notFound()
  const { user: u, profile, counts } = d
  const plan = await studentPlanInfo(db, u.id)
  const roles = u.roles.length ? u.roles : [u.role]
  const isTeacher = roles.includes('teacher')
  const isStudent = roles.includes('student')

  return (
    <div className="flex flex-col gap-6">
      <Link href="/admin/users" className="t-small inline-flex items-center gap-1 self-start font-medium text-ink-500 hover:text-ink-800">
        <ArrowLeft size={16} strokeWidth={ICON.strokeWidth} aria-hidden /> {t('admin.nav.users')}
      </Link>
      <header className="flex items-center gap-4">
        <Avatar id={u.id} name={u.fullName} size={56} />
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="t-h1 truncate">{u.fullName ?? '—'}</h2>
          <span className="t-small t-num text-ink-500">
            {maskForStaff(u.email, u.phone)} · {t('admin.users.joined', { date: formatDate(u.createdAt) })}
            {u.lastActiveAt ? ` · ${t('admin.users.lastActive', { date: formatDate(u.lastActiveAt) })}` : ''}
          </span>
          <span className="flex flex-wrap gap-1">
            {roles.map((r) => (
              <Badge key={r}>{t(`role.${r}` as MessageKey)}</Badge>
            ))}
            {u.blockedAt && <Badge tone="error">{t('admin.users.blockedSince', { date: formatDate(u.blockedAt) })}</Badge>}
            {plan.plan !== 'free' && <Badge tone="success">{`${t(`plans.name.${plan.plan}` as MessageKey)}${plan.until ? ` · ${t('plans.until', { date: formatDate(plan.until) })}` : ''}`}</Badge>}
          </span>
          {u.blockedReason && <span className="t-small text-error-600">{u.blockedReason}</span>}
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {isTeacher && <StatTile value={counts.homework} label={t('admin.users.homework')} />}
        {isTeacher && <StatTile value={counts.groups} label={t('admin.biz.groups')} hint={t('admin.users.students', { n: counts.students })} />}
        {isTeacher && (
          <StatTile
            value={`${d.generationsToday}/${profile?.dailyCap ?? CONFIG.generationDailyCapPerTeacher}`}
            label={t('admin.users.todayLimit')}
            hint={profile?.dailyCap != null ? t('admin.users.customLimit') : undefined}
          />
        )}
        {isStudent && <StatTile value={counts.attempts} label={t('admin.users.submitted')} hint={counts.avgPercent == null ? undefined : t('admin.users.avg', { n: counts.avgPercent })} />}
        <StatTile value={usd(d.aiUsd30)} label={t('admin.users.aiCost30')} hint={`≈ ${formatKrw(Math.round(d.aiUsd30 * usdToKrw()))}원 · ${t('admin.health.calls')}: ${d.aiCalls30}`} />
      </div>

      <UserActions
        userId={u.id}
        blocked={!!u.blockedAt}
        isTeacher={isTeacher}
        isStudent={isStudent}
        dailyCap={profile?.dailyCap ?? null}
        defaultCap={CONFIG.generationDailyCapPerTeacher}
        canManage={can(access, 'users.manage') && u.id !== session.user.id && !isOwner(u)}
        canRevealEmail={can(access, 'users.email') && !!u.email}
        canPlan={can(access, 'users.manage') && (u.id !== session.user.id || isOwner(session.user))}
        plan={plan.plan}
        planUntil={plan.until ? formatDate(plan.until) : null}
        subscriptions={d.subscriptions.map((s) => ({ id: s.id, plan: s.plan, status: s.status, priceKrw: s.priceKrw, createdAt: s.createdAt.toISOString() }))}
      />

      {d.runs.length > 0 && (
        <Section title={t('admin.users.recentRuns')}>
          <ul className={`${panel} t-small flex flex-col gap-1`}>
            {d.runs.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2">
                <Badge tone={r.status === 'ok' ? 'success' : r.status === 'failed' ? 'error' : 'neutral'}>{r.status === 'failed' ? (r.errorCode ?? 'failed') : r.status}</Badge>
                <span className="t-num text-ink-500">
                  {formatDate(r.createdAt)} · {r.mode} · {seconds(r.durationMs)} · {r.items ?? 0} {t('admin.users.items')} · 🖼 {r.picturesAttached}
                </span>
                {r.assignmentId && can(access, 'content') && (
                  <Link href={`/admin/content/${r.assignmentId}`} className="font-medium text-orange-600 hover:underline">
                    {t('admin.open')}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  )
}
