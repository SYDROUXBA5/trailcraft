# Trailcraft as a real iPhone app

The iPhone app is the same code as the website, inside a native shell
(Capacitor). The shell adds what a web page cannot have on an iPhone:

- **recording that keeps going with the phone in a pocket and the screen dark**
  (`@capacitor-community/background-geolocation`);
- **haptics** — the coach can tap your wrist (`@capacitor/haptics`);
- later: Apple sign-in, notifications, files in the Files app.

Everything else — the map, the scent model, the coach, sharing — is the very
same `public/` folder. A fix made once ships to the website and the app.

## What Rémi does once

1. **Open Xcode** (Applications). On first launch accept the licence and let it
   **install the iOS platform** (a few GB, once).
2. Point the Mac's tools at Xcode (asks for your Mac password):
   ```bash
   sudo xcode-select -s /Applications/Xcode.app
   ```
3. **Xcode → Settings → Accounts → +** and sign in with your Apple ID.
4. On the iPhone: **Settings → Privacy & Security → Developer Mode → on**
   (it restarts). Plug the phone into the Mac with a cable and tap **Trust**.

## Two ways onto a phone

| | Free Apple ID | Apple Developer Programme (£79/yr) |
|---|---|---|
| Install | by cable from Xcode | **TestFlight** app, no cable |
| Lasts | 7 days, then reinstall | 90 days per build |
| Others | your phone only | up to 100 testers by email |
| Needed for | trying it | the instructor pilot, Apple sign-in, the App Store |

## Building (Claude does this)

```bash
npm run build:ios      # copies public/ into the iOS project and updates its plugins
open ios/App/App.xcodeproj
```
Then in Xcode pick the device (or a simulator) and press Run. With a
Developer account: **Product → Archive → Distribute → TestFlight**.

The iOS project lives in `ios/`. Generated pieces (`ios/App/App/public`, the
Mapbox token inside it, build folders) are git-ignored. Permission texts are in
`ios/App/App/Info.plist`; app id `com.elitecanine.trailcraft`.

## Known differences inside the shell

- Links and QR codes always name the public site
  (`https://sydrouxba5.github.io/trailcraft/`), never the app's own address.
- The service worker does not run inside the shell (not needed: the files are
  bundled). "Check for update" compares against the bundled copy.
- Google sign-in inside a WebView needs a native sign-in plugin — to do when
  the cloud project exists.
- Offline map areas are still not permitted by Mapbox for the web map, even
  inside the shell.
