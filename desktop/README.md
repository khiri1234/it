# THE H BUSINESS MANAGEMENT — macOS desktop app

This wraps the existing web app (`../index.html`) in an Electron shell so it
runs as a native-feeling macOS app (Dock icon, `THE H BUSINESS MANAGEMENT.app`,
`.dmg` installer) instead of a browser tab. It's the same app, same Firebase
backend — this is just packaging.

The outer `index.html` stays the single source of truth. `npm start` / `npm
run dist` copy it (plus `vendor/`) into `desktop/app/` before running, so you
never edit anything inside `desktop/app/` directly — it's regenerated every
time.

## Get a pre-built copy (no local build needed)

A GitHub Actions workflow (`.github/workflows/build-macos-app.yml`) builds
this on a real macOS runner, so you don't need a Mac of your own just to get
a `.dmg`:

- **Manual build, any time:** open the repo's **Actions** tab → **Build macOS
  App** → **Run workflow**. When it finishes, download the
  `the-h-business-management-macos` artifact from the run's summary page —
  it contains the `.dmg` and `.zip`.
- **Tagged release:** push a version tag (`git tag v1.0.0 && git push origin
  v1.0.0`) and the workflow builds the app and attaches the `.dmg`/`.zip` to
  a GitHub Release automatically, giving you a stable download link on the
  repo's **Releases** page.

Either way, the resulting `.app` is unsigned — see the Gatekeeper note below.

## Or build it yourself on a Mac

Electron's macOS build tooling (codesigning, `.dmg` creation via `hdiutil`)
only works on macOS itself, so run this on a Mac, not in this sandbox:

```sh
cd desktop
npm install
npm start          # launch it in dev mode to try it out
npm run dist        # build the .app + .dmg into desktop/dist/
```

`npm run dist` produces both an unpacked `THE H BUSINESS MANAGEMENT.app` and a
`THE H BUSINESS MANAGEMENT-<version>.dmg` you can drag-install like any other
Mac app, under `desktop/dist/`.

## Dock quick-jump menu

Press and hold (or right-click) the app's Dock icon for a menu of shortcuts —
Dashboard, Apple Store, Invoices, Purchases, Projects — that jump straight to
that section, bringing the window forward if it isn't already. A destination
a signed-in user's role can't see (e.g. Invoices for a purchasing-only
account, or Apple Store for anyone but the flagged iPhone Store admin) falls
back to Dashboard/Stock instead of landing on a forbidden view, same as the
in-app command palette (⌘K). This only customizes the menu while the app is
already running — macOS still shows its own generic Dock menu (Open, Options,
Quit) when the app hasn't been launched yet.

## Submitting to the Mac App Store

The project is wired up for an App Store build (`npm run dist:mas`, sandbox
entitlements in `build/entitlements.mas*.plist`, the camera usage string
`mac.extendInfo` needs), but the rest of this only Apple will let the app's
own account holder do — none of it can be done from here:

1. **Enroll in the Apple Developer Program** (developer.apple.com, $99/year).
   Needs your own Apple ID and legal/business identity — this is the step
   nothing else can substitute for.
2. **Create an App ID** in Certificates, Identifiers & Profiles matching
   `com.thehitsolutions.businessmanagement` (the `appId` already set in
   `package.json`), with the **App Sandbox** capability enabled.
3. **Generate and install two certificates** into your Mac's keychain (via
   Xcode → Settings → Accounts, or the Developer portal): **Apple
   Distribution** (signs the app) and **Mac Installer Distribution** (signs
   the `.pkg`). `electron-builder` finds these automatically by type when it
   builds the `mas` target — nothing to configure beyond having them
   installed.
4. **Create a Mac App Store provisioning profile** for that App ID, download
   it, and save it as `desktop/build/embedded.provisionprofile` —
   electron-builder picks it up from that path automatically.
5. **Create the app record in App Store Connect** (same bundle ID), and fill
   in the listing: screenshots, description, pricing/availability, age
   rating, and the **App Privacy** questionnaire (this app talks to Firebase,
   so expect to disclose that — have a privacy policy URL ready) and a
   reviewer demo account/instructions, since this is a login-gated business
   tool.
6. **Build the signed package** on a Mac with those certs/profile installed:
   ```sh
   cd desktop
   npm install
   npm run dist:mas     # produces a signed .pkg under desktop/dist/
   ```
7. **Upload it** with the **Transporter** app (Mac App Store) or
   `xcrun altool --upload-app`, pointed at the `.pkg` from step 6.
8. **Submit for review** from the app's page in App Store Connect.

Steps 1-2 and 5-8 all require signing in as the Apple Developer account that
will own this app on the Store — they can't be done from a CI runner or this
session. If you'd rather skip App Store review entirely, the direct-download
`.dmg`/`.zip` build above (optionally notarized) works immediately.

## Notes

- **Unsigned build.** `npm run dist` as configured produces an unsigned app.
  macOS Gatekeeper will show an "unidentified developer" warning on first
  launch — right-click the app → Open to bypass it once. To ship this to
  other people without that warning, you'll need an Apple Developer ID
  certificate and to add `mac.identity` / notarization to the `build` config
  in `package.json`.
- **Camera permission.** The barcode/QR scanner feature uses the camera;
  the app is set up to grant that request automatically. macOS will still
  show its own one-time system camera-permission prompt for the app.
- **Icon.** `build/icon.png` was generated from the app's existing favicon,
  so it's fairly small/blurry at large sizes. Drop in your own 1024×1024 PNG
  at that path (square, transparent background) for a sharper icon —
  electron-builder converts it to `.icns` automatically during the build.
- **Links.** `wa.me` and `paypal.me` links (used for "pay via WhatsApp/PayPal")
  open in your default browser instead of inside the app, same as they would
  from a phone.
