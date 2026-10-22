'use client'
import { useState } from 'react'
import { Chip } from '@ikhimi/ui/components'
import { useI18n } from '@/i18n/client'

/** The usual durations; any other number of days goes in "Other" */
const PRESETS = [1, 2, 3, 7, 14, 30]
const MAX_DAYS = 180

type T = ReturnType<typeof useI18n>['t']

/** "2일", "1주", "1개월" */
export function durationText(t: T, days: number) {
  if (days === 30) return t('due.month')
  if (days === 7) return t('due.oneWeek')
  if (days % 7 === 0) return t('due.weeks', { n: days / 7 })
  return days === 1 ? t('due.oneDay') : t('due.days', { n: days })
}

/**
 * How long each student has (DECISIONS.md BK): a duration, not a date. Each student gets all of it from when the
 * homework reaches them, so it stays right for students who join later and for homework given again.
 */
export function DurationPicker({ value, onChange, label }: { value: number | null; onChange: (days: number | null) => void; label?: string }) {
  const { t } = useI18n()
  const [other, setOther] = useState(value !== null && !PRESETS.includes(value))
  const pick = (days: number | null) => {
    setOther(false)
    onChange(days)
  }
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="t-small mb-1 font-medium text-ink-500">{label ?? t('due.title')}</legend>
      <div className="flex flex-wrap gap-2">
        <Chip selected={value === null && !other} onClick={() => pick(null)} className="min-h-11">
          {t('due.none')}
        </Chip>
        {PRESETS.map((d) => (
          <Chip key={d} selected={!other && value === d} onClick={() => pick(d)} className="min-h-11">
            {durationText(t, d)}
          </Chip>
        ))}
        <Chip selected={other} onClick={() => setOther(true)} className="min-h-11">
          {t('due.other')}
        </Chip>
      </div>
      {other && (
        <label className="t-body flex items-center gap-2 text-ink-700">
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_DAYS}
            value={value ?? ''}
            onChange={(e) => {
              const n = Math.round(Number(e.target.value))
              onChange(e.target.value && n >= 1 ? Math.min(MAX_DAYS, n) : null)
            }}
            autoFocus
            aria-label={t('due.daysUnit')}
            className="t-body t-num min-h-11 w-24 rounded-lg border border-paper-300 bg-paper-50 px-3 text-center focus:border-ink-700 focus:outline-none"
          />
          {t('due.daysUnit')}
        </label>
      )}
      <p className="t-small text-ink-500">{t('due.hint')}</p>
    </fieldset>
  )
}
