/**
 * Background jobs (pg-boss, Postgres-backed — no extra infra, stays in-country).
 * Queue names and payloads are shared by the web app (producer) and workers/ (consumer).
 */
import { PgBoss } from 'pg-boss'

export const QUEUES = {
  materialIngest: 'material.ingest',
} as const

export type JobPayloads = {
  [QUEUES.materialIngest]: { materialId: string }
}

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES]

const g = globalThis as unknown as { __ikhimiBoss?: Promise<PgBoss> }

/** Started pg-boss singleton with all queues created. */
export function getBoss(url = process.env.DATABASE_URL): Promise<PgBoss> {
  g.__ikhimiBoss ??= (async () => {
    if (!url) throw new Error('DATABASE_URL is not set')
    const boss = new PgBoss(url)
    boss.on('error', (err) => console.error('[pg-boss]', err))
    await boss.start()
    for (const name of Object.values(QUEUES)) await boss.createQueue(name)
    return boss
  })()
  return g.__ikhimiBoss
}

export async function enqueue<Q extends QueueName>(queue: Q, data: JobPayloads[Q]) {
  const boss = await getBoss()
  return boss.send(queue, data, { retryLimit: 3, retryBackoff: true })
}
