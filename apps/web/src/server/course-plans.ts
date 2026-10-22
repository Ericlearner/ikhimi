/**
 * Which plan a student does a homework on (DECISIONS.md BL). Homework follows the student's own plan (Free, Pro,
 * VIP), except a lesson of a paid course, which is the course's to give:
 * - a buyer, or a student of a class the teacher linked to the course, does it on VIP, whatever their own plan;
 * - anyone else does only its Free items (the vocabulary: a taste before buying), even with VIP.
 * The homework's own class still does it as their homework, on their own plan (VIP if they bought the course).
 */
import { and, courseLessons, courseRuns, courses, enrollments, eq, inArray, isNotNull, isNull, ne, subscriptions, type Db } from '@ikhimi/db'
import type { StudentPlan } from '@ikhimi/ai'
import { isPaid, isPublished } from './courses'
import { claimSeat, studentPlan } from './plans'

export type HomeworkPlan = {
  plan: StudentPlan
  /** Set when the paid course decided it (not bought): where to buy it */
  course: { slug: string; title: string } | null
}

type Homework = { id: string; groupId: string | null }

/** The courses each homework is a lesson of (any status: a buyer keeps a course that was later taken down) */
async function courseLessonsOf(db: Db, ids: string[]) {
  if (!ids.length) return []
  const rows = await db
    .select({ assignmentId: courseLessons.assignmentTemplateId, course: courses })
    .from(courseLessons)
    .innerJoin(courses, eq(courses.id, courseLessons.courseId))
    .where(and(inArray(courseLessons.assignmentTemplateId, ids), isNull(courses.deletedAt)))
  return rows.map((r) => ({
    assignmentId: r.assignmentId,
    courseId: r.course.id,
    slug: r.course.slug,
    title: r.course.title,
    teacherId: r.course.teacherId,
    paid: isPaid(r.course),
    /** On sale now: paid, approved and open to others. Only this keeps its homework from non-buyers. */
    onSale: isPaid(r.course) && isPublished(r.course),
  }))
}

/**
 * The plan for each homework. `claim`: a class package may give the student a seat first (when they open homework,
 * as before); only when their own plan is the one that applies.
 */
export async function homeworkPlans(db: Db, studentId: string, homework: Homework[], opts: { claim?: boolean } = {}): Promise<Map<string, HomeworkPlan>> {
  const lessons = await courseLessonsOf(db, homework.map((h) => h.id))
  const paidIds = [...new Set(lessons.filter((l) => l.paid).map((l) => l.courseId))]
  // Courses this student has in full: bought (for life, whatever became of the course), given by staff or through a
  // class the teacher linked to a paid course (or their own course)
  const full = new Set(lessons.filter((l) => l.teacherId === studentId).map((l) => l.courseId))
  const courseIds = [...new Set(lessons.map((l) => l.courseId))]
  if (courseIds.length) {
    const subs = await db
      .select({ courseId: subscriptions.courseId, priceKrw: subscriptions.priceKrw, plan: subscriptions.plan })
      .from(subscriptions)
      .where(and(eq(subscriptions.studentId, studentId), inArray(subscriptions.courseId, courseIds), eq(subscriptions.status, 'active')))
    for (const r of subs) if (r.courseId && (r.priceKrw > 0 || (r.plan === 'staff_grant' && paidIds.includes(r.courseId)))) full.add(r.courseId)
    const linked = paidIds.length
      ? await db
          .select({ courseId: courseRuns.courseId })
          .from(courseRuns)
          .innerJoin(enrollments, eq(enrollments.groupId, courseRuns.groupId))
          .where(and(inArray(courseRuns.courseId, paidIds), eq(enrollments.studentId, studentId), eq(enrollments.status, 'active')))
      : []
    for (const r of linked) full.add(r.courseId)
  }
  const groupIds = [...new Set(homework.map((h) => h.groupId).filter((g): g is string => !!g))]
  const classes = lessons.some((l) => l.onSale) && groupIds.length
    ? new Set(
        (
          await db
            .select({ groupId: enrollments.groupId })
            .from(enrollments)
            .where(and(eq(enrollments.studentId, studentId), inArray(enrollments.groupId, groupIds), eq(enrollments.status, 'active'), isNotNull(enrollments.groupId)))
        ).map((r) => r.groupId),
      )
    : new Set<string>()

  let own: StudentPlan | null = null
  const ownPlan = async () => (own ??= opts.claim ? await claimSeat(db, studentId) : await studentPlan(db, studentId))
  const out = new Map<string, HomeworkPlan>()
  for (const h of homework) {
    const mine = lessons.filter((l) => l.assignmentId === h.id)
    const onSale = mine.filter((l) => l.onSale)
    if (mine.some((l) => full.has(l.courseId))) out.set(h.id, { plan: 'vip', course: null })
    else if (!onSale.length || (h.groupId && classes.has(h.groupId))) out.set(h.id, { plan: await ownPlan(), course: null })
    else out.set(h.id, { plan: 'free', course: { slug: onSale[0]!.slug, title: onSale[0]!.title } })
  }
  return out
}

export async function homeworkPlan(db: Db, studentId: string, a: Homework, opts: { claim?: boolean } = {}): Promise<HomeworkPlan> {
  return (await homeworkPlans(db, studentId, [a], opts)).get(a.id)!
}

/**
 * A lesson of a published course (by link or in the catalog): opening it never adds anyone to the homework's class.
 * Course students aren't the teacher's class, and joining a class linked to a paid course would open it for free.
 */
export async function inPublishedCourse(db: Db, assignmentId: string) {
  const [row] = await db
    .select({ id: courses.id })
    .from(courseLessons)
    .innerJoin(courses, eq(courses.id, courseLessons.courseId))
    .where(and(eq(courseLessons.assignmentTemplateId, assignmentId), eq(courses.reviewStatus, 'approved'), ne(courses.visibility, 'private'), isNull(courses.deletedAt)))
    .limit(1)
  return !!row
}
