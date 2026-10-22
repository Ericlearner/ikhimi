/**
 * Retrieval for the Plan/Generate and Verify stages (§8.1, §8.5): given the current request, fetch
 * only the 2-4 methodologyDocs rows relevant to it — never the whole library — and hand them to
 * generateAssignment as plain { title, body } notes.
 *
 * Best-effort by design: called from a try/catch at the API route. A retrieval failure (no
 * embedding key configured, DB hiccup) must never block homework generation — see generate.ts's
 * own solve-back step for the same pattern.
 */
import { and, cosineDistance, isNotNull, methodologyDocs, or, eq, type Db } from '@ikhimi/db'
import type { EmbeddingProvider } from '@ikhimi/ai'

export type MethodologyNote = { title: string; body: string }

export type RetrieveMethodologyParams = {
  /** e.g. 'language-learning'. Matched against the doc's subject OR 'cross-subject'. */
  subject: string
  /** Free text describing the request — teacher's message, focus skills, level. Truncated to 2000 chars. */
  queryText: string
  limit?: number
}

export async function retrieveMethodology(
  db: Db,
  embedder: EmbeddingProvider,
  params: RetrieveMethodologyParams,
): Promise<MethodologyNote[]> {
  const queryText = params.queryText.trim().slice(0, 2000)
  if (!queryText) return []

  // Not seeded yet → don't spend an embedding call on every generation
  const [any] = await db.select({ id: methodologyDocs.id }).from(methodologyDocs).where(isNotNull(methodologyDocs.embedding)).limit(1)
  if (!any) return []

  const vector = await embedder.embed(queryText)
  const distance = cosineDistance(methodologyDocs.embedding, vector)

  const rows = await db
    .select({ title: methodologyDocs.title, body: methodologyDocs.body })
    .from(methodologyDocs)
    .where(and(or(eq(methodologyDocs.subject, params.subject), eq(methodologyDocs.subject, 'cross-subject')), isNotNull(methodologyDocs.embedding)))
    .orderBy(distance)
    .limit(params.limit ?? 4)

  return rows
}
