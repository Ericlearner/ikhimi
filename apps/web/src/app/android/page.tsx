import { Download, ShieldCheck, Smartphone } from 'lucide-react'
import { ICON } from '@ikhimi/ui/components'
import { AppHeader } from '@/components/AppHeader'
import { SiteFooter } from '@/components/SiteFooter'
import { redirect } from 'next/navigation'
import { getT } from '@/i18n/server'
import { apkVersion, inIosApp } from '@/server/store-app'

export const metadata = { title: '안드로이드 앱 — 익히미' }

/** The Android app as a download from the site (apps/android/web, kr.ikhimi.app.web), while the Play version is reviewed */
export default async function AndroidApp() {
  // Not a page for the iOS app (App Store rule 2.3.10), nor before an APK is published
  const version = apkVersion()
  if (!version || (await inIosApp())) redirect('/app')
  const { t } = await getT()
  const steps = [t('apk.step1'), t('apk.step2'), t('apk.step3'), t('apk.step4')]
  return (
    <>
      <AppHeader />
      <main className="mx-auto flex max-w-xl flex-col gap-6 px-4 py-10">
        <div className="flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon-192.png" alt="" width={72} height={72} className="rounded-xl" />
          <div className="flex flex-col gap-1">
            <h1 className="t-display-2">{t('apk.title')}</h1>
            <p className="t-small text-ink-500">{t('apk.meta', { version, size: '1.1' })}</p>
          </div>
        </div>
        <p className="t-body-lg text-ink-700">{t('apk.lead')}</p>
        <a href="/download/ikhimi.apk" download className="btn btn-primary btn-xl">
          <span className="btn-label">
            <Download size={22} strokeWidth={ICON.strokeWidth} aria-hidden /> {t('apk.download')}
          </span>
        </a>
        <section className="flex flex-col gap-3 rounded-lg border border-paper-300 bg-paper-50 p-4">
          <h2 className="t-h3 flex items-center gap-2">
            <Smartphone size={20} strokeWidth={ICON.strokeWidth} aria-hidden /> {t('apk.howTitle')}
          </h2>
          <ol className="t-body flex list-decimal flex-col gap-2 pl-5 text-ink-700">
            {steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </section>
        <p className="t-small flex items-start gap-2 text-ink-500">
          <ShieldCheck size={18} strokeWidth={ICON.strokeWidth} className="mt-0.5 shrink-0" aria-hidden /> {t('apk.safe')}
        </p>
      </main>
      <SiteFooter />
    </>
  )
}
