# Trailcraft as a real iPhone app

The iPhone app is the same code as the website, inside a native shell
(Capacitor). The shell adds what a web page cannot have on an iPhone:

- **recording that keeps going with the phone in a pocket and the screen dark**
  (`@capacitor-community/background-geolocation`);
- **haptics** — the coach can tap your wrist (`@capacitor/haptics`);
- **the coach's voice from iOS itself** — any voice on the phone, including the
  Premium ones downloaded in Settings → Accessibility → Read & Speak (called
  Spoken Content before iOS 26) → Voices, which the app then marks Natural;
  still heard with the phone locked, over your music (the Speech plugin in
  `ios/App/App/TrailcraftSpeech.swift`). The tones and taps still need the
  screen on;
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

## App Review notes

`Info.plist` asks for two background modes, and a reviewer will want both
explained. Paste this into **App Review Information → Notes** in App Store
Connect with each submission that adds or keeps them:

> **location** — Trailcraft records a scent-work trail (the route a person
> walks for a tracking dog to follow, then the dog's run along it). The phone
> is in the handler's pocket with the screen locked for the whole walk, so
> recording has to carry on in the background. It stops when the handler
> presses Stop.
>
> **audio** — used only for the coach's spoken calls during a coached run,
> like a satnav's prompts: "Off the trail, 25 m left", "Back on the line".
> The handler is working a dog with the phone locked in a pocket, and the
> call is the whole point of the coach. The audio session (playback, voice
> prompt mode, ducking other audio) is made active only while a call is
> being spoken and let go as soon as it ends, so the handler's music comes
> straight back up. Nothing plays in the background at any other time: no
> music, no silent audio, no tones.
>
> **To hear it, indoors, with no dog:**
> 1. Settings (in the app) → Coach: turn **Voice** on and press **Play** to
>    hear a call.
> 2. Add a dog when the app asks (any name will do). Home → **Lay a trail**
>    → **Start**, tap the map where the trail starts, somewhere away from
>    where you are standing, and draw a short line with your finger. Choose
>    how long after the dog starts, and save it.
> 3. Home → **Run a trail**, pick that trail, and run it on this phone with
>    the coach on. The phone is well off the drawn line, so the coach calls
>    it within a few seconds.
> 4. Lock the phone. The calls go on being spoken while it is locked, and
>    stop when the run is stopped.

Walk through these steps on a phone before each submission: the button
names above are the app's own, and a reviewer who cannot follow them
rejects the build rather than asking.
