import { getDb } from '@ikhimi/db'
import { getBoss, QUEUES, type JobPayloads } from '@ikhimi/db/jobs'
import { getStorage } from '@ikhimi/db/storage'
import { ingestMaterial } from './ingest'

const boss = await getBoss()
const db = getDb()
const storage = getStorage()

await boss.work<JobPayloads[typeof QUEUES.materialIngest]>(QUEUES.materialIngest, { batchSize: 4 }, async (jobs) => {
  for (const job of jobs) {
    const r = await ingestMaterial({ db, storage }, job.data.materialId)
    console.info(`[ingest] ${job.data.materialId} → ${r.status}${r.deduped ? ' (cache hit)' : ''}`)
  }
})

console.info('[workers] listening:', Object.values(QUEUES).join(', '))

const shutdown = async () => {
  await boss.stop({ graceful: true, timeout: 20_000 })
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
