/**
 * Progress analytics (design spec §12, main spec §10.5): a student's results over time against their class,
 * per-skill accuracy, AI writing feedback, and a whole group's picture. Pure queries over a Db, computed in
 * JS — a teacher's classes are small (tens of students × tens of homeworks).
 *
 * Privacy stance: a teacher sees everything about the students in their own groups, and only the work set by
 * them. A student sees their own results and class AVERAGES here; classmates' places and scores only in the group
 * ranking (server/ranking.ts), and only where the teacher turned it on.
 */
import { and, asc, assignments, attempts, enrollments, eq, exercises, groups, inArray, isNull, ne, responses, users, type Db } from '@ikhimi/db'
import { describeAnswer, describeResponse, isAiGraded, type ExerciseKind } from '@ikhimi/ai'
import { studentDue } from './deadline'
import { can, type Actor } from './policy'
import { ownedGroup } from './groups'
import { groupRanking } from './ranking'
import { parseEssayFeedback, parseWritingFeedback } from './writing'

type Done = { assignmentId: string; studentId: string; percent: number | null; submittedAt: Date | null; activeSeconds: number; status: string; attemptId: string }

const round = (x: number) => Math.round(x)
const avg = (xs: number[]) => (xs.length ? round(xs.reduce((s, x) => s + x, 0) / xs.length) : null)

/** Last three results against the three before: rising, falling or steady (±5 points is steady) */
export function trendOf(percents: number[]): 'up' | 'down' | 'flat' | null {
  if (percents.length < 4) return null
  const recent = avg(percents.slice(-3))!
  const before = avg(percents.slice(-6, -3))!
  return recent - before > 5 ? 'up' : before - recent > 5 ? 'down' : 'flat'
}

/** All handed-in attempts on these assignments (anyone's) */
async function doneAttempts(db: Db, assignmentIds: string[]): Promise<Done[]> {
  if (!assignmentIds.length) return []
  return db
    .select({
      attemptId: attempts.id,
      assignmentId: attempts.assignmentId,
      studentId: attempts.studentId,
      percent: attempts.percent,
      submittedAt: attempts.submittedAt,
      activeSeconds: attempts.activeSeconds,
      status: attempts.status,
    })
    .from(attempts)
    .where(and(inArray(attempts.assignmentId, assignmentIds), ne(attempts.status, 'in_progress')))
}

/** Accuracy per skill over the given attempts, from graded responses */
async function skillAccuracy(db: Db, attemptIds: string[]) {
  if (!attemptIds.length) return new Map<string, { right: number; total: number }>()
  const rows = await db
    .select({ skills: exercises.skillTags, isCorrect: responses.isCorrect })
    .from(responses)
    .innerJoin(exercises, eq(exercises.id, responses.exerciseId))
    .where(inArray(responses.attemptId, attemptIds))
  const by = new Map<string, { right: number; total: number }>()
  for (const r of rows) {
    if (r.isCorrect === null) continue
    for (const s of r.skills) {
      const cur = by.get(s) ?? { right: 0, total: 0 }
      cur.total++
      if (r.isCorrect) cur.right++
      by.set(s, cur)
    }
  }
  return by
}

/**
 * One student, as `viewer` may see them. Teachers: only their own groups' homework, with ranks.
 * The student themselves: everything they did, with class averages but no ranks.
 */
export async function studentAnalytics(db: Db, viewer: Actor, studentId: string) {
  const [student] = await db.select({ id: users.id, name: users.fullName, createdAt: users.createdAt }).from(users).where(eq(users.id, studentId)).limit(1)
  if (!student) return null
  const memberships = await db
    .select({ groupId: groups.id, groupName: groups.name, teacherId: groups.teacherId, joinedAt: enrollments.joinedAt, showRank: groups.studentsSeeLeaderboard })
    .from(enrollments)
    .innerJoin(groups, eq(groups.id, enrollments.groupId))
    .where(and(eq(enrollments.studentId, studentId), eq(enrollments.status, 'active'), isNull(groups.deletedAt)))
  if (!can(viewer, 'results:read', { studentId, teacherIdsOfEnrolledGroups: memberships.map((m) => m.teacherId) })) return null
  const asTeacher = viewer.id !== studentId
  const myGroups = asTeacher ? memberships.filter((m) => m.teacherId === viewer.id) : memberships

  // The student's handed-in work (teachers: only homework they set)
  const mine = await db
    .select({ attempt: attempts, title: assignments.title, groupId: assignments.groupId, publishedAt: assignments.publishedAt, dueDays: assignments.dueDays, teacherId: assignments.teacherId, slug: assignments.shareSlug })
    .from(attempts)
    .innerJoin(assignments, eq(assignments.id, attempts.assignmentId))
    .where(and(eq(attempts.studentId, studentId), ne(attempts.status, 'in_progress')))
    .orderBy(asc(attempts.submittedAt))
  const work = asTeacher ? mine.filter((m) => m.teacherId === viewer.id) : mine
  const everyone = await doneAttempts(db, work.map((w) => w.attempt.assignmentId))
  const rankVisible = new Set(memberships.filter((m) => m.showRank).map((m) => m.groupId))
  // Each homework's deadline for this student: its duration from when it reached them (they joined its group later,
  // or opened it from outside their groups)
  const joinedAt = new Map(memberships.map((m) => [m.groupId, m.joinedAt]))

  const timeline = work.map((w) => {
    const peers = everyone.filter((e) => e.assignmentId === w.attempt.assignmentId && e.percent !== null)
    const p = w.attempt.percent ?? 0
    const deadline = studentDue(w, (w.groupId && joinedAt.get(w.groupId)) || w.attempt.startedAt)
    return {
      assignmentId: w.attempt.assignmentId,
      attemptId: w.attempt.id,
      title: w.title,
      slug: w.slug,
      submittedAt: w.attempt.submittedAt,
      percent: round(p),
      pending: w.attempt.status === 'submitted' ? w.attempt.manualPendingCount : 0,
      minutes: round((w.attempt.activeSeconds ?? 0) / 60),
      late: !!(deadline && w.attempt.submittedAt && w.attempt.submittedAt > deadline),
      classAverage: avg(peers.map((e) => e.percent!)),
      classSize: peers.length,
      // 1 = best, ties share a rank. Students see only their own place, and only where the teacher allows it.
      rank: asTeacher || rankVisible.has(w.groupId ?? '') ? peers.filter((e) => (e.percent ?? 0) > p).length + 1 : null,
    }
  })

  // Assigned but not handed in (their groups' published homework)
  const groupIds = myGroups.map((g) => g.groupId)
  const assigned = groupIds.length
    ? await db
        .select({ id: assignments.id, title: assignments.title, dueDays: assignments.dueDays, publishedAt: assignments.publishedAt, groupId: assignments.groupId })
        .from(assignments)
        .where(and(inArray(assignments.groupId, groupIds), eq(assignments.status, 'published'), isNull(assignments.deletedAt)))
    : []
  const doneIds = new Set(timeline.map((x) => x.assignmentId))
  const missing = assigned.filter((a) => !doneIds.has(a.id)).map((a) => ({ ...a, dueAt: studentDue(a, a.groupId ? joinedAt.get(a.groupId) : null) }))
  const overdue = missing.filter((a) => a.dueAt && a.dueAt < new Date())

  // Skills: this student vs everyone who did the same homework
  const mineSkills = await skillAccuracy(db, work.map((w) => w.attempt.id))
  const classSkills = await skillAccuracy(db, everyone.map((e) => e.attemptId))
  const skills = [...mineSkills.entries()]
    .map(([skill, v]) => {
      const c = classSkills.get(skill)
      return { skill, accuracy: round((v.right / v.total) * 100), total: v.total, classAccuracy: c ? round((c.right / c.total) * 100) : null }
    })
    .sort((p, q) => q.total - p.total)

  // Feedback on their writing (own sentences and essays), newest first
  const writingRows = work.length
    ? await db
        .select({ attemptId: responses.attemptId, value: responses.value, aiFeedback: responses.aiFeedback, teacherFeedback: responses.teacherFeedback, prompt: exercises.prompt, kind: exercises.kind })
        .from(responses)
        .innerJoin(exercises, eq(exercises.id, responses.exerciseId))
        .where(and(inArray(responses.attemptId, work.map((w) => w.attempt.id)), inArray(exercises.kind, ['open_writing', 'essay'])))
    : []
  const writing = writingRows
    .map((r) => {
      const w = work.find((x) => x.attempt.id === r.attemptId)!
      const base = { title: w.title, task: (r.prompt as { text?: string }).text ?? '', submittedAt: w.attempt.submittedAt, teacherFeedback: r.teacherFeedback }
      if (r.kind === 'essay') {
        const e = parseEssayFeedback(r.aiFeedback)
        return {
          ...base,
          ok: null,
          written: typeof r.value === 'string' && r.value.trim() ? 1 : 0,
          score: e?.overallLabel ?? null,
          summary: e?.summary ?? '',
          mistakes: e ? [...e.improvements].slice(0, 3) : [],
        }
      }
      const f = parseWritingFeedback(r.aiFeedback)
      const written = Array.isArray(r.value) ? (r.value as unknown[]).filter((x) => typeof x === 'string' && x.trim()).length : 0
      return {
        ...base,
        ok: f ? f.lines.filter((l) => l.ok).length : null,
        written,
        score: null as string | null,
        summary: f?.summary ?? '',
        mistakes: f ? f.lines.filter((l) => !l.ok && l.feedback).map((l) => l.feedback).slice(0, 3) : [],
      }
    })
    .filter((x) => x.written > 0)
    .sort((p, q) => (q.submittedAt?.getTime() ?? 0) - (p.submittedAt?.getTime() ?? 0))
    .slice(0, 6)

  // Where the student stands in each group (by average over that group's homework): teachers always,
  // the student only in groups whose teacher turned the class ranking on
  const rankedGroups = asTeacher ? myGroups : myGroups.filter((g) => g.showRank)
  const standings = rankedGroups.length
    ? await Promise.all(
        rankedGroups.map(async (g) => {
          // The group's ranking (server/ranking.ts): missed homework counts as 0 once it's closed
          const ranking = await groupRanking(db, g.groupId)
          const ranked = ranking.filter((r) => r.score !== null)
          const me = ranking.find((r) => r.studentId === studentId)
          return {
            groupId: g.groupId,
            groupName: g.groupName,
            average: me?.score ?? null,
            groupAverage: avg(ranked.map((r) => r.score!)),
            rank: me?.place ?? null,
            of: ranked.length,
          }
        }),
      )
    : []

  const percents = timeline.map((x) => x.percent)
  const onTime = timeline.filter((x) => !x.late).length
  return {
    student: { id: student.id, name: student.name ?? '—', since: student.createdAt },
    groups: myGroups.map((g) => ({ id: g.groupId, name: g.groupName, joinedAt: g.joinedAt })),
    average: avg(percents),
    classAverage: avg(timeline.filter((x) => x.classAverage !== null).map((x) => x.classAverage!)),
    completed: timeline.length,
    assigned: timeline.length + missing.length,
    missing: missing.map((m) => ({ id: m.id, title: m.title, dueAt: m.dueAt })),
    overdue: overdue.length,
    onTimeRate: timeline.length ? round((onTime / timeline.length) * 100) : null,
    totalMinutes: round(work.reduce((s, w) => s + (w.attempt.activeSeconds ?? 0), 0) / 60),
    trend: trendOf(percents),
    best: timeline.length ? timeline.reduce((b, x) => (x.percent > b.percent ? x : b)) : null,
    timeline,
    skills,
    writing,
    standings,
  }
}

export type StudentAnalytics = NonNullable<Awaited<ReturnType<typeof studentAnalytics>>>

export const SCORE_BUCKETS = [
  { min: 0, max: 49, label: '0–49' },
  { min: 50, max: 69, label: '50–69' },
  { min: 70, max: 89, label: '70–89' },
  { min: 90, max: 100, label: '90–100' },
] as const
export const bucketOf = (p: number) => SCORE_BUCKETS.findIndex((b) => p >= b.min && p <= b.max + 0.999)

/** A whole group for its teacher: class average over time, score spread, weak skills, every student's line. */
export async function groupAnalytics(db: Db, teacherId: string, groupId: string) {
  const g = await ownedGroup(db, teacherId, groupId)
  if (!g) return null
  const work = await db
    .select({ id: assignments.id, title: assignments.title, publishedAt: assignments.publishedAt })
    .from(assignments)
    .where(and(eq(assignments.groupId, g.id), eq(assignments.status, 'published'), isNull(assignments.deletedAt)))
    .orderBy(asc(assignments.publishedAt))
  const members = await db
    .select({ id: users.id, name: users.fullName })
    .from(enrollments)
    .innerJoin(users, eq(users.id, enrollments.studentId))
    .where(and(eq(enrollments.groupId, g.id), eq(enrollments.status, 'active')))
  const all = await doneAttempts(db, work.map((w) => w.id))
  const memberIds = new Set(members.map((m) => m.id))
  const done = all.filter((a) => memberIds.has(a.studentId) && a.percent !== null)

  const perAssignment = work.map((w) => {
    const ps = done.filter((a) => a.assignmentId === w.id).map((a) => a.percent!)
    return {
      id: w.id,
      title: w.title,
      publishedAt: w.publishedAt,
      average: avg(ps),
      min: ps.length ? round(Math.min(...ps)) : null,
      max: ps.length ? round(Math.max(...ps)) : null,
      submitted: ps.length,
    }
  })

  const students = members
    .map((m) => {
      const series = work.map((w) => done.find((a) => a.assignmentId === w.id && a.studentId === m.id)?.percent ?? null)
      const got = series.filter((x): x is number => x !== null).map(round)
      return { id: m.id, name: m.name ?? '—', average: avg(got), done: got.length, series: got, trend: trendOf(got) }
    })
    .sort((p, q) => (q.average ?? -1) - (p.average ?? -1))

  const buckets = SCORE_BUCKETS.map((b) => ({ label: `${b.label}%`, count: 0 }))
  for (const s of students) if (s.average !== null) buckets[bucketOf(s.average)]!.count++

  const skillMap = await skillAccuracy(db, done.map((a) => a.attemptId))
  const skills = [...skillMap.entries()].map(([skill, v]) => ({ skill, accuracy: round((v.right / v.total) * 100), total: v.total })).sort((p, q) => p.accuracy - q.accuracy)

  return {
    perAssignment,
    students,
    buckets,
    skills,
    average: avg(students.filter((s) => s.average !== null).map((s) => s.average!)),
    trend: trendOf(perAssignment.filter((p) => p.average !== null).map((p) => p.average!)),
  }
}

export type GroupAnalytics = NonNullable<Awaited<ReturnType<typeof groupAnalytics>>>

/**
 * What a group keeps getting wrong in one skill, for a practice homework in one click (the group page's weak skill →
 * Create): the items with the most wrong answers, each with its right answer and the most common wrong one. Only the
 * learning content leaves this function; no student is named.
 */
export async function weakSpots(db: Db, teacherId: string, groupId: string, skill: string, limit = 5) {
  const g = await ownedGroup(db, teacherId, groupId)
  if (!g) return null
  const work = await db
    .select({ id: assignments.id })
    .from(assignments)
    .where(and(eq(assignments.groupId, g.id), eq(assignments.status, 'published'), isNull(assignments.deletedAt)))
  const members = new Set(
    (await db.select({ id: enrollments.studentId }).from(enrollments).where(and(eq(enrollments.groupId, g.id), eq(enrollments.status, 'active')))).map((m) => m.id),
  )
  const done = (await doneAttempts(db, work.map((w) => w.id))).filter((a) => members.has(a.studentId))
  if (!done.length) return { group: g, accuracy: null, items: [] }
  const rows = await db
    .select({ exerciseId: exercises.id, kind: exercises.kind, prompt: exercises.prompt, payload: exercises.payload, answerKey: exercises.answerKey, skills: exercises.skillTags, isCorrect: responses.isCorrect, value: responses.value })
    .from(responses)
    .innerJoin(exercises, eq(exercises.id, responses.exerciseId))
    .where(inArray(responses.attemptId, done.map((a) => a.attemptId)))
  const ofSkill = rows.filter((r) => r.skills.includes(skill) && r.isCorrect !== null)
  const right = ofSkill.filter((r) => r.isCorrect).length
  const by = new Map<string, { row: (typeof rows)[number]; wrong: number; answers: Map<string, number> }>()
  for (const r of ofSkill) {
    if (r.isCorrect) continue
    const cur = by.get(r.exerciseId) ?? { row: r, wrong: 0, answers: new Map<string, number>() }
    cur.wrong++
    if (!isAiGraded(r.kind)) {
      const d = describeResponse(r.kind as ExerciseKind, r.payload, r.value)
      if (d !== '—') cur.answers.set(d, (cur.answers.get(d) ?? 0) + 1)
    }
    by.set(r.exerciseId, cur)
  }
  const one = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 160)
  const items = [...by.values()]
    .sort((p, q) => q.wrong - p.wrong)
    .slice(0, limit)
    .map(({ row, wrong, answers }) => {
      const p = row.payload as { text?: string }
      const question = one([(row.prompt as { text?: string }).text ?? '', row.kind === 'gap_fill' ? (p.text ?? '') : ''].filter(Boolean).join(' — '))
      let correct: string | null = null
      try {
        correct = isAiGraded(row.kind) ? null : one(describeAnswer(row.kind as ExerciseKind, row.payload, row.answerKey)) || null
      } catch {}
      const common = [...answers.entries()].sort((x, y) => y[1] - x[1])[0]?.[0]
      return { question, correct, commonWrong: common ? one(common) : null, wrong }
    })
  return { group: g, accuracy: ofSkill.length ? round((right / ofSkill.length) * 100) : null, items }
}
