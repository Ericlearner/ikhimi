/**
 * Embeds PEDAGOGY_CONTENT and upserts it into the methodologyDocs table (§8.5, §18).
 *
 * Idempotent: matches existing rows by title, updates in place rather than duplicating. Safe to
 * re-run whenever content/methodology.json changes — that file is the source of truth, this script
 * just syncs the DB (and its embeddings) to match it.
 *
 * Usage: pnpm --filter @ikhimi/pedagogy seed   (needs DATABASE_URL and GEMINI_API_KEY)
 */
import { createDb, eq, isNotNull, methodologyDocs } from '@ikhimi/db'
import { GeminiEmbeddingProvider } from '@ikhimi/ai'
import { PEDAGOGY_CONTENT } from '../src/content'

const apiKey = process.env.GEMINI_API_KEY
// Also runs during deploys (vercel-build); never fail a deploy over optional notes.
const optional = process.argv.includes('--optional')
if (!apiKey) {
  console.error('GEMINI_API_KEY is not set — cannot embed methodology content. See .env.example.')
  process.exit(optional ? 0 : 1)
}

const embedder = new GeminiEmbeddingProvider({
  apiKey,
  model: process.env.GEMINI_EMBEDDING_MODEL ?? 'gemini-embedding-001',
})
const db = createDb()

let created = 0
let updated = 0
let unchanged = 0
try {
for (const doc of PEDAGOGY_CONTENT) {
  const [existing] = await db
    .select({ id: methodologyDocs.id, body: methodologyDocs.body, subject: methodologyDocs.subject, hasEmbedding: isNotNull(methodologyDocs.embedding) })
    .from(methodologyDocs)
    .where(eq(methodologyDocs.title, doc.title))
    .limit(1)
  // Skip the embedding call when nothing changed (deploys re-run this every time)
  if (existing?.hasEmbedding && existing.body === doc.body && existing.subject === doc.subject) {
    unchanged++
    continue
  }
  const embedding = await embedder.embed(doc.body)

  if (existing) {
    await db
      .update(methodologyDocs)
      .set({ subject: doc.subject, body: doc.body, tags: doc.tags, locale: doc.locale, embedding })
      .where(eq(methodologyDocs.id, existing.id))
    updated++
  } else {
    await db.insert(methodologyDocs).values({ subject: doc.subject, title: doc.title, body: doc.body, tags: doc.tags, locale: doc.locale, embedding })
    created++
  }
  console.log(`  ${existing ? 'updated' : 'created'}: ${doc.title}`)
}
} catch (e) {
  console.error('pedagogy seed failed:', e)
  process.exit(optional ? 0 : 1)
}

console.log(`\nDone. ${created} created, ${updated} updated, ${unchanged} unchanged, ${PEDAGOGY_CONTENT.length} total.`)
process.exit(0)
