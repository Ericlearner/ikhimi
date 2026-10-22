# Android apps

Two Trusted Web Activity apps that open the website full screen (generated with Bubblewrap's core library):

| Folder | Package | Opens | Ships as |
|---|---|---|---|
| `play/` | `kr.ikhimi.app` | `/open/play`: nothing is sold or linked to a purchase (Google Play rules) | `.aab` → Google Play |
| `web/` | `kr.ikhimi.app.web` | `/open/apk`: everything, plans included | `.apk` → `apps/web/public/download/ikhimi.apk`, page `/android` |

Both open `ikhimi.kr` (`twa-manifest.json` → `host`, and `twaManifest.hostName` in `app/build.gradle`). The
site proves it owns them at `/.well-known/assetlinks.json` (`apps/web/src/app/api/assetlinks`); without it the app
shows a browser bar.

## Signing key

익히미 needs its own key (never reuse another app's). Create it once, outside this repo:

```bash
mkdir -p ~/Documents/ikhimi-android-keys && cd ~/Documents/ikhimi-android-keys
"/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/keytool" -genkeypair -v -keystore ikhimi-upload.jks \
  -alias ikhimi -keyalg RSA -keysize 2048 -validity 10000
"/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/keytool" -list -v -keystore ikhimi-upload.jks -alias ikhimi
```

Keep the passwords in `PASSWORDS.txt` next to it. Never in this repo. **Back it up**: every update must be signed
with it. Put the `SHA256:` line from `-list` in the Vercel setting `ANDROID_UPLOAD_SHA256`. Google Play re-signs the Play app with its own key: put that key's SHA-256 (Play Console → Test and release →
App integrity → App signing) in the Vercel setting `ANDROID_PLAY_SHA256`, or the Play app shows a browser bar.

## Build

Needs Android Studio (its Java and SDK). From each folder:

```bash
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export IKHIMI_KEY_PASSWORD="…"            # from PASSWORDS.txt
echo "sdk.dir=$HOME/Library/Android/sdk" > local.properties
cd play && ./gradlew bundleRelease          # → app/build/outputs/bundle/release/app-release.aab
cd web && ./gradlew assembleRelease         # → app/build/outputs/apk/release/app-release.apk
```

For an update, raise `appVersionCode` (and `appVersion`) in both `twa-manifest.json` and `app/build.gradle`
(`versionCode`, `versionName`), then build. After a web APK build, copy it to `apps/web/public/download/ikhimi.apk`
and set the Vercel setting `ANDROID_APK_VERSION` (e.g. `1.0.0`): until it is set, the site hides the download
banner, the footer link and `/android`.

## Moving to another address (ikhimi.kr)

Change `host` in both `twa-manifest.json` and `hostName` in both `app/build.gradle`, raise the version, build, and
upload. The new address must serve the same `assetlinks.json` (it does: it's part of the site).
