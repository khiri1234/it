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
