# Trailcraft — terrain-aware scent engine

*Designed and built 2026-08-24. Everything marked **verified** was checked against
a live API or a passing test on that date; everything else is explicitly a guess.*

---

## The problem

Trailcraft already recorded two GPS tracks and fetched good weather. But
`wind.js` drew one shared vector's worth of motion and `geo.js` drew a geometric
ribbon, and **the two objects knew nothing about each other**. Neither used the
conditions for anything except one sentence of text.

The goal: one simulation, seen several ways, that explains *why the dog worked
where it did*.

## Decisions

| Decision | Why |
|---|---|
| **One pure function is the product** | `flowAt(terrain, x, y, wx, stability)`. Wind particles, scent particles, the ground layers and the verdict all read it, which is why the picture is coherent rather than a pile of overlays. |
| **Terrain-aware flow, not full CFD** | Wind data is a 28 km GFS cell; terrain is 10 m. Bending coarse wind around real ground is legitimate downscaling. Solving Navier–Stokes on top of a 28 km average is precision the input does not deserve. |
| **Continuous ground source, not advection** | The mistake worth not repeating — see below. |
| **Canvas 2D, not WebGL** | ~3,000 particles sampling a solved screen grid is comfortable. Shaders fail silently and cannot be stepped through, and the person field-testing this is not a developer. WebGL stays a drop-in upgrade because the field is a pure function either way. |
| **Offline-first, no backend** | Somerset woods have no signal. Everything runs on the device. |
| **Replay first, live later** | Same engine serves both; replay needs no sync and is the thing you would demo to an instructor. |

### The mistake worth not repeating

The first prototype advected scent particles properly downwind for the full
trail age. At 0.8 m/s an 86-minute trail puts its scent **4.3 km away** —
correct advection, completely wrong scent.

**The ground keeps emitting.** A dog does not work a puff released an hour ago;
it works a continuously re-supplied plume beside the trail, offset by tens of
metres. `sim.js` therefore gives each particle a `phase` — how far through its
airborne life it is — so displacement saturates. This is the same reason
`geo.js`'s `scentOffset` saturates rather than growing without bound.

A second version of the same error survived into the verdict: it predicted where
a *mid-life* particle reaches — the faint **edge** of the plume — and claimed
33.9 m where the honest answer was 9.2. The peak concentration stays close to the
trail because the source never stops feeding it, and **the peak is what a dog
works**. Now pinned by test against `geo.js`'s `DRIFT_PER_MS`, the only constant
with any field history behind it.

## Architecture

```
field.js   pure   terrain grid · flowAt · stability · scentLife · solar · regime · wxAt
sim.js     pure   ScentSim (continuous-source particles) · driftFrom · predictedOffsets
wind.js    canvas particles sampling a solved screen grid
app.js     DOM    terrain from Mapbox DEM · ScentOverlay · ground layers · replay
```

`field.js` and `sim.js` have no DOM, no map and no globals — the reason the
maths is checked in Node rather than eyeballed on a phone in a wet field.

### The three forces

```
flow = deflect(wind, slope) × shelter  +  drainage(slope, ΔT)
```

1. **Deflection** — air cannot drive into a hillside; it follows the contour.
   Deliberately gentle: turned up much past this the field spins into vortices,
   which looks more impressive and is less true.
2. **Drainage** — cold dense air slides down the fall line, **only under an
   inversion**. This is where the forecast is simply wrong: at dawn with the
   ground 3 °C colder than the air, the model says 0.8 m/s from the north while
   the air at nose height runs downhill regardless.
3. **Shelter** — ridges accelerate, hollows go slack.

### Stability is the master switch

`ΔT = soil_temperature_0cm − temperature_2m`, one subtraction, governing three
things: how fast the plume widens, whether drainage runs, and how long scent
survives.

| ΔT | Regime | What the dog experiences |
|---|---|---|
| > +3 | strongly convective | Scent lifts and breaks into pockets. High-headed, casting wide. |
| −1…+1 | neutral | Textbook downwind cone. |
| < −3 | inversion | Scent hugs the ground, runs downhill, pools. Workable for hours. |

**Verified:** Open-Meteo serves `minutely_15` for all nine variables including
`soil_temperature_0cm`. Over one Wells morning the ground went from level with
the air to +2.3 °C while the wind backed 26° and doubled. An hourly snapshot
cannot see that; the app now stores ±6 h of 15-minute samples per session (48
samples, verified in the running app) and interpolates — wind direction
circularly, because averaging 350° and 10° arithmetically gives 180°.

## The honesty rail — non-negotiable

- **Two regimes, never blurred.** "9 m downwind" and "9 m downhill" are different
  sentences and different advice. `regime()` names which force leads.
- **Plume width is the uncertainty.** Never let it narrow into false precision.
- **Layers that aren't a factor grey themselves out** and say why. A layer that
  knows when to shut up is what makes the others believable.
- **Only spatially-varying things get painted.** Air temperature over 400 m is
  one number; a smooth gradient would imply detail the data does not have.
- **The dog's position is the handler's phone**, so it carries the long line as
  error. Stated in the verdict card itself.
- **Every constant is a literature guess** until real trails correct it.

## Built

`field.js`, `sim.js`, `wind.js` rewrite, 15-minute weather with series and
interpolation, terrain grid from Mapbox DEM via `queryTerrainElevation`
(**verified**: 44×44 over 590 m on real ground), `ScentOverlay` with isolated
density accumulation, four ground layers as georeferenced image sources, replay
mode with one clock, verdict card. **52 tests** (24 geo + 28 field).

### Bugs found and fixed during the build

- Scent advected to 4.3 km; and the verdict predicting the plume edge, not its core.
- `renderLayerButtons()` ran before `setReplayTime()`, so layers were disabled on
  missing weather rather than on conditions.
- **Pre-existing:** `.wind-canvas` used `position:fixed; inset:0` with no explicit
  size. A `<canvas>` is a replaced element, so it stayed at its intrinsic
  300×150 — the wind overlay had never filled the screen.
- Record sheet shares z-index 6 and comes later in the DOM, so it covered the
  transport bar.
- Ground-layer repaint was unthrottled; pooling costs four `flowAt` calls per
  pixel, so it would have been ~1M flow evaluations a second on a phone.

## Not built

Draw-a-trail by hand (needs "laid at" + a pace, since a drawn line has no clock
in it), offline region pre-download, canopy from landuse tiles, live two-device
view, accounts, instructor tier.

## Risks

1. **Phone performance is unmeasured.** Comfortable on a laptop; an iPhone in
   low-power mode is a different question. Measure early, not at the end.
2. **Mapbox terrain-tile billing is unverified.** Their tile-API docs carry no
   exemption language. Ask sales before depending on it.
3. **Automated browsers cannot verify this.** Hidden tabs suspend `requestAnimationFrame`,
   so Mapbox silently loads nothing. Every visual check needs a real visible window.

## Next

Lay one real trail in a crosswind and work it. If the predicted side matches the
side the dog favoured, the model is sound and needs only a calibration constant.
If the side is wrong, the approach needs rethinking — better learnt in an
afternoon than after three months.
