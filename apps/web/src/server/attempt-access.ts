import { attempts, eq, getDb } from '@ikhimi/db'
import { authorize, type Actor } from './policy'
import { HttpError } from './request'

export async function ownAttempt(user: Actor, id: string) {
  const [at] = await getDb().select().from(attempts).where(eq(attempts.id, id)).limit(1)
  if (!at) throw new HttpError(404, 'not_found')
  authorize(user, 'attempt:write', { studentId: at.studentId })
  return at
}
