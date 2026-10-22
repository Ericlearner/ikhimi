import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://ikhimi:ikhimi@localhost:5432/ikhimi' },
  casing: 'snake_case',
})
