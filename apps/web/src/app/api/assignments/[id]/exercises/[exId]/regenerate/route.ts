import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb } from '@ikhimi/db'
import { generateAssignment, LlmError, type GenerateInput, type InstructionLocale, type LanguageCode } from '@ikhimi/ai'
import { loadExercises, replaceExercise, toDraft } from '@/server/assignments'
import { editableExercise } from '@/server/assignment-access'
import { env } from '@/server/env'
import { getMeteredLlm } from '@/server/llm'
import { HttpError, requireSession, route } from '@/server/request'
import { attachSpeech, isSpoken, plannedWords, relisten } from '@/server/speech'

export const maxDuration = 120

const body = z.object({ hint: z.string().max(500).default('') })

/** ⟳ Regenerate one item (re-runs generate + verify for that item only, §8.1). */
export const POST = route(async (req, ctx: { params: Promise<{ id: string; exId: string }> }) => {
  const { user } = await requireSession()
  const { id, exId } = await ctx.params
  const { a, ex } = await editableExercise(user, id, exId)
  const { hint } = body.parse(await req.json().catch(() => ({})))
  const llm = getMeteredLlm({ userId: user.id, purpose: 'regenerate', refId: id })
  if (!llm) throw new HttpError(503, 'ai_not_configured')

  const db = getDb()
  const rows = await loadExercises(db, a.id)
  const index = rows.findIndex((r) => r.id === ex.id)
  try {
    const style = (a.generationMeta ?? {}) as Pick<GenerateInput, 'mode'> & { exam?: { id: string; level: string }; language?: LanguageCode }
    const { draft } = await generateAssignment(llm, {
      teacherText: '',
      materials: [],
      instructionLocale: a.instructionLocale as InstructionLocale,
      targetMinutes: 5,
      difficulty: (a.difficulty ?? 3) as 1 | 2 | 3 | 4 | 5,
      single: { previous: toDraft(a, rows), index, hint },
      knownNames: user.fullName ? [user.fullName] : [],
      // Keep a Create draft's exam style, so a new essay is graded on the same grid (digitize: unchanged)
      exam: style.mode === 'digitize' ? null : (style.exam ?? null),
      language: style.mode === 'digitize' ? null : (style.language ?? null),
      review: style.mode !== 'digitize' && env().AI_REVIEW === '1',
    })
    const replacement = draft.exercises[0]
    if (!replacement) throw new HttpError(502, 'generic')
    // A vocabulary "listen and choose" item stays one: its new word is spoken
    relisten([replacement], () => isSpoken(ex))
    const audioIds = await attachSpeech(db, { teacherId: user.id, refId: id, plan: plannedWords(a.generationMeta), locale: a.instructionLocale as InstructionLocale }, [replacement])
    await replaceExercise(db, ex, replacement, audioIds)
    return NextResponse.json({ ok: true })
  } catch (e) {
    if (e instanceof LlmError) throw new HttpError(503, e.code === 'config' ? 'ai_rejected' : 'ai_busy')
    throw e
  }
})
