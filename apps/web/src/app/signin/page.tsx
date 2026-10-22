import { redirect } from 'next/navigation'
import { TemperatureProvider } from '@ikhimi/ui/components'
import { AppHeader } from '@/components/AppHeader'
import { SignInFlow } from '@/components/SignInFlow'
import { needsOnboarding } from '@/server/auth/users'
import { getT } from '@/i18n/server'
import { appleConfig } from '@/server/apple'
import { googleConfig } from '@/server/google'
import { getSession } from '@/server/request'
import { inIosApp } from '@/server/store-app'
import { safeNext } from '@/server/student-pages'

export default async function SignIn({ searchParams }: { searchParams: Promise<{ next?: string; as?: string; error?: string }> }) {
  const sp = await searchParams
  const next = safeNext(sp.next) ?? '/app'
  // A homework or course link asks for a student; otherwise an existing account keeps its roles and a new one chooses
  const audience = sp.as === 'student' ? 'student' : sp.as === 'teacher' ? 'teacher' : null
  const session = await getSession()
  if (session && !needsOnboarding(session.user)) redirect(next)
  const ios = await inIosApp()
  const { t } = await getT()
  return (
    // Students arriving from a homework link get the warm temperature; teachers the calm one
    <TemperatureProvider value={audience === 'student' ? 'warm' : 'calm'}>
      <AppHeader />
      <main className="mx-auto flex max-w-3xl flex-col items-center gap-6 px-4 pb-16 pt-10 sm:pt-16">
        <div className="w-full max-w-sm">
          <h1 className="t-display-2">{session ? t('auth.welcome') : t('auth.signIn')}</h1>
          <hr className="rule-gold mt-4 w-12" />
        </div>
        <SignInFlow
          initialStep={session ? 'profile' : 'start'}
          next={next}
          // Signed in but no name yet: the account's own role decides the questions (subjects for a teacher)
          audience={audience ?? (session && session.user.roleChosen !== false && session.user.role !== 'admin' ? session.user.role : null)}
          chooseRole={session?.user.roleChosen === false}
          initialName={session?.user.fullName ?? ''}
          initialError={sp.error === 'google' ? 'error.googleFailed' : sp.error === 'blocked' ? 'error.accountBlocked' : null}
          // The iOS app is a web view, where Google refuses to sign in: Sign in with Apple there (App Store rule 4.8)
          appleEnabled={!!appleConfig() && ios}
          // The website and the Android apps (Chrome)
          googleEnabled={!!googleConfig() && !ios}
        />
      </main>
    </TemperatureProvider>
  )
}
