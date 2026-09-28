/* The coach: watches a run against the laid trail and says, out loud, when
   the dog has left it — so a handler can train alone, with both hands on the
   line and their eyes on the dog rather than on a screen.

   Four things make it more than a corridor with a buzzer:

   1. The corridor follows the scent. Scent drifts downwind of the line, and
      a dog working there is on the scent, not off it. On the downwind side
      the corridor is the tolerance or the modelled scent band, whichever is
      wider; on the upwind side it is the tolerance alone.
   2. The phone is not the dog. The dog works a line-length ahead of the
      handler, so the position judged is the phone's, projected forward along
      the way the handler is moving.
   3. GPS noise never sounds an alarm. A fix has to be outside the corridor by
      more than its own stated accuracy, twice running (or for six seconds),
      before the coach speaks — unless it is outside by a whole corridor.
   4. It says what is happening, not just that something is: which side, how
      far, and when the dog is back. Never more often than every ten seconds,
      and "still off" once it has gone on for half a minute.

   Everything here is pure: fixes in, decisions out. The sounds and the voice
   live in the app, where the browser is. */

import { crossTrackSigned, progressAlong, project, dist } from './geo.js';

/* The corridor choices, in metres: round numbers in the units the handler
   thinks in, so the chip never reads "9.1 m" or "66 ft". */
export const TOL_OPTIONS = {
  metric: [10, 20, 30, 50],
  imperial: [9.144, 18.288, 30.48, 45.72],      // 30, 60, 100, 150 ft
};

export const COACH_DEFAULTS = {
  coachOn: false,        // off = a blind run: no prompts. Assisted runs are a choice, and are recorded as such.
  coachTol: 20,          // metres each side of the line
  coachScent: false,     // experimental: widen the downwind side toward the scent band
  coachVoice: true,
  coachSound: true,
  coachVibrate: true,    // only where the phone can (not iPhone)
  coachShow: false,      // the distance on screen — off keeps the run blind
  coachVoiceURI: null,   // which voice speaks: one of this phone's voices, or null for the best one here
};

export const QUIET_MS = 10_000;    // never two alerts closer than this
export const STILL_MS = 30_000;    // "still off" from here on
export const CONFIRM_MS = 6_000;   // one excursion this long counts even from single fixes
export const PLAN_EXTRA_M = 10;    // a drawn line is a sketch: give it room
export const SCENT_CAP = 1.5;      // the scent widening never exceeds this × the tolerance
export const STILL_REPEATS = 2;    // repeats without a new fix: then quiet until the dog moves

const fin = Number.isFinite;

/** Where the dog is, from where the phone is: `lineM` ahead along the
    handler's heading. Without a heading (not yet moving) it is the phone. */
export function dogPosition(pos, headingDeg, lineM) {
  if (!pos) return null;
  if (!fin(headingDeg) || !(lineM > 0)) return { lat: pos.lat, lon: pos.lon };
  const q = project(pos, headingDeg, lineM);
  return { lat: q.lat, lon: q.lon };
}

/** The corridor at trail vertex `i`: how far the dog may sit on each side.
    `field` is geo.scentField(trail, …) or empty; with it, the downwind side
    opens toward the scent band's far edge — capped at SCENT_CAP × the
    tolerance, because the band's distance is a modelled guess and the cap
    is a design choice to test, not a validated scent distance. */
export function corridor(trail, field, i, tolM, scentAware = true) {
  const out = { left: tolM, right: tolM, driftSide: null, band: 0 };
  const f = scentAware ? field?.[i] : null;
  if (!f || !trail || trail.length < 2) return out;
  const a = trail[Math.max(0, i - 1)], b = trail[Math.min(trail.length - 1, i + 1)];
  const across = crossTrackSigned(a, b, f.centre).signed;     // + = right of travel
  if (Math.abs(across) < 1) return out;                       // wind along the trail: no side
  const side = across > 0 ? 'right' : 'left';
  out.driftSide = side;
  out.band = Math.abs(across) + (f.halfWidth ?? 0);
  out[side] = Math.min(tolM * SCENT_CAP, Math.max(tolM, out.band));
  return out;
}

export const initialCoach = () => ({
  status: 'on',          // on | edge | off
  offRun: 0,             // consecutive fixes outside the corridor
  offSince: 0,           // when this excursion began being outside
  offAt: 0,              // when the coach first called it off
  lastAlert: 0,
  repeatsSinceFix: 0,    // a standing dog is not called forever
  edgeWarned: false,
  last: null,            // the most recent reading, for timer-driven repeats
  excursions: 0,         // how many times the coach had to call it
});

/** One step. `fix` is a kept GPS fix ({lat, lon, acc, t}) or null for a
    timer tick. Returns { state, reading, alert } — `alert` is null or
    { kind: 'edge'|'off'|'still'|'back', metres, side, where }. */
export function coachStep(state, {
  fix = null, heading = null, lineM = 0, trail, field = [],
  tolM = 20, scent = true, plan = false, now = Date.now(),
} = {}) {
  const st = { ...(state ?? initialCoach()) };
  if (!trail || trail.length < 2) return { state: st, reading: null, alert: null };

  let reading = st.last;
  if (fix) {
    const tol = tolM + (plan ? PLAN_EXTRA_M : 0);
    const dog = dogPosition(fix, heading, lineM);
    const pa = progressAlong(trail, dog);
    const i = pa.t < 0.5 ? pa.i - 1 : pa.i;
    /* The distance is to the nearest piece of trail (past the end, that is
       the end itself); the sign only says which side. */
    const signed = crossTrackSigned(trail[pa.i - 1], trail[pa.i], dog).signed;
    const cor = corridor(trail, field, i, tol, scent);
    const side = signed > 0.5 ? 'right' : signed < -0.5 ? 'left' : null;
    const limit = side ? cor[side] : tol;
    const off = pa.off;
    const acc = fin(fix.acc) ? Math.max(0, fix.acc) : 0;
    const beyond = pa.i === trail.length - 1 && pa.t >= 1 && dist(dog, trail[trail.length - 1]) > 3;
    const before = pa.i === 1 && pa.t <= 0 && dist(dog, trail[0]) > 3;
    reading = {
      t: now, dog, off, signed, side, limit, acc, remaining: pa.remaining, along: pa.along,
      where: beyond ? 'past the end' : before ? 'before the start' : side,
      // Is this fix outside the corridor by more than the GPS can explain?
      outside: off - acc > limit,
      farOutside: off - acc > 2 * limit,
      inside: off <= limit,
      // The soft word at the edge needs a decent fix: a ±30 m position
      // says nothing about a 5 m-wide zone.
      near: off > 0.75 * limit && acc <= 0.5 * limit,
      home: off < 0.6 * limit,
    };
    st.last = reading;
  }
  if (!reading) return { state: st, reading: null, alert: null };

  let alert = null;
  const call = (kind) => {
    alert = { kind, metres: Math.round(reading.off), side: reading.side, where: reading.where };
    st.lastAlert = now;
  };

  if (fix) {
    st.repeatsSinceFix = 0;
    if (reading.outside) {
      st.offRun += 1;
      if (!st.offSince) st.offSince = now;
    } else {
      st.offRun = 0;
      st.offSince = 0;
    }
    const confirmed = reading.outside
      && (st.offRun >= 2 || reading.farOutside || now - st.offSince >= CONFIRM_MS);

    if (st.status !== 'off' && confirmed) {
      st.status = 'off';
      st.offAt = now;
      st.excursions += 1;
      call('off');
    } else if (st.status === 'off' && reading.inside) {
      st.status = 'edge';                 // inside the corridor again: quiet unless it leaves again
      st.offAt = 0;
      call('back');
    } else if (st.status === 'on' && reading.near && reading.inside && !st.edgeWarned) {
      /* Inside the corridor but close to its edge. A fix already outside
         says nothing here: it waits for its second, so the call comes once. */
      st.status = 'edge';
      st.edgeWarned = true;
      call('edge');
    } else if (st.status === 'edge' && reading.home) {
      st.status = 'on';
      st.edgeWarned = false;
    }
  }

  /* Repeats are on the clock, not on the fixes: a dog standing still off the
     trail sends no new fixes and is still called again — twice. After that
     the handler knows, and the coach waits for the dog to move. */
  if (!alert && st.status === 'off' && now - st.lastAlert >= QUIET_MS && st.repeatsSinceFix < STILL_REPEATS) {
    st.repeatsSinceFix += 1;
    call(now - st.offAt >= STILL_MS ? 'still' : 'off');
  }
  return { state: st, reading, alert };
}

/** The words for an alert, in the handler's units. Distances are rounded
    to what a voice can say usefully: the nearest 5 m, or 10 ft. */
export function coachPhrase(alert, { imperial = false } = {}) {
  if (!alert) return '';
  if (alert.kind === 'back') return 'Back on the trail';
  const d = imperial
    ? `${Math.max(10, Math.round(alert.metres * 3.28084 / 10) * 10)} feet`
    : `${Math.max(5, Math.round(alert.metres / 5) * 5)} metres`;
  const where = alert.where === 'past the end' ? 'past the end of the trail'
    : alert.where === 'before the start' ? 'behind the start'
    : alert.side ? `to the ${alert.side}` : 'off';
  if (alert.kind === 'edge') return `Drifting ${where}`;
  return `${alert.kind === 'still' ? 'Still off' : 'Off the trail'}, ${d} ${where}`;
}

/** The short form for the screen, when the handler has asked to see it. */
export function coachLine(reading, status, { imperial = false } = {}) {
  if (!reading) return '';
  const d = imperial ? `${Math.round(reading.off * 3.28084)} ft` : `${Math.round(reading.off)} m`;
  const side = reading.where === 'past the end' ? 'past the end'
    : reading.where === 'before the start' ? 'before the start'
    : reading.side ?? '';
  if (status === 'off') return `Off · ${d} ${side}`.trim();
  return `${d} ${side}`.trim();
}

/* ── The voice ────────────────────────────────────────────────────────
   Left to choose for itself, an iPhone reads the calls in its small
   "compact" voice, and a handler out in a field hears a machine. Most
   phones hold better voices, and Apple's downloadable Enhanced and Premium
   ones sound like a person, though WebKit (Safari, and anything on an
   iPhone) only ever lists the voices the phone came with, so there the
   best is the best built in. The iPhone app is the exception: it speaks
   through iOS itself, which lists every voice on the phone, downloaded
   ones too (fromNativeVoice). So the coach picks its voice rather than
   taking the default: the best quality first, then the handler's own
   English, and never a voice that needs a signal ahead of one that does
   not — the field with the best tracking ground is often the one with no
   bars. */

/* Apple's joke voices, and the old robotic ones, by name. Nobody wants
   "Off the trail" sung by a pipe organ. The Eloquence set (Eddy, Flo,
   Grandma…) is the 1990s screen-reader voice: clear, but a robot. */
const NOT_FOR_THE_COACH = new Set([
  'Albert', 'Bad News', 'Bahh', 'Bells', 'Boing', 'Bubbles', 'Cellos', 'Good News', 'Jester',
  'Organ', 'Pipe Organ', 'Superstar', 'Trinoids', 'Whisper', 'Wobble', 'Zarvox', 'Deranged', 'Hysterical',
  'Eddy', 'Flo', 'Grandma', 'Grandpa', 'Reed', 'Rocko', 'Sandy', 'Shelley',
  'Fred', 'Junior', 'Kathy', 'Ralph',
].map(n => n.replace(/\s+/g, '').toLowerCase()));

const QUALITY_ORDER = { premium: 0, enhanced: 1, plain: 2, compact: 3 };

/** A language tag, the same however the phone spells it: "en_GB" is "en-gb". */
const langTag = (l) => String(l ?? '').replace(/_/g, '-').toLowerCase();

/** The English the coach speaks: the handler's own, or British when the
    phone is set to another language (the words are English whatever it is). */
export function coachLang(lang) {
  const l = langTag(lang);
  return /^en-[a-z]{2}(?![a-z])/.test(l) ? l.slice(0, 5) : 'en-gb';
}

/** That English as the speech engines spell their own voices, "en-GB", for
    when the coach has no voice to name and asks for a language instead.
    Not the phone's language: an iPhone set to French would then read
    "Off the trail" in a French voice. An iPhone can list no voice the
    coach will use and still hold an English one it will pick. */
export const speechLang = (lang) => coachLang(lang).replace(/-([a-z]{2})$/, (_, r) => `-${r.toUpperCase()}`);

/** A voice as iOS describes it to the app ({ identifier, name, language,
    quality, novelty }), in the shape the browser gives, so one ranking
    serves both. iOS says the quality outright, so it is taken as said,
    not read from the name; only a compact voice has to be told by its
    identifier, since iOS calls it default like any other plain one. Every
    voice iOS lists is on the phone, so none needs a signal. */
export function fromNativeVoice(v) {
  const voiceURI = String(v?.identifier ?? '');
  const quality = v?.quality === 'premium' || v?.quality === 'enhanced' ? v.quality
    : /compact/i.test(voiceURI) ? 'compact' : 'plain';
  return { voiceURI, name: String(v?.name ?? ''), lang: String(v?.language ?? ''), localService: true, default: false, quality, novelty: v?.novelty === true };
}

/** How good a voice sounds: as iOS said it, for a voice from the app's own
    engine, else read from its URI and name. Before Premium existed, iOS
    named its Enhanced voices "…-premium", so an old com.apple.ttsbundle
    voice ending that way is Enhanced, not Premium. */
export function voiceQuality(v) {
  if (typeof QUALITY_ORDER[v?.quality] === 'number') return v.quality;
  const s = `${v?.voiceURI ?? ''} ${v?.name ?? ''}`.toLowerCase();
  if (/com\.apple\.ttsbundle\.\S*-premium/.test(s)) return 'enhanced';
  if (s.includes('premium')) return 'premium';
  if (s.includes('enhanced')) return 'enhanced';
  // Microsoft's neural voices say "(Natural)": as good as an Enhanced one, and paced like it.
  if (s.includes('(natural)')) return 'enhanced';
  if (s.includes('compact')) return 'compact';
  return 'plain';
}

/** Whether a voice's quality can be read at all. Apple names every voice
    by its quality, so an Apple voice with no mark is a plain one; any other
    voice without a mark could be good or bad, and calling it "Basic" would
    be a guess. */
const qualityKnown = (v, quality) => quality !== 'plain' || /^com\.apple\./i.test(String(v?.voiceURI ?? ''));

/** The honest word for it on screen. Only Premium earns "Natural". */
export const voiceLabel = (quality) =>
  quality === 'premium' ? 'Natural' : quality === 'enhanced' ? 'Enhanced' : 'Basic';

/** The good voices are paced like speech already; hurried, they gabble.
    The basic ones are a little slow, and a call is better short. */
export const voiceRate = (quality) => (quality === 'premium' || quality === 'enhanced' ? 1 : 1.05);

/** The name to show: "Zoe (Premium)" is Zoe, and the label says the rest. */
export const voiceName = (v) => String(v?.name ?? '').replace(/\s*\((enhanced|premium|natural)\)/ig, '').trim() || 'Unnamed voice';

/** Which English it speaks, in a word. */
export function voiceAccent(lang) {
  const l = langTag(lang);
  if (/gbsct|scotland/.test(l)) return 'Scottish';
  return {
    'en-gb': 'British', 'en-us': 'American', 'en-au': 'Australian', 'en-ie': 'Irish', 'en-in': 'Indian',
    'en-za': 'South African', 'en-nz': 'New Zealand', 'en-ca': 'Canadian', 'en-sg': 'Singaporean',
  }[l.slice(0, 5)] ?? 'English';
}

/** Whether a voice is one the coach may use at all: English, and not a joke.
    iOS marks its joke voices itself; the names catch the ones it does not. */
function usable(v) {
  if (!v || v.novelty === true || !/^en(-|$)/.test(langTag(v.lang))) return false;
  const key = (s) => String(s ?? '').replace(/\s*\(.*$/, '').replace(/\s+/g, '').toLowerCase();
  if (NOT_FOR_THE_COACH.has(key(v.name))) return false;
  const uri = String(v.voiceURI ?? '');
  if (/\.eloquence\./i.test(uri)) return false;
  return !(/^com\.apple\./i.test(uri) && NOT_FOR_THE_COACH.has(key(uri.split('.').pop())));
}

/** The voices the coach could speak in, best first, each with its quality
    and whether that quality could be read at all:
    [{ voice, quality, known, local }]. On this phone before one that needs a
    signal; then Premium, Enhanced, plain, compact; then the handler's own
    English before the others; then by name, so the list holds still. */
export function rankVoices(voices, lang) {
  const own = coachLang(lang);
  const nameOf = (v) => String(v.name ?? '');
  return [...(voices ?? [])].filter(usable)
    .map(voice => {
      const quality = voiceQuality(voice);
      return { voice, quality, known: qualityKnown(voice, quality), local: voice.localService !== false };
    })
    .sort((a, b) => (b.local - a.local)
      || (QUALITY_ORDER[a.quality] - QUALITY_ORDER[b.quality])
      || ((langTag(a.voice.lang).slice(0, 5) === own ? 0 : 1) - (langTag(b.voice.lang).slice(0, 5) === own ? 0 : 1))
      || nameOf(a.voice).localeCompare(nameOf(b.voice)));
}

/** The voice to speak in: the handler's choice while this phone still has
    it and the coach may use it, else the best there is, else null — and
    then the browser speaks in its own default, as it always did. */
export function pickVoice(voices, lang, preferredURI = null) {
  const ranked = rankVoices(voices, lang);
  if (preferredURI) {
    const mine = ranked.find(r => r.voice.voiceURI === preferredURI);
    if (mine) return mine.voice;
  }
  return ranked[0]?.voice ?? null;
}

/** Whether the page speaks through WebKit, which hands it only the voices
    the iPhone or Mac came with and never one downloaded in Settings. That
    is the iPhone app, every browser on an iPhone or iPad (Apple allows
    them no other engine), an iPad asking for the desktop site (it says
    Macintosh, but has a touch screen), and Safari on a Mac. */
export function speaksThroughWebKit(ua = '', { native = false, touches = 0 } = {}) {
  if (native || /iPhone|iPad|iPod/.test(ua)) return true;
  if (!/Macintosh/.test(ua)) return false;
  return touches > 1 || (/AppleWebKit/.test(ua) && !/Chrome|Chromium|Edg\/|Firefox|OPR\//.test(ua));
}

/** What to say about a better voice, and only where saying it helps.
    Nothing once a Premium voice is here. Under WebKit a downloaded voice
    never reaches the coach, so the honest thing is to say so, not to send
    the handler off to download one. The iPhone app speaks through iOS
    itself (`native`), where a downloaded voice does reach the coach, so
    there the way to one is given in full. Elsewhere the steps are Apple's, so
    they are given only where the voices are named the Apple way (a Mac
    outside Safari). On other phones a good voice cannot be told from a
    poor one, so a hint there could never be cleared: none is given. No
    device is named, because an iPad is not an iPhone.
    With no voice the coach can name, once the list has come or the wait
    for it is over, the calls are still spoken, in the phone's default
    voice: an iPhone can list only its robotic Eloquence voices, or none at
    all, and speak all the same. So the block says so, and Play is there
    to hear it, rather than calling the coach mute. */
export function voiceHint(voices, lang, { webkit = false, settled = false, native = false } = {}) {
  const ranked = rankVoices(voices, lang);
  if (ranked.some(r => r.quality === 'premium')) return '';
  const unnamed = !ranked.length && (settled || (voices ?? []).length > 0)
    ? 'This phone does not name a voice the coach can use, so the calls are spoken in its default voice. Press Play to hear it.' : '';
  if (native) return [unnamed, NATIVE_PREMIUM].filter(Boolean).join(' ');
  if (webkit) return [unnamed, 'Apple does not let this app use voices downloaded in Settings, so the coach speaks in the ones built in.'].filter(Boolean).join(' ');
  if (unnamed) return unnamed;
  const apple = ranked.some(r => /^com\.apple\./i.test(String(r.voice.voiceURI ?? '')) || /\((enhanced|premium)\)/i.test(String(r.voice.name ?? '')));
  return apple ? MAC_PREMIUM : '';
}

/* Apple renamed Spoken Content to Read & Speak in the 26 releases, on the
   iPhone, the iPad and the Mac alike, and a handler may be on either side of
   that, so both names are given. Settings calls the good voices Premium; this
   app calls them Natural (voiceLabel), so the hint says what to look for in
   each. */

/** The way to a Premium voice on a Mac, in a browser that can use one. */
export const MAC_PREMIUM = 'For the most natural voice, download an English voice marked Premium in System Settings → Accessibility → Read & Speak (called Spoken Content before macOS 26). It shows up here marked Natural.';

/** The way to a Premium voice, for the app that can use one. The steps are
    the same on an iPad, so no device is named. */
export const NATIVE_PREMIUM = 'For a voice that sounds like a person, download an English voice marked Premium: open Settings, then Accessibility → Read & Speak (called Spoken Content on older versions) → Voices → English. Once it has downloaded it shows up here, marked Natural.';

/** The call the Play button says, so the handler hears the real thing. */
export const SAMPLE_CALL = { kind: 'off', metres: 15, side: 'left', where: 'left' };
