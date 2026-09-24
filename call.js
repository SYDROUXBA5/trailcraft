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

import { ownRun } from './debrief.js';

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
  const shown = session?.data?.revealedAt;
  const when = Number.isFinite(c.call?.at) ? c.call.at : c.t;
  if (Number.isFinite(shown) && shown > 0 && when >= shown) return { ok: false, why: 'seen' };
  const d = session?.data?.debrief;
  if (!d || (d.outcome !== 'found' && d.outcome !== 'false')) return { ok: false, why: 'nodebrief' };
  if (d.blind !== 'handler' && d.blind !== 'double') return { ok: false, why: 'notblind' };
  return { ok: true, conf: c.call.conf, right: d.outcome === 'found', at: c.t };
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
    noDebrief: count('nodebrief'),
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
