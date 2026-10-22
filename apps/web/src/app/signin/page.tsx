import { redirect } from 'next/navigation'
import { TemperatureProvider } from '@ikhimi/ui/components'
import { AppHeader } from '@/components/AppHeader'
import { SignInFlow } from '@/components/SignInFlow'
import { needsOnboarding } from '@/server/auth/users'
import { RESET_WINDOW_MS } from '@/server/auth/password'
import { getT } from '@/i18n/server'
import { env } from '@/server/env'
import { reviewLogin } from '@/server/auth/review'
import { APPLE_PHONE_PREFIX, appleConfig } from '@/server/apple'
import { GOOGLE_PHONE_PREFIX, googleConfig } from '@/server/google'
import { getSession } from '@/server/request'
import { appShell, inIosApp } from '@/server/store-app'
import { telegramLoginEnabled } from '@/server/telegram'
import { safeNext } from '@/server/student-pages'

export default async function SignIn({ searchParams }: { searchParams: Promise<{ next?: string; as?: string; error?: string; step?: string }> }) {
  const sp = await searchParams
  const next = safeNext(sp.next) ?? '/app'
  // A homework or course link asks for a student; otherwise an existing account keeps its roles and a new one chooses
  const audience = sp.as === 'student' ? 'student' : sp.as === 'teacher' ? 'teacher' : null
  const session = await getSession()
  // Signed in a moment ago by the bot's "로그인" button: the password step the page's own Telegram sign-in has
  const password =
    sp.step === 'password' && session?.method === 'telegram' && Date.now() - session.createdAt.getTime() < RESET_WINDOW_MS && /^\+\d+$/.test(session.user.phone)
      ? {
          phone: session.user.phone,
          hasPassword: !!session.user.passwordSetAt,
          needsOnboarding: needsOnboarding(session.user) || session.user.roleChosen === false,
          needsRole: session.user.roleChosen === false,
          role: session.user.role,
        }
      : null
  if (session && !needsOnboarding(session.user) && !password) redirect(next)
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
          initialStep={password ? 'setPassword' : session ? 'profile' : 'phone'}
          initialPassword={password}
          next={next}
          // Signed in but no name yet: the account's own role decides the questions (subjects for a teacher)
          audience={audience ?? (session && session.user.roleChosen !== false && session.user.role !== 'admin' ? session.user.role : null)}
          chooseRole={session?.user.roleChosen === false}
          // Made with Apple or Google just now: it may belong to someone who used Telegram before
          newAppleAccount={!!session && (session.user.phone.startsWith(APPLE_PHONE_PREFIX) || session.user.phone.startsWith(GOOGLE_PHONE_PREFIX))}
          initialName={session?.user.fullName ?? ''}
          initialError={sp.error === 'google' ? 'error.googleFailed' : sp.error === 'blocked' ? 'error.accountBlocked' : sp.error === 'telegram_link' ? 'error.telegramLinkUsed' : null}
          telegramEnabled={telegramLoginEnabled()}
          appleEnabled={!!appleConfig() && (await inIosApp())}
          // Google refuses to sign in inside an app's web view: the website only
          googleEnabled={!!googleConfig() && !(await appShell())}
          // SMS login is hidden in production until a real SMS provider is connected, except for the stores' review login
          phoneEnabled={env().SMS_PROVIDER !== 'console' || env().NODE_ENV !== 'production' || !!reviewLogin()}
        />
      </main>
    </TemperatureProvider>
  )
}
