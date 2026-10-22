import { AppHeader } from '@/components/AppHeader'
import { SiteFooter } from '@/components/SiteFooter'
import { supportBotUrl } from '@/content/site'
import { getT } from '@/i18n/server'

export const metadata = { title: '계정 삭제 — 익히미' }

/** How to delete a 익히미 account and what happens to the data (Google Play's account deletion link; server/purge.ts) */
export default async function DeleteAccount() {
  const { t } = await getT()
  const section = 'flex flex-col gap-2'
  return (
    <>
      <AppHeader />
      <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10">
        <h1 className="t-display-2">{t('deletion.title')}</h1>
        <p className="t-body-lg text-ink-700">{t('deletion.lead')}</p>
        <section className={section}>
          <h2 className="t-h2">{t('deletion.stepsTitle')}</h2>
          <ol className="t-body flex list-decimal flex-col gap-1 pl-5 text-ink-700">
            <li>{t('deletion.step1')}</li>
            <li>{t('deletion.step2')}</li>
            <li>{t('deletion.step3')}</li>
          </ol>
          <p className="t-body text-ink-700">
            {t('deletion.noAccess')}{' '}
            <a href={supportBotUrl()} target="_blank" rel="noopener noreferrer" className="font-semibold text-orange-700 underline">
              {t('help.writeUs')}
            </a>
          </p>
        </section>
        <section className={section}>
          <h2 className="t-h2">{t('deletion.deletedTitle')}</h2>
          <p className="t-body text-ink-700">{t('deletion.deleted')}</p>
        </section>
        <section className={section}>
          <h2 className="t-h2">{t('deletion.keptTitle')}</h2>
          <p className="t-body text-ink-700">{t('deletion.kept')}</p>
        </section>
      </main>
      <SiteFooter />
    </>
  )
}
