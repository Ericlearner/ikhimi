/** Motion system (design spec §6). CSS mirrors these as --d-* / --ease-* in tokens.css. */
export const duration = {
  instant: 80, // press feedback
  fast: 140, // hover, toggle, chip
  base: 200, // enter/exit, tab change
  slow: 320, // page transition, composer dock
  celebr: 600, // completion moment
} as const

export const ease = {
  standard: 'cubic-bezier(.2,0,0,1)',
  decel: 'cubic-bezier(0,0,0,1)',
  accel: 'cubic-bezier(.3,0,1,1)',
  spring: 'linear(0,.28,.72,.94,1.03,1.01,1)', // pops and pills
} as const

export const STAGGER_MS = 40

/** True when motion should be replaced by crossfades (OS setting or the profile override). */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  const override = document.documentElement.dataset.motion
  if (override === 'reduce') return true
  if (override === 'full') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * ~1KB FLIP helper (spec §14: no animation library on student routes).
 * Call `const done = flip(el)` before the layout change, then `done()` after it.
 */
export function flip(target: HTMLElement | (() => HTMLElement | null), opts: { duration?: number; easing?: string } = {}) {
  // A getter lets the "after" element be a different node (e.g. re-rendered in a new container)
  const get = typeof target === 'function' ? target : () => target
  const start = get()
  if (!start) return () => {}
  const first = start.getBoundingClientRect()
  return () => {
    const el = get()
    if (!el) return
    const last = el.getBoundingClientRect()
    const dx = first.left - last.left
    const dy = first.top - last.top
    if (!dx && !dy) return
    if (prefersReducedMotion()) {
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: duration.fast })
      return
    }
    el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }], {
      duration: opts.duration ?? duration.slow,
      easing: opts.easing ?? ease.standard,
    })
  }
}
