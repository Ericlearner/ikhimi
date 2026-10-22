import { after, NextResponse } from 'next/server'
import { eq, getDb, users } from '@ikhimi/db'
import { formatKrw } from '@ikhimi/i18n'
import { isPaid, ownedCourse, submitCourse } from '@/server/courses'
import { tellOwner } from '@/server/notify'
import { HttpError, requireSession, route } from '@/server/request'

/** The teacher sends a course for the admin's approval (DECISIONS.md BL); the owner hears it (server/notify.ts tellOwner) */
export const POST = route(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const { user } = await requireSession()
  const db = getDb()
  const c = await ownedCourse(db, user.id, (await ctx.params).id)
  if (!c) throw new HttpError(404, 'not_found')
  const r = await submitCourse(db, c)
  if (!r.ok) throw new HttpError(409, r.reason)
  after(async () => {
    const [t] = await getDb().select({ name: users.fullName }).from(users).where(eq(users.id, c.teacherId)).limit(1)
    const price = isPaid(c) ? formatKrw(c.priceKrw!, '원') : '요금제 기준'
    await tellOwner(getDb(), `course:${c.id}:${Date.now()}`, `📚 승인 대기 중인 강좌: “${c.title}” — ${t?.name ?? '—'}, 수업 ${c.lessonCount}개, ${price}.\n관리자 → 강좌`)
  })
  return NextResponse.json({ ok: true })
})
