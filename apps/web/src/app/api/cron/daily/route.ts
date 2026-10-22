import { getDb } from '@ikhimi/db'
import { alertOwner, claim, pruneNotificationLog, remindDueSoon } from '@/server/notify'
import { getBot } from '@/server/telegram'
import { remindCardReceipts } from '@/server/telegram/shop'
import { compressOldSpeech, storageUsage } from '@/server/storage-usage'
import { pruneLabUploads } from '@/server/lab-uploads'
import { getGeminiFiles } from '@/server/llm'
import { prunePasswordFailures } from '@/server/auth/password'
import { purgeDeletedAccounts } from '@/server/purge'
import { pruneAnswerFiles } from '@/server/materials'
import { pruneHelpQuestions } from '@/server/help'

// Many Telegram messages on a busy evening
export const maxDuration = 300

/**
 * The daily job, called by Vercel Cron at 09:00 UTC (18:00 in Seoul, apps/web/vercel.json): reminders for homework
 * due soon, card receipts, old speech made smaller, a storage warning, erasing accounts deleted 30+ days ago, old message keys, old wrong-password tries and old help-chat questions. Each step runs even if another fails; a
 * failure reaches the owner in Telegram. Only Vercel may call it: it sends `Authorization: Bearer <CRON_SECRET>`.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const db = getDb()
  const result: Record<string, unknown> = {}
  const step = async (name: string, run: () => Promise<unknown>) => {
    try {
      result[name] = await run()
    } catch (e) {
      console.error(`[cron] ${name}`, e)
      result[name] = 'failed'
      await alertOwner(db, `cron:${name}`, `The daily job's "${name}" step failed: ${String(e).slice(0, 400)}`)
    }
  }
  await step('dueSoon', () => remindDueSoon(db))
  // Card orders still waiting for their receipt: one reminder each
  if (process.env.TELEGRAM_BOT_TOKEN) await step('cardReceipts', () => remindCardReceipts(db, getBot(), (key) => claim(db, key)))
  // Old WAV speech becomes MP3, a batch a day; then the owner hears if the database is getting full
  await step('speechCompressed', () => compressOldSpeech(db))
  await step('storage', async () => {
    const u = await storageUsage(db)
    const mb = (n: number) => `${Math.round(n / 1024 / 1024)} MB`
    if (u.pct >= 80)
      await alertOwner(
        db,
        'storage',
        `The database is ${u.pct}% full: ${mb(u.total)} of ${mb(u.limit)}. Biggest files: ${u.files.slice(0, 3).map((f) => `${f.kind} ${mb(f.bytes)}`).join(', ')}. See Admin → Health → Storage.`,
      )
    return { pct: u.pct, mb: Math.round(u.total / 1024 / 1024) }
  })
  // Lab books left on Google after a failed or abandoned read
  await step('labBooks', () => pruneLabUploads(db, getGeminiFiles()))
  await step('answerFiles', () => pruneAnswerFiles(db))
  await step('purged', () => purgeDeletedAccounts(db))
  await step('pruned', () => pruneNotificationLog(db).then(() => true))
  await step('passwordFailures', () => prunePasswordFailures(db).then(() => true))
  await step('helpQuestions', () => pruneHelpQuestions(db))
  console.info('[cron] daily', JSON.stringify(result))
  return Response.json(result)
}
