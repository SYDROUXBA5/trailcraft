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
  coachOn: true,
  coachTol: 20,          // metres each side of the line
  coachScent: true,      // widen the downwind side to the scent band
  coachVoice: true,
  coachSound: true,
  coachVibrate: true,    // only where the phone can (not iPhone)
  coachShow: false,      // the distance on screen — off keeps the run blind
};

export const QUIET_MS = 10_000;    // never two alerts closer than this
export const STILL_MS = 30_000;    // "still off" from here on
export const CONFIRM_MS = 6_000;   // one excursion this long counts even from single fixes
export const PLAN_EXTRA_M = 10;    // a drawn line is a sketch: give it room

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
    opens up to the scent band's far edge. */
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
  out[side] = Math.max(tolM, out.band);
  return out;
}

export const initialCoach = () => ({
  status: 'on',          // on | edge | off
  offRun: 0,             // consecutive fixes outside the corridor
  offSince: 0,           // when this excursion began being outside
  offAt: 0,              // when the coach first called it off
  lastAlert: 0,
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
     trail sends no new fixes and must still be called every ten seconds. */
  if (!alert && st.status === 'off' && now - st.lastAlert >= QUIET_MS) {
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
