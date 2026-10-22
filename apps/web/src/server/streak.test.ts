import { beforeEach, describe, expect, it } from 'vitest'
import { createTestDb } from '@ikhimi/db/testing'
import { assignments, attempts, exercises, groups, responses, reviewItems, users, type Db } from '@ikhimi/db'
import { streakFrom, studentStreak, seoulDay, seoulWeekStart } from './streak'

// Thursday 15 October 2026, 20:00 in Seoul
const NOW = new Date('2026-10-15T11:00:00Z')
const DAY = 86_400_000

describe('days in a row', () => {
  it('counts back from today, or from yesterday while today is still open', () => {
    expect(streakFrom(new Set(['2026-10-15', '2026-10-14', '2026-10-13']), NOW)).toMatchObject({ days: 3, today: true })
    expect(streakFrom(new Set(['2026-10-14', '2026-10-13']), NOW)).toMatchObject({ days: 2, today: false })
    // A missed day starts again
    expect(streakFrom(new Set(['2026-10-15', '2026-10-13']), NOW).days).toBe(1)
    expect(streakFrom(new Set(['2026-10-12']), NOW).days).toBe(0)
  })

  it("uses Seoul's calendar: 23:30 there is still that day, 00:30 is the next", () => {
    expect(seoulDay(new Date('2026-10-15T14:30:00Z'))).toBe('2026-10-15')
    expect(seoulDay(new Date('2026-10-15T15:30:00Z'))).toBe('2026-10-16')
  })

  it('starts the week on Monday at midnight in Seoul', () => {
    expect(seoulWeekStart(NOW).toISOString()).toBe('2026-10-11T15:00:00.000Z')
  })

  it('shows this week Monday to Sunday, today marked, later days ahead', () => {
    const { week } = streakFrom(new Set(['2026-10-12', '2026-10-15']), NOW)
    expect(week.map((d) => d.day)).toEqual(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'])
    expect(week.map((d) => d.active)).toEqual([true, false, false, true, false, false, false])
    expect(week.findIndex((d) => d.isToday)).toBe(3)
    expect(week.filter((d) => d.future)).toHaveLength(3)
  })
})

describe('active days from what is saved', () => {
  let db: Db
  beforeEach(async () => {
    db = await createTestDb()
  })

  it('answering homework and reviewing old mistakes both count; a mistake only added to the list does not', async () => {
    const [t] = await db.insert(users).values({ role: 'teacher', roles: ['teacher'], phone: '+998900000001' }).returning()
    const [s] = await db.insert(users).values({ role: 'student', roles: ['student'], phone: '+998900000002' }).returning()
    const [g] = await db.insert(groups).values({ teacherId: t!.id, name: '9-B', subject: 'english', contentLanguage: 'en', joinCode: 'ABC123' }).returning()
    const [a] = await db.insert(assignments).values({ teacherId: t!.id, groupId: g!.id, title: 'HW', instructionLocale: 'ko', contentLanguage: 'en', shareSlug: 'hw1' }).returning()
    const ex = []
    for (let i = 0; i < 3; i++) ex.push((await db.insert(exercises).values({ assignmentId: a!.id, orderIndex: i, kind: 'mcq_single', prompt: {}, answerKey: {} }).returning())[0]!)
    const [at] = await db.insert(attempts).values({ assignmentId: a!.id, studentId: s!.id }).returning()
    // Homework answered today, a mistake reviewed yesterday, one only added two days ago
    await db.insert(responses).values({ attemptId: at!.id, exerciseId: ex[0]!.id, value: 0, updatedAt: new Date(NOW.getTime() - 3600_000) })
    await db.insert(reviewItems).values({ studentId: s!.id, exerciseId: ex[1]!.id, dueAt: NOW, lastRight: true, updatedAt: new Date(NOW.getTime() - DAY) })
    await db.insert(reviewItems).values({ studentId: s!.id, exerciseId: ex[2]!.id, dueAt: NOW, updatedAt: new Date(NOW.getTime() - 2 * DAY) })
    expect(await studentStreak(db, s!.id, NOW)).toMatchObject({ days: 2, today: true })
  })
})
