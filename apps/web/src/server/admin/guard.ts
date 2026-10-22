/** Guards for admin pages and API routes (rules in staff.ts) */
import 'server-only'
import { notFound, redirect } from 'next/navigation'
import type { Db } from '@ikhimi/db'
import { HttpError, getSession } from '../request'
import type { Permission } from './permissions'
import { can, isFresh, staffAccess } from './staff'

/**
 * For admin pages. Not staff: the panel doesn't exist (404). Staff with an old sign-in: sent to sign in again.
 * Missing the permission: 404 too, so the page doesn't reveal what exists.
 */
export async function pageStaff(db: Db, need?: Permission | 'staff') {
  const session = await getSession()
  if (!session) notFound()
  const access = await staffAccess(db, session.user)
  if (!access) notFound()
  if (!isFresh(session)) redirect('/admin/verify')
  if (need && !can(access, need)) notFound()
  return { session, access }
}

/** For admin API routes: same rules, as HTTP errors */
export async function apiStaff(db: Db, need: Permission | 'staff') {
  const session = await getSession()
  if (!session) throw new HttpError(401, 'unauthorized')
  const access = await staffAccess(db, session.user)
  if (!access || !can(access, need)) throw new HttpError(404, 'not_found')
  if (!isFresh(session)) throw new HttpError(401, 'reauth')
  return { session, access }
}

