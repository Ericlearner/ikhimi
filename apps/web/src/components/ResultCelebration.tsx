'use client'
import { useEffect } from 'react'
import { TaskIcon, type TaskIconName } from '@ikhimi/ui/components'
import { play } from '@ikhimi/ui/sound'
import { useI18n } from '@/i18n/client'

type Tier = 'great' | 'good' | 'ok' | 'low'
const tierOf = (pct: number): Tier => (pct >= 85 ? 'great' : pct >= 65 ? 'good' : pct >= 40 ? 'ok' : 'low')
const TIER_ICON: Record<Tier, TaskIconName> = { great: 'trophy', good: 'glowing-star', ok: 'flexed-biceps', low: 'open-book' }
export const starsFor = (pct: number) => (pct >= 90 ? 3 : pct >= 70 ? 2 : pct >= 40 ? 1 : 0)

const CONFETTI = ['var(--orange-500)', 'var(--gold-500)', 'var(--success-600)', 'var(--teal-avatar)', 'var(--plum-avatar)']

/**
 * The moment after submitting: tier icon, stars, best streak, and — for a great result — confetti and the
 * achievement sound. Reduced motion turns the confetti into a plain fade (global rule in base.css).
 */
export function ResultCelebration({ percent, bestStreak }: { percent: number; bestStreak: number }) {
  const { t } = useI18n()
  const tier = tierOf(percent)
  const stars = starsFor(percent)

  useEffect(() => {
    // After the submit chime has finished
    const id = setTimeout(() => play(tier === 'great' ? 'result.great' : tier === 'good' ? 'result.good' : 'result.ok'), 650)
    return () => clearTimeout(id)
  }, [tier])

  return (
    <div className="relative flex flex-col items-center gap-2">
      {tier === 'great' && (
        <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-4 h-56 overflow-hidden">
          {Array.from({ length: 28 }, (_, i) => (
            <span
              key={i}
              className="confetti absolute top-0 block h-2.5 w-1.5 rounded-[1px]"
              style={{
                left: `${(i * 37) % 100}%`,
                background: CONFETTI[i % CONFETTI.length],
                ['--dx' as string]: `${((i * 53) % 60) - 30}px`,
                ['--rot' as string]: `${(i * 97) % 720}deg`,
                animationDelay: `${(i % 7) * 60}ms`,
              }}
            />
          ))}
        </div>
      )}
      <TaskIcon name={TIER_ICON[tier]} size={72} className="correct-pop" label={t(`result.tier.${tier}`)} />
      <p className="t-h1">{t(`result.tier.${tier}`)}</p>
      <div className="flex gap-1" role="img" aria-label={t('result.stars', { n: stars })}>
        {[0, 1, 2].map((i) => (
          <span key={i} className={i < stars ? 'correct-pop' : 'opacity-25 grayscale'} style={{ animationDelay: `${200 + i * 150}ms` }}>
            <TaskIcon name="star" size={34} />
          </span>
        ))}
      </div>
      {bestStreak >= 3 && (
        <p className="t-body inline-flex items-center gap-1.5 font-semibold text-orange-700">
          <TaskIcon name="fire" size={22} /> {t('result.bestStreak', { n: bestStreak })}
        </p>
      )}
    </div>
  )
}
