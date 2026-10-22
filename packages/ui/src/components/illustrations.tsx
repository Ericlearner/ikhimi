/**
 * Flat two-tone illustrations (design spec §4): navy + orange on paper, simple geometry, no faces.
 * Fills are token variables so dark mode swaps them without a second file. Each well under 4KB.
 */
type P = { className?: string; size?: number }
const NAVY = 'var(--ink-700)'
const ORANGE = 'var(--orange-500)'
const PAPER = 'var(--paper-50)'
const PAPER2 = 'var(--paper-200)'

export function IlloBook({ className, size = 120 }: P) {
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} className={className} aria-hidden>
      <ellipse cx="60" cy="100" rx="44" ry="6" fill={PAPER2} />
      <path d="M14 34c16-6 32-6 46 4v56c-14-10-30-10-46-4z" fill={PAPER} stroke={NAVY} strokeWidth="3" strokeLinejoin="round" />
      <path d="M106 34c-16-6-32-6-46 4v56c14-10 30-10 46-4z" fill={PAPER} stroke={NAVY} strokeWidth="3" strokeLinejoin="round" />
      <path d="M24 48c9-2 18-1 26 3M24 58c9-2 18-1 26 3M24 68c9-2 18-1 26 3" stroke={NAVY} strokeWidth="2.5" strokeLinecap="round" opacity=".35" />
      <path d="M70 51c8-4 17-5 26-3M70 61c8-4 17-5 26-3" stroke={NAVY} strokeWidth="2.5" strokeLinecap="round" opacity=".35" />
      <path d="M84 28v24l6-5 6 5V26" fill={ORANGE} />
    </svg>
  )
}

export function IlloPlane({ className, size = 120 }: P) {
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} className={className} aria-hidden>
      <path d="M18 92c14-4 26-14 34-26" stroke={NAVY} strokeWidth="2.5" strokeLinecap="round" strokeDasharray="2 7" opacity=".45" fill="none" />
      <path d="M50 64 104 22 66 94l-8-22z" fill={PAPER} stroke={NAVY} strokeWidth="3" strokeLinejoin="round" />
      <path d="M58 72 104 22 50 64z" fill={ORANGE} stroke={NAVY} strokeWidth="3" strokeLinejoin="round" />
    </svg>
  )
}

export function IlloPages({ className, size = 120 }: P) {
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} className={className} aria-hidden>
      <rect x="30" y="26" width="56" height="70" rx="6" fill={PAPER2} stroke={NAVY} strokeWidth="3" transform="rotate(-8 58 61)" />
      <rect x="34" y="22" width="56" height="70" rx="6" fill={PAPER} stroke={NAVY} strokeWidth="3" />
      <path d="M44 38h36M44 48h36M44 58h24" stroke={NAVY} strokeWidth="3" strokeLinecap="round" opacity=".35" />
      <circle cx="80" cy="78" r="14" fill={ORANGE} />
      <path d="m73 78 5 5 9-10" stroke={NAVY} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  )
}

export function IlloCap({ className, size = 120 }: P) {
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} className={className} aria-hidden>
      <ellipse cx="60" cy="100" rx="40" ry="6" fill={PAPER2} />
      <path d="M30 58v16c0 8 14 14 30 14s30-6 30-14V58" fill={NAVY} />
      <path d="m60 28 48 22-48 22-48-22z" fill={NAVY} />
      <path d="M96 56v22" stroke={ORANGE} strokeWidth="3" strokeLinecap="round" />
      <circle cx="96" cy="81" r="4" fill={ORANGE} />
    </svg>
  )
}

export const ILLUSTRATIONS = { book: IlloBook, plane: IlloPlane, pages: IlloPages, cap: IlloCap }
