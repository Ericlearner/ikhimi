import { describe, expect, it } from 'vitest'
import { authorize, can, ForbiddenError, type Actor } from './policy'

const teacherA: Actor = { id: 'tA', role: 'teacher' }
const teacherB: Actor = { id: 'tB', role: 'teacher' }
const student1: Actor = { id: 's1', role: 'student' }
const student2: Actor = { id: 's2', role: 'student' }

describe('policy', () => {
  it("privacy: a student's results are visible to self, their groups' teachers and a guardian only (§12)", () => {
    const r = { studentId: 's1', teacherIdsOfEnrolledGroups: ['tA'], guardianUserId: 'g1' }
    expect(can(student1, 'results:read', r)).toBe(true)
    expect(can(teacherA, 'results:read', r)).toBe(true)
    expect(can({ id: 'g1', role: 'student' }, 'results:read', r)).toBe(true)
    expect(can(student2, 'results:read', r)).toBe(false) // classmates never see each other
    expect(can(teacherB, 'results:read', r)).toBe(false) // other teachers neither
    expect(can({ id: 'tA', role: 'student' }, 'results:read', r)).toBe(false) // active role matters, not the account
    expect(can(null, 'results:read', r)).toBe(false)
  })

  it('anonymous can do nothing', () => {
    expect(can(null, 'material:create', null)).toBe(false)
    expect(() => authorize(null, 'group:create', null)).toThrow(ForbiddenError)
  })

  it('only teachers create materials and groups', () => {
    expect(can(teacherA, 'material:create', null)).toBe(true)
    expect(can(student1, 'material:create', null)).toBe(false)
    expect(can(student1, 'group:create', null)).toBe(false)
  })

  it('a teacher touches only her own materials and groups', () => {
    expect(can(teacherA, 'material:update', { teacherId: 'tA' })).toBe(true)
    expect(can(teacherB, 'material:update', { teacherId: 'tA' })).toBe(false)
    expect(can(teacherB, 'material:read', { teacherId: 'tA' })).toBe(false)
    expect(can(teacherB, 'group:update', { teacherId: 'tA' })).toBe(false)
  })

  it('enrolled students can read their group, others cannot', () => {
    const g = { teacherId: 'tA', enrolledStudentIds: ['s1'] }
    expect(can(student1, 'group:read', g)).toBe(true)
    expect(can(student2, 'group:read', g)).toBe(false)
    expect(can(teacherB, 'group:read', g)).toBe(false)
  })

  it('a student touches only her own attempts; the owning teacher can read them', () => {
    expect(can(student1, 'attempt:write', { studentId: 's1' })).toBe(true)
    expect(can(student2, 'attempt:write', { studentId: 's1' })).toBe(false)
    expect(can(teacherA, 'attempt:write', { studentId: 's1' })).toBe(false)
    expect(can(teacherB, 'assignment:update', { teacherId: 'tA' })).toBe(false)
    expect(can(teacherA, 'assignment:update', { teacherId: 'tA' })).toBe(true)
    expect(can(student1, 'assignment:read', { teacherId: 'tA' })).toBe(false)
    expect(can(teacherA, 'attempt:read', { studentId: 's1', teacherId: 'tA' })).toBe(true)
    expect(can(teacherB, 'attempt:read', { studentId: 's1', teacherId: 'tA' })).toBe(false)
    expect(can(student2, 'attempt:read', { studentId: 's1', teacherId: 'tA' })).toBe(false)
  })
})
