# THE H BUSINESS MANAGEMENT — iOS app

This wraps the existing web app (hosted at `https://app.hatef.cc`, deployed
automatically from this repo's `index.html` — see
`.github/workflows/deploy-pages.yml`) in a thin native iOS shell, so it runs
as its own app (Home Screen icon, no Safari address bar) instead of a browser
tab, with three things the web platform can't provide on its own: **Face ID**
unlock, **push notification** topic subscriptions, and **picking a contact**
from the device's own address book.

Unlike the macOS desktop app (`../desktop/`), this does **not** bundle
`index.html` into the binary. The web app ships constantly — every PR merged
to `main` in this repo deploys straight to production — so loading it live
means every user is always on the latest version with no app-update/App
Store review cycle in the way. Bundling it would mean a new native build and
resubmission for every web-only change, which defeats the point of shipping
fast. The native code here only exists for the bridges below; everything
else (the UI, the data, Firebase sync) is the same web app, loaded live.

The outer `index.html` is already written expecting this wrapper to exist —
look for `isWrappedApp()`, `requestBiometricLogin()`, `syncPushTopic()` and
`pickContact()` in it. Nothing on the native side needs to change when the
web app changes, unless a *new* native bridge is needed.

## What's native here, and why

| Feature | Why it needs native code |
|---|---|
| **Face ID** | WebAuthn/Touch ID has no iOS Face ID equivalent reachable from a web page. `WebViewController` adds a `faceID` `WKScriptMessageHandler`; the web app posts `'unlock'` to it and the native side calls back into `window.__faceIDUnlock()` / `window.__faceIDFailed('message')`. |
| **Push notification topics** | The app targets notifications by *topic* (`staff`, `client_<slug>`, `supplier_<slug>`, etc. — see `pushTopicsForUser()` in `index.html`), not per-device tokens, so it needs Firebase Cloud Messaging's native topic-subscription API. `WebViewController` adds a `pushTopic` handler that the web app posts `{action: 'subscribe'|'unsubscribe', topic}` to. |
| **Picking a contact** | The web [Contact Picker API](https://developer.mozilla.org/en-US/docs/Web/API/Contact_Picker_API) (`navigator.contacts.select`) that the hosted site falls back to in a plain Safari tab is a *browser-only* API — it is **not** implemented inside a third-party app's WKWebView, which is exactly why this needs its own bridge. `WebViewController` adds a `contactPicker` handler that opens the real iOS People picker (`CNContactPickerViewController`) and calls back into `window.__contactPicked({name, tel, email})` / `window.__contactPickCancelled()`. No `NSContactsUsageDescription`/permission prompt needed — picking one contact through Apple's own picker UI never grants the app bulk address-book access. |
| **Camera permission** | The barcode/QR scanner uses `getUserMedia`. `WKUIDelegate`'s `requestMediaCapturePermissionFor` auto-grants it once iOS's own one-time system prompt has already been accepted — same behavior as the desktop app's permission handler for the same feature. |
| **External links** (wa.me, paypal.me) | Routed to Safari/the WhatsApp app instead of loading inside the single WKWebView — same behavior as the desktop app's `setWindowOpenHandler`. |
| Everything else | Plain web platform features that already work inside any WKWebView with zero native code — `navigator.share` (used for the OS share sheet / PDF sharing), WebAuthn, etc. |

## Project layout

```
ios/
  project.yml                 XcodeGen spec — the source of truth for the Xcode project
  App/
    TheHApp.swift              SwiftUI @main entry point
    AppDelegate.swift          Firebase configure + APNs/push registration
    ContentView.swift          SwiftUI -> UIKit bridge
    WebViewController.swift    The actual WKWebView + the two bridges above
    Info.plist
    App.entitlements
    GoogleService-Info.plist.example   Template — see "Push notifications" below
    Assets.xcassets/           App icon (reused from ../desktop/build/icon.png,
                                flattened to drop its alpha channel — Apple
                                rejects a marketing icon that has one), accent
                                color, launch screen background
```

There is **no committed `.xcodeproj`**. It's generated from `project.yml` by
[XcodeGen](https://github.com/yonaskolb/XcodeGen) — same philosophy as the
desktop app's `copy-app.js` regenerating `desktop/app/` at build time rather
than committing a derived artifact. Regenerate it any time with
`xcodegen generate`; never hand-edit a generated `.xcodeproj`.

## Get a pre-built copy (no local build needed)

A GitHub Actions workflow (`.github/workflows/build-ios-app.yml`) builds this
on a real macOS runner for the iOS **Simulator** (no Apple Developer account
or code signing needed for a simulator build) on every push that touches
`ios/`, and on demand:

- Open the repo's **Actions** tab -> **Build iOS App** -> **Run workflow**.
- Download the `the-h-ios-simulator-build` artifact from the run's summary —
  it's a `.app` you can drag onto a *running* iOS Simulator window, or
  install with `xcrun simctl install booted TheHBusinessManagement.app`.

This proves the project builds and is useful for a quick look in Simulator,
but a simulator build **cannot** go on a real iPhone or TestFlight — that
needs real code signing, which needs your own Apple Developer account (see
below).

## Build it yourself on a Mac

```sh
brew install xcodegen
cd ios
xcodegen generate
open TheHBusinessManagement.xcodeproj
```

Then in Xcode: pick a simulator or your own device as the run destination,
set your own Team under **Signing & Capabilities** (needed even for a
simulator build run from Xcode itself, though not for the CI/Simulator-only
artifact above), and hit Run.

For push notifications to actually work (Face ID works regardless), you also
need `App/GoogleService-Info.plist` — see `App/GoogleService-Info.plist.example`
for exactly how to get it from the Firebase console. Without it, Firebase
silently no-ops (per the comment in `AppDelegate.swift`) and the rest of the
app works fine, just without push.

## Submitting to the App Store

Everything below needs your own Apple Developer account — none of it can be
done from here, same as the equivalent section in `../desktop/README.md`:

1. **Enroll in the Apple Developer Program** (developer.apple.com, $99/year).
2. **Create an App ID** matching `com.thehitsolutions.businessmanagement.ios`
   (the bundle ID set in `project.yml` — change it there first if you want a
   different one), with the **Push Notifications** capability enabled.
3. **Upload an APNs key** for this app under Firebase console -> Project
   Settings -> Cloud Messaging -> Apple app configuration, so the `pushTopic`
   subscriptions actually deliver anything.
4. **Download `GoogleService-Info.plist`** for this app from the Firebase
   console (see `App/GoogleService-Info.plist.example`) and save it at
   `ios/App/GoogleService-Info.plist`.
5. **Switch `App.entitlements`'s `aps-environment`** from `development` to
   `production` before archiving for the App Store — the development value
   is correct for Xcode/TestFlight-via-Xcode debug runs, but push silently
   stops working on an App-Store/TestFlight-via-App-Store-Connect build if
   you forget this.
6. **Create the app record in App Store Connect** (same bundle ID), and fill
   in the listing: screenshots, description, pricing/availability, age
   rating, the **App Privacy** questionnaire (this app talks to Firebase —
   have a privacy policy URL ready), and a reviewer demo account, since this
   is a login-gated business tool.
7. **Archive and upload** from Xcode (Product -> Archive -> Distribute App),
   signed automatically with your Team's certificates once you've selected
   your Team in Signing & Capabilities.
8. **Submit for review**, or distribute via **TestFlight** first from the
   same App Store Connect page.

## Notes

- **Icon.** `App/Assets.xcassets/AppIcon.appiconset/icon-1024.png` was
  generated from `../desktop/build/icon.png` (flattened onto the brand navy
  to remove its alpha channel, which Apple rejects on a marketing icon) —
  same small/blurry caveat the desktop README already flags for that source
  image. Drop in your own sharp 1024×1024 opaque PNG at that path for a
  crisper icon.
- **Orientation.** iPhone is locked to portrait (matching the web app's
  mobile-first layout); iPad allows all four orientations.
- **No analytics.** `GoogleService-Info.plist.example` has
  `IS_ANALYTICS_ENABLED` / `IS_ADS_ENABLED` / `IS_SIGNIN_ENABLED` all off —
  only Cloud Messaging (push) is used.
