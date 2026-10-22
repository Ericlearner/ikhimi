import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb } from '@ikhimi/db'
import { LlmError, type InstructionLocale } from '@ikhimi/ai'
import { applyAnswerPages } from '@/server/answer-pages'
import { ownedAssignment } from '@/server/assignment-access'
import { getMeteredLlm } from '@/server/llm'
import { MaterialError } from '@/server/materials'
import { HttpError, requireSession, route } from '@/server/request'

// The model reads a few answer pages
export const maxDuration = 120

const body = z.object({
  materialIds: z.array(z.string().max(40)).min(1).max(8),
  /** Which pages of an answer PDF, e.g. "142-143" */
  pdfPages: z.string().max(40).optional(),
})

/** A copied draft's answers from the book's answer pages, added after copying (DECISIONS.md BM). */
export const POST = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const { user } = await requireSession()
  const a = await ownedAssignment(user, (await ctx.params).id)
  if (a.status !== 'draft') throw new HttpError(409, 'already_published')
  const input = body.parse(await req.json())
  const llm = getMeteredLlm({ userId: user.id, purpose: 'answers', refId: a.id })
  if (!llm) throw new HttpError(503, 'ai_not_configured')
  try {
    return NextResponse.json(await applyAnswerPages(getDb(), llm, a, { ...input, instructionLocale: a.instructionLocale as InstructionLocale }))
  } catch (e) {
    if (e instanceof MaterialError) {
      const code = e.code === 'too_many_pages' || e.code === 'pdf_pages' ? `answers_${e.code}` : e.code
      return NextResponse.json({ error: code, n: e.n }, { status: 422 })
    }
    if (e instanceof LlmError) throw new HttpError(503, e.code === 'config' ? 'ai_rejected' : 'ai_busy')
    throw e
  }
})
