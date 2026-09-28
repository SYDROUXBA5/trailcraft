/* The native shell, when there is one.

   The same app runs three ways: in Safari, as a Home Screen web app, and
   inside a real iOS app (Capacitor wraps this exact code). Only the last can
   keep recording with the phone in a pocket and the screen dark, tap the
   handler's wrist, or speak the coach's calls in a downloaded voice with
   the screen locked. The tones and the buzz still need the screen on: iOS
   plays a dark app's web sounds and taps for nobody (app.js holdScreen).
   This module is the whole of the difference: everything
   else in the app asks it "is there a shell?" and carries on the same way
   when the answer is no.

   Capacitor injects `window.Capacitor` into the page when — and only when —
   the app is running inside the shell. In a browser it is simply absent, so
   every function here fails closed to "no". */

const cap = () => (typeof window !== 'undefined' ? window.Capacitor : null);

/** True inside the iOS (or Android) app; false in any browser. */
export const isNative = () => !!cap()?.isNativePlatform?.();

export const platform = () => cap()?.getPlatform?.() ?? 'web';

/* A native plugin's JavaScript proxy. Core plugins are already on
   Capacitor.Plugins; community ones need registering by name. No bundler
   here, so this is done by hand rather than by `import`. */
function plugin(name) {
  const c = cap();
  if (!c?.isNativePlatform?.()) return null;
  try { return c.Plugins?.[name] ?? c.registerPlugin?.(name) ?? null; } catch { return null; }
}

/** Is background GPS available — recording that survives a dark screen? */
export const canRecordInBackground = () => !!plugin('BackgroundGeolocation')?.addWatcher;

/** Start background GPS. `onFix` receives the same shape the browser's
    watchPosition gives, so the recorder does not know which it is on.
    Returns { stop } or null when there is no shell. */
export async function watchBackground(onFix, onError, { message = 'Recording the trail' } = {}) {
  const BG = plugin('BackgroundGeolocation');
  if (!BG?.addWatcher) return null;
  const id = await BG.addWatcher(
    {
      backgroundTitle: 'Trailcraft',
      backgroundMessage: message,   // iOS shows this while the screen is dark
      requestPermissions: true,
      stale: false,                 // never the last known position, only fresh ones
      distanceFilter: 0,            // every fix: stillness is dwell, not noise, and the app decides
    },
    (loc, err) => {
      if (err) {
        if (err.code === 'NOT_AUTHORIZED') BG.openSettings?.();
        onError?.(err);
        return;
      }
      if (!loc) return;
      onFix({
        coords: {
          latitude: loc.latitude, longitude: loc.longitude, accuracy: loc.accuracy,
          altitude: loc.altitude ?? null, speed: loc.speed ?? null, heading: loc.bearing ?? null,
        },
        timestamp: loc.time ?? Date.now(),
      });
    },
  );
  return { id, stop: () => BG.removeWatcher({ id }).catch(() => {}) };
}

/* ── Files out of the iPhone app ──────────────────────────────────────
   In a browser a file leaves through the share sheet or as a download. Inside
   the app a download does nothing: the web view hands the blob: link to the
   system to open, and nothing there can, so the tap did nothing and said
   nothing. Where the web view offers no share sheet for files, the file is
   written to the app's cache folder and the phone's own share sheet takes it
   from there (Save to Files, AirDrop, Mail). Both plugins are Capacitor's own
   (@capacitor/filesystem, @capacitor/share). */
/* A name for the cache folder: one plain file, never a path out of it. */
const safeName = (name) => String(name || '').replace(/[^\w.-]+/g, '-').replace(/^[.-]+/, '').slice(0, 120) || 'trailcraft';
function base64Of(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Hand a file to the phone's share sheet from inside the app. `bytes` is
    text or a Uint8Array. Says what happened: 'shared', 'cancelled' (the
    handler closed the sheet), 'failed', or 'none' when there is no shell or
    no plugin to do it with (a browser, or an app built before they were in). */
export async function shareFile(bytes, name) {
  const FS = plugin('Filesystem'), SH = plugin('Share');
  if (!FS?.writeFile || !SH?.share) return 'none';
  let uri;
  try {
    const text = typeof bytes === 'string';
    ({ uri } = await FS.writeFile({
      path: safeName(name), directory: 'CACHE',
      data: text ? bytes : base64Of(bytes),
      ...(text ? { encoding: 'utf8' } : {}),
    }));
  } catch { return 'failed'; }
  if (!uri) return 'failed';
  try {
    await SH.share({ title: name, files: [uri] });
    return 'shared';
  } catch (e) {
    return /cancel/i.test(String(e?.message ?? e)) ? 'cancelled' : 'failed';
  }
}

/** Can the shell tap the wrist? (iPhones cannot from a web page.) */
export const canHaptic = () => !!plugin('Haptics');

/** One tap, sized to what it means: light at the edge, a warning when off,
    a success pattern when back. False when there is nothing to tap with. */
export async function haptic(kind) {
  const H = plugin('Haptics');
  if (!H) return false;
  try {
    if (kind === 'edge') await H.impact({ style: 'LIGHT' });
    else if (kind === 'back') await H.notification({ type: 'SUCCESS' });
    else await H.notification({ type: 'WARNING' });
    return true;
  } catch { return false; }
}

/* ── The compass ─────────────────────────────────────────────────────
   Inside the iPhone app the heading comes from Core Location (the Heading
   plugin in ios/App/App/TrailcraftNative.swift): no permission to tap for,
   true north, and it starts on its own. `onHeading(degrees)` is clockwise
   from north. Resolves to a function that stops it — or to null where there
   is no such plugin (the browser, or a shell built before it existed), and
   the caller falls back on the browser's own compass events. */
export async function watchHeading(onHeading) {
  if (!isNative()) return null;
  const H = plugin('Heading');
  if (!H?.start || !H.addListener) return null;
  let sub = null;
  try {
    sub = await H.addListener('heading', (e) => { if (Number.isFinite(e?.heading)) onHeading(e.heading, e); });
    await H.start();
  } catch {
    try { await sub?.remove?.(); } catch { /* nothing to undo */ }
    return null;
  }
  return async () => {
    try { await H.stop(); } catch { /* already stopped */ }
    try { await sub?.remove?.(); } catch { /* already gone */ }
  };
}


/* ── The coach's voice ───────────────────────────────────────────────
   Inside the iPhone app the coach speaks through iOS itself (the Speech
   plugin in ios/App/App/TrailcraftSpeech.swift), not the web view's
   speechSynthesis, which lists only the voices the phone came with and
   is silent once the screen goes dark. iOS lists the Premium and Enhanced
   voices the handler downloaded too, and speaks with the screen locked,
   dipping the handler's music under the call. Only a plugin the shell
   really has counts: an app built before it existed has no Speech entry,
   and there the web view speaks, as it always did. */
const speech = () => (isNative() ? cap()?.Plugins?.Speech ?? null : null);

/** Can the coach speak through iOS rather than the web view? */
export const canSpeakNative = () => !!speech()?.speak;

/** Every voice iOS holds, as it describes them: [{ identifier, name,
    language, quality: 'premium' | 'enhanced' | 'default', novelty }].
    Null when there is no such engine or it would not answer. */
export async function nativeVoices() {
  const S = speech();
  if (!S?.voices) return null;
  try {
    const r = await S.voices();
    return Array.isArray(r?.voices) ? r.voices : [];
  } catch { return null; }
}

/** Say one call now, cutting off the one before. `voice` is a voice's
    identifier (the coach's voiceURI), `rate` the web's pace, 1 being
    normal. True once iOS has taken it; false when it could not. 'unheard'
    (still truthy: iOS did take it) when iOS would not give the app the
    sound to say it in, during a phone call or Siri, so the coach can count
    it as missed rather than as said. A shell built before it said so
    answers nothing, and is taken at its word as before. */
export async function speakNative({ text, voice = null, lang = 'en-GB', rate = 1 }) {
  const S = speech();
  if (!S?.speak) return false;
  try {
    const r = await S.speak({ text, lang, rate, ...(voice ? { voice } : {}) });
    return r?.heard === false ? 'unheard' : true;
  } catch { return false; }
}

/** Stop mid-word: the run is over. */
export async function stopNativeSpeech() {
  try { await speech()?.stop?.(); } catch { /* nothing was being said */ }
}

/** Call `fn` when iOS says its voices changed (one finished downloading).
    Resolves to a function that stops listening, or null. */
export async function watchNativeVoices(fn) {
  const S = speech();
  if (!S?.addListener) return null;
  try {
    const sub = await S.addListener('voicesChanged', () => fn());
    return () => { try { sub?.remove?.(); } catch { /* already gone */ } };
  } catch { return null; }
}
