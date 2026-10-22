'use client'
import { BarChart3, Users } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { ICON, StatTile } from '@ikhimi/ui/components'
import { useI18n } from '@/i18n/client'
import { CopyToGroup } from './CopyToGroup'
import { DueEditor } from './DueEditor'
import { ShareButtons } from './ShareLink'

/** Publish success state (design spec §11 screen 3): large QR, copyable link, Telegram, live board. */
export function SharePanel({
  assignmentId,
  url,
  qrSvg,
  counts,
  group,
  dueDays,
  groupDue,
  otherGroups = [],
}: {
  assignmentId: string
  url: string
  qrSvg: string
  counts: { opened: number; inProgress: number; submitted: number; notStarted: number }
  group: { id: string; name: string } | null
  /** How long each student has, which the teacher can change here; groupDue (ISO) is when it ends for the group */
  dueDays: number | null
  groupDue: string | null
  /** The teacher's other groups, for "give to another group too" */
  otherGroups?: { id: string; name: string }[]
}) {
  const { t } = useI18n()
  const router = useRouter()

  // Live status board: refresh while the teacher watches
  useEffect(() => {
    const id = setInterval(() => document.visibilityState === 'visible' && router.refresh(), 15_000)
    return () => clearInterval(id)
  }, [router])

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-4 px-4 pt-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="t-h1">{t('share.title')}</h2>
        {group && (
          <Link href={`/app/groups/${group.id}`} className="t-small inline-flex items-center gap-1 font-medium text-ink-500 hover:text-ink-800">
            <Users size={16} strokeWidth={ICON.strokeWidth} aria-hidden /> {group.name}
          </Link>
        )}
      </div>
      <div className="fade-in flex flex-col items-center gap-5 rounded-xl border border-paper-300 bg-paper-50 p-5 shadow-e2 sm:flex-row sm:items-start">
        {/* White quiet zone so the code scans off a projector, in dark mode too; ≥240px, high EC, cap in the centre */}
        <div className="relative shrink-0 rounded-md bg-white p-3 shadow-e1" style={{ width: 264 }}>
          <div dangerouslySetInnerHTML={{ __html: qrSvg }} aria-label="QR" role="img" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/app-icon.svg" alt="" className="absolute left-1/2 top-1/2 size-12 -translate-x-1/2 -translate-y-1/2 rounded-md ring-4 ring-white" />
        </div>
        <div className="flex w-full min-w-0 flex-col gap-3">
          <p className="t-small text-ink-500">{t('share.qrHint')}</p>
          <code className="t-body-lg break-all rounded-md bg-paper-200 px-3 py-2 font-semibold text-ink-800">{url}</code>
          <ShareButtons url={url} />
          <DueEditor assignmentId={assignmentId} dueDays={dueDays} groupDue={groupDue} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile value={counts.opened} label={t('board.opened')} />
        <StatTile value={counts.inProgress} label={t('board.inProgress')} />
        <StatTile value={counts.submitted} label={t('state.submitted')} />
        <StatTile value={counts.notStarted} label={t('report.notStarted')} />
      </div>
      <Link href={`/app/a/${assignmentId}/report`} className="btn btn-primary btn-lg">
        <span className="btn-label">
          <BarChart3 size={20} strokeWidth={ICON.strokeWidth} aria-hidden /> {t('nav.reports')}
        </span>
      </Link>
      <CopyToGroup assignmentId={assignmentId} groups={otherGroups} />
    </section>
  )
}
