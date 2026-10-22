/**
 * How full the database is (on Vercel every file lives in it: material_blobs), what takes the space, and the
 * daily jobs that keep it in check: old WAV speech is turned into MP3 a batch at a time, and the owner hears in
 * Telegram when the database passes 80% of its plan (DB_STORAGE_LIMIT_MB, default 512: Neon's free plan).
 */
import { and, eq, ilike, materialBlobs, materials, sql, type Db } from '@ikhimi/db'
import { compressSpeech } from './audio'

export const storageLimitBytes = () => (Number(process.env.DB_STORAGE_LIMIT_MB) || 512) * 1024 * 1024

/** The pglite (tests) and postgres-js drivers return raw queries in different shapes */
async function rows<T>(db: Db, q: ReturnType<typeof sql>): Promise<T[]> {
  const r = (await db.execute(q)) as unknown
  return (Array.isArray(r) ? r : ((r as { rows?: T[] }).rows ?? [])) as T[]
}

/** AI speech still stored as WAV (made before it was stored as MP3) */
const oldSpeech = and(eq(materials.kind, 'audio'), eq(materials.mimeType, 'audio/wav'), ilike(materials.originalFilename, 'say-%'))

export async function storageUsage(db: Db) {
  const [size] = await rows<{ total: string | number }>(db, sql`select pg_database_size(current_database()) as total`)
  const tables = await rows<{ name: string; bytes: string | number }>(
    db,
    sql`select relname as name, pg_total_relation_size(relid) as bytes from pg_statio_user_tables order by 2 desc limit 6`,
  )
  // Files by what they are; the AI's speech and the pictures it cut out are told apart by their names
  const files = await db
    .select({
      kind: sql<string>`case when ${materials.originalFilename} like 'say-%' then 'speech' when ${materials.originalFilename} like 'picture-%' then 'pictures' else ${materials.kind}::text end`,
      n: sql<number>`count(*)::int`,
      bytes: sql<number>`coalesce(sum(length(${materialBlobs.data})), 0)::bigint`,
    })
    .from(materialBlobs)
    .innerJoin(materials, eq(materials.id, materialBlobs.materialId))
    .groupBy(sql`1`)
  const [wav] = await db.select({ n: sql<number>`count(*)::int` }).from(materials).innerJoin(materialBlobs, eq(materialBlobs.materialId, materials.id)).where(oldSpeech)
  const total = Number(size?.total ?? 0)
  const limit = storageLimitBytes()
  return {
    total,
    limit,
    pct: Math.round((total / limit) * 100),
    tables: tables.map((t) => ({ name: t.name, bytes: Number(t.bytes) })),
    files: files.map((f) => ({ kind: f.kind, n: Number(f.n), bytes: Number(f.bytes) })).sort((a, b) => b.bytes - a.bytes),
    oldWav: Number(wav?.n ?? 0),
  }
}

/** The daily job: turn up to `limit` old WAV speech clips into MP3 (same material, same links; only the bytes change) */
export async function compressOldSpeech(db: Db, limit = 200) {
  const list = await db
    .select({ id: materials.id, data: materialBlobs.data })
    .from(materials)
    .innerJoin(materialBlobs, eq(materialBlobs.materialId, materials.id))
    .where(oldSpeech)
    .limit(limit)
  let saved = 0
  for (const m of list) {
    const out = compressSpeech({ mimeType: 'audio/wav', data: Buffer.from(m.data) })
    // Not a readable WAV: leave it, but mark it so it isn't tried again every day
    if (out.mimeType !== 'audio/mpeg') {
      await db.update(materials).set({ mimeType: 'audio/x-wav' }).where(eq(materials.id, m.id))
      continue
    }
    await db.update(materialBlobs).set({ data: out.data }).where(eq(materialBlobs.materialId, m.id))
    await db.update(materials).set({ mimeType: out.mimeType, bytes: out.data.length }).where(eq(materials.id, m.id))
    saved += m.data.length - out.data.length
  }
  return { converted: list.length, savedBytes: saved }
}
