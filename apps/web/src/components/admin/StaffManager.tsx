'use client'
import { Pencil, Trash2, UserPlus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { MessageKey } from '@ikhimi/i18n'
import { Badge, Button, ICON, IconButton, Input } from '@ikhimi/ui/components'
import { useI18n } from '@/i18n/client'
import { postJson } from '@/lib/client'

type Role = { id: string; name: string; permissions: string[] }
type Member = { id: string; email: string; masked: string; name: string | null; roleId: string; signedUp: boolean }

/** Create roles from permissions, and add, move or remove assistants by the email they sign in with (/api/admin/staff) */
export function StaffManager({ permissions, roles, members }: { permissions: string[]; roles: Role[]; members: Member[] }) {
  const { t } = useI18n()
  const router = useRouter()
  const [editing, setEditing] = useState<Role | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [roleId, setRoleId] = useState(roles[0]?.id ?? '')

  const call = async (body: Record<string, unknown>) => {
    setBusy(true)
    setError(null)
    const { ok, json } = await postJson('/api/admin/staff', body)
    setBusy(false)
    if (!ok) {
      const key: Record<string, MessageKey> = {
        email_invalid: 'error.emailInvalid',
        role_in_use: 'admin.staff.roleInUse',
        already_owner: 'admin.staff.alreadyOwner',
        reauth: 'admin.verify.title',
      }
      setError(t(key[String(json.error)] ?? 'error.generic'))
      return false
    }
    router.refresh()
    return true
  }

  const roleName = (id: string) => roles.find((r) => r.id === id)?.name ?? '—'
  const select = 't-body min-h-11 rounded-md border border-paper-300 bg-paper-50 px-3'

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="t-h1">{t('admin.staff.roles')}</h2>
          <Button size="sm" variant="secondary" onClick={() => setEditing({ id: '', name: '', permissions: [] })}>
            {t('admin.staff.newRole')}
          </Button>
        </div>
        {editing && (
          <div className="flex flex-col gap-3 rounded-lg border border-orange-300 bg-paper-50 p-4">
            <label className="flex max-w-sm flex-col gap-1">
              <span className="t-small text-ink-500">{t('admin.staff.roleName')}</span>
              <Input value={editing.name} maxLength={60} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder={t('admin.staff.roleNamePlaceholder')} />
            </label>
            <fieldset className="grid gap-2 sm:grid-cols-2">
              <legend className="t-small mb-1 text-ink-500">{t('admin.staff.canDo')}</legend>
              {permissions.map((p) => (
                <label key={p} className="flex min-h-11 cursor-pointer items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-1 size-5 accent-orange-500"
                    checked={editing.permissions.includes(p)}
                    onChange={(e) => setEditing({ ...editing, permissions: e.target.checked ? [...editing.permissions, p] : editing.permissions.filter((x) => x !== p) })}
                  />
                  <span className="flex flex-col">
                    <span className="t-body font-medium">{t(`admin.perm.${p}` as MessageKey)}</span>
                    <span className="t-small text-ink-500">{t(`admin.perm.${p}.hint` as MessageKey)}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <div className="flex gap-2">
              <Button
                size="sm"
                loading={busy}
                disabled={!editing.name.trim()}
                onClick={async () => {
                  const ok = await call(editing.id ? { action: 'update_role', id: editing.id, name: editing.name, permissions: editing.permissions } : { action: 'create_role', name: editing.name, permissions: editing.permissions })
                  if (ok) setEditing(null)
                }}
              >
                {t('action.save')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        )}
        {roles.length === 0 ? (
          <p className="t-body text-ink-500">{t('admin.staff.noRoles')}</p>
        ) : (
          <ul className="overflow-hidden rounded-lg border border-paper-300 bg-paper-50">
            {roles.map((r) => (
              <li key={r.id} className="flex items-start gap-3 border-b border-paper-300 px-4 py-3 last:border-b-0">
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="t-body font-medium">{r.name}</span>
                  <span className="flex flex-wrap gap-1">
                    {r.permissions.length === 0 ? (
                      <span className="t-small text-ink-400">{t('admin.staff.nothing')}</span>
                    ) : (
                      r.permissions.map((p) => <Badge key={p}>{t(`admin.perm.${p}` as MessageKey)}</Badge>)
                    )}
                  </span>
                </span>
                <IconButton label={t('admin.staff.editRole')} size={36} onClick={() => setEditing(r)}>
                  <Pencil size={16} strokeWidth={ICON.strokeWidth} aria-hidden />
                </IconButton>
                <IconButton label={t('admin.staff.deleteRole')} size={36} onClick={() => window.confirm(t('admin.staff.deleteRoleConfirm')) && call({ action: 'delete_role', id: r.id })}>
                  <Trash2 size={16} strokeWidth={ICON.strokeWidth} aria-hidden />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="t-h1">{t('admin.staff.members')}</h2>
        {roles.length > 0 && (
          <div className="flex flex-wrap items-end gap-2 rounded-lg border border-paper-300 bg-paper-50 p-4">
            <label className="flex flex-col gap-1">
              <span className="t-small text-ink-500">{t('admin.staff.email')}</span>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@gmail.com" type="email" inputMode="email" autoComplete="off" className="w-56" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="t-small text-ink-500">{t('admin.staff.memberName')}</span>
              <Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} className="w-48" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="t-small text-ink-500">{t('admin.staff.role')}</span>
              <select value={roleId} onChange={(e) => setRoleId(e.target.value)} className={select}>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            <Button
              size="sm"
              loading={busy}
              disabled={!email.trim() || !roleId}
              icon={<UserPlus size={16} strokeWidth={ICON.strokeWidth} aria-hidden />}
              onClick={async () => {
                if (await call({ action: 'add_member', email, name, roleId })) {
                  setEmail('')
                  setName('')
                }
              }}
            >
              {t('admin.staff.add')}
            </Button>
          </div>
        )}
        {members.length === 0 ? (
          <p className="t-body text-ink-500">{t('admin.staff.noMembers')}</p>
        ) : (
          <ul className="overflow-hidden rounded-lg border border-paper-300 bg-paper-50">
            {members.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-3 border-b border-paper-300 px-4 py-3 last:border-b-0">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="t-body font-medium">{m.name ?? m.masked}</span>
                  <span className="t-small t-num text-ink-500">
                    {m.email} · {m.signedUp ? t('admin.staff.signedUp') : t('admin.staff.notSignedUp')}
                  </span>
                </span>
                <select aria-label={t('admin.staff.role')} value={m.roleId} onChange={(e) => call({ action: 'update_member', id: m.id, roleId: e.target.value })} className={select}>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                  {!roles.some((r) => r.id === m.roleId) && <option value={m.roleId}>{roleName(m.roleId)}</option>}
                </select>
                <IconButton label={t('admin.staff.remove')} size={36} onClick={() => window.confirm(t('admin.staff.removeConfirm')) && call({ action: 'remove_member', id: m.id })}>
                  <Trash2 size={16} strokeWidth={ICON.strokeWidth} aria-hidden />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
      </section>
      {error && <p className="t-small font-medium text-error-600">{error}</p>}
    </div>
  )
}
