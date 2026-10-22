import { notFound, redirect } from 'next/navigation'
import { attempts, CONFIG, eq, getDb, responses, sessions } from '@ikhimi/db'
import { describeAnswer, gapVerdicts, gradeExercise, isAiGraded, keyAsResponse, PLAN_FEATURES, publicTutorNotes, planAllows, splitByPlan, type ExerciseKind } from '@ikhimi/ai'
import { AttemptRunner, type ItemFeedback } from '@/components/AttemptRunner'
import { needsOnboarding } from '@/server/auth/users'
import { essayForStudent, gradeOptionsFor, loadExercises, publicExercise, startAttempt, writingForStudent } from '@/server/assignments'
import { parseEssayFeedback, parseWritingFeedback } from '@/server/writing'
import { getSession } from '@/server/request'
import { loadPublishedBySlug } from '@/server/student-pages'
import { PlanLockedHomework } from '@/components/PlanLocked'
import { homeworkPlan } from '@/server/course-plans'
import { isStoreApp } from '@/server/store-app'

export default async function DoAssignment({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const session = await getSession()
  const next = `/t/${slug}/do`
  if (!session || needsOnboarding(session.user)) redirect(`/signin?as=student&next=${encodeURIComponent(next)}`)
  const found = await loadPublishedBySlug(slug)
  if (!found) notFound()
  if (found.a.teacherId === session.user.id) redirect(`/t/${slug}`)

  const db = getDb()
  // Only a student does homework; anyone else is asked first on the homework's page (never added silently)
  if (!session.user.roles.includes('student')) redirect(`/t/${slug}`)
  // Doing homework is the student side of a dual-role account: the header says so
  if (session.user.role !== 'student') await db.update(sessions).set({ activeRole: 'student' }).where(eq(sessions.id, session.sessionId))
  const attempt = await startAttempt(db, found.a, session.user.id)
  if (attempt.status !== 'in_progress') redirect(`/t/${slug}/result`)
  // The student's plan decides what they see (a class package gives them a seat first, if it has one free); a paid
  // course's lesson is the course's to give
  const { plan, course } = await homeworkPlan(db, session.user.id, found.a, { claim: true })
  if (attempt.plan !== plan) await db.update(attempts).set({ plan }).where(eq(attempts.id, attempt.id))
  const { shown: rows, locked } = splitByPlan(await loadExercises(db, found.a.id), plan)
  if (!rows.length) return <PlanLockedHomework title={found.a.title} locked={locked} course={course} />
  const saved = await db.select().from(responses).where(eq(responses.attemptId, attempt.id))

  // Items already checked stay locked with their feedback after a reload
  const reveal = ((found.a.settings ?? {}) as { showAnswersAfter?: string }).showAnswersAfter !== 'never'
  const initialFeedback: Record<string, ItemFeedback> = {}
  for (const r of saved) {
    if (!r.checkedAt) continue
    const ex = rows.find((e) => e.id === r.exerciseId)
    if (!ex) continue
    const kind = ex.kind as ExerciseKind
    if (kind === 'essay') {
      const f = parseEssayFeedback(r.aiFeedback)
      if (!f) continue
      initialFeedback[ex.id] = { isCorrect: !!r.isCorrect, correctValue: null, correctText: null, explanation: null, parts: null, essay: essayForStudent(f, reveal) }
      continue
    }
    if (isAiGraded(kind)) {
      const f = parseWritingFeedback(r.aiFeedback)
      if (!f) continue
      initialFeedback[ex.id] = { isCorrect: !!r.isCorrect, correctValue: null, correctText: null, explanation: reveal ? ex.explanation : null, parts: f.lines.map((l) => l.ok), writing: writingForStudent(f, reveal) }
      continue
    }
    initialFeedback[ex.id] = {
      isCorrect: gradeExercise(kind, ex.payload, ex.answerKey, r.value, gradeOptionsFor(found.a)).isCorrect,
      correctValue: reveal ? keyAsResponse(kind, ex.answerKey) : null,
      correctText: reveal ? describeAnswer(kind, ex.payload, ex.answerKey) : null,
      explanation: reveal ? ex.explanation : null,
      parts: kind === 'gap_fill' ? gapVerdicts(ex.payload, ex.answerKey, r.value, gradeOptionsFor(found.a)) : null,
      tutor: publicTutorNotes(r.tutor),
    }
  }
  const tutorOn = planAllows(plan, PLAN_FEATURES.tutor)

  return (
    <AttemptRunner
      slug={slug}
      attemptId={attempt.id}
      title={found.a.title}
      exercises={rows.map(publicExercise)}
      initial={Object.fromEntries(saved.map((r) => [r.exerciseId, { value: r.value, revision: r.revisionCount }]))}
      initialFeedback={initialFeedback}
      initialActiveSeconds={attempt.activeSeconds}
      tutor={{ on: tutorOn, max: CONFIG.tutorNotesPerAnswer }}
      locked={locked}
      course={course}
      storeApp={await isStoreApp()}
    />
  )
}
