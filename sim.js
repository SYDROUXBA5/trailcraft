/* Scent, as particles.

   The mistake worth not making: a scent particle is NOT a puff released once
   when the runner walked past and blown downwind ever since. Integrate that
   properly and at 0.8 m/s an 80-minute-old trail has its scent 4 km away —
   correct advection, and completely wrong scent.

   The ground keeps emitting. What a dog works is a continuously re-supplied
   plume sitting beside the trail, offset by tens of metres, in rough
   equilibrium. So a particle here carries a `phase`: how far through its
   airborne life it is. Displacement saturates at what that life allows, which
   is the scale dogs actually work — and it is the same reason geo.js's
   scentOffset saturates rather than growing without bound.

   Fresh particles sit on the trail. Old ones have drifted to the edge of the
   plume and faded. Between them they draw a band, and the band's width is the
   uncertainty, not a decoration. */

import { project, bearing } from './geo.js';
import { flowAt, normOf, scentLife } from './field.js';

/** Seconds a particle stays workable once it has left the ground. Airborne
    residence is what sets the offset scale: at 0.8 m/s, 50 s puts the plume
    about 40 m off the line, which is the right order for a working dog. */
export const AIRBORNE = 52;

/** Fraction of the reported 10 m wind that reaches nose height. Models report
    over open ground; under canopy at 30 cm the real airflow is a fraction of it
    and can reverse. This constant is a guess until calibration corrects it. */
export const NOSE = 0.28;

/* Where the PEAK concentration sits, as seconds of drift from the source.

   This is the distinction that matters, and getting it wrong makes the whole
   verdict useless: the faint EDGE of a plume may be 50 m out, but the workable
   CORE stays close to the trail, because the ground beneath never stops feeding
   it. A dog works the core.

   7 s at 0.28 of a 10 m wind reproduces roughly 2 m of offset per m/s — which
   is what geo.js's DRIFT_PER_MS already encodes, and is the only number in this
   model with any field history behind it. Anchoring here keeps the new engine
   comparable with whatever calibration data already exists. */
export const PEAK_SECS = 7;

/** Particles per trail point. Enough to read as a plume, few enough to stay at
    60 fps on a phone, which is where this actually has to run. */
const PER_POINT = 7;

/**
 * Where a scent particle released at `origin` ends up after `secs` airborne.
 * Pure — this is the part worth testing.
 */
export function driftFrom(T, origin, secs, wx, st, steps = 5) {
  let { lat, lon } = origin;
  if (!(secs > 0)) return { lat, lon };
  const dt = secs / steps;
  const f = { u: 0, v: 0 };

  for (let i = 0; i < steps; i++) {
    const p = normOf(T, lat, lon);
    flowAt(T, p.x, p.y, wx, st, f);
    const sp = Math.hypot(f.u, f.v);
    if (sp < 1e-6) break;
    // u is eastward, v is southward — so the compass bearing it moves along is
    // measured from north, with south being +v.
    const brg = (Math.atan2(f.u, -f.v) * 180 / Math.PI + 360) % 360;
    ({ lat, lon } = project({ lat, lon }, brg, sp * dt * NOSE));
  }
  return { lat, lon };
}

export class ScentSim {
  constructor() { this.parts = []; this.trail = []; }

  /** Seed one particle set from a laid trail. Each keeps the point it came from
      and the moment that point was walked — its ground source never moves. */
  seed(trail) {
    this.trail = [];
    this.parts = [];
    return this.append(trail || []);
  }

  /** Add particles for newly laid ground.

      Laying a trail live means points arrive one fix at a time. Rebuilding the
      whole particle set on each one would throw away every particle's phase and
      make the plume flicker, so new ground is appended instead. */
  append(points) {
    for (const p of points || []) {
      for (let k = 0; k < PER_POINT; k++) {
        this.parts.push({
          lat: p.lat, lon: p.lon,          // current position
          hlat: p.lat, hlon: p.lon,        // ground source, fixed
          born: p.t,
          phase: (k + Math.random()) / PER_POINT,   // spread across the airborne life
          str: 0,
        });
      }
      this.trail.push(p);
    }
    return this;
  }

  /**
   * Move every particle to where it should be at wall-clock time `now`.
   * @param {object} T   terrain
   * @param {object} wx  weather at this moment
   * @param {object} st  stability at this moment
   * @param {number} now epoch ms — the replay clock, not the real one
   */
  advance(T, wx, st, now) {
    const lifeMs = scentLife(wx, st) * 60000;
    const mix = Math.max(0.5, st?.mix ?? 1);

    for (const s of this.parts) {
      const age = now - s.born;
      if (age < 0) { s.str = 0; continue; }

      // Ground source fades as the trail ages; the particle also thins as it
      // drifts away from the source that is still feeding it.
      s.str = Math.exp(-age / lifeMs) * (1 - s.phase * 0.72);
      if (s.str < 0.02) continue;

      // Convection strips a particle out of the working layer sooner, so it
      // travels less far horizontally before it stops mattering.
      const secs = s.phase * AIRBORNE / mix;
      const d = driftFrom(T, { lat: s.hlat, lon: s.hlon }, secs, wx, st);
      s.lat = d.lat; s.lon = d.lon;
    }
    return this.parts;
  }

  /** Live particles, strongest first, for drawing. */
  visible() { return this.parts.filter(s => s.str >= 0.02); }
}

/* ── What the model claims, so it can be graded ───────────────────── */

/**
 * Predicted offset of the workable line from the true trail, in metres, at the
 * moment the dog reached each point. This is the number the verdict grades — it
 * has to be computed the same way every time or the calibration is meaningless.
 */
export function predictedOffsets(T, trail, wx, st, workedAt) {
  if (!trail?.length) return [];
  const end = workedAt ?? trail[trail.length - 1].t;

  return trail.map((p) => {
    const ageS = Math.max(0, (end - p.t) / 1000);
    /* Stable air holds scent in the working layer, so it drifts further sideways
       before it stops mattering; convection lifts it out, so it drifts less.
       Clamped, because neither effect is worth more than a factor of two on a
       number this uncertain. */
    const secs = PEAK_SECS / Math.max(0.6, Math.min(1.6, st?.mix ?? 1));
    const d = driftFrom(T, p, secs, wx, st);
    const n = normOf(T, p.lat, p.lon);
    const f = flowAt(T, n.x, n.y, wx, st);
    const sp = Math.hypot(f.u, f.v);

    // Settle: the ground keeps emitting, so the offset reaches a steady state
    // rather than growing for as long as the trail is old.
    const settle = 1 - Math.exp(-ageS / 900);
    const m = sp * NOSE * secs * settle;
    return { at: p, to: d, metres: Math.min(60, m), bearing: sp > 1e-6 ? bearing(p, d) : null };
  });
}
