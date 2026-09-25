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

import { ownRun, trailShown, unwalkedPlan } from './debrief.js';
import { dist } from './geo.js';

export const CALL_V = 1;

/** Three bands. More would be false precision from a wet field with a dog on
    the end of a line, and fewer could not show a gap at all.

    `p` is what the band claims — the probability the handler is asserting by
    choosing it. It is the number the observed rate gets measured against, and
    it is deliberately modest: "certain" is 0.9, not 1.0, because nobody is
    ever certain and a band that can only be wrong is useless. */
export const CONFIDENCE = [
  { v: 'sure', label: 'Certain', p: 0.90, why: 'You’d put money on it.' },
  { v: 'fairly', label: 'Fairly sure', p: 0.70, why: 'You think so, but you wouldn’t bet on it.' },
  { v: 'unsure', label: 'Not sure', p: 0.50, why: 'You’re calling it because the dog did.' },
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

/** How near where the target was a first call has to be to count as the
    find, and how far from it before it plainly was not. The mark is where the
    handler's phone was, not the dog's nose, and the hide or the end of the
    trail was placed by another fix or by a tap on the map: fifteen metres
    covers both on a fair day. Past thirty the call was somewhere else, and
    that distance grows with the phones' own stated uncertainty, because a
    poor fix should make the app less sure a call was wrong, never more sure
    it was right. In between, the map cannot say, and nothing is scored. */
export const AT_FIND_M = 15;
export const OFF_FIND_M = 30;

/* Where the target actually was, and whether a GPS fix put it there: the
   hides of a search, or the end of a trail. A laid or walked trail ends where
   the layer's phone stopped, a fix; so does a hide dropped at the layer's
   feet, which says so (`gps`). A hide tapped onto the map, and the end of a
   drawn card's line, are only where a finger stopped. A plan still waiting
   for its walk has none yet: its walked card will bring the real end. */
function targetsOf(d) {
  const at = (p, gps) => ({ lat: p?.lat, lon: p?.lon, gps,
    acc: gps && Number.isFinite(p?.acc) && p.acc > 0 ? p.acc : 0 });
  const end = d?.trail?.length > 1 ? d.trail[d.trail.length - 1] : null;
  const pts = d?.hides?.length ? d.hides.map(h => at(h, h?.gps === true))
    : !end || (d.plan && !d.walked) ? []
    : [at(end, !unwalkedPlan(d))];
  return pts.filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon));
}

/* A mark with a place the phone stood behind: not one made after the GPS
   dropped out, which is only where the phone last was. */
const placed = (w) => !w?.approx && Number.isFinite(w?.lat) && Number.isFinite(w?.lon);

/* The phone's stated uncertainty at the fix nearest a moment, or nought. */
function accAt(track, t) {
  let best = null;
  for (const p of track ?? []) {
    if (Number.isFinite(p?.t) && (!best || Math.abs(p.t - t) < Math.abs(best.t - t))) best = p;
  }
  return Number.isFinite(best?.acc) && best.acc > 0 ? best.acc : 0;
}

/** Was the first call the find? The debrief says how the run ended, not
    whether the handler's first commitment was right: "Certain" forty metres
    from the hide, nothing there, the dog works on and finds it, and the
    handler taps "Found it". Scored against the outcome alone, that was a
    right "Certain", and an over-confident handler was told they read their
    dog well — the opposite of what this is for.

    true when the call was made where the target was; false when it plainly
    was not; null when nothing shows which. Against a target a GPS fix put
    there — a laid trail's end, a hide dropped at the layer's feet — a call
    plainly elsewhere was wrong, whether or not a second mark was made at the
    find: that mark is optional, and a rule that waited for it let a
    handler's over-confidence only ever count in their favour. Against a
    target placed with a finger, which can be tens of metres out, a far call
    is only wrong when a later Indication, made at the target, shows the find
    was that one; the only call of a find is not scored. With no map to
    measure against — a plan not walked yet, a mark made after the GPS
    dropped out — the only Indication of a run is taken as the find, as it
    always was. With more than one, the find may have been a later one, and
    the call is not scored. */
export function firstCallWasFind(session) {
  const c = firstCall(session);
  if (!c) return null;
  const d = session?.data ?? {};
  const targets = targetsOf(d);
  const marks = (d.trackWaypoints ?? []).filter(w => w?.kind === 'Indication');
  if (targets.length && placed(c)) {
    const gapOf = (w) => Math.min(...targets.map(p => dist(w, p)));
    const gap = gapOf(c);
    if (gap <= AT_FIND_M) return true;
    const near = targets.reduce((a, p) => (dist(c, p) < dist(c, a) ? p : a));
    const far = gap > OFF_FIND_M + accAt(d.track, c.t) + near.acc;
    if (far && near.gps) return false;
    const foundLater = marks.some(w => w !== c && Number.isFinite(w.t) && w.t > c.t && placed(w) && gapOf(w) <= AT_FIND_M);
    if (foundLater && far) return false;
    return null;
  }
  return marks.length <= 1 ? true : null;
}

/** Can this run's call be scored, and if not, why not?

    One answer, used by the maths, by the tally of what was thrown away and by
    the run screen, so the three can never tell the handler different things.
    Everything here is about whether the handler could have known: the answer
    was not shown, nothing was telling them where the trail was, nobody
    present knew, and the run ended in a way that says plainly whether the
    call was right or wrong. */
export function callVerdict(session) {
  const c = firstCall(session);
  if (!c) return { ok: false, why: 'nocall' };
  /* Someone else's run, kept from their link: their call, made before this
     phone ever saw it. Folding it in would quietly measure a different person.
     A trail that arrived as a card and was run here is not that. */
  if (!ownRun(session)) return { ok: false, why: 'someone-elses' };
  if (c.call.seen) return { ok: false, why: 'seen' };
  /* The coach reads out the distance to the real trail as the dog works: with
     it on, nothing the handler says afterwards is a blind call. */
  if (session?.data?.coach?.assisted) return { ok: false, why: 'helped' };
  /* Belt and braces against the run screen: the moment the answer was put on
     screen, against the moment the call was actually given. */
  const when = Number.isFinite(c.call?.at) ? c.call.at : c.t;
  if (trailShown(session?.data) && when >= session.data.revealedAt) return { ok: false, why: 'seen' };
  const d = session?.data?.debrief;
  if (!d || (d.outcome !== 'found' && d.outcome !== 'false')) return { ok: false, why: 'nodebrief' };
  /* Everything ranBlind (debrief.js) refuses is refused here too, but a
     call wants the debrief to say outright that nobody knew: a run with no
     answer to that question is not evidence of a blind call. Nor is it
     evidence that the handler knew, and the two are said apart: a blank
     "Who knew the answer" used to tell the handler they knew it, on the
     same card that called the run blind. */
  if (d.blind === 'open') return { ok: false, why: 'notblind' };
  if (d.blind !== 'handler' && d.blind !== 'double') return { ok: false, why: 'blind-unasked' };
  if (d.outcome === 'false') return { ok: true, conf: c.call.conf, right: false, at: c.t };
  /* A find is only this call's find when it happened where the call was. */
  const found = firstCallWasFind(session);
  if (found == null) return { ok: false, why: 'later-find' };
  return { ok: true, conf: c.call.conf, right: found, at: c.t };
}

/** The call as the maths wants it, or nothing. */
export function scorable(session) {
  const v = callVerdict(session);
  return v.ok ? { conf: v.conf, right: v.right, at: v.at } : null;
}

/** One handler's sessions, and nobody else's. A phone carries several
    handlers, a trainer's phone a whole class, and calibration measures one
    person. Run over every session on the phone, one handler's hits were
    credited to another: "When you say “Certain”, you’re right 8 times in 10"
    was the class average, printed to each of them as their own. */
export function runsOf(sessions, handlerId) {
  if (!handlerId) return [];
  return (sessions ?? []).filter(s => s?.handlerId === handlerId);
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
  /* One reason each, the first that applies — the same order the maths
     rejects them in, so the buckets add up to what was actually lost. */
  const mine = (sessions ?? []).map(callVerdict)
    .filter(v => v.why !== 'nocall' && v.why !== 'someone-elses');
  const count = (...why) => mine.filter(v => why.includes(v.why)).length;
  return {
    total: mine.length,
    seen: count('seen', 'helped'),
    helped: count('helped'),
    notBlind: count('notblind'),
    blindUnasked: count('blind-unasked'),
    noDebrief: count('nodebrief'),
    laterFind: count('later-find'),
  };
}

/** The plain-English line for the result card and the dog's record. Written
    as a sentence a trainer would say, never as a score. */
export function calibrationLine(cal) {
  if (!cal || !cal.ready) {
    const n = cal?.calls ?? 0;
    return n
      ? `${n} blind call${n === 1 ? '' : 's'} so far. Too few yet to say how well you read your dog.`
      : 'No blind calls yet.';
  }
  const worst = cal.bands
    .filter(b => b.enough && b.verdict !== 'about right')
    .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))[0];
  if (!worst) return 'How sure you say you are matches how often you’re right.';
  const pct = Math.round(worst.rate * 100);
  const said = `When you say “${worst.label}”, you’re right ${worst.right} times in ${worst.n} (${pct}%).`;
  return worst.verdict === 'running hot'
    ? `${said} That’s less often than “${worst.label}” should mean.`
    : `${said} You read your dog better than you give yourself credit for.`;
}
