/* Trail design, graded by physics — the read an instructor gives while a
   student sketches a line, except computed instead of guessed.

   The input is the same scent field the replay draws (geo.js scentField):
   per-point wind regime, offset, width. This module turns that into three
   things a designer can act on while still tapping corners:

     - legs: contiguous runs of one wind regime, WITH index ranges, so the
       drawn line can be painted leg by leg;
     - chips: training objectives the design actually earns — claimed only
       when the numbers support them, per the honesty rail;
     - advice: the single weakest aspect, as one sentence naming a leg.

   Everything here is arithmetic over data the app already has. No terrain
   yet, deliberately: the flow-field bend needs a built terrain grid, which
   is not available mid-draw — claiming drainage effects without it would be
   invention. Pure functions, no DOM, tested in Node. */

/** Contiguous same-regime runs with index ranges. Unlike geo.js legSummary
    (which feeds prose), painting needs to know WHERE each leg is. Runs
    shorter than minPts are folded into the previous leg rather than dropped:
    every point must belong to a leg or the painted line would have holes. */
export function legRanges(field, minPts = 4) {
  if (!field || field.length < 2) return [];
  /* `side` only means anything across the wind: dead ahead or dead astern the
     sign of a near-zero cross component flips with every wobble of the line,
     and splitting a pure downwind stretch on that noise shreds it into
     sub-minPts runs that then get folded under the WRONG label. */
  const sideOf = (r) => (r.label === 'crosswind' ? r.side : '');
  const runs = [];
  for (let i = 0; i < field.length; i++) {
    const r = field[i].regime;
    const last = runs[runs.length - 1];
    if (last && last.label === r.label && last.side === sideOf(r)) { last.i1 = i; continue; }
    runs.push({ label: r.label, side: sideOf(r), i0: i, i1: i });
  }
  // Fold corner flicker into its neighbour instead of leaving gaps.
  const legs = [];
  for (const r of runs) {
    const n = r.i1 - r.i0 + 1;
    const prev = legs[legs.length - 1];
    if (n < minPts && prev) { prev.i1 = r.i1; continue; }
    if (n < minPts && runs.length > 1) continue;            // tiny lead-in: absorbed by the next
    legs.push({ ...r });
  }
  /* Every run under minPts (a very short or very twisty line) must still paint
     SOMETHING, or the map shows an unlabelled line under chips that claim
     regimes. One coarse leg under the dominant regime is honest; silence is not. */
  if (!legs.length) {
    const counts = {};
    for (const f of field) counts[f.regime.label] = (counts[f.regime.label] || 0) + 1;
    const label = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    legs.push({ label, side: '', i0: 0, i1: field.length - 1 });
  }
  // A dropped lead-in leaves the first leg starting late — stretch it back.
  legs[0].i0 = 0; legs[legs.length - 1].i1 = field.length - 1;
  return legs.map(l => ({ ...l, n: l.i1 - l.i0 + 1 }));
}

/** Fractions of the line in each regime, by point count. */
export function regimeMix(field) {
  const mix = { crosswind: 0, tailwind: 0, headwind: 0 };
  for (const f of field) mix[f.regime.label]++;
  const n = field.length || 1;
  return { crosswind: mix.crosswind / n, tailwind: mix.tailwind / n, headwind: mix.headwind / n };
}

/** Corners where the wind's job changes — a regime flip between adjacent
    legs is where a trailing dog has to renegotiate the picture. */
export const regimeTurns = (legs) => {
  let t = 0;
  for (let i = 1; i < legs.length; i++) if (legs[i].label !== legs[i - 1].label) t++;
  return t;
};

/** What this design earns, and its one weakest aspect.
    `metresOf(leg)` maps a leg to its length so advice can name a distance.
    `st` is the field.js stability object ({key, label, ...}) or null. */
export function analyseDesign(field, wx, st, metresOf = () => 0) {
  if (!field || field.length < 2 || !wx) return { legs: [], mix: null, chips: [], advice: null };

  const legs = legRanges(field);
  const mix = regimeMix(field);
  const turns = regimeTurns(legs);
  const chips = [];

  if (mix.crosswind >= 0.35) chips.push('crosswind discrimination');
  if (turns >= 2) chips.push(`${turns} wind-change corners`);
  if (mix.tailwind >= 0.5) chips.push('mostly free scent — easy day');
  if (mix.headwind >= 0.5) chips.push('scent held back — close work');
  if (st?.key === 'inversion' || st?.key === 'stable') chips.push('pooling scent — searches run low');
  if (st?.key === 'convective' || st?.key === 'convective+') chips.push('lifting scent — short life');

  // One sentence, weakest aspect first. A long downwind leg is the classic
  // design flaw: the wind carries the scent ahead of the dog, so the dog can
  // range on air and never has to commit to the track.
  let advice = null;
  const tails = legs.filter(l => l.label === 'tailwind')
    .sort((a, b) => metresOf(b) - metresOf(a));
  if (tails.length && metresOf(tails[0]) >= 40) {
    const i = legs.indexOf(tails[0]) + 1;
    advice = `Leg ${i} runs downwind for ${Math.round(metresOf(tails[0]))} m — the dog gets free scent. Angle it across the wind to make the dog work the track.`;
  } else if (turns === 0 && legs.length && field.length >= 8) {
    advice = `One wind picture the whole way (${legs[0].label}). Add a turn so the dog has to renegotiate at a corner.`;
  } else if (mix.crosswind >= 0.35) {
    advice = `Good design — ${Math.round(mix.crosswind * 100)}% of the line works across the wind.`;
  }

  return { legs, mix, chips, advice };
}
