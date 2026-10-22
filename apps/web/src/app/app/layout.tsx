import { TemperatureProvider } from '@ikhimi/ui/components'
import { HelpChat } from '@/components/HelpChat'
import { SITE } from '@/content/site'
import { getSession } from '@/server/request'

/** Teacher app runs calm: restrained motion, silent by default (spec §1). The help chat sits in the corner (BN). */
export default async function TeacherLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  return (
    <TemperatureProvider value="calm">
      {children}
      {session?.user.role === 'teacher' && <HelpChat userId={session.user.id} supportEmail={SITE.supportEmail} />}
    </TemperatureProvider>
  )
}
