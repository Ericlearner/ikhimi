import { CheckCircle2, Hourglass, Lightbulb, XCircle } from 'lucide-react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { and, attempts, eq, getDb, responses } from '@ikhimi/db'
import { isStudentPlan, splitByPlan, type ExerciseKind } from '@ikhimi/ai'
import { answerText, responseText } from '@/lib/describe'
import { ICON, KIND_TASK_ICON, TaskIcon } from '@ikhimi/ui/components'
import { AppHeader } from '@/components/AppHeader'
import { PlanTeaser } from '@/components/PlanTeaser'
import { isStoreApp } from '@/server/store-app'
import { ResultCelebration } from '@/components/ResultCelebration'
import { ScoreRing } from '@/components/ScoreRing'
import { getT } from '@/i18n/server'
import { loadExercises } from '@/server/assignments'
import { EssayResult } from '@/components/ExerciseView'
import { essayForStudent } from '@/server/assignments'
import { parseEssayFeedback, parseWritingFeedback } from '@/server/writing'
import { homeworkPlan } from '@/server/course-plans'
import { getSession } from '@/server/request'
import { loadPublishedBySlug } from '@/server/student-pages'

export default async function Result({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const session = await getSession()
  if (!session) redirect(`/t/${slug}`)
  const found = await loadPublishedBySlug(slug)
  if (!found) redirect(`/t/${slug}`)
  const db = getDb()
  const [at] = await db
    .select()
    .from(attempts)
    .where(and(eq(attempts.assignmentId, found.a.id), eq(attempts.studentId, session.user.id)))
    .limit(1)
  if (!at || at.status === 'in_progress') redirect(`/t/${slug}`)
  const { t } = await getT()
  // The items of the student's plan when they submitted (all, for work from before plans)
  const { shown: rows, locked } = splitByPlan(await loadExercises(db, found.a.id), isStudentPlan(at.plan) ? at.plan : null)
  const resp = await db.select().from(responses).where(eq(responses.attemptId, at.id))
  const pct = Math.round(at.percent ?? 0)
  // Longest run of right answers, in exercise order
  let bestStreak = 0
  let run = 0
  for (const ex of rows) {
    run = resp.find((x) => x.exerciseId === ex.id)?.isCorrect ? run + 1 : 0
    bestStreak = Math.max(bestStreak, run)
  }
  const showAnswers = ((found.a.settings ?? {}) as { showAnswersAfter?: string }).showAnswersAfter !== 'never'

  return (
    <>
      <AppHeader />
      <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
        <section className="flex flex-col items-center gap-3 text-center">
          <h1 className="t-display-2">{t('student.done')}</h1>
          <ResultCelebration percent={pct} bestStreak={bestStreak} />
          <ScoreRing percent={pct} label={`${pct}%`} />
          <p className="t-body t-num text-ink-500">
            {t('result.score')}: {at.score ?? 0} / {at.maxScore ?? 0}
          </p>
          {at.status === 'submitted' && (
            <p className="t-body flex items-center gap-2 rounded-lg border border-warn-600 bg-warn-100 px-4 py-3 text-left text-warn-600">
              <Hourglass size={20} strokeWidth={ICON.strokeWidth} className="shrink-0" aria-hidden /> {t('result.pendingGrading', { n: at.manualPendingCount })}
            </p>
          )}
        </section>

        <PlanTeaser locked={locked} course={(await homeworkPlan(db, session.user.id, found.a)).course} store={await isStoreApp()} />

        <section className="rounded-lg border border-paper-300 bg-paper-50 p-4">
          <h2 className="t-caption text-ink-500">{t('result.whatsNext')}</h2>
          <p className="t-body-lg mt-1">{t(pct >= 80 ? 'student.nextGood' : pct >= 50 ? 'student.nextOk' : 'student.nextLow')}</p>
        </section>

        {showAnswers && (
          <ol className="flex flex-col gap-3">
            {rows.map((ex, i) => {
              const r = resp.find((x) => x.exerciseId === ex.id)
              const kind = ex.kind as ExerciseKind
              const prompt = (ex.prompt as { text?: string }).text || ((ex.payload as { text?: string }).text ?? '')
              const ok = !!r?.isCorrect
              const pending = r?.pointsAwarded === null || r?.pointsAwarded === undefined
              const writing = kind === 'open_writing' ? parseWritingFeedback(r?.aiFeedback) : null
              const sentences = kind === 'open_writing' && Array.isArray(r?.value) ? (r!.value as string[]) : []
              return (
                <li
                  key={ex.id}
                  style={{ ['--i' as string]: i }}
                  className={`card-enter rounded-lg border-l-4 border-y border-r border-paper-300 bg-paper-50 p-4 ${pending ? 'border-l-warn-600' : ok ? 'border-l-success-600' : 'border-l-error-600'}`}
                >
                  <p className="t-body flex items-start gap-2 font-medium">
                    {ok ? (
                      <CheckCircle2 size={20} strokeWidth={ICON.strokeWidth} className="mt-0.5 shrink-0 text-success-600" aria-label={t('result.correct')} />
                    ) : (
                      <XCircle size={20} strokeWidth={ICON.strokeWidth} className="mt-0.5 shrink-0 text-error-600" aria-label={t('result.incorrect')} />
                    )}
                    <span>
                      {i + 1}. {prompt}
                    </span>
                    <TaskIcon name={ex.audioMaterialId ? 'headphone' : (KIND_TASK_ICON[kind] ?? 'memo')} size={22} className="ml-auto mt-0.5 shrink-0" />
                  </p>
                  {kind === 'essay' ? (
                    <div className="mt-2 flex flex-col gap-2">
                      {typeof r?.value === 'string' && r.value.trim() && (
                        <details className="rounded-md bg-paper-200 px-3 py-2">
                          <summary className="t-small cursor-pointer font-medium text-ink-700">{t('student.yourAnswer')}</summary>
                          <p className="t-body mt-1 whitespace-pre-line text-ink-800">{r.value}</p>
                        </details>
                      )}
                      {(() => {
                        const f = parseEssayFeedback(r?.aiFeedback)
                        return f ? <EssayResult essay={essayForStudent(f, showAnswers)} /> : pending ? <p className="t-small text-warn-600">{t('result.waitingGrade')}</p> : null
                      })()}
                    </div>
                  ) : kind === 'open_writing' ? (
                    <ol className="mt-2 flex flex-col gap-2">
                      {sentences.map((text, j) => {
                        const v = writing?.lines[j]
                        if (!text.trim()) return null
                        return (
                          <li key={j} className="t-body flex flex-col">
                            <span className={v ? (v.ok ? 'text-success-600' : 'text-error-600') : 'text-ink-800'}>
                              {j + 1}. {text}
                            </span>
                            {v && !v.ok && v.correction && v.correction !== text && <span className="text-ink-800">✓ {v.correction}</span>}
                            {v?.feedback && !v.ok && <span className="t-small text-ink-500">{v.feedback}</span>}
                          </li>
                        )
                      })}
                      {writing?.summary && <li className="t-body mt-1 rounded-md bg-paper-200 px-3 py-2 text-ink-700">{writing.summary}</li>}
                      {pending && <li className="t-small text-warn-600">{t('result.waitingGrade')}</li>}
                    </ol>
                  ) : (
                    <p className="t-body mt-2">
                      <span className="text-ink-500">{t('student.yourAnswer')}:</span> {r ? responseText(t, kind, ex.payload, r.value) : '—'}
                    </p>
                  )}
                  {r?.teacherFeedback && <p className="t-body mt-2 rounded-md bg-orange-100 px-3 py-2 text-ink-800">{t('result.teacherNote')}: {r.teacherFeedback}</p>}
                  {!ok && kind !== 'open_writing' && kind !== 'essay' && (
                    <p className="t-body">
                      <span className="text-ink-500">{t('student.correctAnswer')}:</span> <b>{answerText(t, kind, ex.payload, ex.answerKey)}</b>
                    </p>
                  )}
                  {ex.explanation && !ok && (
                    <p className="t-body mt-2 flex gap-2 text-ink-500">
                      <Lightbulb size={18} strokeWidth={ICON.strokeWidth} className="mt-0.5 shrink-0" aria-hidden /> {ex.explanation}
                    </p>
                  )}
                </li>
              )
            })}
          </ol>
        )}
        <Link href="/work" className="btn btn-secondary btn-lg self-center">
          <span className="btn-label">{t('result.backToWork')}</span>
        </Link>
      </main>
    </>
  )
}
