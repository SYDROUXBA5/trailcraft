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

import { project, bearing, dist } from './geo.js';
import { flowAt, normOf, scentLife } from './field.js';
import { PV } from './params.js';
import { blockStep, leeFactor, outside } from './walls.js';

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

/* Residence time, as a multiple of the nominal airborne seconds. Turbulence
   removes scent from the working layer at random rather than on a timer, so
   the spread is roughly exponential: most parcels are mixed out early, a few
   ride a long way. Clamped at both ends — zero would be a parcel that never
   existed, and an unbounded tail would throw specks into the next county. */
export function RESIDENCE() {
  const u = Math.max(1e-6, Math.random());
  return Math.min(1.9, Math.max(0.18, -Math.log(u) * 0.62));
}
/* The live values the bench drives. AIRBORNE, NOSE and PEAK_SECS above stay
   as the documented defaults; nothing on a live path reads them any more. */

/** Particles per trail point. Enough to read as a plume, few enough to stay at
    60 fps on a phone, which is where this actually has to run. */
const PER_POINT = () => PV.perPoint;

/* The end of the trail is not a point — it is a POOL. The runner does not
   vanish at the last footprint: in this sport they stand there waiting to be
   found, and a standing person is a continuous source. Contamination
   accumulates, so the end grows a disc of scent that is wider and hotter the
   longer the dwell — the pool dogs famously overshoot into. */
/* The standing spot is the single hottest thing on a trail and it was drawn
   with 26 parcels against thousands along the line, so the one place the dog
   is actually going read as the faintest. A person waiting to be found is a
   source that does not move and does not stop: the cloud around them wants
   the parcel count to match what it is. */
const POOL_PARTS = () => PV.poolParts;
/** Dwell seconds → pool radius in metres. Diffusive growth: fast at first,
    then slowing, capped where a real search-area stops growing. */
export function poolRadius(dwellS) {
  return Math.min(PV.poolCap, PV.poolBase + PV.poolGrow * Math.sqrt(Math.max(0, dwellS) / 60));
}

/**
 * Where a scent particle released at `origin` ends up after `secs` airborne.
 * Pure — this is the part worth testing.
 */
/** The compass bearing a flow vector moves along.

    flowAt returns u EASTWARD and v SOUTHWARD. That second one is the trap:
    treat v as northward and the north-south component silently inverts, which
    on a map looks like the wind and the scent disagreeing about where they
    are going. Every mover goes through here so there is one place to get it
    right, and one place to test. */
export function flowBearing(f) {
  return (Math.atan2(f.u, -f.v) * 180 / Math.PI + 360) % 360;
}

/** Move a point along a flow vector for `secs`.
    `carry` is the share of the flow that actually moves the thing: air moves
    at the full rate, scent at nose height is held back by ground friction. */
export function stepByFlow(p, f, secs, carry = 1) {
  const sp = Math.hypot(f.u, f.v);
  if (!(secs > 0) || sp < 1e-6) return { lat: p.lat, lon: p.lon };
  return project(p, flowBearing(f), sp * secs * carry);
}

/* `walls` (walls.js) are buildings the scent cannot pass through. Only the
   drawn cloud, tracers and arrows pass them; the grading (predictedOffsets)
   never does, so a building on the map moves what you see and never a score. */
export function driftFrom(T, origin, secs, wx, st, steps = 5, walls = null) {
  /* A trail point inside a footprint starts from just outside its nearest
     wall (walls.js), and from there every wall applies. Before the first
     step too: a parcel just leaving the ground is the brightest one drawn. */
  let pt = walls ? outside(walls, origin) : { lat: origin.lat, lon: origin.lon };
  if (!(secs > 0)) return { lat: pt.lat, lon: pt.lon };
  const dt = secs / steps;
  const f = { u: 0, v: 0 };
  const wake = walls && PV.wakeSlow < 1;
  const going = ((wx?.wind_direction ?? 0) + 180) % 360;

  for (let i = 0; i < steps; i++) {
    const n = normOf(T, pt.lat, pt.lon);
    flowAt(T, n.x, n.y, wx, st, f);
    if (Math.hypot(f.u, f.v) < 1e-6) break;
    if (wake) {
      const k = leeFactor(walls, pt, going, PV.wakeLen, PV.wakeSlow, PV.wakeH);
      f.u *= k; f.v *= k;
    }
    const next = stepByFlow(pt, f, dt, PV.nose);
    pt = walls ? blockStep(walls, pt, next, -1, PV.wallSlide) : next;
  }
  return pt;
}

export class ScentSim {
  /* `walls` is set by whoever draws this cloud; null means open ground. */
  constructor() { this.parts = []; this.trail = []; this.pool = []; this.walls = null; }

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
      const per = PER_POINT();
      for (let k = 0; k < per; k++) {
        this.parts.push({
          lat: p.lat, lon: p.lon,          // current position
          hlat: p.lat, hlon: p.lon,        // ground source, fixed
          born: p.t,
          phase: (k + Math.random()) / per,         // spread across the airborne life
          // A fixed random identity. Meander and convective patchiness must be
          // stable per particle — re-rolled each frame they would flicker, and
          // a flickering plume reads as a bug, not as air.
          seed: Math.random() * 6.28318,
          /* How long THIS parcel stays in the working layer, as a share of
             the nominal airborne time. Turbulence does not remove scent on a
             timer: most parcels are mixed out early and a few ride a long
             way, which is roughly an exponential residence time. Giving every
             parcel the same one put a ruler-straight edge across the end of
             the plume — the one shape a plume never has. */
          life: RESIDENCE(),
          dwellS: p.dwellS ?? 0,           // seconds spent standing here
          /* On tarmac or not. What that does is looked up from the bench's
             ground dials each frame — carried, gives off, holds, spreads —
             all 1 by default, so tarmac changes nothing until tried. */
          hard: !!p.hard,
          str: 0,
        });
      }
      /* A mid-trail PAUSE is a deposit, not a footstep: the longer the stand,
         the wider and stronger the patch it leaves. Scatter extra particles
         over the disc that dwell earned. The end of the trail is handled by
         the live pool below — this is for pauses along the way. */
      if ((p.dwellS ?? 0) >= PV.dwellThresh) {
        const R = poolRadius(p.dwellS) * (p.hard ? PV.hardWiden : 1);
        for (let k = 0; k < 10; k++) {
          const g = project(p, Math.random() * 360, Math.sqrt(Math.random()) * R);
          this.parts.push({
            lat: g.lat, lon: g.lon, hlat: g.lat, hlon: g.lon, born: p.t,
            phase: (k + Math.random()) / 10, seed: Math.random() * 6.28318,
            life: RESIDENCE(), dwellS: p.dwellS, hard: !!p.hard, str: 0,
          });
        }
      }
      this.trail.push(p);
    }
    this.reseedPool();
    return this;
  }

  /** A hide is a source with no walk: placed, stamped, and emitting from that
      moment until the dog arrives — the dwell-pool model, used directly. */
  seedHides(hides) {
    this.trail = [];
    this.parts = [];
    this.hides = (hides || []).slice();
    this.reseedPool();
    return this;
  }

  /** The pool belongs to whichever point is currently the end, so laying live
      moves it along: each appended fix rebuilds it at the new end. Cheap —
      a few dozen objects, at most once per GPS fix. */
  /** Continuous sources: the trail's end (someone standing, waiting to be
      found) and every hide. Both feed the air the whole time. */
  poolSources() {
    const end = this.trail[this.trail.length - 1];
    return [...(end ? [end] : []), ...(this.hides || [])];
  }

  reseedPool() {
    this.pool.length = 0;
    const srcs = this.poolSources();
    for (let i = 0; i < srcs.length; i++) {
      const src = srcs[i];
      const parts = POOL_PARTS();
      for (let k = 0; k < parts; k++) {
        this.pool.push({
          lat: src.lat, lon: src.lon, hlat: src.lat, hlon: src.lon,
          born: src.t, src: i,
          phase: (k + Math.random()) / parts,
          seed: Math.random() * 6.28318,
          ang: Math.random() * 360,             // where on the disc it sits
          rad: Math.sqrt(Math.random()),        // sqrt → uniform over the disc
          life: RESIDENCE(),
          /* When this parcel joins the cloud, as a share of the pool's build.
             Standing still does not only make the scent STRONGER, it makes
             more of it: five minutes leaves a wisp, twenty leaves a cloud.
             Spreading the join thresholds is what makes the pool thicken as
             the wait goes on instead of merely brightening. */
          join: Math.random(),
          str: 0,
        });
      }
    }
  }

  /** Everything the renderer should draw: the trail plume plus the end pool. */
  drawable() { return this.pool.length ? this.parts.concat(this.pool) : this.parts; }

  /**
   * Move every particle to where it should be at wall-clock time `now`.
   * @param {object} T   terrain
   * @param {object} wx  weather at this moment
   * @param {object} st  stability at this moment
   * @param {number} now epoch ms — the replay clock, not the real one
   */
  advance(T, wx, st, now) {
    /* Hoisted: this loop touches thousands of particles a frame, and a
       property read per constant per particle is a real cost on a phone. */
    const AIR = PV.airborne, TFADE = PV.trailFade, PFADE = PV.poolFade;
    const MAMP = PV.meanderAmp, MCAP = PV.meanderCap, BREATHE = PV.breatheMs ?? 8000;
    const PONSET = PV.pocketOnset, PFLOOR = PV.pocketFloor, LINGER = PV.lingerGain;
    const DBS = PV.dwellBoostS, DBC = PV.dwellBoostCap;
    const PBUILD = PV.poolBuildS, PSB = PV.poolStrBase, PSR = PV.poolStrRange;
    /* The ground dials, one job each. Read once a frame like everything else. */
    const CARRY = PV.hardCarry, GIVE = PV.hardGive, HOLD = PV.hardHold, WIDEN = PV.hardWiden;
    const WALLS = this.walls;
    const lifeMs = scentLife(wx, st) * 60000;
    const mix = Math.max(0.5, st?.mix ?? 1);
    const drain = st?.drain ?? 0;

    /* Gustiness drives how much the plume MEANDERS. The forecast carries both
       mean wind and gusts; their ratio is real turbulence data this model was
       ignoring. A steady airflow (gusts ≈ wind) gives a clean cone; a gusty
       one snakes, and the snaking breathes on a ~8 s cycle. */
    const wind = wx?.wind_speed ?? 0;
    const gustiness = Math.max(0, ((wx?.wind_gusts ?? wind) - wind) / Math.max(0.5, wind));
    const breathe = now / BREATHE;

    for (const s of this.parts) {
      const age = now - s.born;
      if (age < 0) { s.str = 0; continue; }

      // Convection strips a particle out of the working layer sooner, so it
      // travels less far horizontally before it stops mattering — and each
      // parcel carries its own residence time on top of that, so they do not
      // all stop at the same distance.
      const h = s.hard;
      const secs = s.phase * AIR * (s.life ?? 1) / mix * (h ? CARRY : 1);
      /* Where this parcel's scent really starts: moved out of a building its
         trail point falls inside (walls.js). Worked out once per set of walls,
         not every frame; the ground source never moves. */
      let home = { lat: s.hlat, lon: s.hlon };
      if (WALLS) {
        if (s.hw !== WALLS) { s.hw = WALLS; s.ho = outside(WALLS, home); }
        home = s.ho;
      }
      const d = driftFrom(T, home, secs, wx, st, 5, WALLS);
      s.lat = d.lat; s.lon = d.lon;

      const dispM = dist(home, d);

      if (dispM > 0.5 && gustiness > 0.02) {
        // Perpendicular wander, amplitude from gustiness and how far the
        // particle has travelled — sin averages to zero, so the MEAN offset
        // the verdict grades is untouched.
        const amp = Math.min(MCAP, dispM * gustiness * MAMP) * (h ? WIDEN : 1);
        const sway = amp * Math.sin(breathe + s.seed * 3.1 + s.phase * 6.28318);
        const brg = bearing(home, d);
        const p2 = project({ lat: s.lat, lon: s.lon }, (brg + 90) % 360, sway);
        /* The sway is a move like any other: a wall stops it too. Left
           unchecked it pushed gusty scent into houses. */
        const p3 = WALLS ? blockStep(WALLS, { lat: s.lat, lon: s.lon }, p2, -1, PV.wallSlide) : p2;
        s.lat = p3.lat; s.lon = p3.lon;
      }

      /* Ground source fades as the trail ages; the particle also thins as it
         drifts from the source still feeding it. Two modifiers:
         - LINGER: under a stable layer, scent in slack air (a sheltered hollow,
           a windless dawn) decays slower — pools hold. Slack is read off the
           particle's own displacement, which the slack air already made small.
         - POCKETS: convective air tears the plume into patches; each particle
           keeps a fixed share of the damage so the patches hold still. */
      const slack = 1 - Math.min(1, dispM / Math.max(1.5, secs * 0.45));
      const linger = 1 + drain * slack * LINGER;
      const pocket = mix > PONSET ? PFLOOR + (1 - PFLOOR) * (0.5 + 0.5 * Math.sin(s.seed * 13.7)) : 1;
      // Standing still deposits more: emission scales with the dwell the
      // fix stream folded into this point.
      const dwellBoost = 1 + Math.min(DBC, (s.dwellS ?? 0) / DBS);
      /* `phase` is already how far through its own airborne life a parcel
         is, so it carries the fade on its own. What ragged the edge is the
         residence time above: parcels from the same piece of ground reach
         very different distances, and the far ones are both fainter and much
         rarer, which is how a plume actually ends. */
      s.str = Math.exp(-age / (lifeMs * linger * (h ? HOLD : 1))) * (1 - s.phase * TFADE) * pocket * dwellBoost
        * (h ? GIVE : 1);
    }

    /* The end pool. Two deliberate differences from the trail plume:
       - it does NOT fade with trail age — the source is still standing there,
         feeding it, the whole time;
       - it ACCUMULATES: ~10 minutes of standing reaches two-thirds of full
         contamination, and the disc keeps widening as sqrt(dwell). */
    const srcs = this.poolSources();
    for (const s of this.pool) {
      const src = srcs[s.src];
      if (!src) { s.str = 0; continue; }
      const dwellS = (now - src.t) / 1000;
      if (dwellS <= 0) { s.str = 0; continue; }
      const build = 1 - Math.exp(-dwellS / PBUILD);
      /* Not in the air yet: this parcel joins later in the wait. Park it back
         on the source rather than leaving it wherever it last was, or a pool
         asked about an EARLIER moment reports the spread of a later one. */
      if (build < (s.join ?? 0) * 0.92) {
        s.str = 0;
        s.hlat = src.lat; s.hlon = src.lon;
        s.lat = src.lat; s.lon = src.lon;
        continue;
      }
      /* Someone standing on tarmac: the same dials as the trail. The pool used
         to shrink here but keep its full strength, so a tarmac pool drew
         BRIGHTER than the trail beside it — one figure applied in two places
         and forgotten in a third. */
      const hp = !!src.hard;
      const poolR = poolRadius(dwellS) * (hp ? WIDEN : 1);
      const g = project({ lat: src.lat, lon: src.lon }, s.ang, s.rad * poolR);
      s.hlat = g.lat; s.hlon = g.lon;
      const d = driftFrom(T, g, s.phase * AIR * (s.life ?? 1) / mix * (hp ? CARRY : 1), wx, st, 5, WALLS);
      s.lat = d.lat; s.lon = d.lon;
      // Up to ~1.5× a fresh trail particle — the hottest thing on the map.
      s.str = (PSB + PSR * build) * (1 - s.phase * PFADE) * (hp ? GIVE : 1);
    }
    return this.parts;
  }

  /** Live particles, strongest first, for drawing. */
  visible() { return this.parts.filter(s => s.str >= 0.02); }

  /** Drop particles the air has finished with.

      Laying a trail live runs for an hour and appends the whole way; without
      this the set only ever grows, and a phone in a pocket pays to carry
      every dead particle. Four lifetimes is well past anything drawable —
      the cut is invisible on screen and the arithmetic stops climbing.

      `since` is the earliest moment these parcels will ever be drawn at. A
      replay opens at the end of the run and can be dragged back to its
      start, and a prune cannot be undone, so it ages the air by the start.
      Aged by the moment on screen, a replay scrubbed back finds nothing. */
  prune(now, wx, st, { lives = 5, max = 6000, since = null } = {}) {
    const from = Number.isFinite(since) ? Math.min(now, since) : now;
    const cutoff = from - scentLife(wx, st) * 60000 * lives;
    if (Number.isFinite(cutoff)) {
      const keptTrail = this.trail.filter(p => p.t > cutoff);
      // The pool's source is the trail's END, so never prune the last point
      // out from under it — a trail with no end has nothing standing at it.
      if (keptTrail.length) this.trail = keptTrail;
      this.parts = this.parts.filter(s => s.born > cutoff);
    }
    /* A budget as well as an age, because scent stays workable for hours and
       age alone retires particles far slower than walking creates them.

       Thin EVENLY rather than dropping the oldest. Cutting the head off would
       erase the plume from the start of a long trail — and how faint that end
       has become is a thing the physics already says, through each parcel's
       strength. A render budget must not get a vote on it. Taking every nth
       parcel leaves the whole line represented, just sampled less finely. */
    if (this.parts.length > max) {
      const stride = this.parts.length / max;
      const kept = [];
      for (let i = 0; kept.length < max && i < this.parts.length; i++) {
        if (Math.floor(i / stride) === kept.length) kept.push(this.parts[i]);
      }
      this.parts = kept;
    }
    return this.parts.length;
  }
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
    const secs = PV.peakSecs / Math.max(0.6, Math.min(1.6, st?.mix ?? 1));
    const d = driftFrom(T, p, secs, wx, st);
    const n = normOf(T, p.lat, p.lon);
    const f = flowAt(T, n.x, n.y, wx, st);
    const sp = Math.hypot(f.u, f.v);

    // Settle: the ground keeps emitting, so the offset reaches a steady state
    // rather than growing for as long as the trail is old.
    const settle = 1 - Math.exp(-ageS / PV.settleS);
    const m = sp * PV.nose * secs * settle;
    return { at: p, to: d, metres: Math.min(PV.offsetCap, m), bearing: sp > 1e-6 ? bearing(p, d) : null };
  });
}
