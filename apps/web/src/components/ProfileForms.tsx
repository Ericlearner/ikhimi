'use client'
import { Check, Download, LogOut, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import type { MessageKey } from '@ikhimi/i18n'
import { Button, Chip, ICON, Input, SegmentedControl, Switch } from '@ikhimi/ui/components'
import { configureSound, DEFAULT_LEARNER_PACK, LEARNER_PACKS, previewPack, type LearnerPack } from '@ikhimi/ui/sound'
import { isLanguageSubject, SUBJECTS } from '@ikhimi/ai/exams'
import { useI18n } from '@/i18n/client'
import { postJson } from '@/lib/client'
import { LinkTelegram } from './LinkTelegram'
import { RoleSwitch } from './RoleSwitch'

type Prefs = {
  theme?: 'system' | 'light' | 'dark'
  sound?: 'off' | 'quiet' | 'normal'
  soundPack?: LearnerPack
  generationChime?: boolean
  motion?: 'system' | 'reduce' | 'full'
  textSize?: 'normal' | 'large' | 'larger'
  notifications?: Record<string, boolean>
}

/** Debounced PATCH /api/profile with a quiet "Saqlandi" tick (spec §12: autosave, no Save buttons). */
function useAutosave() {
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const save = (patch: Record<string, unknown>, delay = 0) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      setState('saving')
      const res = await fetch('/api/profile', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) }).catch(() => null)
      setState(res?.ok ? 'saved' : 'error')
      if (res?.ok) setTimeout(() => setState('idle'), 1800)
    }, delay)
  }
  return { state, save }
}

function SavedTick({ state }: { state: ReturnType<typeof useAutosave>['state'] }) {
  const { t } = useI18n()
  return (
    <span aria-live="polite" className="t-small inline-flex h-5 items-center gap-1 text-ink-400">
      {state === 'saved' && (
        <span className="fade-in inline-flex items-center gap-1 text-success-600">
          <Check size={14} strokeWidth={2} aria-hidden /> {t('student.saved')}
        </span>
      )}
      {state === 'saving' && t('student.saving')}
      {state === 'error' && <span className="text-error-600">{t('error.generic')}</span>}
    </span>
  )
}

export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-3">
        <h2 className="t-h1">{title}</h2>
        {aside}
      </div>
      <hr className="rule-gold w-12" />
      <div className="rounded-lg border border-paper-300 bg-paper-50 p-4">{children}</div>
    </section>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-b border-paper-300 py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-col">
        <span className="t-h3">{label}</span>
        {hint && <span className="t-small text-ink-400">{hint}</span>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}


/** Name (+ teacher's school and subjects), edited inline. */
export function ProfileHeaderForm({ name, school, subjects, isTeacher }: { name: string; school: string | null; subjects: string[]; isTeacher: boolean }) {
  const { t } = useI18n()
  const { state, save } = useAutosave()
  const [n, setN] = useState(name)
  const [s, setS] = useState(school ?? '')
  const [subs, setSubs] = useState(subjects)
  return (
    <div className="flex w-full flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className="t-small font-medium text-ink-500">{t('auth.name')}</span>
        <Input
          value={n}
          maxLength={80}
          onChange={(e) => {
            setN(e.target.value)
            if (e.target.value.trim().length >= 2) save({ fullName: e.target.value.trim() }, 600)
          }}
        />
      </label>
      {isTeacher && (
        <>
          <label className="flex flex-col gap-1">
            <span className="t-small font-medium text-ink-500">{t('profile.school')}</span>
            <Input
              value={s}
              maxLength={120}
              onChange={(e) => {
                setS(e.target.value)
                save({ teacher: { schoolName: e.target.value.trim() || null } }, 600)
              }}
            />
          </label>
          <div className="flex flex-col gap-1">
            <span className="t-small font-medium text-ink-500">{t('profile.subjects')}</span>
            <div className="flex flex-wrap gap-2">
              {SUBJECTS.map((x) => (
                <Chip
                  key={x}
                  selected={subs.includes(x)}
                  onClick={() => {
                    const next = subs.includes(x) ? subs.filter((y) => y !== x) : [...subs, x]
                    setSubs(next)
                    save({ teacher: { subjects: next } })
                  }}
                >
                  {t(`subject.${x}` as MessageKey)}
                </Chip>
              ))}
            </div>
            {subs.some((x) => !isLanguageSubject(x)) && <p className="t-small text-ink-400">{t('profile.subjectHint')}</p>}
          </div>
        </>
      )}
      <SavedTick state={state} />
    </div>
  )
}

export function TeachingDefaultsForm({
  defaults,
  cefr,
}: {
  defaults: { difficulty?: number; minutes?: number; showAnswersAfter?: 'submit' | 'never'; strictness?: 'lenient' | 'standard' | 'strict'; typoTolerance?: boolean }
  cefr: string | null
}) {
  const { t } = useI18n()
  const { state, save } = useAutosave()
  const [d, setD] = useState({ difficulty: 3, minutes: 20, showAnswersAfter: 'submit' as const, strictness: 'standard' as const, typoTolerance: true, ...defaults })
  const [level, setLevel] = useState(cefr ?? 'B1')
  const set = <K extends keyof typeof d>(k: K, v: (typeof d)[K]) => {
    setD((cur) => ({ ...cur, [k]: v }))
    save({ teacher: { teachingDefaults: { [k]: v } } })
  }
  return (
    <div>
      <p className="t-small mb-2 text-ink-400">{t('profile.defaultsHint')}</p>
      <Row label={t('param.difficulty')}>
        <SegmentedControl
          label={t('param.difficulty')}
          value={String(d.difficulty)}
          onChange={(v) => set('difficulty', Number(v))}
          options={[
            { value: '2', label: t('param.easy') },
            { value: '3', label: t('param.medium') },
            { value: '4', label: t('param.hard') },
          ]}
        />
      </Row>
      <Row label={t('param.duration')}>
        <SegmentedControl
          label={t('param.duration')}
          value={String(d.minutes)}
          onChange={(v) => set('minutes', Number(v))}
          options={['10', '15', '20', '30'].map((m) => ({ value: m, label: m }))}
        />
      </Row>
      <Row label="CEFR">
        <SegmentedControl
          label="CEFR"
          size="sm"
          value={level}
          onChange={(v) => {
            setLevel(v)
            save({ teacher: { defaultCefrLevel: v } })
          }}
          options={['A1', 'A2', 'B1', 'B2', 'C1'].map((l) => ({ value: l, label: l }))}
        />
      </Row>
      <Row label={t('profile.showAnswers')}>
        <SegmentedControl
          label={t('profile.showAnswers')}
          value={d.showAnswersAfter}
          onChange={(v) => set('showAnswersAfter', v)}
          options={[
            { value: 'submit', label: t('profile.showAnswers.submit') },
            { value: 'never', label: t('profile.showAnswers.never') },
          ]}
        />
      </Row>
      <Row label={t('profile.strictness')}>
        <SegmentedControl
          label={t('profile.strictness')}
          value={d.strictness}
          onChange={(v) => set('strictness', v)}
          options={(['lenient', 'standard', 'strict'] as const).map((v) => ({ value: v, label: t(`profile.strictness.${v}`) }))}
        />
      </Row>
      <Switch label={t('profile.typo')} checked={d.typoTolerance} onChange={(v) => set('typoTolerance', v)} />
      <SavedTick state={state} />
    </div>
  )
}

/** The shared settings block for every account (spec §12). */
export function AccountSettings({
  prefs,
  isTeacher,
  phoneMasked,
  telegramLinked,
  noNumber = false,
  passwordSetAt = null,
  role,
  roles = [],
}: {
  prefs: Prefs
  isTeacher: boolean
  phoneMasked: string
  telegramLinked: boolean
  /** Made with Apple or Google and no number yet: it can link Telegram (LinkTelegram), and has no password to set */
  noNumber?: boolean
  /** When the password was set; null = none (sign in with Telegram or a code) */
  passwordSetAt?: Date | null
  /** The side open now and the sides the account has: the student / teacher switch */
  role?: 'teacher' | 'student' | 'admin'
  roles?: string[]
}) {
  const { t } = useI18n()
  const router = useRouter()
  const { state, save } = useAutosave()
  const [p, setP] = useState<Prefs>({
    theme: 'system',
    sound: isTeacher ? 'off' : 'normal',
    motion: 'system',
    textSize: 'normal',
    generationChime: false,
    notifications: { newAssignment: true, dueSoon: true, graded: true, digest: true },
    ...prefs,
  })
  const [tg, setTg] = useState(telegramLinked)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const setPref = <K extends keyof Prefs>(k: K, v: Prefs[K]) => {
    setP((cur) => ({ ...cur, [k]: v }))
    save({ prefs: { [k]: v } })
    // Apply immediately — no reload
    const root = document.documentElement
    if (k === 'theme') v === 'system' ? delete root.dataset.theme : (root.dataset.theme = v as string)
    if (k === 'motion') v === 'system' ? delete root.dataset.motion : (root.dataset.motion = v as string)
    if (k === 'textSize') v === 'normal' ? delete root.dataset.textSize : (root.dataset.textSize = v as string)
    if (k === 'sound') configureSound({ level: v as 'off' | 'quiet' | 'normal' })
    if (k === 'generationChime') configureSound({ generationChime: !!v })
    if (k === 'soundPack') {
      configureSound({ pack: v as LearnerPack })
      previewPack(v as LearnerPack)
    }
  }

  const del = async () => {
    setDeleteError(null)
    const res = await fetch('/api/profile/delete', { method: 'POST' })
    if (res.status === 403) return setDeleteError(t('settings.reauth'))
    if (!res.ok) return setDeleteError(t('error.generic'))
    router.push('/')
    router.refresh()
  }

  const signOut = async () => {
    await fetch('/api/auth/signout', { method: 'POST' })
    router.push('/')
    router.refresh()
  }

  return (
    <div>
      {(role === 'student' || role === 'teacher') && <RoleSwitch role={role} roles={roles} />}
      <Row label={t('auth.phone')} hint={t('settings.phoneHint')}>
        <span className="t-body t-num font-medium">{phoneMasked}</span>
      </Row>
      <Row label={t('settings.theme')}>
        <SegmentedControl
          label={t('settings.theme')}
          value={p.theme!}
          onChange={(v) => setPref('theme', v)}
          options={(['system', 'light', 'dark'] as const).map((v) => ({ value: v, label: t(`theme.${v}`) }))}
        />
      </Row>
      <Row label={t('settings.sound')}>
        <SegmentedControl
          label={t('settings.sound')}
          value={p.sound!}
          onChange={(v) => setPref('sound', v)}
          options={(['off', 'quiet', 'normal'] as const).map((v) => ({ value: v, label: t(`sound.${v}`) }))}
        />
      </Row>
      {!isTeacher && p.sound !== 'off' && (
        <Row label={t('settings.soundPack')}>
          <SegmentedControl
            label={t('settings.soundPack')}
            size="sm"
            value={p.soundPack ?? DEFAULT_LEARNER_PACK}
            onChange={(v) => setPref('soundPack', v)}
            options={LEARNER_PACKS.map((v) => ({ value: v, label: t(`soundPack.${v}`) }))}
          />
        </Row>
      )}
      {isTeacher && (
        // The one cue worth un-muting for teachers (spec §8)
        <Switch label={t('settings.generationChime')} description={t('settings.generationChimeHint')} checked={!!p.generationChime} onChange={(v) => setPref('generationChime', v)} />
      )}
      <Row label={t('settings.motion')}>
        <SegmentedControl
          label={t('settings.motion')}
          value={p.motion!}
          onChange={(v) => setPref('motion', v)}
          options={(['system', 'reduce', 'full'] as const).map((v) => ({ value: v, label: t(`motion.${v}`) }))}
        />
      </Row>
      <Row label={t('settings.textSize')}>
        <SegmentedControl
          label={t('settings.textSize')}
          value={p.textSize!}
          onChange={(v) => setPref('textSize', v)}
          options={(['normal', 'large', 'larger'] as const).map((v) => ({ value: v, label: t(`textSize.${v}`) }))}
        />
      </Row>
      {!noNumber && <PasswordSetting setAt={passwordSetAt} />}
      <Row label={t('settings.telegram')} hint={tg ? t('telegram.linked') : noNumber ? t('link.hint') : t('telegram.notLinked')}>
        {!tg && noNumber && (
          <LinkTelegram
            onLinked={() => {
              setTg(true)
              router.refresh()
            }}
          />
        )}
        {tg && (
          <Button
            variant="secondary"
            size="sm"
            onClick={async () => {
              if ((await fetch('/api/profile/telegram', { method: 'DELETE' })).ok) setTg(false)
            }}
          >
            {t('telegram.unlink')}
          </Button>
        )}
      </Row>
      <div className="border-b border-paper-300 py-3">
        <span className="t-h3">{t('settings.notifications')}</span>
        <span className="t-small block text-ink-400">{t('settings.notificationsHint')}</span>
        {(['newAssignment', 'dueSoon', 'graded', 'digest'] as const)
          .filter((k) => (isTeacher ? k === 'digest' || k === 'graded' : k !== 'digest'))
          .map((k) => (
            <Switch
              key={k}
              label={t(`notif.${k}`)}
              checked={p.notifications?.[k] !== false}
              onChange={(v) => setPref('notifications', { ...p.notifications, [k]: v })}
            />
          ))}
      </div>
      <SavedTick state={state} />

      <div className="mt-4 flex flex-wrap gap-2">
        <a href="/api/profile/export" className="btn btn-secondary btn-md" download>
          <span className="btn-label">
            <Download size={18} strokeWidth={ICON.strokeWidth} aria-hidden /> {t('settings.export')}
          </span>
        </a>
        <Button variant="ghost" onClick={signOut} icon={<LogOut size={18} strokeWidth={ICON.strokeWidth} aria-hidden />}>
          {t('auth.signOut')}
        </Button>
      </div>

      {/* Two-step delete with a fresh-sign-in requirement (spec §12) */}
      <div className="mt-6 rounded-md border border-paper-300 p-4">
        {!confirmDelete ? (
          <Button variant="danger" onClick={() => setConfirmDelete(true)} icon={<Trash2 size={18} strokeWidth={ICON.strokeWidth} aria-hidden />}>
            {t('settings.delete')}
          </Button>
        ) : (
          <div className="slide-down flex flex-col gap-3">
            <p className="t-body text-ink-700">{t('settings.deleteExplain')}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="danger" onClick={del}>
                {t('settings.deleteConfirm')}
              </Button>
              <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
                {t('common.cancel')}
              </Button>
            </div>
            {deleteError && (
              <p role="alert" className="t-body text-error-600">
                {deleteError}{' '}
                <a href="/signin" className="font-semibold underline">
                  {t('auth.signIn')}
                </a>
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

const PASSWORD_ERRORS: Record<string, MessageKey> = {
  password_too_short: 'password.tooShort',
  password_too_long: 'password.tooLong',
  password_too_common: 'password.tooCommon',
  password_is_phone: 'password.isPhone',
  password_wrong_current: 'password.wrongCurrent',
  password_current_required: 'password.currentRequired',
}

/** Profile: a password for signing in with the phone number (server/auth/password.ts) */
function PasswordSetting({ setAt }: { setAt: Date | null }) {
  const { t } = useI18n()
  const [has, setHas] = useState(!!setAt)
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const save = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (next.length < 8) return setError(t('password.tooShort'))
    if (next !== again) return setError(t('password.mismatch'))
    setBusy(true)
    const { ok, json } = await postJson('/api/profile/password', { password: next, current: current || undefined }).finally(() => setBusy(false))
    if (!ok) return setError(t(PASSWORD_ERRORS[String(json.error)] ?? 'error.generic'))
    setHas(true)
    setOpen(false)
    setDone(true)
    setCurrent('')
    setNext('')
    setAgain('')
  }

  return (
    <div className="border-b border-paper-300 py-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col">
          <span className="t-h3">{t('password.title')}</span>
          <span className="t-small text-ink-400">{done ? t('password.saved') : t(has ? 'password.hintSet' : 'password.hintNone')}</span>
        </div>
        {!open && (
          <Button variant="secondary" size="sm" onClick={() => (setDone(false), setOpen(true))}>
            {t(has ? 'password.change' : 'password.set')}
          </Button>
        )}
      </div>
      {open && (
        <form onSubmit={save} className="slide-down mt-3 flex max-w-sm flex-col gap-3" noValidate>
          {has && (
            <label className="flex flex-col gap-1">
              <span className="t-small font-medium text-ink-500">{t('password.current')}</span>
              <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} maxLength={128} />
              <span className="t-small text-ink-400">{t('password.currentHint')}</span>
            </label>
          )}
          <label className="flex flex-col gap-1">
            <span className="t-small font-medium text-ink-500">{t('password.new')}</span>
            <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} maxLength={128} />
            <span className="t-small text-ink-400">{t('password.rules')}</span>
          </label>
          <label className="flex flex-col gap-1">
            <span className="t-small font-medium text-ink-500">{t('password.again')}</span>
            <Input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} maxLength={128} />
          </label>
          {error && (
            <p role="alert" className="t-body text-error-600">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={busy}>
              {t('action.save')}
            </Button>
            <Button variant="ghost" onClick={() => (setOpen(false), setError(null))}>
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
