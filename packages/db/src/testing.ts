/**
 * In-process Postgres (PGlite + pgvector) with all migrations applied. Tests only.
 */
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite-pgvector'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { fileURLToPath } from 'node:url'
import * as schema from './schema'
import type { Db } from './client'

export async function createTestDb(): Promise<Db> {
  // Same rule as the app's client: json/jsonb as raw text, parsed once by Drizzle
  const raw = (x: string) => x
  const client = new PGlite({ extensions: { vector }, parsers: { 114: raw, 3802: raw } })
  const db = drizzle(client, { schema, casing: 'snake_case' })
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) })
  // The pglite and postgres-js drizzle instances share the query API we use.
  return db as unknown as Db
}
