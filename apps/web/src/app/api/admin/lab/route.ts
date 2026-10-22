import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb } from '@ikhimi/db'
import { LAB_LIMITS, LANGUAGE_CODES, type LanguageCode } from '@ikhimi/ai'
import { apiStaff } from '@/server/admin/guard'
import { audit } from '@/server/admin/staff'
import { createOwn, deleteOwn, labDecide, labRemovePoint, labRemoveTask, labUndo, updateOwn } from '@/server/lab'
import { HttpError, route } from '@/server/request'

const own = {
  name: z.string().trim().min(1).max(80),
  language: z.enum(LANGUAGE_CODES as [LanguageCode, ...LanguageCode[]]),
  levels: z.array(z.string().max(20)).max(12),
  about: z.string().max(3000),
  visible: z.boolean(),
}

const body = z.discriminatedUnion('action', [
  /** A proposal from the chat: apply the ticked changes, or dismiss it */
  z.object({ action: z.literal('apply'), messageId: z.string().max(40), pick: z.array(z.number().int().min(0).max(LAB_LIMITS.ops)).max(LAB_LIMITS.ops) }),
  z.object({ action: z.literal('dismiss'), messageId: z.string().max(40) }),
  /** The knowledge by hand: remove one point, or undo the newest change */
  z.object({ action: z.literal('remove'), methodologyId: z.string().max(40), pointId: z.string().max(12) }),
  z.object({ action: z.literal('removeTask'), methodologyId: z.string().max(40), taskId: z.string().max(12) }),
  z.object({ action: z.literal('undo'), methodologyId: z.string().max(40) }),
  /** The owner's own methodologies */
  z.object({ action: z.literal('create'), ...own, visible: own.visible.default(false) }),
  z.object({ action: z.literal('update'), methodologyId: z.string().max(40), ...z.object(own).partial().shape }),
  z.object({ action: z.literal('delete'), methodologyId: z.string().max(40) }),
])

/** The owner's Lab: everything but the AI chat turn. Every change is logged. */
export const POST = route(async (req) => {
  const db = getDb()
  const { session } = await apiStaff(db, 'staff')
  const input = body.parse(await req.json())
  const by = session.user.id
  switch (input.action) {
    case 'apply':
    case 'dismiss': {
      const r = await labDecide(db, { ownerId: by, messageId: input.messageId, action: input.action, pick: input.action === 'apply' ? input.pick : [] })
      if (!r.ok) throw new HttpError(409, r.reason)
      await audit(db, by, `lab.${input.action}`, { type: 'lab_message', id: input.messageId }, input.action === 'apply' ? { added: r.added, updated: r.updated, removed: r.removed, tasks: r.tasks, sample: r.sample } : {})
      return NextResponse.json(r)
    }
    case 'remove': {
      if (!(await labRemovePoint(db, { ownerId: by, methodologyId: input.methodologyId, pointId: input.pointId }))) throw new HttpError(404, 'not_found')
      await audit(db, by, 'lab.remove', { type: 'methodology', id: input.methodologyId }, { point: input.pointId })
      return NextResponse.json({ ok: true })
    }
    case 'removeTask': {
      if (!(await labRemoveTask(db, { ownerId: by, methodologyId: input.methodologyId, taskId: input.taskId }))) throw new HttpError(404, 'not_found')
      await audit(db, by, 'lab.removeTask', { type: 'methodology', id: input.methodologyId }, { task: input.taskId })
      return NextResponse.json({ ok: true })
    }
    case 'undo': {
      if (!(await labUndo(db, input.methodologyId))) throw new HttpError(409, 'nothing_to_undo')
      await audit(db, by, 'lab.undo', { type: 'methodology', id: input.methodologyId })
      return NextResponse.json({ ok: true })
    }
    case 'create': {
      const id = await createOwn(db, input)
      await audit(db, by, 'lab.create', { type: 'methodology', id }, { name: input.name, language: input.language })
      return NextResponse.json({ ok: true, id })
    }
    case 'update': {
      const { action: _a, methodologyId, ...fields } = input
      if (!(await updateOwn(db, methodologyId, fields))) throw new HttpError(404, 'not_found')
      await audit(db, by, 'lab.update', { type: 'methodology', id: methodologyId }, { fields: Object.keys(fields) })
      return NextResponse.json({ ok: true })
    }
    case 'delete': {
      if (!(await deleteOwn(db, input.methodologyId))) throw new HttpError(404, 'not_found')
      await audit(db, by, 'lab.delete', { type: 'methodology', id: input.methodologyId })
      return NextResponse.json({ ok: true })
    }
  }
})
