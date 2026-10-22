import { Mail } from 'lucide-react'
import { ICON } from '@ikhimi/ui/components'
import { LegalPage } from '@/components/LegalPage'
import { SITE, supportMailto } from '@/content/site'
import { getT } from '@/i18n/server'

export const metadata = { title: '도움말 — 익히미' }
export default async function Help() {
  const { t } = await getT()
  return (
    <LegalPage id="help">
      <div className="flex flex-wrap items-center gap-3">
        <a href={supportMailto()} className="btn btn-primary btn-lg">
          <span className="btn-label">
            <Mail size={20} strokeWidth={ICON.strokeWidth} aria-hidden /> {t('help.writeUs')}
          </span>
        </a>
        <span className="t-small text-ink-500">{SITE.supportEmail}</span>
      </div>
    </LegalPage>
  )
}
