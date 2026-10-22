/**
 * Course videos live on YouTube or Vimeo; we only keep the link. Turn whatever the teacher pasted
 * (watch page, short link, Shorts, embed, unlisted Vimeo with its hash) into a privacy-friendly embed.
 */
export type VideoEmbed = { provider: 'youtube' | 'vimeo'; id: string; embedUrl: string }

const YT_ID = /^[\w-]{11}$/

export function parseVideoUrl(input: string | null | undefined): VideoEmbed | null {
  const raw = (input ?? '').trim()
  if (!raw) return null
  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
  } catch {
    return null
  }
  const host = url.hostname.replace(/^(www\.|m\.)/, '')

  if (host === 'youtu.be' || host === 'youtube.com' || host === 'youtube-nocookie.com' || host === 'music.youtube.com') {
    let id = host === 'youtu.be' ? url.pathname.slice(1).split('/')[0] : url.searchParams.get('v')
    if (!id) {
      const m = url.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]{11})/)
      id = m?.[1] ?? null
    }
    if (!id || !YT_ID.test(id)) return null
    const start = Number.parseInt(url.searchParams.get('t') ?? url.searchParams.get('start') ?? '', 10)
    const q = new URLSearchParams({ rel: '0', modestbranding: '1', ...(start > 0 && { start: String(start) }) })
    return { provider: 'youtube', id, embedUrl: `https://www.youtube-nocookie.com/embed/${id}?${q}` }
  }

  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    // vimeo.com/123, vimeo.com/123/abcdef (unlisted), player.vimeo.com/video/123?h=abcdef, vimeo.com/channels/x/123
    const parts = url.pathname.split('/').filter(Boolean)
    const idx = parts.findIndex((p) => /^\d{5,}$/.test(p))
    if (idx < 0) return null
    const id = parts[idx]!
    const hash = url.searchParams.get('h') ?? (parts[idx + 1] && /^[\da-f]{6,}$/i.test(parts[idx + 1]!) ? parts[idx + 1] : null)
    const q = new URLSearchParams({ dnt: '1', ...(hash && { h: hash }) })
    return { provider: 'vimeo', id, embedUrl: `https://player.vimeo.com/video/${id}?${q}` }
  }
  return null
}
