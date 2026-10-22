/**
 * material.ingest (§8.2). Phase 0: hash the bytes and dedupe by contentHash so a re-uploaded
 * track never pays for a second transcription. Extraction (vision / ASR) plugs in here in Phase 1–2.
 */
import { createHash } from 'node:crypto'
import { and, eq, isNotNull, materials, ne, type Db } from '@ikhimi/db'
import type { Storage } from '@ikhimi/db/storage'

export async function ingestMaterial(deps: { db: Db; storage: Pick<Storage, 'getStream'> }, materialId: string) {
  const { db, storage } = deps
  const [m] = await db.select().from(materials).where(eq(materials.id, materialId)).limit(1)
  if (!m || !m.storageKey) throw new Error(`material ${materialId} not found`)
  if (m.processingStatus === 'ready') return { status: 'ready' as const, deduped: false }

  await db.update(materials).set({ processingStatus: 'processing' }).where(eq(materials.id, m.id))
  try {
    const hash = createHash('sha256')
    for await (const chunk of await storage.getStream(m.storageKey)) hash.update(chunk)
    const contentHash = hash.digest('hex')

    // Cache hit: identical bytes already processed (by anyone — learning content, not personal data)
    const [prior] = await db
      .select()
      .from(materials)
      .where(and(eq(materials.contentHash, contentHash), eq(materials.processingStatus, 'ready'), ne(materials.id, m.id), isNotNull(materials.contentHash)))
      .limit(1)

    await db
      .update(materials)
      .set({
        contentHash,
        processingStatus: 'ready',
        processingError: null,
        ...(prior && {
          extractedText: prior.extractedText,
          extractedStructure: prior.extractedStructure,
          detectedLabels: prior.detectedLabels,
          durationSec: prior.durationSec,
        }),
      })
      .where(eq(materials.id, m.id))
    return { status: 'ready' as const, deduped: !!prior }
  } catch (err) {
    await db
      .update(materials)
      .set({ processingStatus: 'failed', processingError: String(err).slice(0, 500) })
      .where(eq(materials.id, m.id))
    throw err
  }
}
