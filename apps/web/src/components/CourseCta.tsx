'use client'
import { CreditCard, Play, ShieldCheck } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { formatKrw } from '@ikhimi/i18n'
import { Button, ICON } from '@ikhimi/ui/components'
import { LinkedText, slot } from '@/components/LinkedText'
import { useI18n } from '@/i18n/client'
import { postJson } from '@/lib/client'

type Access = 'owner' | 'bought' | 'group' | 'enrolled' | 'open'

/**
 * The course page's action: start or continue, and for a paid course not bought yet (DECISIONS.md BL) its price
 * with the way to buy it (a payment gateway, once one is connected) next to "try the free part".
 * Nothing is sold in the store apps: there only the free part.
 */
export function CourseCta({
  courseId,
  slug,
  access,
  signedIn,
  firstLessonId,
  buy,
  priceKrw,
  providers = [],
  store = false,
  justPaid = false,
}: {
  courseId: string
  slug: string
  access: Access
  signedIn: boolean
  firstLessonId: string | null
  /** A paid course the viewer hasn't got */
  buy: boolean
  priceKrw: number | null
  providers?: { id: string; label: string }[]
  store?: boolean
  justPaid?: boolean
}) {
  const { t } = useI18n()
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [accepted, setAccepted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lessonHref = firstLessonId ? `/course/${slug}/${firstLessonId}` : `/course/${slug}`

  if (!signedIn) {
    return (
      <div className="flex flex-col gap-3">
        {buy && priceKrw && !store && <Price priceKrw={priceKrw} />}
        <Link href={`/signin?as=student&next=${encodeURIComponent(`/course/${slug}`)}`} className="btn btn-primary btn-lg">
          <span className="btn-label">{t('course.signInToStart')}</span>
        </Link>
      </div>
    )
  }

  // One tap to join (a paid course: its free part)
  const start = async () => {
    setBusy('start')
    const { ok } = access === 'open' ? await postJson(`/api/courses/${courseId}/enroll`, {}) : { ok: true }
    if (!ok) {
      setBusy(null)
      return setError(t('error.generic'))
    }
    router.push(lessonHref)
    router.refresh()
  }

  const pay = async (provider: string) => {
    setBusy(provider)
    setError(null)
    const { ok, json } = await postJson(`/api/courses/${courseId}/checkout`, { provider, acceptOffer: true })
    if (!ok || typeof json.url !== 'string') {
      setBusy(null)
      return setError(t('error.generic'))
    }
    window.location.href = json.url
  }

  if (!buy) {
    if (access === 'open') {
      return (
        <div className="flex flex-col gap-2">
          <Button size="lg" onClick={start} loading={busy === 'start'} icon={<Play size={20} strokeWidth={ICON.strokeWidth} aria-hidden />}>
            {t('course.start')}
          </Button>
          {error && (
            <p role="alert" className="t-small text-error-600">
              {error}
            </p>
          )}
        </div>
      )
    }
    return (
      <div className="flex flex-col gap-2">
        {access === 'group' && <p className="t-small text-ink-500">{t('course.yourAccess.group')}</p>}
        {access === 'bought' && <p className="t-small font-semibold text-success-600">{t('courseSale.yours')}</p>}
        <Link href={lessonHref} className="btn btn-primary btn-lg">
          <span className="btn-label">
            <Play size={20} strokeWidth={ICON.strokeWidth} aria-hidden /> {access === 'owner' ? t('course.view') : t('course.continue')}
          </span>
        </Link>
      </div>
    )
  }

  // A paid course, not bought
  const tryFree = (
    <Button variant={store ? 'primary' : 'secondary'} size="lg" onClick={start} loading={busy === 'start'} icon={<Play size={20} strokeWidth={ICON.strokeWidth} aria-hidden />}>
      {t('courseSale.tryFree')}
    </Button>
  )
  if (store) return <div className="flex flex-col gap-2">{tryFree}</div>
  return (
    <div className="flex flex-col gap-3 rounded-2xl border-2 border-orange-500 bg-orange-100 p-4">
      {priceKrw && <Price priceKrw={priceKrw} />}
      <p className="t-small text-ink-700">{t('courseSale.whatYouGet')}</p>
      {justPaid && <p className="t-body font-medium text-ink-700">{t('plans.paidPending')}</p>}
      {providers.length > 0 ? (
        <>
          <label className="t-small flex cursor-pointer items-start gap-2 text-ink-700">
            <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} className="mt-0.5 size-5 shrink-0 accent-orange-500" />
            <span>
              <LinkedText text={t('legal.acceptOffer', { offer: slot('offer') })} links={{ offer: { href: '/terms', label: t('legal.offerLink') } }} />
            </span>
          </label>
          {providers.map((p, i) => (
            <Button
              key={p.id}
              size="lg"
              variant={i === 0 ? 'primary' : 'secondary'}
              onClick={() => pay(p.id)}
              loading={busy === p.id}
              disabled={!!busy || !accepted}
              icon={<CreditCard size={20} strokeWidth={ICON.strokeWidth} aria-hidden />}
            >
              {t('course.buyWith', { provider: p.label })}
            </Button>
          ))}
          <p className="t-small flex items-start gap-2 text-ink-500">
            <ShieldCheck size={18} strokeWidth={ICON.strokeWidth} className="mt-0.5 shrink-0 text-success-600" aria-hidden />
            {t('plans.secure')}
          </p>
        </>
      ) : (
        <p className="t-body text-ink-500">{t('course.noProviders')}</p>
      )}
      {tryFree}
      {error && (
        <p role="alert" className="t-small text-error-600">
          {error}
        </p>
      )}
    </div>
  )
}

function Price({ priceKrw }: { priceKrw: number }) {
  const { t } = useI18n()
  return (
    <p className="flex flex-wrap items-baseline gap-x-2">
      <span className="t-display-2 t-num">{t('course.priceValue', { price: formatKrw(priceKrw) })}</span>
      <span className="t-small text-ink-500">{t('courseSale.once')}</span>
    </p>
  )
}
