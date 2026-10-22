import { NextResponse } from 'next/server'
import { getDb } from '@ikhimi/db'
import { env } from '@/server/env'
import { handOff, helpRequest, helpTeacher } from '@/server/help'
import { HttpError, requireSession, route } from '@/server/request'
import { getSupportBot } from '@/server/telegram'

/** "Send to the team": the help chat's conversation goes to the support admin chat in Telegram (DECISIONS.md BN). */
export const POST = route(async (req) => {
  const { user } = await requireSession()
  if (user.role !== 'teacher') throw new HttpError(403, 'teachers_only')
  const input = helpRequest.parse(await req.json())
  const teacher = await helpTeacher(getDb(), user.id)
  if (!teacher) throw new HttpError(404, 'not_found')
  try {
    const r = await handOff(getDb(), teacher, input, { bot: getSupportBot(), adminChatId: env().SUPPORT_ADMIN_CHAT_ID })
    if (!r.ok) throw new HttpError(r.reason === 'limit' ? 429 : 503, r.reason === 'limit' ? 'handoff_limit' : 'support_unavailable', r.limit ? { limit: r.limit } : {})
    return NextResponse.json(r)
  } catch (e) {
    if (e instanceof HttpError) throw e
    console.warn('[help] handoff failed', e)
    throw new HttpError(503, 'support_unavailable')
  }
})
