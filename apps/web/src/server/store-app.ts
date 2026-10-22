/**
 * The Google Play app (DECISIONS.md BD) and the iOS app (apps/ios). They open /open/play and /open/ios first, which
 * mark the device with a cookie; while it's there, nothing is sold and nothing points to a purchase: no plans page, no
 * teacher packages, no "see plans" links (Google and Apple allow selling digital plans only through their own billing).
 * Plans bought on the website still apply. The APK downloaded from the website opens /open/apk and keeps everything
 * (marked 'apk', only to hide the download button).
 */
import 'server-only'
import { cookies } from 'next/headers'

export const STORE_COOKIE = 'tl_store'

export async function isStoreApp() {
  const v = (await cookies()).get(STORE_COOKIE)?.value
  return v === 'play' || v === 'ios'
}

/** Opened in the iOS app: Sign in with Apple, notifications, and nothing about Android */
export async function inIosApp() {
  return (await cookies()).get(STORE_COOKIE)?.value === 'ios'
}

/** Opened in either Android app (Play or the website's APK): no "download the app" button there */
export async function inAndroidApp() {
  const v = (await cookies()).get(STORE_COOKIE)?.value
  return v === 'play' || v === 'apk'
}

/**
 * Opened in one of the apps (iOS, Google Play, the website's APK): the app look (data-app on <html>): a bottom tab
 * bar instead of the header's links, no footer, no pinch zoom. The website itself keeps its own look.
 */
export async function appShell(): Promise<'ios' | 'android' | null> {
  const v = (await cookies()).get(STORE_COOKIE)?.value
  return v === 'ios' ? 'ios' : v === 'play' || v === 'apk' ? 'android' : null
}

/**
 * The version of the APK in public/download/ikhimi.apk, from ANDROID_APK_VERSION (e.g. "1.0.0"); null until one is
 * built and put there (apps/android/README.md): then the download banner, the footer link and /android stay hidden.
 */
export const apkVersion = () => process.env.ANDROID_APK_VERSION?.trim() || null
