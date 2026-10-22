'use client'
import { Check, Clock, CreditCard, Crown, Minus, Plus, ShieldCheck, Sprout, Zap } from 'lucide-react'
import Link from 'next/link'
import { useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { listPrice, orderDiscount, planTotal, pricingMonths, type Pricing } from '@ikhimi/ai'
import { formatKrw, type MessageKey } from '@ikhimi/i18n'
import { Button, ICON } from '@ikhimi/ui/components'
import { LinkedText, slot } from '@/components/LinkedText'
import { useI18n } from '@/i18n/client'
import { postJson } from '@/lib/client'

type Paid = 'pro' | 'vip'
type Plan = 'free' | Paid

/** What each plan opens, one row per feature; a plan without a row shows it dimmed, so cards compare at a glance */
const FEATURES: { key: MessageKey; plans: Plan[] }[] = [
  { key: 'plans.inc.vocabulary', plans: ['free', 'pro', 'vip'] },
  { key: 'plans.inc.allTasks', plans: ['pro', 'vip'] },
  { key: 'plans.inc.listening', plans: ['pro', 'vip'] },
  { key: 'plans.inc.shadowing', plans: ['vip'] },
  { key: 'plans.inc.tutor', plans: ['vip'] },
  { key: 'plans.inc.future', plans: ['vip'] },
]

const ICONS: Record<Plan, typeof Zap> = { free: Sprout, pro: Zap, vip: Crown }

const QUICK_SEATS = [10, 20, 30, 50]

/**
 * The plan cards and buying one: a student for themselves (Free, Pro, VIP), or a teacher for the students of a
 * class (Pro or VIP places). Choosing a card fills the order below; the price is planTotal (monthly × months × seats,
 * less the period's discount, and the teacher's on a package). A plan with no price yet says "soon" instead of buy
 * buttons.
 */
export function PlanCheckout({
  mode,
  pricing,
  maxSeats = 500,
  providers,
  groups = [],
  initialPlan = 'pro',
  current = null,
  signInHref,
}: {
  mode: 'student' | 'package'
  pricing: Pricing
  maxSeats?: number
  providers: { id: string; label: string }[]
  groups?: { id: string; name: string }[]
  initialPlan?: Paid
  /** The student's plan now, marked on its card */
  current?: Plan | null
  /** Signed out: the order asks to sign in instead */
  signInHref?: string
}) {
  const { t } = useI18n()
  const [plan, setPlan] = useState<Paid>(initialPlan)
  const monthsOptions = pricingMonths(pricing)
  const teacher = mode === 'package'
  const [months, setMonths] = useState<number>(monthsOptions[0] ?? 1)
  const [seats, setSeats] = useState('10')
  const [groupId, setGroupId] = useState(groups[0]?.id ?? '')
  const [accepted, setAccepted] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const order = useRef<HTMLElement>(null)

  const n = mode === 'package' ? Math.max(1, Math.min(maxSeats, Math.round(Number(seats) || 0))) : 1
  const price = planTotal(pricing, plan, months, n, teacher)
  const full = listPrice(pricing, plan, months, n)
  const off = orderDiscount(pricing, months, teacher)
  const plans: Plan[] = mode === 'package' ? ['pro', 'vip'] : ['free', 'pro', 'vip']

  /** One student's month with this order's discount */
  const perMonth = (p: Paid) => {
    const total = planTotal(pricing, p, months, 1, teacher)
    return total === null ? null : Math.round(total / months)
  }

  const choose = (p: Paid) => {
    setPlan(p)
    order.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const buy = async (provider: string) => {
    setBusy(provider)
    setError(null)
    const body = mode === 'package' ? { plan, months, seats: n, groupId: groupId || null, provider, acceptOffer: true } : { plan, months, provider, acceptOffer: true }
    const { ok, json } = await postJson(mode === 'package' ? '/api/packages/checkout' : '/api/plans/checkout', body)
    if (!ok || typeof json.url !== 'string') {
      setBusy(null)
      return setError(t('error.generic'))
    }
    window.location.href = json.url
  }

  const pill = (active: boolean) =>
    `t-body t-num min-h-10 rounded-full px-4 font-semibold transition-colors ${active ? 'bg-ink-700 text-paper-50 shadow-[var(--e-2)]' : 'text-ink-700 hover:bg-paper-300'}`

  return (
    <div className="flex flex-col gap-6">
      {teacher && pricing.teacherDiscount > 0 && (
        <p className="t-body mx-auto rounded-full bg-success-100 px-4 py-1.5 text-center font-semibold text-success-600">{t('plans.teacherDiscount', { n: pricing.teacherDiscount })}</p>
      )}
      <div className="flex justify-center">
        <div className="inline-flex flex-wrap justify-center gap-1 rounded-full border border-paper-300 bg-paper-200 p-1" role="radiogroup" aria-label={t('plans.months')}>
          {monthsOptions.map((m) => (
            <button key={m} type="button" role="radio" aria-checked={months === m} className={pill(months === m)} onClick={() => setMonths(m)}>
              {t('plans.monthsN', { n: m })}
              {(pricing.periodDiscount[String(m)] ?? 0) > 0 && (
                <span className={`t-small ml-1.5 rounded-full px-1.5 py-0.5 font-bold ${months === m ? 'bg-success-100 text-success-600' : 'text-success-600'}`}>
                  −{pricing.periodDiscount[String(m)]}%
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <section className={`grid items-stretch gap-4 pt-3 ${plans.length === 3 ? 'md:grid-cols-3' : 'md:grid-cols-2'}`} role="radiogroup" aria-label={t('plans.choosePlan')}>
        {plans.map((p) => (
          <PlanCard
            key={p}
            plan={p}
            mode={mode}
            perMonth={p === 'free' ? 0 : perMonth(p)}
            listMonthly={p === 'free' ? 0 : pricing.monthly[p]}
            periodTotal={p === 'free' ? 0 : planTotal(pricing, p, months, 1, teacher)}
            months={months}
            selected={p !== 'free' && plan === p}
            current={current === p}
            onChoose={p === 'free' ? undefined : () => choose(p)}
          />
        ))}
      </section>

      <section ref={order} className="scroll-mt-20 overflow-hidden rounded-[var(--r-xl)] border border-paper-300 bg-paper-50 shadow-[var(--e-2)]" aria-label={t('plans.order')}>
        <div className="grid md:grid-cols-[1fr_1.1fr]">
          <div className="flex flex-col gap-3 border-b border-paper-300 bg-paper-100 p-5 md:border-r md:border-b-0">
            <h2 className="t-h2">{t('plans.order')}</h2>
            <Row label={t('plans.plan')}>
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-semibold ${plan === 'vip' ? 'bg-[var(--vip-bg)] text-[var(--vip-gold)]' : 'bg-orange-100 text-orange-700'}`}>
                {plan === 'vip' ? <Crown size={14} aria-hidden /> : <Zap size={14} aria-hidden />}
                {t(`plans.name.${plan}` as MessageKey)}
              </span>
            </Row>
            <Row label={t('plans.months')}>{t('plans.monthsN', { n: months })}</Row>
            {mode === 'package' && (
              <>
                <Row label={t('plans.seats')}>
                  <div className="flex items-center gap-1">
                    <StepButton label={t('plans.seatsLess')} onClick={() => setSeats(String(Math.max(1, n - 1)))} disabled={n <= 1}>
                      <Minus size={16} aria-hidden />
                    </StepButton>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={maxSeats}
                      value={seats}
                      aria-label={t('plans.seats')}
                      onChange={(e) => setSeats(e.target.value)}
                      onBlur={() => setSeats(String(n))}
                      className="t-body t-num h-10 w-16 rounded-md border border-paper-300 bg-paper-50 text-center font-semibold"
                    />
                    <StepButton label={t('plans.seatsMore')} onClick={() => setSeats(String(Math.min(maxSeats, n + 1)))} disabled={n >= maxSeats}>
                      <Plus size={16} aria-hidden />
                    </StepButton>
                  </div>
                </Row>
                <div className="flex flex-wrap justify-end gap-1.5">
                  {QUICK_SEATS.filter((q) => q <= maxSeats).map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => setSeats(String(q))}
                      className={`t-small t-num rounded-full border px-3 py-1 font-semibold ${n === q ? 'border-orange-500 bg-orange-100 text-orange-700' : 'border-paper-300 text-ink-500 hover:bg-paper-200'}`}
                    >
                      {q}
                    </button>
                  ))}
                </div>
                {groups.length > 0 && (
                  <Row label={t('plans.forGroup')}>
                    <select value={groupId} onChange={(e) => setGroupId(e.target.value)} className="t-body min-h-10 max-w-48 rounded-md border border-paper-300 bg-paper-50 px-3">
                      {groups.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name}
                        </option>
                      ))}
                    </select>
                  </Row>
                )}
              </>
            )}
            <div className="mt-auto flex flex-col gap-2 border-t border-dashed border-paper-400 pt-3">
              {price !== null && off > 0 && full !== null && (
                <Row label={t('plans.discount', { n: off })}>
                  <span className="t-num text-ink-500 line-through">{formatKrw(full)}</span>{' '}
                  <span className="t-num font-semibold text-success-600">−{formatKrw(full - price)}</span>
                </Row>
              )}
              <Row label={t('plans.total')}>
                {price === null ? (
                  <span className="text-ink-500">{t('plans.priceSoonShort')}</span>
                ) : (
                  <span className="t-h1 t-num">{t('course.priceValue', { price: formatKrw(price) })}</span>
                )}
              </Row>
            </div>
          </div>

          <div className="flex flex-col justify-center gap-4 p-5">
            {signInHref ? (
              <Link href={signInHref} className="btn btn-primary btn-xl">
                <span className="btn-label">{t('plans.signInToBuy')}</span>
              </Link>
            ) : price === null ? (
              <p className="t-body flex items-start gap-3 rounded-lg bg-paper-200 p-4 text-ink-700">
                <Clock size={22} strokeWidth={ICON.strokeWidth} className="mt-0.5 shrink-0 text-orange-700" aria-hidden />
                {t('plans.priceSoon')}
              </p>
            ) : providers.length === 0 ? (
              <p className="t-body text-ink-500">{t('course.noProviders')}</p>
            ) : (
              <>
                <label className="t-small flex cursor-pointer items-start gap-2 text-ink-700">
                  <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} className="mt-0.5 size-5 shrink-0 accent-orange-500" />
                  <span>
                    <LinkedText text={t('legal.acceptOffer', { offer: slot('offer') })} links={{ offer: { href: '/terms', label: t('legal.offerLink') } }} />
                  </span>
                </label>
                <div className="flex flex-col gap-2">
                  {providers.map((p, i) => (
                    <Button
                      key={p.id}
                      size="xl"
                      variant={i === 0 ? 'primary' : 'secondary'}
                      onClick={() => buy(p.id)}
                      loading={busy === p.id}
                      disabled={!!busy || !accepted}
                      icon={<CreditCard size={20} strokeWidth={ICON.strokeWidth} aria-hidden />}
                    >
                      {t('course.buyWith', { provider: p.label })}
                    </Button>
                  ))}
                </div>
              </>
            )}
            {/* About the provider's own payment page */}
            {providers.length > 0 && (
              <p className="t-small flex items-start gap-2 text-ink-500">
                <ShieldCheck size={18} strokeWidth={ICON.strokeWidth} className="mt-0.5 shrink-0 text-success-600" aria-hidden />
                {t('plans.secure')}
              </p>
            )}
            {error && (
              <p role="alert" className="t-small text-error-600">
                {error}
              </p>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="t-body flex items-center justify-between gap-3">
      <span className="text-ink-500">{label}</span>
      <span className="text-right text-ink-800">{children}</span>
    </div>
  )
}

function StepButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="press inline-flex size-10 items-center justify-center rounded-full border border-paper-300 bg-paper-50 text-ink-700 hover:bg-paper-200 disabled:opacity-40"
    >
      {children}
    </button>
  )
}

/** One plan: Free on paper, Pro raised in orange, VIP in night navy and gold */
function PlanCard({
  plan,
  mode,
  perMonth,
  listMonthly,
  periodTotal,
  months,
  selected,
  current,
  onChoose,
}: {
  plan: Plan
  mode: 'student' | 'package'
  /** What one month costs with this order's discount; null = not on sale */
  perMonth: number | null
  /** The monthly price before any discount (crossed out when there is one) */
  listMonthly: number | null
  /** The whole period for one student, discounted */
  periodTotal: number | null
  months: number
  selected: boolean
  current: boolean
  onChoose?: () => void
}) {
  const { t } = useI18n()
  const vip = plan === 'vip'
  const Icon = ICONS[plan]
  const frame = vip
    ? `bg-[var(--vip-bg)] text-[var(--vip-text)] border ${selected ? 'border-[var(--vip-gold)] ring-2 ring-[var(--vip-gold)]' : 'border-[color-mix(in_srgb,var(--vip-gold)_45%,transparent)]'}`
    : plan === 'pro'
      ? `bg-paper-50 border-2 ${selected ? 'border-orange-500 ring-4 ring-orange-100' : 'border-orange-400'} md:-translate-y-2`
      : `bg-paper-100 border ${current ? 'border-ink-700' : 'border-paper-300'}`
  const soft = vip ? 'text-[var(--vip-soft)]' : 'text-ink-500'

  return (
    <div
      role={onChoose ? 'radio' : undefined}
      aria-checked={onChoose ? selected : undefined}
      tabIndex={onChoose ? 0 : undefined}
      onClick={onChoose}
      onKeyDown={(e) => {
        if (onChoose && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          onChoose()
        }
      }}
      // Headings take --text-strong; on the night-navy card that is the card's own light text
      style={vip ? ({ '--text-strong': 'var(--vip-text)' } as CSSProperties) : undefined}
      className={`relative flex flex-col gap-4 rounded-[var(--r-xl)] p-5 shadow-[var(--e-3)] transition-[box-shadow,border-color] ${onChoose ? 'cursor-pointer' : ''} ${frame}`}
    >
      {vip && (
        // A soft gold glow in the corner
        <span aria-hidden className="pointer-events-none absolute inset-0 rounded-[inherit] bg-[radial-gradient(120%_70%_at_100%_0%,color-mix(in_srgb,var(--vip-gold)_22%,transparent),transparent_60%)]" />
      )}
      {(plan === 'pro' || current) && (
        <span
          className={`t-small absolute -top-3 left-5 rounded-full px-3 py-0.5 font-bold shadow-[var(--e-2)] ${current ? 'bg-ink-700 text-paper-50' : 'bg-orange-500 text-[var(--on-orange)]'}`}
        >
          {current ? t('plans.current') : t('plans.recommended')}
        </span>
      )}

      <div className="relative flex items-center gap-3">
        <span
          className={`inline-flex size-12 shrink-0 items-center justify-center rounded-[var(--r-lg)] ${vip ? 'bg-[color-mix(in_srgb,var(--vip-gold)_16%,transparent)] text-[var(--vip-gold)]' : plan === 'pro' ? 'bg-orange-100 text-orange-700' : 'bg-success-100 text-success-600'}`}
        >
          <Icon size={26} strokeWidth={ICON.strokeWidth} aria-hidden />
        </span>
        <div className="min-w-0">
          <h3 className="t-h1 leading-tight" style={vip ? { color: 'var(--vip-gold)', letterSpacing: '0.04em' } : undefined}>{t(`plans.name.${plan}` as MessageKey)}</h3>
          <p className={`t-small ${soft}`}>{t(`plans.tag.${plan}` as MessageKey)}</p>
        </div>
      </div>

      <div className="relative">
        {perMonth === null ? (
          <p className="t-h2">{t('plans.priceSoonShort')}</p>
        ) : (
          <>
            {plan !== 'free' && listMonthly !== null && listMonthly > perMonth && (
              <p className={`t-small t-num line-through ${soft}`}>{formatKrw(listMonthly)}</p>
            )}
            <p className="flex flex-wrap items-baseline gap-x-2">
              <span className="t-display-2 t-num leading-none">{plan === 'free' ? '0' : formatKrw(perMonth)}</span>
              <span className={`t-small ${soft}`}>{t(mode === 'package' ? 'plans.sumPerSeatMonth' : 'plans.sumPerMonth')}</span>
            </p>
            <p className={`t-small t-num mt-1 ${soft}`}>
              {plan === 'free' ? t('plans.free') : months > 1 && periodTotal !== null ? t('plans.forPeriod', { period: t('plans.monthsN', { n: months }), price: formatKrw(periodTotal) }) : ' '}
            </p>
          </>
        )}
      </div>

      <hr className={`relative border-0 border-t ${vip ? 'border-[color-mix(in_srgb,var(--vip-gold)_35%,transparent)]' : 'border-paper-300'}`} />

      <ul className="relative flex flex-col gap-2.5">
        {FEATURES.map((f) => {
          const has = f.plans.includes(plan)
          return (
            <li key={f.key} className={`t-body flex gap-2.5 ${has ? '' : `opacity-55 ${soft}`}`}>
              <span
                className={`mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full ${has ? (vip ? 'bg-[var(--vip-gold)] text-[var(--vip-bg)]' : 'bg-success-600 text-paper-50') : vip ? 'bg-white/10' : 'bg-paper-300'}`}
              >
                {has ? <Check size={13} strokeWidth={3} aria-hidden /> : <Minus size={12} strokeWidth={3} aria-hidden />}
              </span>
              <span>
                <span className="sr-only">{has ? '✓ ' : '— '}</span>
                {t(f.key)}
              </span>
            </li>
          )
        })}
      </ul>

      {onChoose && (
        <div className="relative mt-auto pt-1">
          <span
            className={`btn btn-xl ${selected ? (vip ? 'bg-[var(--vip-gold)] text-[var(--vip-bg)]' : 'btn-primary') : vip ? 'border border-[var(--vip-gold)] bg-transparent text-[var(--vip-gold)]' : 'btn-secondary'}`}
            aria-hidden
          >
            <span className="btn-label">
              {selected && <Check size={18} strokeWidth={3} aria-hidden />}
              {selected ? t('plans.chosen') : t('plans.choose')}
            </span>
          </span>
        </div>
      )}
    </div>
  )
}
