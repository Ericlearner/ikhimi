import { NextResponse } from 'next/server'
import { getDb } from '@ikhimi/db'
import { askHelp, helpRequest, helpTeacher } from '@/server/help'
import { getMeteredLlm } from '@/server/llm'
import { getPricing } from '@/server/pricing'
import { getLocale, HttpError, requireSession, route } from '@/server/request'
import { isStoreApp } from '@/server/store-app'

export const maxDuration = 30

/** The teachers' help chat: one question about using 익히미, answered from the guide (DECISIONS.md BN). */
export const POST = route(async (req) => {
  const { user } = await requireSession()
  if (user.role !== 'teacher') throw new HttpError(403, 'teachers_only')
  const input = helpRequest.parse(await req.json())
  const llm = getMeteredLlm({ userId: user.id, purpose: 'help' })
  if (!llm) throw new HttpError(503, 'ai_not_configured')
  const teacher = await helpTeacher(getDb(), user.id)
  if (!teacher) throw new HttpError(404, 'not_found')
  try {
    const r = await askHelp(getDb(), teacher, { ...input, locale: await getLocale(), prices: await getPricing(getDb()), store: await isStoreApp() }, llm)
    if (!r.ok) throw new HttpError(429, 'help_limit', { limit: r.limit })
    return NextResponse.json(r)
  } catch (e) {
    if (e instanceof HttpError) throw e
    console.warn('[help] answer failed', e)
    throw new HttpError(503, 'ai_busy')
  }
})
