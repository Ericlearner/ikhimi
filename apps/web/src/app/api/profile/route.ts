import { NextResponse } from 'next/server'
import { z } from 'zod'
import { SUBJECTS } from '@ikhimi/ai/exams'
import { eq, getDb, sql, teacherProfiles, users } from '@ikhimi/db'
import { requireSession, route } from '@/server/request'


const body = z.object({
  fullName: z.string().trim().min(2).max(80).optional(),
  prefs: z
    .object({
      theme: z.enum(['system', 'light', 'dark']).optional(),
      sound: z.enum(['off', 'quiet', 'normal']).optional(),
      soundPack: z.enum(['arcade', 'rubber', 'glass', 'soft', 'organic', 'zen']).optional(),
      generationChime: z.boolean().optional(),
      motion: z.enum(['system', 'reduce', 'full']).optional(),
      textSize: z.enum(['normal', 'large', 'larger']).optional(),
      notifications: z.record(z.enum(['newAssignment', 'dueSoon', 'graded', 'digest']), z.boolean()).optional(),
    })
    .optional(),
  teacher: z
    .object({
      schoolName: z.string().trim().max(120).nullable().optional(),
      subjects: z.array(z.enum(SUBJECTS)).max(5).optional(),
      defaultCefrLevel: z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']).nullable().optional(),
      teachingDefaults: z
        .object({
          difficulty: z.number().int().min(1).max(5).optional(),
          minutes: z.number().int().min(5).max(90).optional(),
          showAnswersAfter: z.enum(['submit', 'never']).optional(),
          strictness: z.enum(['lenient', 'standard', 'strict']).optional(),
          typoTolerance: z.boolean().optional(),
        })
        .optional(),
    })
    .optional(),
})

/** Inline autosave for every profile field (design spec §12): partial updates, no Save button. */
export const PATCH = route(async (req) => {
  const { user } = await requireSession()
  const input = body.parse(await req.json())
  const db = getDb()
  if (input.fullName || input.prefs) {
    await db
      .update(users)
      .set({
        ...(input.fullName && { fullName: input.fullName }),
        // Merge prefs server-side so concurrent toggles from two tabs don't clobber each other
        ...(input.prefs && { prefs: sql`${users.prefs} || ${JSON.stringify(input.prefs)}::jsonb` }),
      })
      .where(eq(users.id, user.id))
  }
  if (input.teacher && user.roles.includes('teacher')) {
    const { teachingDefaults, ...rest } = input.teacher
    await db
      .update(teacherProfiles)
      .set({
        ...rest,
        ...(teachingDefaults && { teachingDefaults: sql`${teacherProfiles.teachingDefaults} || ${JSON.stringify(teachingDefaults)}::jsonb` }),
      })
      .where(eq(teacherProfiles.userId, user.id))
  }
  return NextResponse.json({ ok: true })
})
