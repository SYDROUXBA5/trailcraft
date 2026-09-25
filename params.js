/* Every number the scent model runs on, in one place, with where it came from.

   Until now these lived as `const`s scattered through field.js, geo.js and
   sim.js — which meant nobody could see them, nobody could move them, and
   nobody could tell which were measured and which were typed. That last part
   is the real point of this file. An audit of the model in September 2026
   found that of roughly ninety numbers, ZERO had a citation, one was a
   trainer's field observation, and the rest were plausible-looking values
   somebody chose. A bench that showed ninety green ticks would be lying.

   So each dial carries a `prov`:
     input   — a measurement from the world (wind, temperature, a clock)
     yours   — the handler's own field observation, held as a hypothesis
     guess   — nobody has measured this; it is a number we chose
     drawing — changes the picture only, never what the model claims

   There is deliberately no 'evidence' value in use. When a real measurement
   turns up for one of these, it earns the tag, and not before.

   PV is the live values, read directly by the model in its hot loops — a
   property read, not a function call, because advance() touches it thousands
   of times a frame. PARAMS is the description the bench draws itself from. */

/** The categories the September audit insisted the model keep apart: one
    number must never move two of these at once without saying so. */
export const CATS = {
  retention: 'what stays on the ground',
  release: 'what leaves the ground',
  transport: 'where the air takes it',
  dispersion: 'how it spreads out',
  uncertainty: 'how sure we are',
  input: 'measured from the world',
  drawing: 'how it is drawn',
};

/* ── The dials ────────────────────────────────────────────────────────
   Each: id, label (plain words a trainer uses), unit, min, max, step, def,
   prov, cat, moves (what it actually changes), note (why it is what it is).
   `hot` marks a dial whose change the plume picks up on its own tick; the
   rest need the band redrawn explicitly, because the band is not on that
   tick and a dial that looks dead is worse than no dial. */

const G = (id, title, why, kind, dials) => ({ id, title, why, kind, dials });
const D = (id, label, unit, min, max, step, def, prov, cat, moves, note) =>
  ({ id, label, unit, min, max, step, def, prov, cat, moves, note });

export const PARAMS = [
  G('weather', 'The weather', 'What the forecast gave, or what you want to ask about.', 'physics', [
    D('wind', 'Wind speed', 'm/s', 0, 14, 0.1, 3, 'input', 'input',
      'everything — the plume, the band, the wisps, the arrows',
      'A forecast for open ground at 10 m, not the air at the dog’s nose.'),
    D('dir', 'Wind comes from', '°', 0, 359, 1, 315, 'input', 'input',
      'which side of the line the scent sits on',
      'Degrees the wind blows FROM, as every forecast reports it.'),
    D('gust', 'Gusts', 'm/s', 0, 20, 0.5, 4.2, 'input', 'input',
      'how much the plume snakes',
      'Gustiness is the one piece of real turbulence data the forecast carries.'),
    D('air', 'Air temperature', '°C', -10, 40, 0.5, 12, 'input', 'input',
      'stability, with the ground temperature',
      'Measured at 2 m.'),
    D('soil', 'Ground temperature', '°C', -10, 50, 0.5, 12, 'input', 'input',
      'stability: which of the five classes fires',
      'Soil at the surface. The difference from the air is what sets everything below.'),
    D('hum', 'Humidity', '%', 25, 100, 1, 78, 'input', 'input',
      'how long scent stays workable',
      'Air humidity. It is NOT a reading of how wet the ground is.'),
    D('rain', 'Rain', 'mm/h', 0, 6, 0.1, 0, 'input', 'input',
      'how long scent stays workable',
      'A drizzle is modelled as helping, heavier rain as washing out.'),
    D('age', 'Trail age', 'min', 0, 240, 1, 30, 'input', 'input',
      'how far the band has drifted and how wide it has grown',
      'Minutes since the ground was walked. Drag it and watch the band settle.'),
    D('dwell', 'Stood at the end', 'min', 0, 20, 0.5, 3, 'input', 'input',
      'the size and heat of the pool at the end of the trail',
      'A person waiting to be found is a source that never stops.'),
  ]),

  G('band', 'Where the band sits', 'The drawn band and the particle cloud work this out by two different routes. They are meant to agree.', 'physics', [
    D('driftPerMs', 'Drift per wind', 'm per m/s', 0.5, 6, 0.1, 2.0, 'yours', 'transport',
      'how far off the line the band sits',
      'The one number with any field history behind it, and that history is not written down anywhere.'),
    D('settleS', 'Settles after', 's', 120, 3600, 30, 900, 'guess', 'transport',
      'how quickly the band reaches its final offset',
      'About 15 minutes. The ground keeps emitting, so the offset settles rather than growing forever.'),
    D('offsetCap', 'Furthest the band goes', 'm', 15, 150, 5, 60, 'guess', 'transport',
      'a hard ceiling on the offset',
      'Binds in a strong wind: past about 7 m/s nothing moves further.'),
    D('nose', 'Wind reaching the nose', 'share', 0.05, 0.6, 0.01, 0.28, 'guess', 'transport',
      'how far every particle travels',
      'The share of the 10 m wind that reaches 30 cm. Under canopy the real figure can be lower and can reverse.'),
    D('airborne', 'Stays workable in the air', 's', 10, 180, 1, 52, 'guess', 'transport',
      'the scale of the whole particle cloud',
      'How long a parcel is worth anything once it has left the ground.'),
    D('peakSecs', 'Where the core sits', 's', 2, 25, 0.5, 7, 'guess', 'transport',
      'the offset the grading uses',
      'Fitted to reproduce the drift-per-wind figure, not measured separately. Move one and they disagree.'),
  ]),

  G('flow', 'Air over the ground', 'How the ground bends the wind. Needs elevation data; on flat ground none of this fires.', 'physics', [
    D('deflect', 'Slope turns the wind', '', 0, 1, 0.01, 0.52, 'guess', 'transport',
      'how much air follows the contour instead of driving into the hill',
      'Deliberately gentle. Turned up, the field spins into vortices that look impressive and are less true.'),
    D('slopeSat', 'Slope that turns it fully', '', 0.5, 6, 0.1, 1.7, 'guess', 'transport',
      'the steepness at which the turning maxes out', 'A choice, not a measurement.'),
    D('contour', 'Push along the contour', '', 0, 0.8, 0.01, 0.34, 'guess', 'transport',
      'how much deflected air runs sideways along the hill', 'A choice.'),
    D('drainGain', 'Cold air runs downhill', '', 0, 4, 0.05, 2.6, 'guess', 'transport',
      'the strength of drainage flow under a stable layer',
      'Drainage is real and well measured in meteorology. This number is not.'),
    D('drainCap', 'Fastest drainage', 'm/s', 0.3, 4, 0.1, 1.6, 'guess', 'transport',
      'a ceiling on the downhill flow', 'Binds at dawn on any real slope.'),
    D('creepGain', 'Scent creeps downhill', '', 0, 10, 0.1, 4.5, 'yours', 'transport',
      'a slow downhill slide on any slope, in nearly any air',
      'A handler’s rule, not meteorology. Set it to zero to see the model without it.'),
    D('creepCap', 'Fastest creep', 'm/s', 0.1, 2, 0.05, 0.9, 'guess', 'transport',
      'a ceiling on the creep', 'A choice.'),
    D('expoGain', 'Ridges speed air up', '', 0, 0.15, 0.002, 0.052, 'guess', 'transport',
      'wind faster on ridges, slacker in hollows', 'A choice.'),
    D('expoFloor', 'Slackest hollow', '×', 0.05, 1, 0.01, 0.28, 'guess', 'transport',
      'the floor on sheltering', 'A choice.'),
    D('expoCeil', 'Windiest ridge', '×', 1, 3, 0.05, 1.7, 'guess', 'transport',
      'the ceiling on speed-up', 'A choice.'),
  ]),

  G('stability', 'Warm ground, cold ground', 'The ground minus the air decides which of five classes fires. The directions are textbook; every number here was chosen.', 'physics', [
    D('stbHot', 'Lifting hard, above', '°C', 1.5, 8, 0.1, 3, 'guess', 'release', 'the class boundary', 'A round number where a physical threshold should be.'),
    D('stbWarm', 'Rising, above', '°C', 0.3, 3, 0.1, 1, 'guess', 'release', 'the class boundary', 'A round number.'),
    D('stbNeut', 'Neutral, above', '°C', -3, -0.2, 0.1, -1, 'guess', 'release', 'the class boundary', 'A round number.'),
    D('stbStable', 'Stable, above', '°C', -8, -1.5, 0.1, -3, 'guess', 'release', 'the class boundary', 'A round number.'),
    D('mixN', 'Spread — neutral', '×', 0.3, 2.5, 0.02, 1.0, 'guess', 'dispersion', 'band width and particle mixing', 'The anchor the others are relative to.'),
    D('mixC', 'Spread — rising', '×', 0.3, 2.5, 0.02, 1.4, 'guess', 'dispersion', 'band width and particle mixing', 'Chosen.'),
    D('mixCp', 'Spread — lifting hard', '×', 0.3, 2.5, 0.02, 1.9, 'guess', 'dispersion', 'band width, and above 1.25 the plume breaks into patches', 'Chosen.'),
    D('mixS', 'Spread — stable', '×', 0.3, 2.5, 0.02, 0.62, 'guess', 'dispersion', 'band width and particle mixing', 'Chosen.'),
    D('mixI', 'Spread — inversion', '×', 0.3, 2.5, 0.02, 0.40, 'guess', 'dispersion', 'band width and particle mixing', 'Chosen.'),
    D('lifeN', 'Lasts — neutral', '×', 0.2, 4, 0.02, 1.0, 'guess', 'release', 'how long scent stays workable', 'The anchor.'),
    D('lifeC', 'Lasts — rising', '×', 0.2, 4, 0.02, 0.58, 'guess', 'release', 'how long scent stays workable', 'Chosen.'),
    D('lifeCp', 'Lasts — lifting hard', '×', 0.2, 4, 0.02, 0.34, 'guess', 'release', 'how long scent stays workable', 'Chosen.'),
    D('lifeS', 'Lasts — stable', '×', 0.2, 4, 0.02, 1.7, 'guess', 'release', 'how long scent stays workable', 'Chosen.'),
    D('lifeI', 'Lasts — inversion', '×', 0.2, 4, 0.02, 2.6, 'guess', 'release', 'how long scent stays workable', 'Chosen.'),
    D('drainN', 'Downhill — neutral', '', 0, 1.5, 0.05, 0.1, 'guess', 'transport', 'drainage strength', 'Chosen.'),
    D('drainS', 'Downhill — stable', '', 0, 1.5, 0.05, 0.7, 'guess', 'transport', 'drainage strength', 'Chosen.'),
    D('drainI', 'Downhill — inversion', '', 0, 1.5, 0.05, 1.0, 'guess', 'transport', 'drainage strength', 'Chosen.'),
    D('creepN', 'Creep — neutral', '', 0, 1, 0.01, 0.38, 'yours', 'transport', 'downhill creep in this class', 'Your rule.'),
    D('creepC', 'Creep — rising', '', 0, 1, 0.01, 0.16, 'yours', 'transport', 'downhill creep in this class', 'Your rule.'),
    D('creepCp', 'Creep — lifting hard', '', 0, 1, 0.01, 0.08, 'yours', 'transport', 'downhill creep in this class', 'Your rule.'),
    D('creepS', 'Creep — stable', '', 0, 1, 0.01, 0.55, 'yours', 'transport', 'downhill creep in this class', 'Your rule.'),
    D('creepI', 'Creep — inversion', '', 0, 1, 0.01, 0.65, 'yours', 'transport', 'downhill creep in this class', 'Your rule.'),
  ]),

  G('life', 'How long it lasts', 'Minutes of workable scent, before stability scales it.', 'physics', [
    D('lifeBase', 'Fresh trail lasts', 'min', 20, 300, 1, 82, 'guess', 'release', 'the whole scent lifetime', 'The headline number, and nobody has measured it.'),
    D('lifeFloor', 'Never less than', 'min', 1, 30, 1, 8, 'guess', 'release', 'a floor under the lifetime', 'Chosen.'),
    D('humA', 'Dry-air penalty', '', 0, 1.5, 0.01, 0.42, 'guess', 'release', 'lifetime in dry air', 'Chosen.'),
    D('humB', 'Humidity that doubles it', '%', 40, 150, 1, 78, 'guess', 'release', 'lifetime in damp air', 'Chosen.'),
    D('windHalf', 'Wind that halves it', 'm/s', 1.5, 12, 0.1, 4.2, 'guess', 'release', 'lifetime in wind', 'Chosen.'),
    D('hotKnee', 'Heat starts to matter', '°C', 5, 25, 0.5, 15, 'guess', 'release', 'lifetime on hot ground', 'Chosen.'),
    D('hotScale', 'Heat that halves it', '°C', 5, 40, 1, 16, 'guess', 'release', 'lifetime on hot ground', 'Chosen.'),
    D('rainDrizzle', 'Drizzle up to', 'mm/h', 0.1, 3, 0.1, 0.6, 'guess', 'release', 'where rain stops helping', 'Chosen.'),
    D('rainBoost', 'Drizzle helps by', '×', 1, 2, 0.05, 1.25, 'guess', 'release', 'lifetime in a drizzle', 'Damp surfaces releasing held scent is well measured for buried explosives. This number is still a guess.'),
    D('rainDecay', 'Heavy rain washes out', '', 0.3, 4, 0.1, 1.4, 'guess', 'release', 'lifetime in real rain', 'Chosen.'),
  ]),

  G('pools', 'Pools, pauses, the stand', 'Standing still is the strongest source on a trail. This is the disc it leaves.', 'physics', [
    D('dwellThresh', 'Counts as a pause after', 's', 10, 300, 5, 45, 'guess', 'retention', 'whether a mid-trail stop leaves a patch', 'Chosen.'),
    D('poolBase', 'Pool starts at', 'm', 0.5, 5, 0.1, 2, 'guess', 'retention', 'the smallest pool radius', 'Chosen.'),
    D('poolGrow', 'Pool grows by', 'm', 0.5, 6, 0.1, 2.4, 'guess', 'retention', 'how fast the pool widens with waiting',
      'The shape is right — fast then slowing — the number is a guess.'),
    D('poolCap', 'Pool stops at', 'm', 10, 60, 1, 26, 'guess', 'retention', 'the widest a pool gets', 'Chosen.'),
    D('poolBuildS', 'Pool fills in', 's', 120, 2400, 30, 600, 'guess', 'release', 'how fast the pool reaches full strength', 'Chosen — about ten minutes to two thirds.'),
    D('poolStrBase', 'Pool starts at strength', '', 0.2, 1, 0.05, 0.55, 'guess', 'release', 'how hot a fresh pool draws', 'Chosen.'),
    D('poolStrRange', 'Pool grows to', '', 0, 2, 0.05, 0.95, 'guess', 'release', 'how hot a long wait draws', 'Chosen.'),
    D('dwellBoostS', 'Pause strength per', 's', 20, 300, 5, 60, 'guess', 'release', 'how much a pause brightens the ground', 'Chosen.'),
    D('dwellBoostCap', 'Pause strength stops at', '×', 1, 10, 0.5, 3, 'guess', 'release', 'a ceiling on that', 'Chosen.'),
  ]),

  G('gusts', 'Gusts, patches, fade', 'Why a plume snakes and breaks up instead of being a clean cone.', 'physics', [
    D('meanderAmp', 'Snaking', '', 0, 1.5, 0.05, 0.4, 'guess', 'dispersion', 'how far the plume weaves side to side',
      'Driven by real gust data; the amount is a guess. It averages to zero, so it never moves the graded result.'),
    D('meanderCap', 'Snaking stops at', 'm', 3, 40, 1, 12, 'guess', 'dispersion', 'a ceiling on the weave', 'Binds in most winds.'),
    D('pocketOnset', 'Breaks into patches above', '×', 1, 2, 0.05, 1.25, 'guess', 'dispersion', 'when the plume goes patchy', 'A step, not a slope — it switches on abruptly.'),
    D('pocketFloor', 'Faintest patch', '', 0.2, 1, 0.05, 0.55, 'guess', 'dispersion', 'how dark the gaps between patches go', 'Chosen.'),
    D('trailFade', 'Fade along its life', '', 0.3, 1, 0.02, 0.72, 'guess', 'release', 'how fast a parcel dims as it travels', 'Chosen.'),
    D('poolFade', 'Pool fade', '', 0.2, 1, 0.02, 0.45, 'guess', 'release', 'how fast pool parcels dim', 'Chosen.'),
    D('lingerGain', 'Slack air holds scent', '', 0, 2, 0.05, 0.9, 'guess', 'release', 'slower decay where the air is still', 'Chosen.'),
  ]),

  G('sure', 'How sure the model is', 'The width of the band is the honest part. It says "somewhere in here".', 'physics', [
    D('widthBase', 'Fresh trail, either side', 'm', 0.5, 10, 0.1, 2, 'guess', 'uncertainty', 'the narrowest the band ever gets',
      'The loudest number in the model: it is what the app claims to know.'),
    D('widthGrow', 'Widens with age', '', 0, 0.3, 0.005, 0.06, 'guess', 'uncertainty', 'how fast the band widens as the trail ages', 'Shape sound, number guessed.'),
    D('widthWind', 'Wind that widens it', 'm/s', 2, 20, 0.5, 6, 'guess', 'uncertainty', 'extra width in wind', 'Chosen.'),
    D('widthCap', 'Widest band', 'm', 10, 120, 5, 50, 'guess', 'uncertainty', 'a ceiling on the width', 'Rarely binds.'),
  ]),

  G('ground', 'The ground', 'This used to be one number doing five jobs. Now it’s five dials, all at 1, so tarmac changes nothing until you move one. “Try the tarmac rule” puts the old figure back.', 'physics', [
    D('hardHold', 'Hard — holds', '×', 0.2, 1.5, 0.05, 1.0, 'guess', 'retention', 'how much scent the surface keeps',
      'OFF by default. One weak study found asphalt worked for 1–3 h against 8–11 h on grass — that is about THIS dial, not the others.'),
    D('hardGive', 'Hard — gives off', '×', 0.2, 1.5, 0.05, 1.0, 'guess', 'release', 'how strongly it draws', 'OFF by default.'),
    D('hardCarry', 'Hard — carries', '×', 0.3, 1.5, 0.05, 1.0, 'guess', 'transport', 'how far the band shifts',
      'OFF by default. The wind evidence points the OTHER way: air moves faster at nose height over pavement than over grass.'),
    D('hardWiden', 'Hard — spreads', '×', 0.2, 1.5, 0.05, 1.0, 'guess', 'dispersion', 'how wide the plume draws', 'OFF by default.'),
    D('hardDoubt', 'Hard — unsure by', '×', 1.0, 3, 0.05, 1.0, 'guess', 'uncertainty', 'how much WIDER the band gets over hard ground',
      'Only ever widens. Uncertainty is one-way: nothing may make the model look more certain than the baseline.'),
  ]),

  G('buildings', 'Buildings', 'Scent at nose height cannot pass through a wall, so the drawn cloud and arrows go round the buildings the map has drawn. That part is always on. What happens in the sheltered pocket behind a building is the experiment.', 'physics', [
    D('wallSlide', 'Speed along a wall', 'share', 0.2, 1, 0.05, 0.6, 'guess', 'transport',
      'how fast scent that hits a wall is carried along it, as a share of the step',
      'Air meeting a wall head-on splits and runs round both ends. How fast is not measured here.'),
    D('wakeSlow', 'Wind left behind a building', 'share', 0.05, 1, 0.05, 1, 'guess', 'transport',
      'how fast scent moves in the sheltered pocket downwind of a building',
      'OFF at 1. Air behind a building slows and curls back towards the wall. How much, for any building here, is not measured.'),
    D('wakeLen', 'Pocket length', 'heights', 0.5, 5, 0.1, 2, 'guess', 'transport',
      'how far behind a building the shelter reaches, in building heights',
      'Studies of air round single buildings put the sheltered zone at roughly one to three building heights, longer for wider buildings. Two is a choice inside that range, not a measurement of any building here.'),
    D('wakeH', 'Height when the map has none', 'm', 3, 20, 0.5, 6, 'guess', 'transport',
      'the pocket length behind buildings the map gives no height',
      'About two storeys.'),
  ]),

  G('draw', 'How it is drawn', 'These change the picture and nothing the model claims. Moving them proves nothing about scent.', 'drawing', [
    D('plumeMs', 'Redraw every', 'ms', 100, 2000, 50, 400, 'drawing', 'drawing', 'how often the cloud is recomputed', ''),
    D('thinDiv', 'Thinning with distance', 'm', 5, 100, 1, 22, 'drawing', 'drawing', 'whether the core or the edge looks hottest',
      'NO PHYSICAL BASIS. It decides the exact thing you are trying to judge by eye.'),
    D('renderCut', 'Faintest speck drawn', '', 0.005, 0.15, 0.005, 0.03, 'drawing', 'drawing', 'how far the plume appears to reach', ''),
    D('perPoint', 'Specks per step', '', 3, 20, 1, 7, 'drawing', 'drawing', 'how dense the cloud looks', ''),
    D('poolParts', 'Specks in a pool', '', 100, 2000, 50, 700, 'drawing', 'drawing', 'how solid the end pool looks', ''),
    D('sampleM', 'Sample the line every', 'm', 1, 10, 0.5, 2, 'drawing', 'drawing', 'whether the line reads as beads or a plume', ''),
    D('pruneMax', 'Most specks at once', '', 2000, 20000, 500, 9000, 'drawing', 'drawing', 'how much of a long trail is drawn', ''),
    D('wispN', 'Wind streaks', '', 10, 200, 5, 60, 'drawing', 'drawing', 'how busy the wind looks', ''),
    D('wispLife', 'Streak lasts', 's', 5, 60, 1, 20, 'drawing', 'drawing', 'how long a streak runs before it restarts', ''),
    D('breatheMs', 'Snaking cycle', 'ms', 2000, 30000, 500, 8000, 'drawing', 'drawing', 'how fast the plume breathes side to side',
      'Picked for looks. Nothing in the weather sets this.'),
    D('arrowGate', 'Hide arrows under', 'px', 10, 80, 1, 34, 'drawing', 'drawing', 'whether short arrows vanish or shrink',
      'Below this an arrow disappears rather than getting smaller — which reads as "no effect" when there is one.'),
  ]),
];

/** Flat lookup, and the live values the model reads. */
export const DIALS = PARAMS.flatMap(g => g.dials.map(d => ({ ...d, group: g.id, kind: g.kind })));
const BY_ID = new Map(DIALS.map(d => [d.id, d]));
export const dialById = (id) => BY_ID.get(id) ?? null;

/** The defaults, frozen, so "what did it ship as" is always answerable. */
export const DEFAULTS = Object.freeze(Object.fromEntries(DIALS.map(d => [d.id, d.def])));

/** The live values. Read directly — `PV.airborne`, not a getter — because
    advance() touches these thousands of times a frame. */
export const PV = { ...DEFAULTS };

export function setParam(id, v) {
  const d = BY_ID.get(id);
  if (!d) return false;
  const n = Math.min(d.max, Math.max(d.min, Number(v)));
  if (!Number.isFinite(n)) return false;
  PV[id] = n;
  return true;
}

export function resetParams() { Object.assign(PV, DEFAULTS); }

/* ── Named experiments ────────────────────────────────────────────────
   A hypothesis someone holds, as a set of dial positions with a name on it.
   Never the default and never applied by the app on its own: a preset is
   chosen on the bench, and the bench puts everything back when it closes. */
export const PRESETS = [
  {
    id: 'tarmacRule', group: 'ground', label: 'Try the tarmac rule', short: 'Tarmac rule',
    why: 'The working rule the app used to apply to every run. On tarmac, scent carries half as far and draws '
      + 'half as strong, and a standing pool covers half the ground. The band keeps its full width: the old '
      + 'figure narrowed it, which made the model look surest on the ground it understands least.',
    set: { hardCarry: 0.5, hardGive: 0.5, hardWiden: 0.5 },
  },
  {
    id: 'wakeRule', group: 'buildings', label: 'Try building wakes', short: 'Building wakes',
    why: 'Behind every building the map has drawn, scent keeps only 30% of the wind, recovering over two '
      + 'building heights, so it lingers against the downwind wall. The pocket’s size and strength are guesses.',
    set: { wakeSlow: 0.3 },
  },
];
export const presetById = (id) => PRESETS.find(p => p.id === id) ?? null;

/** Apply a preset on top of the defaults, so it means the same thing whatever
    was moved before it. Returns false for an unknown one. */
export function applyPreset(id) {
  const p = presetById(id);
  if (!p) return false;
  resetParams();
  for (const [k, v] of Object.entries(p.set)) setParam(k, v);
  return true;
}

/** Which dials are no longer where they shipped. The bench shows this, and a
    saved analysis has to carry it, or a picture cannot be reproduced. */
export function changed() {
  const out = {};
  for (const id of Object.keys(DEFAULTS)) if (PV[id] !== DEFAULTS[id]) out[id] = PV[id];
  return out;
}
export const isDefault = () => Object.keys(changed()).length === 0;

/** How much of this model is actually known. The honest headline. */
export function tally() {
  const t = { input: 0, yours: 0, guess: 0, drawing: 0 };
  for (const d of DIALS) t[d.prov] = (t[d.prov] ?? 0) + 1;
  return t;
}

/** One stability class's creep weight, live, or undefined for a class that
    has none. flowAt asks for this for every parcel at every step of every
    frame, so it reads the one dial it needs rather than building a whole
    stabilityStops() (five arrays and an object) each time it asks. A switch
    of plain reads, because a looked-up key boxes the number it returns. */
export function creepOf(key) {
  switch (key) {
    case 'convective+': return PV.creepCp;
    case 'convective': return PV.creepC;
    case 'neutral': return PV.creepN;
    case 'stable': return PV.creepS;
    case 'inversion': return PV.creepI;
    case 'unknown': return 0.30;
    default: return undefined;
  }
}
const CREEP_KEYS = ['convective+', 'convective', 'neutral', 'stable', 'inversion', 'unknown'];

/** The stability class's four numbers, live. stability() calls this so the
    boundaries and every multiplier can be moved from the bench. */
export function stabilityStops() {
  return {
    bounds: [PV.stbHot, PV.stbWarm, PV.stbNeut, PV.stbStable],
    mix: [PV.mixCp, PV.mixC, PV.mixN, PV.mixS, PV.mixI],
    drain: [0, 0, PV.drainN, PV.drainS, PV.drainI],
    life: [PV.lifeCp, PV.lifeC, PV.lifeN, PV.lifeS, PV.lifeI],
    creep: Object.fromEntries(CREEP_KEYS.map(k => [k, creepOf(k)])),
  };
}
