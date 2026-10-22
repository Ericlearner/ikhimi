/**
 * Digital Asset Links (served at /.well-known/assetlinks.json, next.config.ts): proves the Android apps belong to this
 * site, so they open it full screen without a browser bar. Two apps:
 * - kr.ikhimi.app (Google Play): Google re-signs it, so it needs Play's app-signing key from Play Console → Test and
 *   release → App integrity (ANDROID_PLAY_SHA256, comma-separated) and our upload key (for installs from Android Studio).
 * - kr.ikhimi.app.web (the APK on the download page): signed with our key only.
 * Our upload key's SHA-256 is ANDROID_UPLOAD_SHA256 (apps/android/README.md: `keytool -list` on the 익히미 key).
 */
const fingerprints = (v: string | undefined) =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(s))

export function GET() {
  const play = fingerprints(process.env.ANDROID_PLAY_SHA256)
  const upload = fingerprints(process.env.ANDROID_UPLOAD_SHA256)
  const target = (pkg: string, keys: string[]) => ({
    relation: ['delegate_permission/common.handle_all_urls'],
    target: { namespace: 'android_app', package_name: pkg, sha256_cert_fingerprints: keys },
  })
  return Response.json([target('kr.ikhimi.app', [...play, ...upload]), target('kr.ikhimi.app.web', upload)], {
    headers: { 'Cache-Control': 'public, max-age=3600' },
  })
}
