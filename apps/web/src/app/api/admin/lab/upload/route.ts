import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb } from '@ikhimi/db'
import { apiStaff } from '@/server/admin/guard'
import { startLabUpload } from '@/server/lab-uploads'
import { getGeminiFiles } from '@/server/llm'
import { HttpError, route } from '@/server/request'

const body = z.object({ filename: z.string().max(500), mimeType: z.string().max(120), bytes: z.number().int().positive() })

/** A whole book for the Lab (up to 100 MB): starts its upload to the Gemini Files API (lab-uploads.ts) */
export const POST = route(async (req) => {
  const db = getDb()
  const { session } = await apiStaff(db, 'staff')
  const files = getGeminiFiles()
  if (!files) throw new HttpError(503, 'ai_not_configured')
  const r = await startLabUpload(db, files, { ownerId: session.user.id, ...body.parse(await req.json()) })
  if (!r.ok) throw new HttpError(r.reason === 'file_too_large' ? 413 : 415, r.reason, r.reason === 'file_too_large' ? { maxMb: 100 } : {})
  return NextResponse.json({ id: r.id })
})
