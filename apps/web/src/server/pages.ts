import 'server-only'
import { notFound, redirect } from 'next/navigation'
import { assignments, eq, getDb } from '@ikhimi/db'
import { needsOnboarding } from './auth/users'
import { can } from './policy'
import { getSession } from './request'

/** Teacher page guard: signed in, onboarded, owns the assignment. */
export async function requireTeacherAssignment(id: string) {
  const session = await getSession()
  if (!session) redirect('/signin')
  if (needsOnboarding(session.user)) redirect('/signin')
  const [a] = await getDb().select().from(assignments).where(eq(assignments.id, id)).limit(1)
  if (!a || a.deletedAt || !can(session.user, 'assignment:read', { teacherId: a.teacherId })) notFound()
  return { session, a }
}

export const shareUrl = (slug: string) => `${(process.env.PUBLIC_ORIGIN ?? 'https://ikhimi.kr').replace(/\/$/, '')}/t/${slug}`
