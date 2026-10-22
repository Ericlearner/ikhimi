import { getDb } from '@ikhimi/db'
import { StaffManager } from '@/components/admin/StaffManager'
import { getT } from '@/i18n/server'
import { pageStaff } from '@/server/admin/guard'
import { maskForStaff, PERMISSIONS } from '@/server/admin/permissions'
import { staffOverview } from '@/server/admin/stats'

/** Owner only: roles (sets of permissions) and the assistants who hold them, added by phone number */
export default async function AdminStaff() {
  const db = getDb()
  await pageStaff(db, 'staff')
  const { t } = await getT()
  const { roles, members } = await staffOverview(db)
  return (
    <div className="flex flex-col gap-4">
      <p className="t-body max-w-2xl text-ink-700">{t('admin.staff.intro')}</p>
      <StaffManager
        permissions={[...PERMISSIONS]}
        roles={roles.map((r) => ({ id: r.id, name: r.name, permissions: r.permissions }))}
        members={members.map((m) => ({
          id: m.m.id,
          phone: m.m.phone,
          masked: maskForStaff(m.m.phone),
          name: m.m.name ?? m.user?.fullName ?? null,
          roleId: m.m.roleId,
          signedUp: !!m.user?.id,
        }))}
      />
    </div>
  )
}
