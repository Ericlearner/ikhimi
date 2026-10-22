import { defineConfig } from 'vitest/config'

// DB-backed tests boot an in-process Postgres per test; allow for parallel CI load.
export default defineConfig({ test: { testTimeout: 30000, hookTimeout: 30000 } })
