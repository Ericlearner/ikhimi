import { Clock, ListChecks } from 'lucide-react'
import Link from 'next/link'
import { and, attempts, eq, exercises, getDb } from '@ikhimi/db'
import type { MessageKey } from '@ikhimi/i18n'
import { Avatar, EmptyState, ICON, KIND_TASK_ICON, TaskIcon } from '@ikhimi/ui/components'
import { AppHeader } from '@/components/AppHeader'
import { JoinAsStudent } from '@/components/JoinAsStudent'
import { getT } from '@/i18n/server'
import { getSession } from '@/server/request'
import { loadPublishedBySlug } from '@/server/student-pages'

/** Assignment landing behind the share link / QR (design spec §11 screen 8): the conversion moment. */
export default async function AssignmentPreview({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { t } = await getT()
  const session = await getSession()
  const found = await loadPublishedBySlug(slug)

  if (!found) {
    return (
      <>
        <AppHeader />
        <main className="mx-auto max-w-md px-4 py-10">
          <EmptyState illustration="pages" title={t('student.notFound')} />
        </main>
      </>
    )
  }
  const { a, teacher, groupName } = found
  const rows = await getDb().select({ kind: exercises.kind, skills: exercises.skillTags }).from(exercises).where(eq(exercises.assignmentId, a.id))
  const skills = [...new Set(rows.flatMap((r) => r.skills))]
  const kinds = [...new Set(rows.map((r) => r.kind))]

  let status: string | null = null
  if (session) {
    const [at] = await getDb()
      .select({ status: attempts.status })
      .from(attempts)
      .where(and(eq(attempts.assignmentId, a.id), eq(attempts.studentId, session.user.id)))
      .limit(1)
    status = at?.status ?? null
  }
  const isOwner = session?.user.id === a.teacherId
  const startHref = session ? `/t/${slug}/do` : `/signin?as=student&next=${encodeURIComponent(`/t/${slug}/do`)}`

  return (
    <>
      <AppHeader />
      <main className="mx-auto flex min-h-[calc(100dvh-4rem)] max-w-md flex-col justify-center gap-6 px-4 py-8">
        {/* Teacher's public card */}
        <div className="fade-in flex items-center gap-3">
          <Avatar id={teacher.id} name={teacher.name} size={48} />
          <div className="flex min-w-0 flex-col">
            <span className="t-h3 truncate">{teacher.name}</span>
            <span className="t-small truncate text-ink-500">
              {[teacher.school, ...teacher.subjects.map((s) => t(`subject.${s}` as MessageKey))].filter(Boolean).join(' · ')}
            </span>
          </div>
        </div>

        <div className="card-enter flex flex-col gap-3 rounded-xl border border-paper-300 bg-paper-50 p-5 shadow-e2">
          {groupName && <span className="t-caption self-start rounded-pill bg-paper-200 px-2.5 py-1 text-ink-500">{groupName}</span>}
          <h1 className="t-display-2">{a.title}</h1>
          <hr className="rule-gold w-12" />
          <div className="t-body flex flex-wrap gap-x-5 gap-y-2 text-ink-500">
            <span className="flex items-center gap-1.5">
              <ListChecks size={18} strokeWidth={ICON.strokeWidth} aria-hidden /> {t('draft.items', { n: rows.length })}
            </span>
            <span className="flex items-center gap-1.5">
              <Clock size={18} strokeWidth={ICON.strokeWidth} aria-hidden /> {t('draft.minutes', { n: a.estimatedMinutes ?? 0 })}
            </span>
          </div>
          {skills.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {kinds.map((k) => (
                <TaskIcon key={k} name={KIND_TASK_ICON[k] ?? 'memo'} size={26} label={t(`draft.kind.${k}` as MessageKey)} />
              ))}
              <span className="t-small text-ink-500">{skills.map((s) => t(`skill.${s}` as MessageKey)).join(', ')}</span>
            </div>
          )}
          {a.instructions && <p className="t-body rounded-md bg-paper-100 px-4 py-3">{a.instructions}</p>}
        </div>

        {isOwner ? (
          <p className="t-body rounded-md border border-paper-300 px-4 py-3 text-ink-500">{t('student.preview')}</p>
        ) : session && !status && !session.user.roles.includes('student') ? (
          // A teacher (or anyone without the student role) opening someone's homework: asked, never added silently
          <JoinAsStudent slug={slug} />
        ) : status === 'graded' ? (
          <Link href={`/t/${slug}/result`} className="btn btn-secondary btn-xl">
            <span className="btn-label">{t('student.seeResult')}</span>
          </Link>
        ) : (
          <Link href={startHref} className="btn btn-primary btn-xl">
            <span className="btn-label">{status === 'in_progress' ? t('action.continue') : t('action.start')}</span>
          </Link>
        )}
        {!session && !isOwner && <p className="t-small text-center text-ink-500">{t('student.loginToStart')}</p>}
      </main>
    </>
  )
}
