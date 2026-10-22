'use client'
import { LinkedText, slot } from '@/components/LinkedText'
import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import type { MessageKey } from '@ikhimi/i18n'
import { useI18n } from '@/i18n/client'
import { appleSignIn } from '@/lib/ios-app'
import { Button, Chip, Input, TaskIcon } from '@ikhimi/ui/components'
import { SUBJECTS } from '@ikhimi/ai/exams'

type Step = 'start' | 'profile'

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  return { ok: res.ok, json }
}

export function SignInFlow({
  initialStep = 'start',
  appleEnabled = false,
  googleEnabled = false,
  next = '/app',
  audience = null,
  chooseRole = false,
  initialName = '',
  initialError = null,
}: {
  initialStep?: Step
  /** In the iOS app: Sign in with Apple (App Store rule 4.8; Google refuses to sign in inside an iOS web view) */
  appleEnabled?: boolean
  /** The website and the Android apps, with GOOGLE_CLIENT_ID set: Continue with Google */
  googleEnabled?: boolean
  /** Where to go after login (e.g. back to the homework link) */
  next?: string
  /** The way in asked for a role (a homework link: student); null = an existing account keeps its own, a new one chooses */
  audience?: 'teacher' | 'student' | null
  /** Signed in already, but a new account that hasn't chosen teacher or student yet */
  chooseRole?: boolean
  /** The name the account already has (from Google or Apple), to start the welcome form with */
  initialName?: string
  /** Came back from Google with a problem */
  initialError?: MessageKey | null
}) {
  const { t } = useI18n()
  const router = useRouter()
  const [step, setStep] = useState<Step>(initialStep)
  const [name, setName] = useState(initialName)
  const [subject, setSubject] = useState<(typeof SUBJECTS)[number] | null>(null)
  // A new account says once whether it teaches or learns; nothing else ever adds a role
  const [needsRole, setNeedsRole] = useState(chooseRole)
  const [role, setRole] = useState<'teacher' | 'student' | null>(audience)
  const [error, setError] = useState<string | null>(initialError ? t(initialError) : null)
  const [busy, setBusy] = useState(false)

  const errorText = (json: Record<string, unknown>): string => {
    const map: Record<string, MessageKey> = { account_blocked: 'error.accountBlocked' }
    return t(map[String(json.error)] ?? 'error.generic')
  }

  const startApple = async () => {
    setError(null)
    setBusy(true)
    try {
      const apple = await appleSignIn()
      // Closed Apple's sheet: nothing to say
      if (!apple) return
      const { ok, json } = await post('/api/auth/apple', { ...apple, as: audience ?? undefined })
      if (!ok) return setError(errorText(json))
      if (json.needsRole) setNeedsRole(true)
      else if (json.role === 'teacher' || json.role === 'student') setRole(json.role)
      if (json.needsOnboarding) setStep('profile')
      else {
        router.push(next)
        router.refresh()
      }
    } catch {
      setError(t('error.generic'))
    } finally {
      setBusy(false)
    }
  }

  // Google's page, then back to /signin (api/auth/google/callback): the welcome questions or `next`
  const startGoogle = () => {
    setBusy(true)
    const q = new URLSearchParams({ next })
    if (audience) q.set('as', audience)
    window.location.href = `/api/auth/google/start?${q}`
  }

  const saveProfile = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (needsRole && !role) return setError(t('auth.roleRequired'))
    if (name.trim().length < 2) return setError(t('error.nameRequired'))
    setBusy(true)
    const { ok, json } = await post('/api/auth/profile', { fullName: name.trim(), subject: subject ?? undefined, role: needsRole ? role : undefined }).finally(() =>
      setBusy(false),
    )
    if (!ok) return setError(errorText(json))
    // A student's home is their work, whatever the default destination was
    router.push(json.role === 'student' && next === '/app' ? '/work' : next)
    router.refresh()
  }

  // Two screens, progress dots so it feels finite (design spec §11)
  const stepIndex = step === 'profile' ? 1 : 0

  return (
    <div className="w-full max-w-sm">
      <ol className="mb-8 flex justify-center gap-2" aria-label={`${stepIndex + 1} / 2`}>
        {[0, 1].map((i) => (
          <li key={i} className={`h-2 rounded-pill transition-all ${i === stepIndex ? 'w-6 bg-orange-500' : i < stepIndex ? 'w-2 bg-ink-700' : 'w-2 bg-paper-300'}`} />
        ))}
      </ol>

      {step === 'start' && (
        <div className="fade-in flex flex-col gap-6">
          {appleEnabled || googleEnabled ? (
            <div className="flex flex-col gap-4">
              <p className="t-body text-ink-500">{t(appleEnabled ? 'auth.appleIntro' : 'auth.googleIntro')}</p>
              {appleEnabled && (
                <Button variant="apple" size="xl" onClick={startApple} loading={busy}>
                  <svg viewBox="0 0 814 1000" className="size-5 fill-current" aria-hidden>
                    <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z" />
                  </svg>
                  {t('auth.appleLogin')}
                </Button>
              )}
              {googleEnabled && (
                <Button variant="secondary" size="xl" onClick={startGoogle} loading={busy}>
                  <svg viewBox="0 0 48 48" className="size-5" aria-hidden>
                    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
                    <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
                    <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
                    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
                  </svg>
                  {t('auth.googleLogin')}
                </Button>
              )}
            </div>
          ) : (
            <p className="t-body rounded-lg border border-paper-300 bg-paper-50 p-4 text-ink-700">{t('auth.unavailable')}</p>
          )}

          <p className="t-small text-center text-ink-500">
            <LinkedText
              text={t('legal.acceptSignin', { terms: slot('terms'), privacy: slot('privacy') })}
              links={{ terms: { href: '/terms', label: t('legal.termsLink') }, privacy: { href: '/privacy', label: t('legal.privacyLink') } }}
            />
          </p>
        </div>
      )}

      {step === 'profile' && (
        <form onSubmit={saveProfile} className="fade-in flex flex-col gap-5" noValidate>
          {needsRole && (
            <fieldset className="flex flex-col gap-2">
              <legend className="t-h3 mb-2">{t('auth.roleQuestion')}</legend>
              {(['teacher', 'student'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  aria-pressed={role === r}
                  onClick={() => setRole(r)}
                  className={`press flex items-center gap-3 rounded-lg border-2 p-4 text-left ${role === r ? 'border-orange-500 bg-orange-100' : 'border-paper-300 bg-paper-50 hover:bg-paper-200'}`}
                >
                  <TaskIcon name={r === 'teacher' ? 'graduation-cap' : 'books'} size={36} />
                  <span className="flex flex-col">
                    <span className="t-h3">{t(r === 'teacher' ? 'auth.roleTeacher' : 'auth.roleStudent')}</span>
                    <span className="t-small text-ink-500">{t(r === 'teacher' ? 'auth.roleTeacherHint' : 'auth.roleStudentHint')}</span>
                  </span>
                </button>
              ))}
            </fieldset>
          )}
          <label className="flex flex-col gap-2">
            <span className="t-small font-medium text-ink-500">{t('auth.name')}</span>
            <Input type="text" autoComplete="name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t('auth.namePlaceholder')} maxLength={80} className="t-body-lg min-h-14" />
          </label>
          {role === 'teacher' && (
            <fieldset className="flex flex-col gap-2">
              <legend className="t-small mb-2 font-medium text-ink-500">{t('auth.subject')}</legend>
              <div className="flex flex-wrap gap-2">
                {SUBJECTS.map((s) => (
                  <Chip key={s} selected={subject === s} onClick={() => setSubject(subject === s ? null : s)} className="min-h-11">
                    {t(`subject.${s}` as MessageKey)}
                  </Chip>
                ))}
              </div>
            </fieldset>
          )}
          <Button type="submit" size="xl" loading={busy}>
            {t('action.continue')}
          </Button>
        </form>
      )}

      {error && (
        <p role="alert" className="t-body slide-down mt-4 rounded-md border border-error-600 bg-error-100 px-4 py-3 font-medium text-error-600">
          {error}
        </p>
      )}
    </div>
  )
}
