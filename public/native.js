/* The native shell, when there is one.

   The same app runs three ways: in Safari, as a Home Screen web app, and
   inside a real iOS app (Capacitor wraps this exact code). Only the last can
   keep recording with the phone in a pocket and the screen dark, or tap the
   handler's wrist. This module is the whole of the difference: everything
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

