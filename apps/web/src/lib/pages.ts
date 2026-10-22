/** Most items of one type on one page; beyond this the page gets long on a phone */
export const PAGE_MAX = 8

/**
 * Pages: consecutive items of the same kind (and the same reading text) are done together on one page, checked
 * with one press. Essays and listening items keep a page of their own.
 */
export function groupPages(exercises: { kind: string; payload: Record<string, unknown>; audioUrl?: string | null }[]): number[][] {
  const pages: number[][] = []
  exercises.forEach((e, i) => {
    const last = pages.at(-1)
    const prev = last ? exercises[last.at(-1)!]! : null
    const joins =
      prev &&
      last!.length < PAGE_MAX &&
      prev.kind === e.kind &&
      e.kind !== 'essay' &&
      !e.audioUrl &&
      !prev.audioUrl &&
      (prev.payload.passage ?? null) === (e.payload.passage ?? null)
    if (joins) last!.push(i)
    else pages.push([i])
  })
  return pages
}

