import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb } from '@ikhimi/db'
import { LAB_LIMITS, LlmError } from '@ikhimi/ai'
import { apiStaff } from '@/server/admin/guard'
import { audit } from '@/server/admin/staff'
import { labSend } from '@/server/lab'
import { getGeminiFiles, getMeteredLlm } from '@/server/llm'
import { MaterialError } from '@/server/materials'
import { HttpError, route } from '@/server/request'

// Reading a long resource or a whole real test with the strongest model: one AI call
export const maxDuration = 300

const body = z.object({
  methodologyId: z.string().max(40),
  text: z.string().max(LAB_LIMITS.sourceChars).default(''),
  materialIds: z.array(z.string().max(40)).max(12).default([]),
  /** Whole books already uploaded to Google (lab-uploads.ts) */
  uploads: z.array(z.string().max(40)).max(5).default([]),
  /** The files are a real sample (a past test): the Lab lists its tasks, and applying counts it */
  sample: z.boolean().default(false),
})

/** The Lab chat: the owner's message or resource in, the AI's reply and proposed changes to the knowledge out */
export const POST = route(async (req) => {
  const db = getDb()
  const { session } = await apiStaff(db, 'staff')
  const input = body.parse(await req.json())
  if (!input.materialIds.length && !input.uploads.length && !input.text.trim()) throw new HttpError(400, 'empty')
  const llm = getMeteredLlm({ userId: session.user.id, purpose: 'methods' })
  if (!llm) throw new HttpError(503, 'ai_not_configured')
  try {
    const r = await labSend(db, llm, { ownerId: session.user.id, ...input }, { files: getGeminiFiles() })
    if (!r.ok) throw new HttpError(r.reason === 'not_found' ? 404 : 400, r.reason)
    await audit(db, session.user.id, 'lab.send', { type: 'methodology', id: input.methodologyId }, { files: input.materialIds.length, books: input.uploads.length, text: !!input.text.trim(), sample: input.sample, proposed: r.proposed })
    return NextResponse.json(r)
  } catch (e) {
    if (e instanceof MaterialError) throw new HttpError(400, e.code)
    // The Lab never falls back to a weaker model: busy means try again
    if (e instanceof LlmError && (e.code === 'rate_limited' || e.code === 'unavailable')) throw new HttpError(503, 'ai_busy')
    if (e instanceof LlmError && e.code === 'config') throw new HttpError(502, 'ai_rejected')
    throw e
  }
})
