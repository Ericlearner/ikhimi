import { assignments, eq, exercises, getDb } from '@ikhimi/db'
import { authorize, type Actor } from './policy'
import { HttpError } from './request'

export async function ownedAssignment(user: Actor, id: string) {
  const [a] = await getDb().select().from(assignments).where(eq(assignments.id, id)).limit(1)
  if (!a || a.deletedAt) throw new HttpError(404, 'not_found')
  authorize(user, 'assignment:update', { teacherId: a.teacherId })
  return a
}

/** Exercises are editable only while the assignment is a draft — grading must not shift under students. */
export async function editableExercise(user: Actor, assignmentId: string, exId: string) {
  const a = await ownedAssignment(user, assignmentId)
  if (a.status !== 'draft') throw new HttpError(409, 'already_published')
  const [ex] = await getDb().select().from(exercises).where(eq(exercises.id, exId)).limit(1)
  if (!ex || ex.assignmentId !== a.id) throw new HttpError(404, 'not_found')
  return { a, ex }
}
