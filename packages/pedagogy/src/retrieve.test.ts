import { describe, expect, it, vi } from 'vitest'
import { createTestDb } from '@ikhimi/db/testing'
import { EMBEDDING_DIMENSIONS, methodologyDocs } from '@ikhimi/db'
import { retrieveMethodology } from './retrieve'

// One-hot vectors: axis 0 = "grammar", axis 1 = "listening"
const axis = (i: number) => Array.from({ length: EMBEDDING_DIMENSIONS }, (_, j) => (j === i ? 1 : 0))

describe('retrieveMethodology', () => {
  it('does not call the embedder when nothing is seeded', async () => {
    const db = await createTestDb()
    const embedder = { name: 'fake', embed: vi.fn(async () => axis(0)) }
    expect(await retrieveMethodology(db, embedder, { subject: 'language-learning', queryText: 'past simple' })).toEqual([])
    expect(embedder.embed).not.toHaveBeenCalled()
  })

  it('returns the closest notes for the subject or cross-subject, never other subjects', async () => {
    const db = await createTestDb()
    await db.insert(methodologyDocs).values([
      { subject: 'language-learning', title: 'Grammar', body: 'g', tags: [], locale: 'en', embedding: axis(0) },
      { subject: 'cross-subject', title: 'Listening', body: 'l', tags: [], locale: 'en', embedding: axis(1) },
      { subject: 'math', title: 'Fractions', body: 'f', tags: [], locale: 'en', embedding: axis(0) },
    ])
    const embedder = { name: 'fake', embed: async () => axis(0) }
    const notes = await retrieveMethodology(db, embedder, { subject: 'language-learning', queryText: 'past simple' })
    expect(notes.map((n) => n.title)).toEqual(['Grammar', 'Listening'])
  })
})
