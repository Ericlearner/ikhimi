/**
 * Default initials avatar (design spec §12): one or two letters on a fill picked deterministically from
 * the user id across six brand-safe hues. Colours are token names, not hex.
 */
export const AVATAR_FILLS = ['--ink-700', '--orange-700', '--gold-avatar', '--success-600', '--teal-avatar', '--plum-avatar'] as const

export function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  const first = [...parts[0]!][0] ?? ''
  const second = parts.length > 1 ? ([...parts[parts.length - 1]!][0] ?? '') : ''
  return (first + second).toUpperCase()
}

export function avatarFill(id: string): (typeof AVATAR_FILLS)[number] {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return AVATAR_FILLS[h % AVATAR_FILLS.length]!
}
