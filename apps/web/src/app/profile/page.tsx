import Link from 'next/link'
import { redirect } from 'next/navigation'
import { eq, getDb, teacherProfiles } from '@ikhimi/db'
import { formatDate, maskPhone } from '@ikhimi/i18n'
import { Avatar, TaskIcon, TemperatureProvider, type TaskIconName } from '@ikhimi/ui/components'
import type { MessageKey } from '@ikhimi/i18n'
import { AppHeader } from '@/components/AppHeader'
import { StudentAnalytics } from '@/components/work/StudentAnalytics'
import { CARD } from '@/components/work/bands'
import { AppInfoLinks } from '@/components/SiteFooter'
import { AccountSettings, ProfileHeaderForm, Section, TeachingDefaultsForm } from '@/components/ProfileForms'
import { getT } from '@/i18n/server'
import { teacherGroups, teacherImpact } from '@/server/profiles'
import { studentDashboard } from '@/server/student-dashboard'
import { APPLE_PHONE_PREFIX } from '@/server/apple'
import { GOOGLE_PHONE_PREFIX } from '@/server/google'
import { getSession } from '@/server/request'

/** "010-****-5678" (design spec §12) */
function phoneForDisplay(e164: string) {
  // Signed up with Apple or Google: no phone number
  if (e164.startsWith(APPLE_PHONE_PREFIX)) return 'Apple ID'
  if (e164.startsWith(GOOGLE_PHONE_PREFIX)) return 'Google'
  const m = /^\+82(1\d)\d{3,4}(\d{4})$/.exec(e164)
  return m ? `0${m[1]}-****-${m[2]}` : maskPhone(e164)
}

/** One route, two profile shapes (design spec §12): the active role decides which one renders. */
export default async function ProfilePage() {
  const session = await getSession()
  if (!session) redirect('/signin?next=/profile')
  const { user } = session
  const { t } = await getT()
  // Made with Apple or Google: no number yet, so it can link Telegram, and has no password to set
  const noNumber = user.phone.startsWith(APPLE_PHONE_PREFIX) || user.phone.startsWith(GOOGLE_PHONE_PREFIX)
  const account = { phoneMasked: phoneForDisplay(user.phone), telegramLinked: !!user.telegramChatId, noNumber, passwordSetAt: user.passwordSetAt, role: user.role, roles: user.roles }
  const db = getDb()
  const isTeacher = user.role === 'teacher'
  const [tp] = isTeacher ? await db.select().from(teacherProfiles).where(eq(teacherProfiles.userId, user.id)).limit(1) : []

  const header = (
    <section className="flex flex-col gap-5 sm:flex-row sm:items-start">
      <Avatar id={user.id} name={user.fullName} size={72} />
      <div className="flex w-full flex-col gap-1">
        <h1 className="t-display-2">{user.fullName}</h1>
        <p className="t-small text-ink-500">
          {t(`role.${user.role}` as MessageKey)} · {t('profile.memberSince', { date: formatDate(user.createdAt) })}
        </p>
      </div>
    </section>
  )

  if (isTeacher) {
    const impact = await teacherImpact(db, user.id)
    const groups = await teacherGroups(db, user.id)
    return (
      <TemperatureProvider value="calm">
        <AppHeader />
        <main className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-8 pb-20">
          {header}
          {/* The teacher's numbers first, as tiles with a picture each (like the student side's) */}
          <section className="flex flex-col gap-3">
            <h2 className="t-h1">{t('profile.impact')}</h2>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <ImpactTile icon="memo" value={String(impact.assignmentsCreated)} label={t('profile.assignmentsCreated')} />
              <ImpactTile icon="graduation-cap" value={String(impact.studentsTaught)} label={t('profile.studentsTaught')} />
              <ImpactTile icon="bullseye" value={impact.averageClassScore === null ? '—' : `${impact.averageClassScore}%`} label={t('profile.avgClassScore')} />
              <ImpactTile icon="stopwatch" value={t('profile.hours', { n: impact.hoursSaved })} label={t('profile.hoursSaved')} hint={t('profile.hoursSavedHint')} />
            </div>
          </section>
          <Section title={t('nav.profile')}>
            <ProfileHeaderForm name={user.fullName ?? ''} school={tp?.schoolName ?? null} subjects={tp?.subjects ?? []} isTeacher />
          </Section>
          <Section title={t('nav.groups')} aside={<Link href="/app/groups" className="t-small font-medium text-ink-500 underline-offset-4 hover:underline">→</Link>}>
            {groups.length === 0 ? (
              <p className="t-body text-ink-500">{t('groups.empty')}</p>
            ) : (
              <ul className="flex flex-col">
                {groups.map((g) => (
                  <li key={g.id} className="t-body flex justify-between border-b border-paper-300 py-2 last:border-b-0">
                    <span className="font-medium">{g.name}</span>
                    <span className="t-num text-ink-500">{t('group.members', { n: g.students })}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section title={t('profile.defaults')}>
            <TeachingDefaultsForm defaults={tp?.teachingDefaults ?? {}} cefr={tp?.defaultCefrLevel ?? null} />
          </Section>
          <Section title={t('settings.account')}>
            <AccountSettings prefs={user.prefs} isTeacher {...account} />
          </Section>
          <AppInfoLinks />
        </main>
      </TemperatureProvider>
    )
  }

  const dash = await studentDashboard(db, user)
  const { progress } = dash
  return (
    <TemperatureProvider value="warm">
      <AppHeader />
      <main className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-8 pb-20">
        {header}
        {progress && progress.groups.length > 0 && (
          <p className="t-body -mt-4 text-ink-500">
            {progress.groups.map((g) => `${g.name}${g.teacherName ? ` · ${g.teacherName}` : ''}`).join(' — ')}
          </p>
        )}
        {/* The full analytics (My work's "Natijalarim" card opens here) */}
        <section id="analitika" className="flex scroll-mt-20 flex-col gap-3">
          <h2 className="t-h1">{t('profile.analytics')}</h2>
          <StudentAnalytics d={dash} t={t} />
        </section>
        <Section title={t('nav.profile')}>
          <ProfileHeaderForm name={user.fullName ?? ''} school={null} subjects={[]} isTeacher={false} />
        </Section>
        <Section title={t('profile.subscriptions')}>
          <p className="t-body text-ink-500">{t('profile.noSubscriptions')}</p>
        </Section>
        <Section title={t('settings.account')}>
          <AccountSettings prefs={user.prefs} isTeacher={false} {...account} />
        </Section>
        <AppInfoLinks />
      </main>
    </TemperatureProvider>
  )
}

/** A teacher's number with its picture, in the outlined card look */
function ImpactTile({ icon, value, label, hint }: { icon: TaskIconName; value: string; label: string; hint?: string }) {
  return (
    <div className={`flex flex-col items-center gap-1 p-3 text-center ${CARD}`} title={hint}>
      <TaskIcon name={icon} size={28} />
      <span className="t-h3 t-num whitespace-nowrap leading-tight">{value}</span>
      <span className="t-small text-ink-500">{label}</span>
    </div>
  )
}
