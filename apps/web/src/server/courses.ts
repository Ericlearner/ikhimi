import { z } from 'zod'
import {
  and,
  asc,
  assignments,
  attempts,
  CONFIG,
  courseLessons,
  courseRuns,
  courses,
  desc,
  enrollments,
  eq,
  groups,
  gt,
  inArray,
  isNull,
  newShareSlug,
  or,
  sql,
  subscriptions,
  users,
  type Db,
} from '@ikhimi/db'
import { parseVideoUrl } from '../lib/video'

export type CourseRow = typeof courses.$inferSelect
export type LessonRow = typeof courseLessons.$inferSelect

export const courseDetailsSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().max(4000).nullable().optional(),
  cefrLevel: z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']).nullable().optional(),
  subject: z.string().max(60).nullable().optional(),
  /** private = only the teacher (and linked groups); unlisted = anyone with the link; marketplace = public catalog */
  visibility: z.enum(['private', 'unlisted', 'marketplace']).optional(),
  /** null = plan-covered; a price = a paid course (DECISIONS.md BL) */
  priceKrw: z.number().int().min(CONFIG.courses.minPriceKrw).max(CONFIG.courses.maxPriceKrw).nullable().optional(),
})

export const lessonSchema = z.object({
  title: z.string().trim().min(1).max(160),
  videoUrl: z
    .string()
    .max(500)
    .nullable()
    .optional()
    .refine((v) => !v?.trim() || !!parseVideoUrl(v), { message: 'bad_video_url' }),
  videoNote: z.string().max(8000).nullable().optional(),
  assignmentId: z.string().max(40).nullable().optional(),
  isPreview: z.boolean().optional(),
})

/** "Ingliz tili A2: Oila" → "ingliz-tili-a2-oila-7KQ2" (readable + unguessable suffix) */
export function courseSlug(title: string) {
  const base = title
    .toLowerCase()
    .replace(/[ʻʼ'`’]/g, '')
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return `${base || 'kurs'}-${newShareSlug(4).toLowerCase()}`
}

// ─── teacher side ───────────────────────────────────────────────────────────

export async function createCourse(db: Db, teacherId: string, input: z.infer<typeof courseDetailsSchema>) {
  const [c] = await db
    .insert(courses)
    .values({
      teacherId,
      slug: courseSlug(input.title),
      title: input.title.trim(),
      description: input.description?.trim() || null,
      cefrLevel: input.cefrLevel ?? null,
      subject: input.subject ?? null,
      visibility: input.visibility ?? 'private',
    })
    .returning()
  return c!
}

export async function ownedCourse(db: Db, teacherId: string, courseId: string) {
  const [c] = await db
    .select()
    .from(courses)
    .where(and(eq(courses.id, courseId), eq(courses.teacherId, teacherId), isNull(courses.deletedAt)))
    .limit(1)
  return c ?? null
}

export async function updateCourse(db: Db, c: CourseRow, input: Partial<z.infer<typeof courseDetailsSchema>>) {
  const [row] = await db
    .update(courses)
    .set({
      ...(input.title !== undefined && { title: input.title.trim() }),
      ...(input.description !== undefined && { description: input.description?.trim() || null }),
      ...(input.cefrLevel !== undefined && { cefrLevel: input.cefrLevel }),
      ...(input.subject !== undefined && { subject: input.subject }),
      ...(input.visibility !== undefined && { visibility: input.visibility }),
      ...(input.priceKrw !== undefined && { priceKrw: input.priceKrw }),
    })
    .where(eq(courses.id, c.id))
    .returning()
  return row!
}

export async function loadLessons(db: Db, courseId: string) {
  return db.select().from(courseLessons).where(eq(courseLessons.courseId, courseId)).orderBy(asc(courseLessons.orderIndex))
}

async function syncLessonCount(db: Db, courseId: string) {
  const [n] = await db.select({ n: sql<number>`count(*)::int` }).from(courseLessons).where(eq(courseLessons.courseId, courseId))
  await db.update(courses).set({ lessonCount: n?.n ?? 0 }).where(eq(courses.id, courseId))
}

/** A lesson's homework must be the same teacher's published assignment. */
async function checkAssignment(db: Db, teacherId: string, assignmentId: string | null | undefined) {
  if (!assignmentId) return null
  const [a] = await db
    .select({ id: assignments.id })
    .from(assignments)
    .where(and(eq(assignments.id, assignmentId), eq(assignments.teacherId, teacherId), eq(assignments.status, 'published'), isNull(assignments.deletedAt)))
    .limit(1)
  if (!a) throw new Error('bad_assignment')
  return a.id
}

export async function addLesson(db: Db, c: CourseRow, input: z.infer<typeof lessonSchema>) {
  const assignmentTemplateId = await checkAssignment(db, c.teacherId, input.assignmentId)
  const [last] = await db
    .select({ n: sql<number>`coalesce(max(${courseLessons.orderIndex}), -1)::int` })
    .from(courseLessons)
    .where(eq(courseLessons.courseId, c.id))
  const [l] = await db
    .insert(courseLessons)
    .values({
      courseId: c.id,
      orderIndex: (last?.n ?? -1) + 1,
      title: input.title.trim(),
      videoUrl: input.videoUrl?.trim() || null,
      videoNote: input.videoNote?.trim() || null,
      assignmentTemplateId,
      isPreview: input.isPreview ?? false,
    })
    .returning()
  await syncLessonCount(db, c.id)
  return l!
}

export async function updateLesson(db: Db, c: CourseRow, lessonId: string, input: Partial<z.infer<typeof lessonSchema>>) {
  const assignmentTemplateId = input.assignmentId !== undefined ? await checkAssignment(db, c.teacherId, input.assignmentId) : undefined
  const [l] = await db
    .update(courseLessons)
    .set({
      ...(input.title !== undefined && { title: input.title.trim() }),
      ...(input.videoUrl !== undefined && { videoUrl: input.videoUrl?.trim() || null }),
      ...(input.videoNote !== undefined && { videoNote: input.videoNote?.trim() || null }),
      ...(assignmentTemplateId !== undefined && { assignmentTemplateId }),
      ...(input.isPreview !== undefined && { isPreview: input.isPreview }),
    })
    .where(and(eq(courseLessons.id, lessonId), eq(courseLessons.courseId, c.id)))
    .returning()
  return l ?? null
}

export async function deleteLesson(db: Db, c: CourseRow, lessonId: string) {
  await db.delete(courseLessons).where(and(eq(courseLessons.id, lessonId), eq(courseLessons.courseId, c.id)))
  const rest = await loadLessons(db, c.id)
  for (const [i, l] of rest.entries()) if (l.orderIndex !== i) await db.update(courseLessons).set({ orderIndex: i }).where(eq(courseLessons.id, l.id))
  await syncLessonCount(db, c.id)
}

export async function reorderLessons(db: Db, c: CourseRow, ids: string[]) {
  const current = await loadLessons(db, c.id)
  if (ids.length !== current.length || !current.every((l) => ids.includes(l.id))) throw new Error('bad_order')
  for (const [i, id] of ids.entries()) await db.update(courseLessons).set({ orderIndex: i }).where(eq(courseLessons.id, id))
}

/** Link or unlink the teacher's groups: their students get the course free. */
export async function setCourseGroups(db: Db, c: CourseRow, groupIds: string[]) {
  const own = groupIds.length
    ? await db.select({ id: groups.id }).from(groups).where(and(inArray(groups.id, groupIds), eq(groups.teacherId, c.teacherId)))
    : []
  await db.delete(courseRuns).where(eq(courseRuns.courseId, c.id))
  if (own.length) await db.insert(courseRuns).values(own.map((g) => ({ courseId: c.id, groupId: g.id })))
}

export async function teacherCourses(db: Db, teacherId: string) {
  const rows = await db
    .select()
    .from(courses)
    .where(and(eq(courses.teacherId, teacherId), isNull(courses.deletedAt)))
    .orderBy(desc(courses.createdAt))
  const stats = rows.length ? await courseStats(db, rows.map((c) => c.id)) : new Map<string, { students: number }>()
  return rows.map((c) => ({ ...c, ...(stats.get(c.id) ?? { students: 0 }) }))
}

/** Enrolled students (active subscriptions) per course */
export async function courseStats(db: Db, courseIds: string[]) {
  const subs = await db
    .select({ courseId: subscriptions.courseId, n: sql<number>`count(*)::int` })
    .from(subscriptions)
    .where(and(inArray(subscriptions.courseId, courseIds), eq(subscriptions.status, 'active')))
    .groupBy(subscriptions.courseId)
  const out = new Map<string, { students: number }>()
  for (const id of courseIds) out.set(id, { students: subs.find((s) => s.courseId === id)?.n ?? 0 })
  return out
}

// ─── publishing (DECISIONS.md BL) ───────────────────────────────────────────

/** A course subscription that gives a paid course in full: bought, or given by staff (Admin → Users) */
export const ownsCourse = or(gt(subscriptions.priceKrw, 0), eq(subscriptions.plan, 'staff_grant'))

/** A paid course: a price is set. Without one its homework follows each student's own plan. */
export const isPaid = (c: Pick<CourseRow, 'priceKrw'>) => (c.priceKrw ?? 0) > 0

/** Open to people outside the teacher's groups (by link or in the catalog): only once the admin approved it */
export const isPublished = (c: Pick<CourseRow, 'visibility' | 'reviewStatus' | 'deletedAt'>) => c.visibility !== 'private' && c.reviewStatus === 'approved' && !c.deletedAt

/**
 * The teacher sends the course for approval (it must be meant for others and have a lesson). Approved once, it stays
 * approved: later changes (lessons, price, link or catalog) need no new approval.
 */
export async function submitCourse(db: Db, c: CourseRow, now = new Date()): Promise<{ ok: true } | { ok: false; reason: 'already' | 'private' | 'no_lessons' }> {
  if (c.reviewStatus === 'pending' || c.reviewStatus === 'approved') return { ok: false, reason: 'already' }
  if (c.visibility === 'private') return { ok: false, reason: 'private' }
  if (!c.lessonCount) return { ok: false, reason: 'no_lessons' }
  await db.update(courses).set({ reviewStatus: 'pending', submittedAt: now, reviewNote: null }).where(eq(courses.id, c.id))
  return { ok: true }
}

/** The admin approves a course (it opens to everyone it's meant for), or returns it with a note (also a published one) */
export async function reviewCourse(db: Db, c: CourseRow, staffId: string, decision: 'approve' | 'return', note: string | null, now = new Date()) {
  const [row] = await db
    .update(courses)
    .set(
      decision === 'approve'
        ? { reviewStatus: 'approved', approvedAt: now, approvedBy: staffId, reviewNote: null }
        : { reviewStatus: 'returned', reviewNote: note?.trim() || null },
    )
    .where(eq(courses.id, c.id))
    .returning()
  return row!
}

// ─── access ─────────────────────────────────────────────────────────────────

/**
 * owner: the teacher. bought: paid for it (for life). group: in a class the teacher linked to it (free, in full).
 * enrolled: joined without paying. open: not joined yet. A private or not-yet-approved course is visible only to
 * the owner and people who already have it.
 */
export type CourseAccess = 'owner' | 'bought' | 'group' | 'enrolled' | 'open'

export async function courseAccess(db: Db, c: CourseRow, userId: string | null): Promise<CourseAccess> {
  if (userId && c.teacherId === userId) return 'owner'
  if (userId) {
    const subs = await db
      .select({ priceKrw: subscriptions.priceKrw, plan: subscriptions.plan })
      .from(subscriptions)
      .where(and(eq(subscriptions.courseId, c.id), eq(subscriptions.studentId, userId), eq(subscriptions.status, 'active')))
    if (subs.some((x) => x.priceKrw > 0 || x.plan === 'staff_grant')) return 'bought'
    const [member] = await db
      .select({ id: enrollments.id })
      .from(enrollments)
      .innerJoin(courseRuns, eq(courseRuns.groupId, enrollments.groupId))
      .where(and(eq(courseRuns.courseId, c.id), eq(enrollments.studentId, userId), eq(enrollments.status, 'active')))
      .limit(1)
    if (member) return 'group'
    if (subs.length) return 'enrolled'
  }
  return 'open'
}

/** Everything in the course: videos, notes and homework (a paid course's homework then on VIP) */
export const hasFullAccess = (c: Pick<CourseRow, 'priceKrw'>, a: CourseAccess) => a === 'owner' || a === 'bought' || a === 'group' || (a === 'enrolled' && !isPaid(c))
/** Can this viewer see the course page at all? */
export const canView = (c: CourseRow, a: CourseAccess) => a !== 'open' || isPublished(c)

/** Join a course (idempotent). */
export async function enrollFree(db: Db, c: CourseRow, studentId: string) {
  const [existing] = await db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.courseId, c.id), eq(subscriptions.studentId, studentId), eq(subscriptions.status, 'active')))
    .limit(1)
  if (existing) return existing
  const [s] = await db
    .insert(subscriptions)
    .values({ studentId, courseId: c.id, plan: 'free', status: 'active', priceKrw: 0, periodStart: new Date() })
    .returning()
  return s!
}

export async function courseBySlug(db: Db, slug: string) {
  const [c] = await db.select().from(courses).where(and(eq(courses.slug, slug), isNull(courses.deletedAt))).limit(1)
  return c ?? null
}

// ─── student side ───────────────────────────────────────────────────────────

/**
 * A lesson as the viewer may see it: locked lessons keep their title but hide video, notes and homework. A paid
 * course before buying is a taste: every lesson's homework opens (on Free: its vocabulary), videos and notes only in
 * the preview lessons.
 */
export async function coursePage(db: Db, c: CourseRow, userId: string | null) {
  const access = await courseAccess(db, c, userId)
  const lessons = await loadLessons(db, c.id)
  const full = hasFullAccess(c, access)
  const taste = !full && isPaid(c)
  const hw = lessons.map((l) => l.assignmentTemplateId).filter((x): x is string => !!x)
  const hwRows = hw.length ? await db.select({ id: assignments.id, slug: assignments.shareSlug, title: assignments.title }).from(assignments).where(inArray(assignments.id, hw)) : []
  const done = userId && hw.length
    ? await db
        .select({ assignmentId: attempts.assignmentId, percent: attempts.percent })
        .from(attempts)
        .where(and(eq(attempts.studentId, userId), inArray(attempts.assignmentId, hw), eq(attempts.status, 'graded')))
    : []
  const [teacher] = await db.select({ id: users.id, name: users.fullName }).from(users).where(eq(users.id, c.teacherId)).limit(1)
  return {
    course: c,
    teacher: teacher ?? { id: c.teacherId, name: null },
    access,
    /** A paid course the viewer hasn't got: show its price and the way to buy it */
    buy: taste,
    lessons: lessons.map((l) => {
      const open = full || l.isPreview
      const h = hwRows.find((r) => r.id === l.assignmentTemplateId)
      const d = done.find((x) => x.assignmentId === l.assignmentTemplateId)
      return {
        id: l.id,
        n: l.orderIndex + 1,
        title: l.title,
        isPreview: l.isPreview,
        open,
        /** The lesson page opens: all of it, or (a paid course before buying) its homework's free part */
        enter: open || (taste && !!h),
        hasVideo: !!l.videoUrl,
        hasHomework: !!h,
        video: open ? parseVideoUrl(l.videoUrl) : null,
        note: open ? l.videoNote : null,
        homework: (open || taste) && h ? { slug: h.slug, title: h.title, done: !!d, percent: d?.percent ?? null } : null,
      }
    }),
  }
}

/** Public catalog: approved marketplace courses with at least one lesson */
export async function catalog(db: Db) {
  const rows = await db
    .select({ c: courses, teacher: users.fullName })
    .from(courses)
    .innerJoin(users, eq(users.id, courses.teacherId))
    .where(and(eq(courses.visibility, 'marketplace'), eq(courses.reviewStatus, 'approved'), isNull(courses.deletedAt), sql`${courses.lessonCount} > 0`))
    .orderBy(desc(courses.createdAt))
    .limit(60)
  const stats = rows.length ? await courseStats(db, rows.map((r) => r.c.id)) : new Map<string, { students: number; revenueKrw: number }>()
  return rows.map((r) => ({ ...r.c, teacherName: r.teacher, students: stats.get(r.c.id)?.students ?? 0 }))
}

/** "My courses" on the student's work page, with homework progress */
export async function studentCourses(db: Db, studentId: string) {
  const viaSub = await db
    .select({ c: courses })
    .from(subscriptions)
    .innerJoin(courses, eq(courses.id, subscriptions.courseId))
    .where(and(eq(subscriptions.studentId, studentId), eq(subscriptions.status, 'active'), isNull(courses.deletedAt)))
  const viaGroup = await db
    .select({ c: courses })
    .from(enrollments)
    .innerJoin(courseRuns, eq(courseRuns.groupId, enrollments.groupId))
    .innerJoin(courses, eq(courses.id, courseRuns.courseId))
    .where(and(eq(enrollments.studentId, studentId), eq(enrollments.status, 'active'), isNull(courses.deletedAt)))
  const all = [...new Map([...viaSub, ...viaGroup].map((r) => [r.c.id, r.c])).values()]
  const out = []
  for (const c of all) {
    const p = await coursePage(db, c, studentId)
    const withHw = p.lessons.filter((l) => l.homework)
    out.push({ id: c.id, slug: c.slug, title: c.title, lessons: p.lessons.length, homework: withHw.length, done: withHw.filter((l) => l.homework!.done).length })
  }
  return out
}
