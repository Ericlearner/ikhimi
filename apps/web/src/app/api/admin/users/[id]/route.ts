import { NextResponse } from 'next/server'
import { z } from 'zod'
import { and, eq, getDb, planPackages, sessions, subscriptions, teacherProfiles, users } from '@ikhimi/db'
import { courseBySlug } from '@/server/courses'
import { giveVipGift, grantPlan } from '@/server/plans'
import { apiStaff } from '@/server/admin/guard'
import { audit, ownerPhones } from '@/server/admin/staff'
import { HttpError, route } from '@/server/request'

const body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('block'), reason: z.string().trim().max(300).default('') }),
  z.object({ action: z.literal('unblock') }),
  z.object({ action: z.literal('reset_cap') }),
  /** null = back to the default limit */
  z.object({ action: z.literal('set_cap'), cap: z.number().int().min(0).max(500).nullable() }),
  z.object({ action: z.literal('reveal_phone') }),
  z.object({ action: z.literal('grant_course'), courseSlug: z.string().trim().min(1).max(120) }),
  z.object({ action: z.literal('revoke_subscription'), subscriptionId: z.string().max(40) }),
  /** A student plan for some days (after a running one of the same kind); plan null takes staff-given plans back */
  z.object({ action: z.literal('set_plan'), plan: z.enum(['pro', 'vip']).nullable(), days: z.number().int().min(1).max(366).default(30) }),
  /** A free package for a teacher: places for the students of a class they pick */
  /** Correct which sides the account has (e.g. a student the old sign-in made a teacher); at least one */
  z.object({ action: z.literal('set_roles'), roles: z.array(z.enum(['teacher', 'student'])).min(1).max(2) }),
  z.object({ action: z.literal('grant_package'), plan: z.enum(['pro', 'vip']), seats: z.number().int().min(1).max(500), days: z.number().int().min(1).max(366) }),
])

/** Staff actions on one user. Every action is checked against the staff member's role and written to the log. */
export const POST = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const db = getDb()
  const input = body.parse(await req.json())
  const { session } = await apiStaff(db, input.action === 'reveal_phone' ? 'users.phone' : 'users.manage')
  const id = (await ctx.params).id
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1)
  if (!user) throw new HttpError(404, 'not_found')
  const log = (details: Record<string, unknown> = {}) => audit(db, session.user.id, `user.${input.action}`, { type: 'user', id }, details)

  switch (input.action) {
    case 'reveal_phone':
      await log()
      return NextResponse.json({ phone: user.phone })
    case 'block':
      // Nobody blocks an owner or themselves
      if (user.id === session.user.id || ownerPhones().includes(user.phone)) throw new HttpError(403, 'forbidden')
      await db.update(users).set({ blockedAt: new Date(), blockedReason: input.reason || null }).where(eq(users.id, id))
      await db.delete(sessions).where(eq(sessions.userId, id))
      await log({ reason: input.reason })
      break
    case 'unblock':
      await db.update(users).set({ blockedAt: null, blockedReason: null }).where(eq(users.id, id))
      await log()
      break
    case 'reset_cap':
    case 'set_cap': {
      const [p] = await db.select().from(teacherProfiles).where(eq(teacherProfiles.userId, id)).limit(1)
      if (!p) throw new HttpError(409, 'not_teacher')
      const set = input.action === 'reset_cap' ? { capResetAt: new Date() } : { dailyCap: input.cap }
      await db.update(teacherProfiles).set(set).where(eq(teacherProfiles.userId, id))
      await log(input.action === 'set_cap' ? { cap: input.cap } : {})
      break
    }
    case 'grant_course': {
      const c = await courseBySlug(db, input.courseSlug)
      if (!c) throw new HttpError(404, 'course_not_found')
      const [has] = await db
        .select({ id: subscriptions.id })
        .from(subscriptions)
        .where(and(eq(subscriptions.studentId, id), eq(subscriptions.courseId, c.id), eq(subscriptions.status, 'active')))
        .limit(1)
      if (!has) await db.insert(subscriptions).values({ studentId: id, courseId: c.id, plan: 'staff_grant', status: 'active', priceKrw: 0, periodStart: new Date() })
      await log({ course: c.slug, title: c.title })
      break
    }
    case 'set_plan': {
      // Owners may give themselves a plan (to test it); other staff only give plans to others
      if (user.id === session.user.id && !ownerPhones().includes(session.user.phone)) throw new HttpError(403, 'forbidden')
      const until = await grantPlan(db, id, input.plan, input.days)
      await log({ plan: input.plan, days: input.days, until: until?.toISOString() ?? null })
      break
    }
    case 'grant_package': {
      if (user.id === session.user.id && !ownerPhones().includes(session.user.phone)) throw new HttpError(403, 'forbidden')
      const [p] = await db.select().from(teacherProfiles).where(eq(teacherProfiles.userId, id)).limit(1)
      if (!p) throw new HttpError(409, 'not_teacher')
      const now = new Date()
      const periodEnd = new Date(now.getTime() + input.days * 86_400_000)
      await db.insert(planPackages).values({ teacherId: id, plan: input.plan, seats: input.seats, months: Math.max(1, Math.round(input.days / 30)), status: 'active', priceKrw: 0, periodStart: now, periodEnd })
      await log({ plan: input.plan, seats: input.seats, days: input.days })
      break
    }
    case 'set_roles': {
      const before = user.roles.length ? user.roles : [user.role]
      const roles = [...new Set(input.roles)]
      // Staff and owners aren't roles here: an admin account keeps 'admin'
      const next = [...roles, ...before.filter((r) => r === 'admin')]
      const primary = roles.includes(user.role as 'teacher' | 'student') ? user.role : roles[0]!
      await db.update(users).set({ roles: next, role: primary }).where(eq(users.id, id))
      // A side added here works like one added by the person (teacher profile; a new student's welcome gift)
      if (roles.includes('teacher')) await db.insert(teacherProfiles).values({ userId: id }).onConflictDoNothing()
      if (roles.includes('student') && !before.includes('student')) await giveVipGift(db, id)
      // Open sessions of a removed side fall back to the account's first role (session.ts)
      await log({ before, after: next })
      break
    }
    case 'revoke_subscription': {
      const [s] = await db.select().from(subscriptions).where(and(eq(subscriptions.id, input.subscriptionId), eq(subscriptions.studentId, id))).limit(1)
      if (!s) throw new HttpError(404, 'not_found')
      // Only free access given by staff is taken back here; paid ones go through the payment provider
      if (s.plan !== 'staff_grant') throw new HttpError(409, 'paid_subscription')
      await db.update(subscriptions).set({ status: 'cancelled' }).where(eq(subscriptions.id, s.id))
      await log({ subscriptionId: s.id })
      break
    }
  }
  return NextResponse.json({ ok: true })
})
