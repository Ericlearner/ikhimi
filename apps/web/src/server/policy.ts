/**
 * Authorization policy (§16). Every route asks `authorize()`; handlers never hand-roll checks.
 * Rules are pure functions of (actor, action, resource) so they are exhaustively testable.
 */
export type Actor = { id: string; role: 'teacher' | 'student' | 'admin' }

type Resources = {
  'material:create': null
  'material:read': { teacherId: string }
  'material:update': { teacherId: string }
  'group:create': null
  'group:read': { teacherId: string; enrolledStudentIds?: string[] }
  'group:update': { teacherId: string }
  'assignment:read': { teacherId: string }
  'assignment:update': { teacherId: string }
  'attempt:read': { studentId: string; teacherId: string }
  'attempt:write': { studentId: string }
  /** A student's results: the student, teachers of groups they're enrolled in, a guardian. Nobody else. */
  'results:read': { studentId: string; teacherIdsOfEnrolledGroups: string[]; guardianUserId?: string | null }
}
export type Action = keyof Resources

const rules: { [A in Action]: (actor: Actor, r: Resources[A]) => boolean } = {
  'material:create': (a) => a.role === 'teacher',
  'material:read': (a, r) => a.role === 'teacher' && a.id === r.teacherId,
  'material:update': (a, r) => a.role === 'teacher' && a.id === r.teacherId,
  'group:create': (a) => a.role === 'teacher',
  'group:read': (a, r) => (a.role === 'teacher' && a.id === r.teacherId) || (r.enrolledStudentIds?.includes(a.id) ?? false),
  'group:update': (a, r) => a.role === 'teacher' && a.id === r.teacherId,
  'assignment:read': (a, r) => a.role === 'teacher' && a.id === r.teacherId,
  'assignment:update': (a, r) => a.role === 'teacher' && a.id === r.teacherId,
  'attempt:read': (a, r) => a.id === r.studentId || (a.role === 'teacher' && a.id === r.teacherId),
  // Anyone signed in may do homework from a link; only on their own attempt.
  'attempt:write': (a, r) => a.id === r.studentId,
  'results:read': (a, r) =>
    a.id === r.studentId ||
    (a.role === 'teacher' && r.teacherIdsOfEnrolledGroups.includes(a.id)) ||
    (!!r.guardianUserId && a.id === r.guardianUserId),
}

export class ForbiddenError extends Error {
  constructor(public readonly action: Action) {
    super(`Forbidden: ${action}`)
    this.name = 'ForbiddenError'
  }
}

export function can<A extends Action>(actor: Actor | null, action: A, resource: Resources[A]): boolean {
  if (!actor) return false
  return rules[action](actor, resource)
}

export function authorize<A extends Action>(actor: Actor | null, action: A, resource: Resources[A]): asserts actor is Actor {
  if (!can(actor, action, resource)) throw new ForbiddenError(action)
}
