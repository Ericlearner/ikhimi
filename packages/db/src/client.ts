import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

export type Db = ReturnType<typeof createDb>

const rawJson = (oid: number) => ({ to: oid, from: [oid], serialize: (x: unknown) => (typeof x === 'string' ? x : JSON.stringify(x)), parse: (x: string) => x })

export function createDb(url = process.env.DATABASE_URL) {
  if (!url) throw new Error('DATABASE_URL is not set')
  const client = postgres(url, {
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    // Transaction-mode poolers (Neon "-pooler", PgBouncer) don't support prepared statements
    prepare: !/-pooler\.|pgbouncer=true/.test(url),
    // json/jsonb come back as raw text; Drizzle parses them exactly once. With the driver's default
    // JSON.parse as well, a stored string like "false" or "12" was parsed twice into false / 12
    // (true/false answers were graded wrong at submit).
    types: { json: rawJson(114), jsonb: rawJson(3802) },
  })
  return drizzle(client, { schema, casing: 'snake_case' })
}

// One pool per process (survives Next.js dev hot reloads).
const g = globalThis as unknown as { __ikhimiDb?: Db }
export function getDb(): Db {
  g.__ikhimiDb ??= createDb()
  return g.__ikhimiDb
}
