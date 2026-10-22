/**
 * What staff can be allowed to do in the admin panel (/admin). The owner (OWNER_PHONES) has every permission
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
  /** Search users and see their activity (phone numbers masked) */
  'users.view',
  /** Reveal a full phone number (each reveal is logged) */
  'users.phone',
  /** Block / unblock, daily limits, free course access */
  'users.manage',
  /** Open a homework: exercises, answer keys, pictures, student results (each opening is logged) */
  'content',
  /** Read the staff action log */
  'audit',
] as const
export type Permission = (typeof PERMISSIONS)[number]

export const isPermission = (p: string): p is Permission => (PERMISSIONS as readonly string[]).includes(p)

/** 010-••••-5678: enough to recognise a number, not enough to call it */
export function maskForStaff(phone: string): string {
  if (phone.startsWith('apple:')) return 'Apple ID'
  if (phone.startsWith('google:')) return 'Google'
  const d = phone.replace(/[^\d+]/g, '')
  if (d.length < 8) return '•••'
  const kr = /^\+82(1\d)\d{3,4}(\d{4})$/.exec(d)
  if (kr) return `0${kr[1]}-••••-${kr[2]}`
  return `${d.slice(0, 3)} ${d.slice(3, 5)} ••• ${d.slice(-4, -2)} ${d.slice(-2)}`
}
