import { redirect } from 'next/navigation'
import type { MessageKey } from '@ikhimi/i18n'
import { and, assignments, CONFIG, courses, desc, eq, getDb, isNull, teacherProfiles } from '@ikhimi/db'
import { AppHeader } from '@/components/AppHeader'
import { Composer } from '@/components/Composer'
import { getT } from '@/i18n/server'
import { weakSpots } from '@/server/analytics'
import { needsOnboarding } from '@/server/auth/users'
import { ownStyles } from '@/server/lab'
import { getSession } from '@/server/request'

/**
 * The group page's "practice homework" on a weak skill: a request for Create mode, written in the teacher's language
 * from what the group got wrong (questions, right answers, the most common wrong answer; never a student's name).
 * The teacher sees it in the composer and sends or edits it.
 */
async function practiceRequest(teacherId: string, groupId: string, skill: string) {
  const spots = await weakSpots(getDb(), teacherId, groupId, skill)
  if (!spots) return null
  const { t } = await getT()
  const name = t(`skill.${skill}` as MessageKey)
  const lines = [spots.accuracy === null ? t('practice.intro', { skill: name }) : t('practice.introAccuracy', { skill: name, n: spots.accuracy })]
  if (spots.group.cefrLevel) lines.push(t('practice.level', { level: spots.group.cefrLevel }))
  if (spots.items.length) {
    lines.push('', t('practice.itemsHead'))
    for (const i of spots.items) {
      lines.push(`• ${i.question}${i.correct ? t('practice.correct', { v: i.correct }) : ''}${i.commonWrong ? t('practice.wrong', { v: i.commonWrong }) : ''}`)
    }
  }
  lines.push('', t('practice.ask'))
  return { text: lines.join('\n'), skills: [skill] }
}

/** Teacher home: the composer and nothing else (main spec §3.1, design spec §7). */
export default async function TeacherHome({ searchParams }: { searchParams: Promise<{ practice?: string; skill?: string }> }) {
  const session = await getSession()
  if (!session || needsOnboarding(session.user)) redirect('/signin')
  // Learners (and dual-role accounts in learner mode) land on their work instead
  if (session.user.role !== 'teacher') redirect('/work')
  const [profile] = await getDb().select().from(teacherProfiles).where(eq(teacherProfiles.userId, session.user.id)).limit(1)
  // What the teacher usually teaches: the composer's language guess starts from here
  const recent = await getDb()
    .select({ lang: assignments.contentLanguage })
    .from(assignments)
    .where(and(eq(assignments.teacherId, session.user.id), isNull(assignments.deletedAt)))
    .orderBy(desc(assignments.createdAt))
    .limit(10)
  // For the course chip: the plan remembers the teacher's choices per course
  const myCourses = await getDb()
    .select({ id: courses.id, title: courses.title })
    .from(courses)
    .where(and(eq(courses.teacherId, session.user.id), isNull(courses.deletedAt)))
    .orderBy(desc(courses.updatedAt))
    .limit(30)
  // The owner's own methodologies from the Lab, beside the exams in the Style list
  const styles = await ownStyles(getDb())
  const firstName = session.user.fullName?.split(/\s+/)[0] ?? null
  const q = await searchParams
  const initial = q.practice && q.skill && /^[a-z_]{2,30}$/.test(q.skill) ? await practiceRequest(session.user.id, q.practice.slice(0, 40), q.skill) : null
  return (
    <>
      <AppHeader />
      <main>
        <Composer firstName={firstName} defaults={profile?.teachingDefaults ?? {}} subjects={profile?.subjects ?? []} recentLanguages={recent.map((r) => r.lang)} maxPages={CONFIG.maxMaterialPages} maxAnswerPages={CONFIG.maxAnswerPages} courses={myCourses} styles={styles} initial={initial} />
      </main>
    </>
  )
}
