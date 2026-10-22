import { Download } from 'lucide-react'
import Link from 'next/link'
import { ICON } from '@ikhimi/ui/components'
import { getT } from '@/i18n/server'
import { apkVersion, inAndroidApp, inIosApp } from '@/server/store-app'

/**
 * The Android app, one tap: the icon and a button that downloads the APK straight away, with a link to the install
 * steps (/android). Never shown inside the apps themselves (the iOS app may not point to Android either).
 */
export async function AndroidDownload({ className = '' }: { className?: string }) {
  if (!apkVersion() || (await inAndroidApp()) || (await inIosApp())) return null
  const { t } = await getT()
  return (
    <div className={`flex items-center gap-3 rounded-xl border border-paper-300 bg-paper-50 p-3 pr-4 shadow-e1 ${className}`}>
      <a href="/download/ikhimi.apk" download className="press shrink-0" aria-label={t('apk.download')}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon-192.png" alt="" width={56} height={56} className="rounded-xl" />
      </a>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="t-h3">{t('apk.bannerTitle')}</span>
        <Link href="/android" className="t-small text-ink-500 underline-offset-4 hover:underline">
          {t('apk.howTitle')} →
        </Link>
      </div>
      <a href="/download/ikhimi.apk" download className="btn btn-primary btn-md shrink-0">
        <span className="btn-label">
          <Download size={18} strokeWidth={ICON.strokeWidth} aria-hidden /> {t('apk.bannerButton')}
        </span>
      </a>
    </div>
  )
}
