import { ShieldCheck } from 'lucide-react'
import { ICON } from '@ikhimi/ui/components'
import { ReauthButton } from '@/components/admin/ReauthButton'
import { panel } from '@/components/admin/Bars'
import { getT } from '@/i18n/server'
import { FRESH_HOURS } from '@/server/admin/staff'

/** Admin pages need a sign-in from the last few hours; the layout already checked this is staff */
export default async function AdminVerify() {
  const { t } = await getT()
  return (
    <div className={`${panel} flex max-w-lg flex-col items-start gap-4`}>
      <ShieldCheck size={32} strokeWidth={ICON.strokeWidth} className="text-orange-500" aria-hidden />
      <h2 className="t-h1">{t('admin.verify.title')}</h2>
      <p className="t-body text-ink-700">{t('admin.verify.body', { hours: FRESH_HOURS })}</p>
      <ReauthButton />
    </div>
  )
}
