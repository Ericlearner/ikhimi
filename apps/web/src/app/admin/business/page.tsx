import { getDb } from '@ikhimi/db'
import type { MessageKey } from '@ikhimi/i18n'
import { StatTile } from '@ikhimi/ui/components'
import { Bars, panel, Section } from '@/components/admin/Bars'
import { getT } from '@/i18n/server'
import { pageStaff } from '@/server/admin/guard'
import { businessStats } from '@/server/admin/stats'
import { mostAsked } from '@/server/help'

/** Growth and use: people, homework, submissions over the last 30 days, and what teachers ask the help chat */
export default async function AdminBusiness() {
  const db = getDb()
  await pageStaff(db, 'business')
  const { t } = await getT()
  const b = await businessStats(db, 30)
  const help = await mostAsked(db, 30)
  return (
    <div className="flex flex-col gap-8">
      <Section title={t('admin.biz.people')}>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <StatTile value={b.users.teachers} label={t('admin.biz.teachers')} hint={t('admin.biz.newWeek', { n: b.users.newTeachersWeek })} />
          <StatTile value={b.users.activeTeachersWeek} label={t('admin.biz.activeTeachers')} />
          <StatTile value={b.users.students} label={t('admin.biz.students')} hint={t('admin.biz.newWeek', { n: b.users.newStudentsWeek })} />
          <StatTile value={b.users.activeStudentsWeek} label={t('admin.biz.activeStudents')} />
          <StatTile value={b.groups} label={t('admin.biz.groups')} />
          <StatTile value={b.users.blocked} label={t('admin.biz.blocked')} />
        </div>
      </Section>
      <Section title={t('admin.biz.homework30')}>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <StatTile value={b.homework.created} label={t('admin.biz.created30')} hint={t('admin.biz.allTime', { n: b.homework.total })} />
          <StatTile value={b.homework.published} label={t('admin.biz.published30')} />
          <StatTile value={b.attempts.submitted} label={t('admin.biz.submitted30')} />
          <StatTile value={b.attempts.avgPercent == null ? '—' : `${b.attempts.avgPercent}%`} label={t('admin.biz.avgScore')} />
        </div>
        <div className={`${panel} grid gap-6 md:grid-cols-3`}>
          <Bars data={b.newUsersByDay} caption={t('admin.biz.newUsersPerDay')} />
          <Bars data={b.homeworkByDay} caption={t('admin.biz.homeworkPerDay')} tone="bg-ink-500" />
          <Bars data={b.submissionsByDay} caption={t('admin.biz.submissionsPerDay')} tone="bg-success-600" />
        </div>
      </Section>
      <Section title={t('admin.help.title')} aside={<span className="t-small text-ink-500">{t('admin.help.lead')}</span>}>
        <p className="t-body t-num text-ink-700">{t('admin.help.stats', { q: help.totals.questions, t: help.totals.teachers })}</p>
        {help.totals.questions === 0 ? (
          <p className="t-body text-ink-500">{t('admin.help.empty')}</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <AskedList title={t('admin.help.topics')} rows={help.topics.map((r) => ({ label: t(`help.topic.${r.topic}` as MessageKey), n: r.n }))} times={(n) => t('admin.help.times', { n })} />
            <AskedList
              title={t('admin.help.unknown')}
              hint={t('admin.help.unknownHint')}
              rows={help.unknown.map((r) => ({ label: r.gist, n: r.n }))}
              times={(n) => t('admin.help.times', { n })}
            />
          </div>
        )}
      </Section>
    </div>
  )
}

/** One most-asked list: the question (or topic) and how many times */
function AskedList({ title, hint, rows, times }: { title: string; hint?: string; rows: { label: string; n: number }[]; times: (n: number) => string }) {
  return (
    <div className={`${panel} flex flex-col gap-2`}>
      <h3 className="t-h3">{title}</h3>
      {hint && <p className="t-small text-ink-500">{hint}</p>}
      {rows.length ? (
        <ol className="flex flex-col">
          {rows.map((r, i) => (
            <li key={i} className="flex items-baseline gap-3 border-b border-paper-300 py-1.5 last:border-b-0">
              <span className="t-body min-w-0 flex-1">{r.label}</span>
              <span className="t-small t-num shrink-0 text-ink-500">{times(r.n)}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="t-small text-ink-500">—</p>
      )}
    </div>
  )
}
