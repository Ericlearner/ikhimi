import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import { fileURLToPath } from 'node:url'

// Migrations need a direct connection; Neon (Vercel) also provides a pooled one as DATABASE_URL.
const url = process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set')
const client = postgres(url, { max: 1, onnotice: () => {} })
await migrate(drizzle(client), { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) })
console.log('Migrations applied')
await client.end()
