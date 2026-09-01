/* Gesture physics — the maths that makes the sheet feel held rather than played.

   Four ideas, all from Apple's Designing Fluid Interfaces, none decorative:

   1. A drag tracks the finger 1:1 and remembers where it was grabbed.
   2. Release hands the finger's VELOCITY to a spring, so there is no seam
      between dragging and animating.
   3. The landing point is projected from momentum — a flick commits even when
      the sheet has barely moved, because the decision reads where the gesture
      was GOING, not where it stopped.
   4. Past a boundary the sheet resists progressively instead of stopping dead.

   Pure functions and a step-based spring, no DOM — so all of it is checked in
   Node like the rest of the maths in this project. */

/** Where a gesture at `velocity` px/s would coast to, in px from here.
    Apple's exponential-decay projection — not the v²/2a textbook form, which
    is not what any scroll view actually ships. */
export function project(velocity, decelerationRate = 0.998) {
  return (velocity / 1000) * decelerationRate / (1 - decelerationRate);
}

/** Progressive resistance past a boundary. The further past, the less the
    element follows — real things slow before they stop. */
export function rubberband(overshoot, dimension, constant = 0.55) {
  if (!dimension) return 0;
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

/** Release velocity in px/s from a short history of {t, y} samples.
    Reads over the last ~100 ms rather than the final two events, because the
    last event pair before pointerup is often a near-stationary jitter that
    would erase a genuine flick. */
export function velocityFrom(samples, windowMs = 100) {
  if (!samples || samples.length < 2) return 0;
  const last = samples[samples.length - 1];
  let first = samples[0];
  for (let i = samples.length - 2; i >= 0; i--) {
    if (last.t - samples[i].t > windowMs) break;
    first = samples[i];
  }
  const dt = last.t - first.t;
  return dt > 0 ? ((last.y - first.y) / dt) * 1000 : 0;
}

/** Which snap point a release commits to: project the momentum, take the
    nearest. Velocity sign decides reversals by construction — a real flick
    projects clean past the midpoint however far the sheet has moved. */
export function chooseTarget(current, velocity, points) {
  const projected = current + project(velocity);
  let best = points[0];
  for (const p of points) if (Math.abs(p - projected) < Math.abs(best - projected)) best = p;
  return best;
}

/* A spring in Apple's two designer parameters — dampingRatio (1 = no bounce)
   and response (seconds to feel arrived; a spring has no fixed duration).
   Semi-implicit Euler, stepped by the caller: the integrator holds position
   AND velocity, which is exactly what makes it grabbable mid-flight — an
   interruption just reads .x and keeps going, no jump, no brick wall. */
export class Spring {
  constructor({ dampingRatio = 1, response = 0.35 } = {}) {
    const omega = (2 * Math.PI) / response;
    this.k = omega * omega;
    this.c = 2 * dampingRatio * omega;
    this.x = 0; this.v = 0; this.target = 0;
  }

  /** Advance by dt seconds (clamped: a background tab must not explode).

      Integrated in ≤1/240 s substeps. One Euler step per 60 fps frame adds
      enough numerical damping that a 0.8 ratio behaves like critical — the
      bounce the parameter promises quietly disappears, and a 120 Hz phone
      feels different from a 60 Hz one. Substepping makes the parameters mean
      what they say on every display. */
  step(dt) {
    let h = Math.min(dt, 1 / 30);
    while (h > 0) {
      const s = Math.min(h, 1 / 240);
      const a = -this.k * (this.x - this.target) - this.c * this.v;
      this.v += a * s;
      this.x += this.v * s;
      h -= s;
    }
    return this;
  }

  get done() { return Math.abs(this.x - this.target) < 0.5 && Math.abs(this.v) < 20; }
}
