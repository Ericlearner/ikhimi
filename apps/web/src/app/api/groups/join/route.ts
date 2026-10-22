import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb } from '@ikhimi/db'
import { joinGroupByCode } from '@/server/groups'
import { HttpError, requireSession, route } from '@/server/request'

const body = z.object({ code: z.string().max(20) })

const STATUS = { invalid_code: 400, code_not_found: 404, own_group: 409, removed: 403 } as const

/** A student joins a group with its code (My work) */
export const POST = route(async (req) => {
  const { user } = await requireSession()
  const { code } = body.parse(await req.json())
  const r = await joinGroupByCode(getDb(), user.id, code)
  if (!r.ok) throw new HttpError(STATUS[r.reason], r.reason)
  return NextResponse.json({ ok: true, already: r.already, group: r.group })
})
