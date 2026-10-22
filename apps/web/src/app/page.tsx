import { BarChart3, Camera, Gift, Smartphone } from 'lucide-react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ICON, IlloPlane } from '@ikhimi/ui/components'
import { AndroidDownload } from '@/components/AndroidDownload'
import { AppHeader } from '@/components/AppHeader'
import { Logo } from '@/components/Logo'
import { getT } from '@/i18n/server'
import { getSession } from '@/server/request'

/** Public landing (design spec §13): one screen, one promise, one CTA. */
export default async function Landing() {
  const session = await getSession()
  if (session) redirect(session.user.role === 'teacher' ? '/app' : '/work')
  const { t } = await getT()
  const proofs = [
    { icon: Camera, key: 'landing.proof1' as const },
    { icon: BarChart3, key: 'landing.proof2' as const },
    { icon: Gift, key: 'landing.proof3' as const },
  ]
  return (
    <>
      <AppHeader />
      <main className="mx-auto flex max-w-5xl flex-col gap-16 px-4 py-12 md:py-20">
        <section className="grid items-center gap-10 md:grid-cols-[1.2fr_1fr]">
          <div className="fade-in flex flex-col gap-6">
            <span className="self-start"><Logo className="h-10 w-auto" /></span>
            <h1 className="t-display-1 measure">{t('landing.promise')}</h1>
            <hr className="rule-gold complete-sweep w-16" />
            <p className="t-body-lg measure text-ink-500">{t('landing.sub')}</p>
            <Link href="/signin" className="btn btn-primary btn-lg self-start">
              <span className="btn-label">{t('landing.cta')}</span>
            </Link>
            <AndroidDownload className="max-w-md" />
          </div>
          <div className="flex justify-center">
            <IlloPlane size={260} className="complete-plane" />
          </div>
        </section>

        <ul className="grid gap-3 sm:grid-cols-3">
          {proofs.map(({ icon: Icon, key }, i) => (
            <li key={key} style={{ ['--i' as string]: i }} className="card-enter flex items-start gap-3 rounded-lg border border-paper-300 bg-paper-50 p-4">
              <Icon size={24} strokeWidth={ICON.strokeWidth} className="shrink-0 text-orange-700" aria-hidden />
              <span className="t-body font-medium">{t(key)}</span>
            </li>
          ))}
        </ul>

        <section className="flex flex-col gap-3 rounded-xl bg-paper-200 p-6 md:flex-row md:items-center md:gap-6">
          <Smartphone size={40} strokeWidth={ICON.strokeWidth} className="shrink-0 text-ink-700" aria-hidden />
          <div>
            <h2 className="t-h1">{t('landing.studentsTitle')}</h2>
            <p className="t-body-lg measure mt-1 text-ink-500">{t('landing.studentsText')}</p>
          </div>
        </section>
      </main>
    </>
  )
}
