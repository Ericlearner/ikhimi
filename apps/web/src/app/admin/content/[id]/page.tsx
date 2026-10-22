import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getDb } from '@ikhimi/db'
import { formatDate } from '@ikhimi/i18n'
import { Badge, ICON } from '@ikhimi/ui/components'
import { panel, Section, seconds } from '@/components/admin/Bars'
import { getT } from '@/i18n/server'
import { pageStaff } from '@/server/admin/guard'
import { audit, can } from '@/server/admin/staff'
import { homeworkDetail } from '@/server/admin/stats'

/** One homework as the AI made it: every item with its key, flags and picture, plus how it was generated and scored */
export default async function AdminHomework({ params }: { params: Promise<{ id: string }> }) {
  const db = getDb()
  const { session, access } = await pageStaff(db, 'content')
  const { t } = await getT()
  const id = (await params).id
  const d = await homeworkDetail(db, id)
  if (!d) notFound()
  // Opening someone's homework is logged
  await audit(db, session.user.id, 'content.view', { type: 'assignment', id })
  const meta = d.a.generationMeta as { mode?: string; model?: string; usage?: { inputTokens?: number; outputTokens?: number; thoughtsTokens?: number }; review?: Record<string, number> }

  return (
    <div className="flex flex-col gap-6">
      <Link href={`/admin/content?teacher=${d.a.teacherId}`} className="t-small inline-flex items-center gap-1 self-start font-medium text-ink-500 hover:text-ink-800">
        <ArrowLeft size={16} strokeWidth={ICON.strokeWidth} aria-hidden /> {d.teacherName ?? t('admin.nav.content')}
      </Link>
      <header className="flex flex-col gap-1">
        <h2 className="t-h1">{d.a.title}</h2>
        <span className="t-small t-num text-ink-500">
          {can(access, 'users.view') ? (
            <Link href={`/admin/users/${d.a.teacherId}`} className="hover:underline">
              {d.teacherName ?? '—'}
            </Link>
          ) : (
            (d.teacherName ?? '—')
          )}{' '}
          · {formatDate(d.a.createdAt)} · {d.a.status} · {meta.mode ?? 'create'} · {meta.model ?? ''}
        </span>
      </header>

      {d.runs.length > 0 && (
        <div className={`${panel} t-small flex flex-col gap-1`}>
          {d.runs.map((r) => (
            <span key={r.id} className="t-num text-ink-700">
              {r.kind} · {seconds(r.durationMs)} · {t('admin.content.review')}: {r.review ?? '—'} · 🖼 {t('admin.health.picturesHint', { pointed: r.picturesPointed, located: r.picturesLocated, removed: r.picturesRemoved })}, {r.picturesAttached}
            </span>
          ))}
          {meta.usage && (
            <span className="t-num text-ink-500">
              tokens: in {meta.usage.inputTokens ?? 0} · out {meta.usage.outputTokens ?? 0} · thinking {meta.usage.thoughtsTokens ?? 0}
            </span>
          )}
        </div>
      )}

      <Section title={t('admin.content.items', { n: d.items.length })}>
        <ol className="flex flex-col gap-3">
          {d.items.map((e, i) => {
            const payload = e.payload as Record<string, unknown> & { imageId?: string; text?: string; options?: string[]; passage?: string }
            return (
              <li key={e.id} className={`${panel} flex flex-col gap-2`}>
                <span className="flex flex-wrap items-center gap-2">
                  <span className="t-num text-ink-400">{i + 1}.</span>
                  <Badge>{e.kind}</Badge>
                  {e.sourceRef && <span className="t-small text-ink-500">{e.sourceRef}</span>}
                  {e.verifyFlags.map((f) => (
                    <Badge key={f} tone="warn">
                      {f}
                    </Badge>
                  ))}
                  {e.teacherEdited && <Badge tone="orange">{t('admin.content.edited')}</Badge>}
                </span>
                {payload.imageId && (
                  // eslint-disable-next-line @next/next/no-img-element -- private picture, served with a staff check
                  <img src={`/api/pictures/${e.id}`} alt="" className="max-h-60 w-auto max-w-full self-start rounded-md border border-paper-300" />
                )}
                <p className="t-body whitespace-pre-line font-medium">{(e.prompt as { text?: string }).text ?? ''}</p>
                {payload.text && <p className="t-body whitespace-pre-line text-ink-700">{payload.text}</p>}
                {payload.options && <p className="t-small text-ink-700">{payload.options.join(' · ')}</p>}
                <pre className="t-small overflow-x-auto whitespace-pre-wrap rounded-md bg-paper-200 p-2 text-ink-700">{JSON.stringify(e.answerKey)}</pre>
                {e.explanation && <p className="t-small text-ink-500">{e.explanation}</p>}
              </li>
            )
          })}
        </ol>
      </Section>

      <Section title={t('admin.content.results', { n: d.results.length })}>
        {d.results.length === 0 ? (
          <p className="t-body text-ink-500">{t('admin.content.noResults')}</p>
        ) : (
          <ul className={`${panel} t-small flex flex-col gap-1`}>
            {d.results.map(({ at, name }) => (
              <li key={at.id} className="flex justify-between gap-2">
                <span>{name ?? '—'}</span>
                <span className="t-num text-ink-500">
                  {at.percent == null ? '…' : `${Math.round(at.percent)}%`} · {at.submittedAt ? formatDate(at.submittedAt) : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  )
}
