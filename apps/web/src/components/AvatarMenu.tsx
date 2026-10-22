'use client'
import { ChevronRight, GraduationCap, LogOut, Presentation, Repeat, ShieldCheck, UserRound } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import type { MessageKey } from '@ikhimi/i18n'
import { Avatar, ICON } from '@ikhimi/ui/components'
import { useI18n } from '@/i18n/client'

type Role = 'teacher' | 'student' | 'admin'

/** Avatar menu: profile, role switch for dual-role accounts (spec §12), sign out. In the apps also `links`: the
 * places that aren't in the bottom tab bar (a teacher's courses and earnings). */
export function AvatarMenu({
  id,
  name,
  role,
  roles,
  admin = false,
  links = [],
}: {
  id: string
  name: string | null
  role: Role
  roles: Role[]
  admin?: boolean
  links?: { href: string; label: string }[]
}) {
  const { t } = useI18n()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', close)
    }
  }, [open])

  const other = roles.find((r) => r !== role && r !== 'admin')
  // Switching is asked once more: teacher and student sides show different things
  const [confirming, setConfirming] = useState(false)
  useEffect(() => {
    if (!open) setConfirming(false)
  }, [open])
  const switchRole = async () => {
    await fetch('/api/profile/role', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role: other }) })
    router.push(other === 'student' ? '/work' : '/app')
    router.refresh()
  }
  const signOut = async () => {
    await fetch('/api/auth/signout', { method: 'POST' })
    router.push('/')
    router.refresh()
  }
  const item = 'flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-left text-ink-700 hover:bg-paper-200'

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${t('nav.profile')} · ${t(`role.${role}` as MessageKey)}`}
        onClick={() => setOpen((o) => !o)}
        title={role !== 'admin' ? t(`role.${role}` as MessageKey) : undefined}
        className="press relative flex size-11 items-center justify-center rounded-full"
      >
        <Avatar id={id} name={name} size={36} />
        {/* Which side of the account is open, always in sight: a line icon like the bottom tabs (a cap for a student,
            a teaching board for a teacher; no person, so no gender), small on the avatar's edge */}
        {role !== 'admin' && (
          <span
            className="absolute -bottom-0.5 -right-0.5 flex size-[18px] items-center justify-center rounded-full bg-orange-500 text-on-orange ring-2 ring-paper-100"
            aria-hidden
          >
            {role === 'teacher' ? <Presentation size={11} strokeWidth={2.5} /> : <GraduationCap size={11} strokeWidth={2.5} />}
          </span>
        )}
      </button>
      {open && (
        <div role="menu" className="slide-down absolute right-0 top-12 z-30 w-64 rounded-lg border border-paper-300 bg-paper-50 p-2 shadow-e3">
          <p className="t-h3 truncate px-3 py-2">{name}</p>
          <Link role="menuitem" href="/profile" className={item} onClick={() => setOpen(false)}>
            <UserRound size={20} strokeWidth={ICON.strokeWidth} aria-hidden /> {t('nav.profile')}
          </Link>
          {links.map((l) => (
            <Link key={l.href} role="menuitem" href={l.href} className={item} onClick={() => setOpen(false)}>
              <ChevronRight size={20} strokeWidth={ICON.strokeWidth} aria-hidden /> {l.label}
            </Link>
          ))}
          {admin && (
            <Link role="menuitem" href="/admin" className={item} onClick={() => setOpen(false)}>
              <ShieldCheck size={20} strokeWidth={ICON.strokeWidth} aria-hidden /> {t('admin.title')}
            </Link>
          )}
          {other &&
            (confirming ? (
              <div className="flex flex-col gap-2 rounded-md bg-paper-100 p-3">
                <p className="t-small text-ink-700">{t(other === 'student' ? 'role.confirmStudent' : 'role.confirmTeacher')}</p>
                <div className="flex gap-2">
                  <button type="button" className="btn btn-primary btn-sm flex-1" onClick={switchRole}>
                    <span className="btn-label">{t('role.confirmYes')}</span>
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirming(false)}>
                    <span className="btn-label">{t('common.cancel')}</span>
                  </button>
                </div>
              </div>
            ) : (
              <button role="menuitem" type="button" className={item} onClick={() => setConfirming(true)}>
                <Repeat size={20} strokeWidth={ICON.strokeWidth} aria-hidden />
                {t('role.switchTo', { role: t(`role.${other}` as MessageKey) })}
              </button>
            ))}
          <hr className="my-1 h-px border-0 bg-paper-300" />
          <button role="menuitem" type="button" className={item} onClick={signOut}>
            <LogOut size={20} strokeWidth={ICON.strokeWidth} aria-hidden /> {t('auth.signOut')}
          </button>
        </div>
      )}
    </div>
  )
}
