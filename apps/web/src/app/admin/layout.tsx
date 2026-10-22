import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getDb } from '@ikhimi/db'
import { TemperatureProvider } from '@ikhimi/ui/components'
import { AppHeader } from '@/components/AppHeader'
import { AdminNav } from '@/components/admin/AdminNav'
import { staffAccess } from '@/server/admin/staff'
import { getSession } from '@/server/request'

export const metadata: Metadata = { robots: { index: false, follow: false } }

/** The admin panel: only staff get past this; everyone else sees "not found". Pages check their permission. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  const access = session ? await staffAccess(getDb(), session.user) : null
  if (!access) notFound()
  return (
    <TemperatureProvider value="calm">
      <AppHeader />
      <div className="mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-6 px-4 py-6 pb-16">
        <AdminNav owner={access.owner} permissions={[...access.permissions]} roleName={access.roleName} />
        {children}
      </div>
    </TemperatureProvider>
  )
}
