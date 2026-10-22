import { describe, expect, it } from 'vitest'
import { createTestDb } from './testing'
import { users, groups, enrollments } from './schema'
import { newJoinCode, newShareSlug } from './ids'
import { eq } from 'drizzle-orm'

describe('migrations', () => {
  it('apply cleanly and enforce the core constraints', async () => {
    const db = await createTestDb()
    const [t] = await db.insert(users).values({ role: 'teacher', phone: '+998901234567', fullName: 'Nodira' }).returning()
    expect(t!.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
    expect(t!.uiLocale).toBe('ko')

    await expect(db.insert(users).values({ role: 'student', phone: '+998901234567' })).rejects.toThrow()

    const [g] = await db
      .insert(groups)
      .values({ teacherId: t!.id, name: '9-B', subject: 'english', contentLanguage: 'en', joinCode: newJoinCode() })
      .returning()
    const [s] = await db.insert(users).values({ role: 'student', phone: '+998901112233' }).returning()
    await db.insert(enrollments).values({ groupId: g!.id, studentId: s!.id })
    await expect(db.insert(enrollments).values({ groupId: g!.id, studentId: s!.id })).rejects.toThrow()

    await db.update(users).set({ fullName: 'Nodira Karimova' }).where(eq(users.id, t!.id))
    const [u] = await db.select().from(users).where(eq(users.id, t!.id))
    expect(u!.updatedAt.getTime()).toBeGreaterThanOrEqual(t!.updatedAt.getTime())
  })
})

describe('ids', () => {
  it('share slugs are 8 unambiguous random chars', () => {
    const slugs = new Set(Array.from({ length: 2000 }, () => newShareSlug()))
    expect(slugs.size).toBe(2000)
    for (const s of slugs) expect(s).toMatch(/^[2-9A-HJKMNP-Z]{8}$/)
  })
})
