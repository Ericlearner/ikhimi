import { NextResponse } from 'next/server'
import { z } from 'zod'
import { and, eq, getDb, isNull, staffMembers, staffRoles } from '@ikhimi/db'
import { normalizePhone } from '@ikhimi/i18n'
import { apiStaff } from '@/server/admin/guard'
import { PERMISSIONS } from '@/server/admin/permissions'
import { audit, ownerPhones } from '@/server/admin/staff'
import { HttpError, route } from '@/server/request'

const perms = z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length)
const body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create_role'), name: z.string().trim().min(1).max(60), permissions: perms }),
  z.object({ action: z.literal('update_role'), id: z.string().max(40), name: z.string().trim().min(1).max(60), permissions: perms }),
  z.object({ action: z.literal('delete_role'), id: z.string().max(40) }),
  z.object({ action: z.literal('add_member'), phone: z.string().max(40), name: z.string().trim().max(80).default(''), roleId: z.string().max(40) }),
  z.object({ action: z.literal('update_member'), id: z.string().max(40), roleId: z.string().max(40) }),
  z.object({ action: z.literal('remove_member'), id: z.string().max(40) }),
])

/** Roles and assistants. Only an owner (OWNER_PHONES) manages staff, so nobody can give themselves more. */
export const POST = route(async (req) => {
  const db = getDb()
  const { session } = await apiStaff(db, 'staff')
  const input = body.parse(await req.json())
  const log = (target: { type: string; id: string }, details: Record<string, unknown> = {}) => audit(db, session.user.id, `staff.${input.action}`, target, details)
  const role = async (id: string) => {
    const [r] = await db.select().from(staffRoles).where(eq(staffRoles.id, id)).limit(1)
    if (!r) throw new HttpError(404, 'role_not_found')
    return r
  }

  switch (input.action) {
    case 'create_role': {
      const [r] = await db.insert(staffRoles).values({ name: input.name, permissions: [...new Set(input.permissions)] }).returning()
      await log({ type: 'role', id: r!.id }, { name: input.name, permissions: input.permissions })
      return NextResponse.json({ ok: true, id: r!.id })
    }
    case 'update_role':
      await role(input.id)
      await db.update(staffRoles).set({ name: input.name, permissions: [...new Set(input.permissions)] }).where(eq(staffRoles.id, input.id))
      await log({ type: 'role', id: input.id }, { name: input.name, permissions: input.permissions })
      break
    case 'delete_role': {
      const r = await role(input.id)
      const [used] = await db.select({ id: staffMembers.id }).from(staffMembers).where(and(eq(staffMembers.roleId, input.id), isNull(staffMembers.revokedAt))).limit(1)
      if (used) throw new HttpError(409, 'role_in_use')
      // Assistants removed earlier still point at it; their history lives on in the action log
      await db.delete(staffMembers).where(eq(staffMembers.roleId, input.id))
      await db.delete(staffRoles).where(eq(staffRoles.id, input.id))
      await log({ type: 'role', id: input.id }, { name: r.name })
      break
    }
    case 'add_member': {
      const phone = normalizePhone(input.phone, 'UZ')
      if (!phone) throw new HttpError(400, 'phone_invalid')
      if (ownerPhones().includes(phone)) throw new HttpError(409, 'already_owner')
      await role(input.roleId)
      const [existing] = await db.select().from(staffMembers).where(eq(staffMembers.phone, phone)).limit(1)
      // Re-adding someone who was removed brings the same row back with the new role
      const [m] = existing
        ? await db.update(staffMembers).set({ roleId: input.roleId, name: input.name || existing.name, revokedAt: null, addedBy: session.user.id }).where(eq(staffMembers.id, existing.id)).returning()
        : await db.insert(staffMembers).values({ phone, name: input.name || null, roleId: input.roleId, addedBy: session.user.id }).returning()
      await log({ type: 'staff', id: m!.id }, { phone, roleId: input.roleId })
      return NextResponse.json({ ok: true, id: m!.id })
    }
    case 'update_member':
      await role(input.roleId)
      await db.update(staffMembers).set({ roleId: input.roleId }).where(eq(staffMembers.id, input.id))
      await log({ type: 'staff', id: input.id }, { roleId: input.roleId })
      break
    case 'remove_member':
      await db.update(staffMembers).set({ revokedAt: new Date() }).where(eq(staffMembers.id, input.id))
      await log({ type: 'staff', id: input.id })
      break
  }
  return NextResponse.json({ ok: true })
})
