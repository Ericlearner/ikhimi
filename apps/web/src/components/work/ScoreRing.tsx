import type { ReactNode } from 'react'
import { band } from './bands'

/** A ring filled to the score in its level's colour, with anything in the middle (a picture or the number) */
export function ScoreRing({ percent, size = 80, dashed = false, children }: { percent: number | null; size?: number; dashed?: boolean; children: ReactNode }) {
  const R = 26
  const C = 2 * Math.PI * R
  return (
    <span className="relative flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg viewBox="0 0 64 64" className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx="32" cy="32" r={R} fill="none" stroke="var(--paper-300)" strokeWidth="6" strokeDasharray={dashed ? '3 4' : undefined} />
        {percent !== null && !dashed && (
          <circle cx="32" cy="32" r={R} fill="none" stroke={`var(--score-${band(percent)})`} strokeWidth="6" strokeLinecap="round" strokeDasharray={`${(percent / 100) * C} ${C}`} />
        )}
      </svg>
      {children}
    </span>
  )
}
