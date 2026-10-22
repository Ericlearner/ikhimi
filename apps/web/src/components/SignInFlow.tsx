'use client'
import { LinkedText, slot } from '@/components/LinkedText'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { AsYouType } from 'libphonenumber-js/min'
import { formatPhone, listCountries, normalizePhone, type CountryCode, type MessageKey } from '@ikhimi/i18n'
import { useI18n } from '@/i18n/client'
import { appleSignIn } from '@/lib/ios-app'
import { LinkTelegram } from './LinkTelegram'
import { Button, Chip, Input, OtpInput, Spinner, TaskIcon } from '@ikhimi/ui/components'
import { SUBJECTS } from '@ikhimi/ai/exams'

type Step = 'phone' | 'code' | 'telegram' | 'setPassword' | 'confirmPassword' | 'profile'

const flag = (cc: string) => String.fromCodePoint(...[...cc].map((c) => 0x1f1a5 + c.charCodeAt(0)))


async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  return { ok: res.ok, json }
}

const TG_KEY = 'tl_tg_login'

export function SignInFlow({
  initialStep = 'phone',
  telegramEnabled = false,
  appleEnabled = false,
  phoneEnabled = true,
  next = '/app',
  audience = null,
  chooseRole = false,
  newAppleAccount = false,
  googleEnabled = false,
  initialName = '',
  initialError = null,
  initialPassword = null,
}: {
  initialStep?: Step
  telegramEnabled?: boolean
  /** In the iOS app: Sign in with Apple, first (App Store rule 4.8) */
  appleEnabled?: boolean
  phoneEnabled?: boolean
  /** Where to go after login (e.g. back to the homework link) */
  next?: string
  /** The way in asked for a role (a homework link: student); null = an existing account keeps its own, a new one chooses */
  audience?: 'teacher' | 'student' | null
  /** Signed in already, but a new account that hasn't chosen teacher or student yet */
  chooseRole?: boolean
  /** Signed in already with a new Apple or Google account: it may belong to someone who used Telegram before */
  newAppleAccount?: boolean
  /** The website, with GOOGLE_CLIENT_ID set: Continue with Google */
  googleEnabled?: boolean
  /** The name the account already has (from Google or Apple), to start the welcome form with */
  initialName?: string
  /** Came back from Google with a problem */
  initialError?: MessageKey | null
  /** Signed in by the bot's "로그인" button: start at setting a password, then go on as the sign-in would */
  initialPassword?: { phone: string; hasPassword: boolean; needsOnboarding: boolean; needsRole: boolean; role: string } | null
}) {
  const { t, locale } = useI18n()
  const router = useRouter()
  const [step, setStep] = useState<Step>(initialStep)
  const [country, setCountry] = useState<CountryCode>('KR')
  const [digits, setDigits] = useState('')
  // Country names come from the browser's Intl data, which differs from Node's — resolve them
  // after mount so server and client HTML match.
  const [names, setNames] = useState<Intl.DisplayNames | null>(null)
  useEffect(() => {
    try {
      setNames(new Intl.DisplayNames(['ko'], { type: 'region' }))
    } catch {}
  }, [locale])
  const countries = useMemo(() => listCountries().map((c) => ({ ...c, name: names?.of(c.code) ?? c.code })), [names])
  const dial = countries.find((c) => c.code === country)?.dial ?? '82'
  const isKr = country === 'KR'
  // Typed nationally (010-1234-5678) or without the leading 0 (10-1234-5678)
  const fullNumber = normalizePhone(digits, country) ?? normalizePhone(`+${dial}${digits}`, country)
  const [phone, setPhone] = useState('')
  const [channel, setChannel] = useState<'sms' | 'telegram'>('sms')
  const [code, setCode] = useState('')
  const [name, setName] = useState(initialName)
  const [password, setPassword] = useState('')
  // After Telegram or a code proved the number: set a password, then sign in with it once (the device remembers)
  const [pwPhone, setPwPhone] = useState(initialPassword?.phone ?? '')
  const [hadPassword, setHadPassword] = useState(!!initialPassword?.hasPassword)
  const [newPassword, setNewPassword] = useState('')
  const [newPassword2, setNewPassword2] = useState('')
  const pending = useRef<Record<string, unknown> | null>(initialPassword)
  const [subject, setSubject] = useState<(typeof SUBJECTS)[number] | null>(null)
  // A new account says once whether it teaches or learns; nothing else ever adds a role
  const [needsRole, setNeedsRole] = useState(chooseRole)
  const [role, setRole] = useState<'teacher' | 'student' | null>(audience)
  // A new Apple account: someone who used Telegram before can go to that account instead of starting again
  const [appleNew, setAppleNew] = useState(newAppleAccount)
  const afterSignIn = (json: Record<string, unknown>) => {
    if (json.needsPassword && typeof json.phone === 'string') {
      pending.current = json
      setPwPhone(json.phone)
      setHadPassword(!!json.hasPassword)
      setError(null)
      setStep('setPassword')
      return
    }
    if (json.appleNew) setAppleNew(true)
    if (json.needsRole) setNeedsRole(true)
    else if (json.role === 'teacher' || json.role === 'student') setRole(json.role)
    if (json.needsOnboarding) setStep('profile')
    else {
      router.push(next)
      router.refresh()
    }
  }
  const [error, setError] = useState<string | null>(initialError ? t(initialError) : null)
  const [busy, setBusy] = useState(false)
  const [resendIn, setResendIn] = useState(0)
  const [tg, setTg] = useState<{ token: string; botUrl: string } | null>(null)

  // Resume a Telegram login if the page was reloaded while the user was in Telegram
  useEffect(() => {
    if (initialStep !== 'phone') return
    try {
      const saved = sessionStorage.getItem(TG_KEY)
      if (saved) {
        setTg(JSON.parse(saved))
        setStep('telegram')
      }
    } catch {}
  }, [initialStep])

  // Poll while waiting for the user to share their number in Telegram
  useEffect(() => {
    if (step !== 'telegram' || !tg) return
    let stopped = false
    const check = async () => {
      if (stopped) return
      const { json } = await post('/api/auth/telegram/poll', { token: tg.token, as: audience ?? undefined }).catch(() => ({ json: {} as Record<string, unknown> }))
      if (stopped || json.status === 'pending' || !json.status) return
      stopped = true
      try {
        sessionStorage.removeItem(TG_KEY)
      } catch {}
      if (json.status === 'approved') afterSignIn(json)
      else {
        setTg(null)
        setStep('phone')
        setError(t(json.status === 'blocked' ? 'error.accountBlocked' : 'tg.expired'))
      }
    }
    const id = setInterval(check, 2000)
    const onVisible = () => document.visibilityState === 'visible' && void check()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [step, tg]) // eslint-disable-line react-hooks/exhaustive-deps

  const startTelegram = async () => {
    setError(null)
    // Open the tab synchronously in the click handler so popup blockers allow it
    const win = window.open('', '_blank')
    setBusy(true)
    // The role and the page to go to are kept for the bot's "로그인" link, in case this tab is lost
    const { ok, json } = await post('/api/auth/telegram/start', { as: audience ?? undefined, next }).finally(() => setBusy(false))
    if (!ok) {
      win?.close()
      return setError(errorText(json))
    }
    const login = { token: String(json.token), botUrl: String(json.botUrl) }
    if (win) win.location.href = login.botUrl
    setTg(login)
    setStep('telegram')
    try {
      sessionStorage.setItem(TG_KEY, JSON.stringify(login))
    } catch {}
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
      afterSignIn(json)
    } catch {
      setError(t('error.generic'))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (resendIn <= 0) return
    const id = setTimeout(() => setResendIn((s) => s - 1), 1000)
    return () => clearTimeout(id)
  }, [resendIn])

  const errorText = (json: Record<string, unknown>): string => {
    const map: Record<string, MessageKey> = {
      phone_invalid: 'error.phoneInvalid',
      code_invalid: 'error.codeInvalid',
      code_expired: 'error.codeExpired',
      code_too_many_attempts: 'error.codeExpired',
      telegram_unavailable: 'error.telegramUnavailable',
      sms_unavailable: 'error.smsUnavailable',
      account_blocked: 'error.accountBlocked',
      password_invalid: 'error.passwordInvalid',
      password_too_short: 'password.tooShort',
      password_too_long: 'password.tooLong',
      password_too_common: 'password.tooCommon',
      password_is_phone: 'password.isPhone',
    }
    if (json.error === 'rate_limited') {
      return t('error.tooManyRequests', { minutes: Math.max(1, Math.ceil(Number(json.retryAfterSeconds ?? 60) / 60)) })
    }
    return t(map[String(json.error)] ?? 'error.generic')
  }

  const sendCode = async (e?: FormEvent) => {
    e?.preventDefault()
    setError(null)
    if (!fullNumber) return setError(t('error.phoneInvalid'))
    setBusy(true)
    const { ok, json } = await post('/api/auth/otp/send', { phone: fullNumber }).finally(() => setBusy(false))
    if (!ok) return setError(errorText(json))
    setPhone(String(json.phone))
    setChannel(json.channel === 'telegram' ? 'telegram' : 'sms')
    setResendIn(Number(json.resendAfterSeconds ?? 60))
    setCode('')
    setStep('code')
  }

  const signInWithPassword = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!fullNumber) return setError(t('error.phoneInvalid'))
    if (!password) return setError(t('error.passwordInvalid'))
    setBusy(true)
    const { ok, json } = await post('/api/auth/password', { phone: fullNumber, password, as: audience ?? undefined }).finally(() => setBusy(false))
    if (!ok) return setError(errorText(json))
    afterSignIn(json)
  }

  const savePassword = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (newPassword.length < 8) return setError(t('password.tooShort'))
    if (newPassword !== newPassword2) return setError(t('password.mismatch'))
    setBusy(true)
    const { ok, json } = await post('/api/profile/password', { password: newPassword }).finally(() => setBusy(false))
    if (!ok) return setError(errorText(json))
    setNewPassword('')
    setNewPassword2('')
    setPassword('')
    setStep('confirmPassword')
  }

  // The one sign-in with the new password: the browser offers to save it, and this device stays signed in
  const confirmPassword = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const { ok, json } = await post('/api/auth/password', { phone: pwPhone, password, as: audience ?? undefined }).finally(() => setBusy(false))
    if (!ok) return setError(errorText(json))
    afterSignIn(json)
  }

  const startGoogle = () => {
    setBusy(true)
    const q = new URLSearchParams({ next })
    if (audience) q.set('as', audience)
    window.location.href = `/api/auth/google/start?${q}`
  }

  const verify = async (value: string) => {
    setError(null)
    setBusy(true)
    const { ok, json } = await post('/api/auth/otp/verify', { phone, code: value, as: audience ?? undefined }).finally(() => setBusy(false))
    if (!ok) {
      setCode('')
      return setError(errorText(json))
    }
    afterSignIn(json)
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

  // Three screens, progress dots so it feels finite (design spec §11)
  const stepIndex = step === 'profile' ? 2 : step === 'phone' ? 0 : 1

  return (
    <div className="w-full max-w-sm">
      <ol className="mb-8 flex justify-center gap-2" aria-label={`${stepIndex + 1} / 3`}>
        {[0, 1, 2].map((i) => (
          <li key={i} className={`h-2 rounded-pill transition-all ${i === stepIndex ? 'w-6 bg-orange-500' : i < stepIndex ? 'w-2 bg-ink-700' : 'w-2 bg-paper-300'}`} />
        ))}
      </ol>

      {step === 'phone' && (
        <div className="fade-in flex flex-col gap-6">
          {/* The way in: the phone number and the password set once after the number was confirmed */}
          <form onSubmit={signInWithPassword} className="flex flex-col gap-4" noValidate>
          <label className="flex flex-col gap-2">
            <span className="t-small font-medium text-ink-500">{t('auth.phone')}</span>
            <div className="flex items-stretch overflow-hidden rounded-lg border border-paper-300 bg-paper-50 focus-within:border-ink-700">
              {/* People abroad sign up with their local number — Korea is just the default */}
              <span className="t-body-lg relative flex shrink-0 items-center whitespace-nowrap border-r border-paper-300 bg-paper-200 px-3 font-medium text-ink-500">
                <span aria-hidden>
                  {flag(country)} +{dial}
                </span>
                <select
                  value={country}
                  onChange={(e) => {
                    setCountry(e.target.value as CountryCode)
                    setDigits('')
                  }}
                  aria-label={`${t('auth.phone')}: +${dial}`}
                  className="absolute inset-0 cursor-pointer opacity-0"
                >
                  {countries.map((c) => (
                    <option key={c.code} value={c.code}>
                      {flag(c.code)} {c.name} +{c.dial}
                    </option>
                  ))}
                </select>
              </span>
              <input
                type="tel"
                inputMode="tel"
                autoComplete="tel-national"
                autoFocus
                placeholder={isKr ? '010-1234-5678' : ''}
                value={new AsYouType(country).input(digits)}
                onChange={(e) => {
                  const raw = e.target.value
                  // Pasted a full international number: switch country to match
                  if (raw.trim().startsWith('+')) {
                    const typer = new AsYouType()
                    typer.input(raw)
                    const cc = typer.getCountry()
                    const n = typer.getNumber()
                    if (cc && n) {
                      setCountry(cc)
                      setDigits(n.nationalNumber)
                      return
                    }
                  }
                  let d = raw.replace(/\D/g, '')
                  if (isKr && d.startsWith('82') && d.length > 11) d = `0${d.slice(2)}`
                  setDigits(d.slice(0, 15))
                }}
                className="t-body-lg t-num min-h-14 w-full bg-transparent px-3 tracking-wide text-ink-800 placeholder:text-ink-400 focus:outline-none"
                aria-invalid={!!error}
              />
            </div>
          </label>
            <label className="flex flex-col gap-2">
              <span className="t-small font-medium text-ink-500">{t('auth.password')}</span>
              <Input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                maxLength={128}
                className="t-body-lg min-h-14"
                aria-invalid={!!error}
              />
            </label>
            <Button type="submit" size="xl" disabled={!fullNumber || !password} loading={busy}>
              {t('auth.signIn')}
            </Button>
          </form>

          {/* Telegram (or a code) only proves the number: the first time, or when the password is forgotten */}
          {(telegramEnabled || phoneEnabled) && (
            <div className="flex flex-col gap-3 rounded-lg border border-paper-300 bg-paper-50 p-4">
              <p className="t-h3">{t('auth.firstTime')}</p>
              <p className="t-small -mt-2 text-ink-500">{t('auth.firstTimeHint')}</p>
              {telegramEnabled && (
                <Button variant="telegram" size="lg" onClick={startTelegram} loading={busy}>
                  <svg viewBox="0 0 24 24" className="size-5 fill-current" aria-hidden>
                    <path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z" />
                  </svg>
                  {t('auth.telegramVerify')}
                </Button>
              )}
              {phoneEnabled && (
                <button type="button" className="t-small min-h-11 font-medium text-ink-500 underline underline-offset-4" onClick={() => sendCode()}>
                  {t('auth.codeVerify')}
                </button>
              )}
            </div>
          )}

          {(appleEnabled || googleEnabled) && (
            <div className="flex flex-col gap-4">
              <div className="t-small flex items-center gap-3 text-ink-400">
                <span className="h-px flex-1 bg-paper-300" />
                {t('auth.orOther')}
                <span className="h-px flex-1 bg-paper-300" />
              </div>
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
          )}

          <p className="t-small text-center text-ink-500">
            <LinkedText
              text={t('legal.acceptSignin', { terms: slot('terms'), privacy: slot('privacy') })}
              links={{ terms: { href: '/terms', label: t('legal.termsLink') }, privacy: { href: '/privacy', label: t('legal.privacyLink') } }}
            />
          </p>
        </div>
      )}

      {step === 'telegram' && tg && (
        <div className="fade-in flex flex-col items-start gap-4">
          <p className="t-body-lg">{t('auth.telegramWaiting')}</p>
          <Spinner className="size-6 text-ink-500" />
          <a href={tg.botUrl} target="_blank" rel="noopener noreferrer" className="t-h3 min-h-11 text-ink-800 underline underline-offset-4">
            {t('auth.telegramOpenAgain')}
          </a>
          <button
            type="button"
            className="t-small min-h-11 font-medium text-ink-500 underline-offset-4 hover:underline"
            onClick={() => {
              try {
                sessionStorage.removeItem(TG_KEY)
              } catch {}
              setTg(null)
              setStep('phone')
            }}
          >
            ← {t('auth.signIn')}
          </button>
        </div>
      )}

      {step === 'setPassword' && (
        <form onSubmit={savePassword} className="fade-in flex flex-col gap-4" noValidate>
          <h2 className="t-h2">{t(hadPassword ? 'auth.newPasswordTitle' : 'auth.setPasswordTitle')}</h2>
          <p className="t-body -mt-2 text-ink-500">{t(hadPassword ? 'auth.newPasswordBody' : 'auth.setPasswordBody')}</p>
          {/* For the browser's password manager: whose password this is */}
          <input type="text" name="username" autoComplete="username" value={pwPhone} readOnly hidden />
          <label className="flex flex-col gap-2">
            <span className="t-small font-medium text-ink-500">{t('password.new')}</span>
            <Input type="password" autoComplete="new-password" autoFocus value={newPassword} onChange={(e) => setNewPassword(e.target.value)} maxLength={128} className="t-body-lg min-h-14" />
            <span className="t-small text-ink-400">{t('password.rules')}</span>
          </label>
          <label className="flex flex-col gap-2">
            <span className="t-small font-medium text-ink-500">{t('password.again')}</span>
            <Input type="password" autoComplete="new-password" value={newPassword2} onChange={(e) => setNewPassword2(e.target.value)} maxLength={128} className="t-body-lg min-h-14" />
          </label>
          <Button type="submit" size="xl" disabled={!newPassword || !newPassword2} loading={busy}>
            {t('action.save')}
          </Button>
          {hadPassword && (
            <button type="button" className="t-small min-h-11 font-medium text-ink-500 underline underline-offset-4" onClick={() => pending.current && afterSignIn({ ...pending.current, needsPassword: false })}>
              {t('auth.keepPassword')}
            </button>
          )}
        </form>
      )}

      {step === 'confirmPassword' && (
        <form onSubmit={confirmPassword} className="fade-in flex flex-col gap-4" noValidate>
          <h2 className="t-h2">{t('auth.confirmTitle')}</h2>
          <p className="t-body -mt-2 text-ink-500">{t('auth.confirmBody')}</p>
          <label className="flex flex-col gap-2">
            <span className="t-small font-medium text-ink-500">{t('auth.phone')}</span>
            <input type="tel" name="username" autoComplete="username" value={formatPhone(pwPhone)} readOnly className="t-body-lg t-num min-h-14 rounded-lg border border-paper-300 bg-paper-200 px-3 text-ink-700" />
          </label>
          <label className="flex flex-col gap-2">
            <span className="t-small font-medium text-ink-500">{t('auth.password')}</span>
            <Input type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} maxLength={128} className="t-body-lg min-h-14" />
          </label>
          <Button type="submit" size="xl" disabled={!password} loading={busy}>
            {t('auth.signIn')}
          </Button>
        </form>
      )}

      {step === 'code' && (
        <div className="fade-in flex flex-col gap-5">
          <p className="t-body text-ink-500">{t(channel === 'telegram' ? 'auth.codeSentTelegram' : 'auth.codeSentTo', { phone: formatPhone(phone) })}</p>
          <OtpInput label={t('auth.code')} value={code} onChange={setCode} onComplete={(v) => void verify(v)} disabled={busy} />
          <div className="t-small flex flex-wrap items-center justify-between gap-2">
            <button type="button" className="min-h-11 font-medium text-ink-500 underline-offset-4 hover:underline" onClick={() => setStep('phone')}>
              {t('auth.changePhone')}
            </button>
            {resendIn > 0 ? (
              <span className="t-num text-ink-400">{t('auth.resendIn', { seconds: resendIn })}</span>
            ) : (
              <button type="button" className="min-h-11 font-semibold text-ink-800 underline underline-offset-4" onClick={() => sendCode()}>
                {t('auth.resend')}
              </button>
            )}
          </div>
        </div>
      )}

      {step === 'profile' && appleNew && telegramEnabled && (
        <div className="fade-in mb-6 flex flex-col items-start gap-3 rounded-lg border border-paper-300 bg-paper-50 p-4">
          <p className="t-body text-ink-700">{t('link.welcome')}</p>
          <LinkTelegram onLinked={() => setAppleNew(false)} />
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
