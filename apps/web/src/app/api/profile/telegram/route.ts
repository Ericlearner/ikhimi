import { NextResponse } from 'next/server'
import { eq, getDb, users } from '@ikhimi/db'
import { requireSession, route } from '@/server/request'

/** Unlink Telegram (it re-links automatically on the next Telegram login). */
export const DELETE = route(async () => {
  const { user } = await requireSession()
  await getDb().update(users).set({ telegramChatId: null }).where(eq(users.id, user.id))
  return NextResponse.json({ ok: true })
})
