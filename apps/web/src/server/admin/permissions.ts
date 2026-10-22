/**
 * What staff can be allowed to do in the admin panel (/admin). The owner (OWNER_EMAILS) has every permission
 * and is the only one who manages staff and roles; assistants get a role, which is a set of these.
 * Pure data, shared by the server and the role editor.
 */
export const PERMISSIONS = [
  /** Generations, failures, speed, pictures, AI cost */
  'health',
  /** Users, homework and activity numbers */
  'business',
  /** Payments and revenue */
  'money',
  /** Search users and see their activity (emails masked) */
  'users.view',
  /** Reveal a full email address (each reveal is logged) */
  'users.email',
  /** Block / unblock, daily limits, free course access */
  'users.manage',
  /** Open a homework: exercises, answer keys, pictures, student results (each opening is logged) */
  'content',
  /** Read the staff action log */
  'audit',
] as const
export type Permission = (typeof PERMISSIONS)[number]

export const isPermission = (p: string): p is Permission => (PERMISSIONS as readonly string[]).includes(p)

/** j•••@gmail.com: enough to recognise someone, not enough to write to them */
export function maskForStaff(email: string | null, phone: string): string {
  if (!email) return phone.startsWith('apple:') ? 'Apple ID' : '—'
  const at = email.lastIndexOf('@')
  return at < 1 ? '•••' : `${email[0]}•••${email.slice(at)}`
}
