'use client'
/**
 * Primitives (design spec §10). Labels come in as props — this package knows nothing about i18n.
 * Colours are Tailwind classes backed by tokens (bg-paper-50, text-ink-700…); no hex in components.
 */
import {
  forwardRef,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react'
import { play } from '../sound'
import { useTemperature } from './temperature'

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

// ─── Button ─────────────────────────────────────────────────────────────────

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'apple'
export type ButtonSize = 'sm' | 'md' | 'lg' | 'xl'

type BtnOwn = { variant?: ButtonVariant; size?: ButtonSize; loading?: boolean; pill?: boolean; icon?: ReactNode }

export function buttonClass({ variant = 'primary', size = 'md', pill }: BtnOwn = {}) {
  return cx('btn', `btn-${variant}`, `btn-${size}`, pill && 'btn-pill')
}

/** The letterpress button: 4px ledge that collapses on press (spec §5). Loading keeps its width. */
export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & BtnOwn>(function Button(
  { variant = 'primary', size = 'md', loading, pill, icon, className, children, disabled, onPointerDown, type = 'button', ...rest },
  ref,
) {
  const temp = useTemperature()
  return (
    <button
      ref={ref}
      type={type}
      {...rest}
      disabled={disabled || loading}
      data-loading={loading ? '' : undefined}
      aria-busy={loading || undefined}
      onPointerDown={(e) => {
        if (temp === 'warm') play('tap')
        onPointerDown?.(e)
      }}
      className={cx(buttonClass({ variant, size, pill }), className)}
    >
      <span className="btn-label inline-flex items-center gap-2">
        {icon}
        {children}
      </span>
      {loading && (
        <span className="btn-spinner" aria-hidden>
          <span className="spinner" />
        </span>
      )}
    </button>
  )
})

export function ButtonLink({ variant = 'primary', size = 'md', pill, icon, className, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & BtnOwn) {
  return (
    <a {...rest} className={cx(buttonClass({ variant, size, pill }), className)}>
      <span className="btn-label inline-flex items-center gap-2">
        {icon}
        {children}
      </span>
    </a>
  )
}

/** Icon-only buttons always carry a label for screen readers and a tooltip. */
export const IconButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { label: string; size?: 36 | 44 | 48; tone?: 'plain' | 'filled' }
>(function IconButton({ label, size = 44, tone = 'plain', className, children, type = 'button', ...rest }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      {...rest}
      style={{ width: size, height: size }}
      className={cx(
        'press inline-flex shrink-0 items-center justify-center rounded-full text-ink-700 transition-colors disabled:opacity-40',
        tone === 'filled' ? 'bg-paper-200 hover:bg-paper-300' : 'hover:bg-paper-200',
        className,
      )}
    >
      {children}
    </button>
  )
})

// ─── Chip ───────────────────────────────────────────────────────────────────

export function Chip({
  selected,
  className,
  children,
  as = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean; as?: 'button' | 'span' }) {
  const cls = cx(
    'press inline-flex min-h-9 items-center gap-1.5 rounded-pill border px-3.5 text-sm font-medium transition-colors',
    selected ? 'border-orange-500 bg-orange-100 text-ink-800' : 'border-paper-300 bg-paper-50 text-ink-700 hover:bg-paper-200',
    className,
  )
  if (as === 'span') return <span className={cls}>{children}</span>
  return (
    <button type="button" aria-pressed={selected} {...rest} className={cls}>
      {children}
    </button>
  )
}

// ─── Inputs ─────────────────────────────────────────────────────────────────

const fieldCls =
  'w-full rounded-lg border border-paper-300 bg-paper-50 px-4 text-base text-ink-700 placeholder:text-ink-400 transition-colors focus:border-ink-700 focus:outline-none disabled:opacity-60'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function Input(
  { className, invalid, ...rest },
  ref,
) {
  return <input ref={ref} aria-invalid={invalid || undefined} {...rest} className={cx(fieldCls, 'min-h-12', invalid && 'border-error-600', className)} />
})

/** Auto-growing textarea (min/max rows). */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { minRows?: number; maxRows?: number; bare?: boolean }>(
  function Textarea({ className, minRows = 1, maxRows = 6, bare, value, ...rest }, fwd) {
    const inner = useRef<HTMLTextAreaElement | null>(null)
    useLayoutEffect(() => {
      const el = inner.current
      if (!el) return
      const cs = getComputedStyle(el)
      const lh = parseFloat(cs.lineHeight) || 24
      // Heights include the padding (border-box), so min and max rows add it too
      const pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0)
      el.style.height = 'auto'
      el.style.height = `${Math.min(Math.max(el.scrollHeight, lh * minRows + pad), lh * maxRows + pad)}px`
    }, [value, minRows, maxRows])
    return (
      <textarea
        ref={(el) => {
          inner.current = el
          if (typeof fwd === 'function') fwd(el)
          else if (fwd) fwd.current = el
        }}
        rows={minRows}
        value={value}
        {...rest}
        className={cx(bare ? 'w-full resize-none bg-transparent text-ink-700 placeholder:text-ink-400 focus:outline-none' : cx(fieldCls, 'resize-none py-3'), className)}
      />
    )
  },
)

/** 6 boxes, paste-aware, auto-submits when complete (spec §10). */
export function OtpInput({ length = 6, value, onChange, onComplete, disabled, label }: {
  length?: number
  value: string
  onChange: (v: string) => void
  onComplete?: (v: string) => void
  disabled?: boolean
  label: string
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([])
  const set = (v: string) => {
    const clean = v.replace(/\D/g, '').slice(0, length)
    onChange(clean)
    if (clean.length === length) onComplete?.(clean)
    refs.current[Math.min(clean.length, length - 1)]?.focus()
  }
  useEffect(() => {
    if (!value) refs.current[0]?.focus()
  }, [value])
  return (
    <div role="group" aria-label={label} className="flex justify-between gap-2">
      {Array.from({ length }, (_, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el
          }}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          aria-label={`${label} ${i + 1}`}
          maxLength={length}
          disabled={disabled}
          value={value[i] ?? ''}
          onFocus={(e) => e.target.select()}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && !value[i] && i > 0) {
              e.preventDefault()
              set(value.slice(0, i - 1))
            }
          }}
          onChange={(e) => {
            const typed = e.target.value.replace(/\D/g, '')
            // Paste or SMS autofill delivers several digits into one box
            if (typed.length > 1) return set(value.slice(0, i) + typed)
            set((value.slice(0, i) + typed + value.slice(i + 1)).slice(0, i + 1 + value.slice(i + 1).length))
          }}
          className="t-num h-14 w-full min-w-0 rounded-lg border border-paper-300 bg-paper-50 text-center text-2xl font-semibold text-ink-800 focus:border-orange-600 focus:outline-none"
        />
      ))}
    </div>
  )
}

// ─── Display ────────────────────────────────────────────────────────────────

export type BadgeTone = 'neutral' | 'success' | 'warn' | 'error' | 'published' | 'orange'

export function Badge({ tone = 'neutral', children, className, icon }: { tone?: BadgeTone; children: ReactNode; className?: string; icon?: ReactNode }) {
  const tones: Record<BadgeTone, string> = {
    neutral: 'bg-paper-200 text-ink-500',
    success: 'bg-success-100 text-success-600',
    warn: 'bg-warn-100 text-warn-600',
    error: 'bg-error-100 text-error-600',
    // Gold hairline is reserved for this badge (spec §2)
    published: 'border border-gold-500 bg-paper-50 text-ink-700',
    orange: 'bg-orange-100 text-orange-700',
  }
  return (
    <span className={cx('t-caption inline-flex items-center gap-1 rounded-pill px-2.5 py-1', tones[tone], className)}>
      {icon}
      {children}
    </span>
  )
}

export function ProgressBar({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max ? Math.min(1, value / max) : 0
  return (
    <div className="progress-track" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
      <div className="progress-fill" style={{ transform: `scaleX(${pct})` }} />
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('skeleton', className)} aria-hidden />
}

export function Divider({ gold, className }: { gold?: boolean; className?: string }) {
  return <hr className={cx(gold ? 'rule-gold' : 'h-px border-0 bg-paper-300', className)} />
}

export function Card({ className, children, as: Tag = 'div', ...rest }: { className?: string; children: ReactNode; as?: 'div' | 'section' | 'li' | 'article' } & Record<string, unknown>) {
  return (
    <Tag {...rest} className={cx('rounded-lg border border-paper-300 bg-paper-50 shadow-e1', className)}>
      {children}
    </Tag>
  )
}

export function StatTile({ value, label, hint, className }: { value: ReactNode; label: string; hint?: string; className?: string }) {
  return (
    <div className={cx('flex flex-col gap-1 rounded-lg border border-paper-300 bg-paper-50 p-4', className)}>
      <span className="t-num font-display text-3xl font-bold leading-none text-ink-900">{value}</span>
      <span className="t-small text-ink-500">{label}</span>
      {hint && <span className="t-small text-ink-400">{hint}</span>}
    </div>
  )
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  size = 'md',
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
  label: string
  size?: 'sm' | 'md'
}) {
  return (
    // A long label wraps inside its button on a narrow phone instead of pushing the control off the screen
    <div role="radiogroup" aria-label={label} className="inline-flex max-w-full rounded-pill border border-paper-300 bg-paper-200 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => o.value !== value && onChange(o.value)}
          className={cx(
            'press rounded-pill font-medium leading-tight transition-colors',
            size === 'sm' ? 'min-h-8 px-2.5 py-1 text-xs' : 'min-h-9 px-3.5 py-1 text-sm',
            o.value === value ? 'bg-ink-700 text-paper-50 shadow-e1' : 'text-ink-500 hover:text-ink-700',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Switch({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string }) {
  const id = useId()
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <label htmlFor={id} className="flex flex-col">
        <span className="t-h3">{label}</span>
        {description && <span className="t-small text-ink-400">{description}</span>}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => {
          play('toggle')
          onChange(!checked)
        }}
        className={cx('relative inline-flex h-7 w-12 shrink-0 items-center rounded-pill transition-colors', checked ? 'bg-ink-700' : 'bg-paper-400')}
      >
        <span className={cx('inline-block size-5 rounded-full bg-paper-50 shadow-e1 transition-transform', checked ? 'translate-x-6' : 'translate-x-1')} />
      </button>
    </div>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cx('spinner inline-block', className)} aria-hidden />
}
