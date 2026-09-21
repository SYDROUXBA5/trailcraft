/* The handler's call, captured at the moment of commitment.

   Everything else in the app is recorded after the fact. This is the one
   thing that cannot be: how sure the handler was when they said "that's it",
   before they walked up, before anyone spoke, before the trail was revealed.
   Asked ten minutes later it is not a memory, it is a reconstruction — and
   the reconstruction is always flattered by knowing the answer.

   So it is asked on the Indication button itself, in three taps, and the
   waypoint is stamped before the question appears. A slow answer never moves
   the mark.

   What it is for: over enough runs, a confidence that means something. A
   handler who says "certain" and is right nine times in ten is reading their
   dog. A handler who says "certain" and is right six times in ten is not —
   and until this was recorded, nothing in the world would ever have told
   them. That gap is the single most useful thing a training record can hold
   about the person rather than the dog.

   Two refusals, for the same reason as everywhere else:
   - A call made while the trail was on screen is not a call. It is reading.
   - A call on a run the handler knew the answer to proves nothing either.
   Both are excluded from the maths, not quietly folded in. */

export const CALL_V = 1;

/** Three bands. More would be false precision from a wet field with a dog on
    the end of a line, and fewer could not show a gap at all.

    `p` is what the band claims — the probability the handler is asserting by
    choosing it. It is the number the observed rate gets measured against, and
    it is deliberately modest: "certain" is 0.9, not 1.0, because nobody is
    ever certain and a band that can only be wrong is useless. */
export const CONFIDENCE = [
  { v: 'sure', label: 'Certain', p: 0.90, why: 'You would put money on it.' },
  { v: 'fairly', label: 'Fairly sure', p: 0.70, why: 'You think so, but you would not be shocked.' },
  { v: 'unsure', label: 'Not sure', p: 0.50, why: 'Calling it because the dog did, not because you know.' },
];

const byV = new Map(CONFIDENCE.map(c => [c.v, c]));
export const confidenceOf = (v) => byV.get(v) ?? null;
export const labelOf = (v) => byV.get(v)?.label ?? null;

/** Below this, a band is reported as "not enough yet" rather than given a
    rate. Five is not a statistician's threshold — it is the point at which a
    number stops being a coin flip dressed up as a finding, and the copy says
    so rather than pretending otherwise. */
export const MIN_PER_BAND = 5;

/** A call attached to a waypoint at the moment it was made.
    `seen` records whether the answer was already drawn on the map — the app
    knows this for free and it decides whether the call counts at all. */
export const stampCall = (conf, seen) => ({ v: CALL_V, conf: conf ?? null, seen: !!seen, at: Date.now() });

/* ── Reading the record ───────────────────────────────────────────────── */

/** Every indication in a session that carries a call. */
export function callsIn(session) {
  return (session?.data?.trackWaypoints ?? [])
    .filter(w => w.kind === 'Indication' && w.call?.conf)
    .sort((a, b) => a.t - b.t);
}

/** The call that pairs with the run's outcome. The debrief judges the run as
    a whole, so only the first commitment can honestly be scored against it —
    scoring a second indication against the same outcome would count one
    result twice. */
export function firstCall(session) {
  return callsIn(session)[0] ?? null;
}

/** Was this run's call one that can be scored at all?

    Three conditions, all of them about whether the handler could have known:
    the trail was not on screen, nobody present knew the answer, and the run
    ended in a way that says plainly whether the call was right or wrong. */
export function scorable(session) {
  /* A run kept from someone else's link carries THEIR call. Folding it into
     your calibration would quietly measure a different person. */
  if (session?.data?.imported) return null;
  const c = firstCall(session);
  if (!c || c.call.seen) return null;
  const d = session?.data?.debrief;
  if (!d) return null;
  if (d.blind !== 'handler' && d.blind !== 'double') return null;
  if (d.outcome !== 'found' && d.outcome !== 'false') return null;
  return { conf: c.call.conf, right: d.outcome === 'found', at: c.t };
}

/** How the handler's confidence has actually performed, band by band.

    Returns a row per band whether or not it has enough runs behind it, so the
    screen can say "three more to go" instead of silently omitting it — a
    missing band reads as a band with nothing wrong. */
export function calibration(sessions) {
  const rows = (sessions ?? []).map(scorable).filter(Boolean);
  const bands = CONFIDENCE.map(c => {
    const mine = rows.filter(r => r.conf === c.v);
    const right = mine.filter(r => r.right).length;
    const enough = mine.length >= MIN_PER_BAND;
    /* No rate below the threshold, and not merely unshown — absent. Two runs
       out of two is 100%, and a caller that reads `rate` without checking
       `enough` would print it as a finding. */
    const rate = enough ? right / mine.length : null;
    return {
      v: c.v, label: c.label, claimed: c.p,
      n: mine.length, right, rate, enough,
      /* Positive means the band is honest-to-modest; negative means it
         promises more than it delivers. */
      gap: enough ? rate - c.p : null,
      verdict: !enough ? 'not enough yet'
        : Math.abs(rate - c.p) <= 0.10 ? 'about right'
        : rate < c.p ? 'running hot' : 'running cold',
      needs: enough ? 0 : MIN_PER_BAND - mine.length,
    };
  });
  const scored = bands.filter(b => b.enough);
  return {
    calls: rows.length,
    bands,
    ready: scored.length > 0,
    /* One number for the whole handler: how far their stated confidence sits
       from their actual hit rate, weighted by how often each band is used.
       Negative is overconfident. */
    bias: scored.length
      ? scored.reduce((sum, b) => sum + b.gap * b.n, 0) / scored.reduce((sum, b) => sum + b.n, 0)
      : null,
  };
}

/** How many runs have been thrown away, and why. Shown so that a thin
    calibration reads as "you have not run blind much" rather than as a fault
    in the app. */
export function calibrationLosses(sessions) {
  const all = (sessions ?? []).filter(s => !s?.data?.imported && firstCall(s));
  return {
    total: all.length,
    seen: all.filter(s => firstCall(s).call.seen).length,
    notBlind: all.filter(s => {
      const d = s?.data?.debrief;
      return !firstCall(s).call.seen && d && d.blind === 'open';
    }).length,
    noDebrief: all.filter(s => !s?.data?.debrief?.outcome).length,
  };
}

/** The plain-English line for the result card and the dog's record. Written
    as a sentence a trainer would say, never as a score. */
export function calibrationLine(cal) {
  if (!cal || !cal.ready) {
    const n = cal?.calls ?? 0;
    return n
      ? `${n} blind call${n === 1 ? '' : 's'} recorded — not enough yet to say how well you read it.`
      : 'No blind calls recorded yet.';
  }
  const worst = cal.bands
    .filter(b => b.enough && b.verdict !== 'about right')
    .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))[0];
  if (!worst) return 'Your confidence matches your hit rate across every band.';
  const pct = Math.round(worst.rate * 100);
  return worst.verdict === 'running hot'
    ? `When you say “${worst.label}” you are right ${worst.right} times in ${worst.n} — ${pct}%. That word is promising more than it delivers.`
    : `When you say “${worst.label}” you are right ${worst.right} times in ${worst.n} — ${pct}%. You are reading it better than you claim.`;
}
