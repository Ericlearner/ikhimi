'use client'
import { Check, Copy, QrCode, Share } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Button, ICON } from '@ikhimi/ui/components'
import { play } from '@ikhimi/ui/sound'
import { useI18n } from '@/i18n/client'
import { canShareNatively, shareNatively } from '@/lib/ios-app'

/** Copy the link, send it in Telegram, or the phone's share sheet */
export function ShareButtons({ url }: { url: string }) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)
  // The phone's share sheet (the iOS app's, or the browser's): known only after mount
  const [nativeShare, setNativeShare] = useState(false)
  useEffect(() => setNativeShare(canShareNatively()), [])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      play('copy')
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {}
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" onClick={copy} icon={copied ? <Check size={18} strokeWidth={ICON.strokeWidth} aria-hidden /> : <Copy size={18} strokeWidth={ICON.strokeWidth} aria-hidden />}>
        {copied ? t('share.copied') : t('action.copyLink')}
      </Button>
      <a href={`https://t.me/share/url?url=${encodeURIComponent(url)}`} target="_blank" rel="noopener noreferrer" className="btn btn-telegram btn-md">
        <span className="btn-label">{t('share.telegram')}</span>
      </a>
      {nativeShare && (
        <Button variant="secondary" onClick={() => void shareNatively({ url })} icon={<Share size={18} strokeWidth={ICON.strokeWidth} aria-hidden />}>
          {t('action.share')}
        </Button>
      )}
    </div>
  )
}

/** The results page's short version of the share panel: the link and its buttons, the QR one tap away */
export function ShareBar({ url, assignmentId }: { url: string; assignmentId: string }) {
  const { t } = useI18n()
  return (
    <section className="flex flex-col gap-3 rounded-2xl border-2 border-paper-300 bg-paper-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="t-h3">{t('share.linkTitle')}</h2>
        <Link href={`/app/a/${assignmentId}`} className="t-small inline-flex items-center gap-1 font-medium text-ink-500 hover:text-ink-800">
          <QrCode size={16} strokeWidth={ICON.strokeWidth} aria-hidden /> {t('share.qrLink')}
        </Link>
      </div>
      <code className="t-body break-all rounded-md bg-paper-200 px-3 py-2 font-semibold text-ink-800">{url}</code>
      <ShareButtons url={url} />
    </section>
  )
}
