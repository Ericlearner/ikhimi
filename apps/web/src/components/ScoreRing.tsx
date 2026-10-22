/** Score ring + the `complete` moment (design spec §6/§11): checkmark draws, plane rises, gold sweeps. */
export function ScoreRing({ percent, label }: { percent: number; label: string }) {
  const r = 52
  const c = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(100, percent))
  return (
    <div className="relative flex flex-col items-center">
      <svg viewBox="0 0 120 120" width="168" height="168" role="img" aria-label={label}>
        <circle cx="60" cy="60" r={r} fill="none" stroke="var(--paper-200)" strokeWidth="10" />
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke="var(--orange-500)"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${(pct / 100) * c} ${c}`}
          transform="rotate(-90 60 60)"
        />
        <text x="60" y="60" textAnchor="middle" dominantBaseline="central" className="t-num" style={{ font: '700 28px var(--font-display)', fill: 'var(--ink-900)' }}>
          {Math.round(pct)}%
        </text>
      </svg>
      {/* Paper plane = "submitted" metaphor (kept distinct from the composer's send arrow) */}
      <svg viewBox="0 0 40 40" width="40" height="40" className="complete-plane absolute -right-2 top-0" aria-hidden>
        <path d="M6 20 36 6 26 36l-5-12z" fill="var(--paper-50)" stroke="var(--ink-700)" strokeWidth="2" strokeLinejoin="round" />
        <path d="M21 24 36 6 6 20z" fill="var(--orange-500)" stroke="var(--ink-700)" strokeWidth="2" strokeLinejoin="round" />
      </svg>
      <svg viewBox="0 0 24 24" width="32" height="32" className="complete-check -mt-3 text-success-600" aria-hidden>
        <circle cx="12" cy="12" r="11" fill="var(--success-100)" />
        <path d="m7 12.5 3.2 3.2L17 9" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <hr className="rule-gold complete-sweep mt-4 w-24" />
    </div>
  )
}
