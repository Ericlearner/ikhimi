import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb } from '@ikhimi/db'
import { LlmError, type InstructionLocale } from '@ikhimi/ai'
import { ownedAssignment } from '@/server/assignment-access'
import { attachAudio, detachAudio } from '@/server/listening'
import { getMeteredLlm } from '@/server/llm'
import { HttpError, requireSession, route } from '@/server/request'

// The model listens to the whole recording
export const maxDuration = 120

const body = z.object({
  materialId: z.string().max(40),
  exerciseIds: z.array(z.string().max(40)).max(40).optional(),
  /** Attach it although the AI said it doesn't fit: no listening, the answers stay marked for checking */
  force: z.boolean().optional(),
})

/** Attach a recording to listening exercises: matched by file name (or chosen), checked and keyed by the AI. */
export const POST = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const { user } = await requireSession()
  const a = await ownedAssignment(user, (await ctx.params).id)
  if (a.status !== 'draft') throw new HttpError(409, 'already_published')
  const input = body.parse(await req.json())
  const llm = input.force ? null : getMeteredLlm({ userId: user.id, purpose: 'listening', refId: a.id })
  if (!input.force && !llm) throw new HttpError(503, 'ai_not_configured')
  try {
    const r = await attachAudio(getDb(), llm, a, { ...input, instructionLocale: a.instructionLocale as InstructionLocale })
    if (r.ok) return NextResponse.json(r)
    if (r.code === 'no_match') return NextResponse.json({ error: 'audio_no_match', waiting: r.waiting }, { status: 409 })
    if (r.code === 'mismatch') return NextResponse.json({ error: 'audio_mismatch', reason: r.reason, exerciseIds: r.exerciseIds }, { status: 422 })
    throw new HttpError(415, 'file_type')
  } catch (e) {
    if (e instanceof LlmError) throw new HttpError(503, e.code === 'config' ? 'ai_rejected' : 'ai_busy')
    throw e
  }
})

/** Detach the recording from an exercise (and every item sharing it). */
export const DELETE = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const { user } = await requireSession()
  const a = await ownedAssignment(user, (await ctx.params).id)
  if (a.status !== 'draft') throw new HttpError(409, 'already_published')
  const exerciseId = new URL(req.url).searchParams.get('exerciseId')
  if (!exerciseId) throw new HttpError(400, 'bad_request')
  await detachAudio(getDb(), a, exerciseId)
  return NextResponse.json({ ok: true })
})
