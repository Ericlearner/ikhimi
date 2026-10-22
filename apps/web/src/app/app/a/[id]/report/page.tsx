import { ArrowLeft, CheckCircle2, Coffee, LifeBuoy, XCircle } from 'lucide-react'
import Link from 'next/link'
import { getDb, inArray, responses } from '@ikhimi/db'
import { gapVerdicts, itemPlan, planAllows, textLength, type ExerciseKind } from '@ikhimi/ai'
import { answerText, localizeTf, responseText } from '@/lib/describe'
import { EmptyState, ICON, KindIcon, StatTile } from '@ikhimi/ui/components'
import { AppHeader } from '@/components/AppHeader'
import { AutoRefresh } from '@/components/AutoRefresh'
import { getT } from '@/i18n/server'
import { RegradeButton, ResponseReview } from '@/components/ResponseReview'
import { RemindButton } from '@/components/RemindButton'
import { DueEditor } from '@/components/DueEditor'
import { ShareBar } from '@/components/ShareLink'
import { buildReport, gradeOptionsFor, loadExercises } from '@/server/assignments'
import { studentDue } from '@/server/deadline'
import { requireTeacherAssignment, shareUrl } from '@/server/pages'
import { parseEssayFeedback, parseWritingFeedback } from '@/server/writing'

type EssayP = { min: number; max?: number; grader?: string; scale: { unit: 'words' | 'chars'; criteria: { id: string; name: string; max: number }[] } }
function reviewEssay(payload: unknown, text: string, f: ReturnType<typeof parseEssayFeedback>) {
  const p = payload as EssayP
  return {
    text,
    length: textLength(text, p.scale.unit),
    min: p.min,
    max: p.max,
    unit: p.scale.unit,
    criteria: p.scale.criteria.map((c) => {
      const got = f?.criteria.find((x) => x.id === c.id)
      return { id: c.id, name: c.name, max: c.max, score: got?.score ?? null, feedback: got?.feedback ?? '' }
    }),
    overallLabel: f?.overallLabel ?? null,
    summary: f?.summary ?? '',
    byTeacher: f?.gradedBy === 'teacher',
    teacherGrades: p.grader === 'teacher',
  }
}

/** Typed answers marked wrong that the teacher may accept: the short answer, or each wrong gap of a gap fill */
function acceptableFor(a: Parameters<typeof gradeOptionsFor>[0]) {
  return (ex: { kind: string; payload: unknown; answerKey: unknown }, value: unknown): { blank: number | null; text: string }[] => {
    if (ex.kind === 'short_answer') return typeof value === 'string' && value.trim() ? [{ blank: null, text: value.trim() }] : []
    if (ex.kind !== 'gap_fill' || !Array.isArray(value)) return []
    const parts = gapVerdicts(ex.payload, ex.answerKey, value, gradeOptionsFor(a))
    return value.flatMap((v, i) => (typeof v === 'string' && v.trim() && parts[i] === false ? [{ blank: i, text: v.trim() }] : []))
  }
}

/** The 60-second report (design spec §11 screen 5). Calm temperature: no celebration motion. */
export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { a } = await requireTeacherAssignment((await params).id)
  const { t } = await getT()
  const db = getDb()
  const report = await buildReport(db, a)
  const exRows = await loadExercises(db, a.id)
  const acceptable = acceptableFor(a)
  const resp = report.students.length ? await db.select().from(responses).where(inArray(responses.attemptId, report.students.map((s) => s.attemptId))) : []

  const names = (list: { name: string }[]) => (list.length ? list.map((s) => s.name).join(', ') : '—')
  const lists = [
    { key: 'report.top' as const, icon: CheckCircle2, tone: 'border-l-success-600 text-success-600', people: report.top },
    { key: 'report.needsHelp' as const, icon: LifeBuoy, tone: 'border-l-error-600 text-error-600', people: report.needsHelp },
    { key: 'report.passive' as const, icon: Coffee, tone: 'border-l-warn-600 text-warn-600', people: report.passive },
  ]

  return (
    <>
      <AppHeader />
      <AutoRefresh seconds={30} />
      <main className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-6 pb-16">
        <Link href={`/app/a/${a.id}`} className="t-small inline-flex items-center gap-1 self-start font-medium text-ink-500 hover:text-ink-800">
          <ArrowLeft size={16} strokeWidth={ICON.strokeWidth} aria-hidden /> {a.title}
        </Link>
        <div className="flex flex-col gap-1">
          <h1 className="t-display-2">{a.title}</h1>
          {a.status !== 'draft' && <DueEditor assignmentId={a.id} dueDays={a.dueDays} groupDue={studentDue(a)?.toISOString() ?? null} />}
        </div>

        {/* The link is here too: a homework opened from its group lands on this page, not on the share panel */}
        {a.status !== 'draft' && <ShareBar url={shareUrl(a.shareSlug)} assignmentId={a.id} />}

        {/* 1. Headline */}
        <section className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <StatTile value={report.averagePercent === null ? '—' : `${report.averagePercent}%`} label={t('report.average')} />
          <StatTile value={`${report.counts.submitted}/${Math.max(report.counts.audience, report.counts.submitted)}`} label={t('report.submissionRate')} />
          <StatTile value={report.medianMinutes ?? '—'} label={t('report.medianTime')} hint={t('report.vsEstimate', { n: report.expectedMinutes })} />
        </section>

        {/* Students of the group who haven't handed it in can be reminded in Telegram */}
        {a.groupId && a.status === 'published' && report.counts.inProgress + report.counts.notStarted > 0 && (
          <RemindButton assignmentId={a.id} pending={report.counts.inProgress + report.counts.notStarted} />
        )}

        {report.counts.opened === 0 && report.counts.notStarted === 0 ? (
          <div className="rounded-2xl border-2 border-paper-300 bg-paper-50">
            <EmptyState illustration="plane" title={t('report.empty')} action={{ label: t('action.share'), href: `/app/a/${a.id}` }} />
          </div>
        ) : (
          <>
            {/* 2. Three named lists, always */}
            <section className="grid grid-cols-1 gap-2 md:grid-cols-3">
              {lists.map(({ key, icon: Icon, tone, people }) => (
                <div key={key} className={`rounded-2xl border-2 border-l-4 border-paper-300 bg-paper-50 p-4 ${tone.split(' ')[0]}`}>
                  <h2 className={`t-h3 flex items-center gap-2 ${tone.split(' ')[1]}`}>
                    <Icon size={20} strokeWidth={ICON.strokeWidth} aria-hidden /> {t(key)}
                    <span className="t-num ml-auto text-ink-500">{people.length}</span>
                  </h2>
                  <p className="t-body mt-1 text-ink-700">{names(people)}</p>
                </div>
              ))}
            </section>

            {/* 3. What to re-teach tomorrow */}
            {report.hardest.length > 0 && (
              <section className="flex flex-col gap-2">
                <h2 className="t-h1">{t('report.hardest')}</h2>
                {report.hardest.map((h) => {
                  const ex = exRows.find((e) => e.id === h.exerciseId)!
                  return (
                    <div key={h.exerciseId} className="rounded-2xl border-2 border-paper-300 bg-paper-50 p-4">
                      <p className="t-body flex items-start gap-2 font-medium">
                        <KindIcon kind={ex.kind} size={20} className="mt-0.5 shrink-0 text-ink-500" />
                        {h.n}. {h.prompt || ((ex.payload as { text?: string }).text ?? '')}
                      </p>
                      <p className="t-small t-num mt-1 text-ink-500">
                        {t('report.wrongCount', { n: h.wrong })} / {h.total}
                      </p>
                      <p className="t-body mt-2 flex items-center gap-2">
                        <CheckCircle2 size={16} strokeWidth={ICON.strokeWidth} className="text-success-600" aria-hidden />
                        {t('student.correctAnswer')}: <b>{answerText(t, ex.kind, ex.payload, ex.answerKey)}</b>
                      </p>
                      {h.commonWrong && (
                        <p className="t-body flex items-center gap-2">
                          <XCircle size={16} strokeWidth={ICON.strokeWidth} className="text-error-600" aria-hidden />
                          {t('report.commonWrong')}: <b>{h.kind === 'true_false' ? localizeTf(t, h.commonWrong) : h.commonWrong}</b>
                        </p>
                      )}
                    </div>
                  )
                })}
              </section>
            )}

            {/* 4. Student table: score and effort side by side (main spec §10.5) */}
            <section className="flex flex-col gap-2">
              <h2 className="t-h1">{t('report.students')}</h2>
              <div className="overflow-hidden rounded-2xl border-2 border-paper-300 bg-paper-50">
                <div className="t-caption grid grid-cols-[1fr_auto_auto_auto] gap-4 border-b border-paper-300 bg-paper-200 px-4 py-2 text-ink-500">
                  <span>{t('report.students')}</span>
                  <span className="w-16 text-right">{t('result.score')}</span>
                  <span className="w-16 text-right">{t('report.effort')}</span>
                  <span className="w-14 text-right">{t('param.minutes')}</span>
                </div>
                {report.students.map((s) => (
                  <details key={s.attemptId} className="group border-b border-paper-300 last:border-b-0">
                    <summary className="grid cursor-pointer list-none grid-cols-[1fr_auto_auto_auto] items-center gap-4 px-4 py-3 hover:bg-paper-100">
                      <span className="t-body flex min-w-0 items-center gap-2 font-medium">
                        <span className="truncate">{s.name}</span>
                        {s.pending > 0 && <span className="t-small shrink-0 rounded-pill bg-warn-100 px-2 py-0.5 text-warn-600">⏳ {s.pending}</span>}
                        {s.plan && <span className="t-small shrink-0 rounded-pill bg-paper-200 px-2 py-0.5 text-ink-500">{t(`plans.name.${s.plan}`)}</span>}
                      </span>
                      <span className="t-body t-num w-16 text-right font-semibold">{s.percent === null ? '…' : `${s.percent}%`}</span>
                      <span className="t-body t-num w-16 text-right" title="0.35·completion + 0.25·on time + 0.20·engaged time + 0.20·accuracy">
                        {s.effort}
                      </span>
                      <span className="t-body t-num w-14 text-right text-ink-500">{s.minutes}</span>
                    </summary>
                    <div className="flex flex-col gap-2 bg-paper-100 px-4 py-3">
                      <div className="flex flex-wrap items-center gap-3">
                        <Link href={`/app/students/${s.studentId}`} className="t-small font-medium text-orange-700 underline">
                          {t('report.studentPage')}
                        </Link>
                        {s.pending > 0 && <RegradeButton attemptId={s.attemptId} />}
                      </div>
                      <ol className="flex flex-col divide-y divide-paper-300">
                        {exRows.map((ex, i) => {
                          // Not on this student's plan: they never saw it
                          if (s.plan && !planAllows(s.plan, itemPlan(ex))) {
                            return (
                              <li key={ex.id} className="t-small py-2 text-ink-400">
                                {i + 1}. 🔒 {t('plans.notOnPlan', { plan: t(`plans.name.${itemPlan(ex)}`) })}
                              </li>
                            )
                          }
                          const r = resp.find((x) => x.attemptId === s.attemptId && x.exerciseId === ex.id)
                          const submitted = s.status !== 'in_progress'
                          const f = ex.kind === 'open_writing' ? parseWritingFeedback(r?.aiFeedback) : null
                          const sentences = ex.kind === 'open_writing' && Array.isArray(r?.value) ? (r!.value as unknown[]).map((x) => (typeof x === 'string' ? x : '')) : []
                          return (
                            <ResponseReview
                              key={ex.id}
                              responseId={submitted && r ? r.id : null}
                              n={i + 1}
                              answerText={r ? responseText(t, ex.kind, ex.payload, r.value) : '—'}
                              isCorrect={r?.isCorrect ?? null}
                              points={submitted ? (r?.pointsAwarded ?? null) : null}
                              maxPoints={ex.points}
                              writing={
                                ex.kind === 'open_writing'
                                  ? {
                                      lines: sentences.map((text, j) => ({ text, ok: f?.lines[j]?.ok ?? null, correction: f?.lines[j]?.correction ?? '', feedback: f?.lines[j]?.feedback ?? '' })),
                                      summary: f?.summary ?? '',
                                      byTeacher: f?.gradedBy === 'teacher',
                                    }
                                  : null
                              }
                              teacherFeedback={r?.teacherFeedback ?? null}
                              overridden={!!r?.teacherOverrode}
                              essay={ex.kind === 'essay' ? reviewEssay(ex.payload, typeof r?.value === 'string' ? r.value : '', parseEssayFeedback(r?.aiFeedback)) : null}
                              accept={r && r.isCorrect === false && !r.teacherOverrode ? { url: `/api/assignments/${a.id}/exercises/${ex.id}/accept`, items: acceptable(ex, r.value) } : null}
                            />
                          )
                        })}
                      </ol>
                    </div>
                  </details>
                ))}
                {report.passive
                  .filter((p) => !report.students.some((s) => s.studentId === p.id))
                  .map((p) => (
                    <div key={p.id} className="grid grid-cols-[1fr_auto] gap-4 border-b border-paper-300 px-4 py-3 last:border-b-0">
                      <span className="t-body text-ink-500">{p.name}</span>
                      <span className="t-small text-ink-400">{t('report.notStarted')}</span>
                    </div>
                  ))}
              </div>
            </section>
          </>
        )}
      </main>
    </>
  )
}
