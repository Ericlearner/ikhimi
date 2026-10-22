# iOS app

A native iPhone app (Swift, UIKit) that shows the website full screen and adds what a website can't, so App Review
sees an app rather than a web page in a frame (guideline 4.2):

| Native part | Where |
|---|---|
| Sign in with Apple, first on the sign-in screen (guideline 4.8) | `NativeBridge.swift` → `POST /api/auth/apple` |
| Push notifications: new homework, due soon, the teacher's reminder, a graded essay | `NativeBridge.swift` (`PushRegistrar`) → `POST /api/push`; sent by `server/push.ts` |
| Camera, photo picker, microphone (pronunciation, dictation) | WebKit + `Info.plist` texts in Korean (`ko.lproj`) |
| Share sheet for homework links, downloads go to the share sheet | `WebViewController.swift` |
| Links to the site open in the app (universal links) | `/.well-known/apple-app-site-association` |
| Pull to refresh, swipe back, a native "no internet" screen, JS alerts as iOS alerts | `WebViewController.swift`, `OfflineView.swift` |

It opens `https://<IKHIMI_HOST>/open/ios`, which marks the device as the iOS app: **nothing is sold in it** and
nothing points to a purchase (guideline 3.1.1), like the Google Play app. Plans bought on the website still apply.
Nothing about Android shows either (guideline 2.3.10).

| | |
|---|---|
| Bundle ID | `kr.ikhimi.app` |
| Site | build setting `IKHIMI_HOST` (now `ikhimi.kr`, same as Android) |
| iOS | 15.0 and newer, iPhone (runs on iPad in iPhone mode) |
| Version | `MARKETING_VERSION` 1.0.0, build `CURRENT_PROJECT_VERSION` 1 |

## 1. Once: the server

1. **Apple key.** developer.apple.com → Certificates, IDs & Profiles → **Keys** → "+" → name it "Ikhimi", tick
   **Apple Push Notifications service (APNs)** and **Sign in with Apple** (Configure → Primary App ID
   `kr.ikhimi.app`; the App ID exists after step 2.2, so do that first if it's not in the list) → Register →
   **Download** the `.p8` file (only once possible: keep it next to the Android keys, never in this repo).
2. **Vercel → Settings → Environment Variables** (Production), then redeploy:
   - `APPLE_TEAM_ID`: Membership details → Team ID (10 characters)
   - `APPLE_KEY_ID`: the key's ID (10 characters)
   - `APPLE_PRIVATE_KEY`: the whole `.p8` text, `-----BEGIN PRIVATE KEY-----` to `-----END PRIVATE KEY-----`
3. **Database:** nothing to do: the tables come with the normal migrations.
4. **Check:** `https://ikhimi.kr/.well-known/apple-app-site-association` shows JSON with
   `<TEAM_ID>.kr.ikhimi.app`. (404 = `APPLE_TEAM_ID` isn't set.)

Without the key there's no way to sign in inside the app: Google refuses to sign in inside an app's web view, so
Sign in with Apple is the app's only way in (the website and the Android apps use Google). An Apple ID whose email
the person shares opens the same account as their Google account with that email; with "Hide My Email" it's a
separate account.

## 2. Once: Xcode

1. Install **Xcode** from the Mac App Store (it's not installed on this Mac yet; the command line tools alone can't
   build iOS apps). Open it once and let it install the iOS platform.
2. Open `apps/ios/Ikhimi.xcodeproj`. Select the **Ikhimi** target → **Signing & Capabilities**:
   1. Tick "Automatically manage signing" (on already), choose your **Team**.
   2. Xcode registers `kr.ikhimi.app` with Push Notifications, Sign in with Apple and Associated Domains (they're in
      `Ikhimi.entitlements`). If it reports a problem with a capability, click "Try Again" or add the capability
      once with "+ Capability".
3. Run on your iPhone (connect it, choose it at the top, ⌘R). Check: sign in with Apple, allow notifications,
   publish a homework to a group you're a student in (another account), take a photo in Create, pronunciation
   practice, share a link, airplane mode → the "no internet" screen.

Builds run from Xcode get notifications from Apple's **sandbox**; TestFlight and the App Store use production. The
server keeps which one each device uses, so both work.

## 3. Upload

1. App Store Connect → Apps → "+" → New App: iOS, name **익히미**, primary language **Korean**, bundle ID
   `kr.ikhimi.app`, SKU `ikhimi-ios`.
2. Xcode: choose **Any iOS Device (arm64)** at the top → Product → **Archive** → Distribute App → **App Store
   Connect** → Upload.
3. The build shows in TestFlight after processing (15–30 minutes). Test it there before review.

For every update: raise the build (`CURRENT_PROJECT_VERSION`: 2, 3, …) and, for a visible release, the version
(`MARKETING_VERSION`), in the target's General tab. Most changes don't need a new build at all: they're on the site.

## 4. The store page and review

- **Category:** Education. **Age rating:** answer "None" to everything → 4+. Don't enter the Kids category (its
  rules forbid things the site does, like links out and sign-in).
- **Screenshots:** iPhone 6.9" (1320 × 2868), 3–10 of them: the teacher's Create screen, a generated homework, the
  report, a student doing homework, the result. Take them from the iPhone 16 Pro Max simulator (⌘S).
- **Description:** the Korean text from the Google Play listing fits, without anything about prices.
- **Privacy policy URL:** `https://ikhimi.kr/privacy`. **Account deletion:** in the app, Profile →
  Settings → Delete account (`/delete-account` explains it).
- **App Privacy** (must match `Ikhimi/PrivacyInfo.xcprivacy`): Data collected, linked to the user, not used for
  tracking, purpose App Functionality: Name, Email Address, User ID, Photos (textbook pages teachers upload), Other
  User Content (homework answers). Nothing else.
- **App Review Information → Sign-in required:** no demo account; reviewers sign in with their own Apple ID (a new
  account picks teacher or student on the first screen). Notes (paste):

  > 익히미 (Ikhimi) helps foreign-language teachers in Korea turn a textbook page into homework with automatic checking; students do it
  > on their phones. Sign in: tap "Sign in with Apple" with any Apple ID; the first screen asks whether you teach or
  > learn (choose "teacher" to see homework creation). Nothing is sold in the iOS app: plans can't be bought
  > or seen in it. Native features: Sign in with Apple, push notifications for homework and grades, the camera for
  > textbook pages, the microphone for pronunciation practice, the share sheet, universal links.

## Moving to another address (ikhimi.kr)

Set the build setting `IKHIMI_HOST` (target → Build Settings, search "IKHIMI"), raise the build, upload. The new
address serves the same `apple-app-site-association` (it's part of the site). Universal links follow the entitlement
`applinks:$(IKHIMI_HOST)`.
