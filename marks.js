/* ── Marks, placed after the run ──────────────────────────────────────
   On a trail the handler's hands are full: a line in one, often gloves on,
   and eyes on the dog. Tapping Indication on the phone at the moment of
   commitment meant looking down at the moment that mattered most. So a
   trail run has only Found and Done on its screen, and the marks are placed
   once it is over, on a replay of the dog's route with the laid trail kept
   off it: pause at the moment, tap what the dog did. A hide search keeps its
   live marks, because they are what its hides are scored on.

   These are the pure parts: where a moment of the run was, what a mark
   placed there says, whether a call made then can count, and what has to be
   saved or graded again when marking ends. Nothing here touches the screen. */

import { trailShown } from './debrief.js';

/** The marks, in the order they sit on the run screen and the replay. */
export const MARK_KINDS = ['Indication', 'Lost it', 'Re-found', 'Article', 'Reward'];

/** How long after the last usable fix the place stops being trusted. The
    same 15 seconds the run screen's GPS warning waits (geo.js gpsTrouble),
    so a mark placed afterwards is "roughly" exactly when a live one was. */
export const GAP_MS = 15000;

const fin = Number.isFinite;

/** Where the handler was at moment `t` of a recorded track, as the replay
    draws it: at the last kept fix at or before that moment. A fix holds its
    place for as long as the handler stood there (dwellS), because standing
    still folds fixes into the one before rather than adding points. A moment
    more than GAP_MS past where the GPS was last seen is inside a gap in the
    recording, and the place is only roughly right.
    { lat, lon, approx } or null when there is no usable track. */
export function posAt(track, t) {
  const pts = Array.isArray(track) ? track.filter(p => fin(p?.lat) && fin(p?.lon) && fin(p?.t)) : [];
  if (!pts.length || !fin(t)) return null;
  let i = 0;
  while (i + 1 < pts.length && pts[i + 1].t <= t) i++;
  const p = pts[i];
  const seen = p.t + Math.max(0, fin(p.dwellS) ? p.dwellS : 0) * 1000;
  return { lat: p.lat, lon: p.lon, approx: t - seen >= GAP_MS };
}

/** A mark of `kind` at moment `t` of the run, in the shape a live mark has
    always had ({ kind, lat, lon, t, approx? }), so everything that reads
    marks (the result, the debrief, the link, the PDF, the GPX file) reads
    these unchanged. The moment is kept inside the run. Null when the kind
    is not a mark or there is no run to place it on. A mark placed with the
    answer already seen says so (`late`): it is a note on the run, and never
    counts towards how a blind call is scored (call.js firstCallWasFind). */
export function placeMark(track, kind, t, { late = false } = {}) {
  if (!MARK_KINDS.includes(kind)) return null;
  const pts = Array.isArray(track) ? track.filter(p => fin(p?.t)) : [];
  if (!pts.length || !fin(t)) return null;
  const at = Math.round(Math.min(pts[pts.length - 1].t, Math.max(pts[0].t, t)));
  const p = posAt(track, at);
  if (!p) return null;
  return { kind, lat: p.lat, lon: p.lon, t: at, ...(p.approx ? { approx: true } : {}), ...(late ? { late: true } : {}) };
}

/** The marks with one more, in time order. The mark itself is kept as the
    same object, so a call written onto it afterwards lands on the one saved. */
export const addMark = (wps, wp) => [...(Array.isArray(wps) ? wps : []), wp].sort((a, b) => a.t - b.t);

/** The marks without the one at index `i`. */
export const removeMark = (wps, i) => (Array.isArray(wps) ? wps : []).filter((_, j) => j !== i);

/** The Indication owed the question "How sure were you?", or null. As on
    the run screen, it is the run's first Indication in time, the first
    commitment, which is the one call scored against how the run went
    (call.js firstCall). Placed from memory the marks can come in any order:
    the find first, then a false indication the dog gave earlier. So the
    question follows the earliest Indication, wherever it was placed in the
    list, and moves to an earlier one placed afterwards. Never once the
    answer has been seen (`seen`: the trail or the grade on screen since the
    run), shown during the run, or read out by the coach: a call made after
    looking means nothing, so it is not asked for. */
export function callOwed(wps, data, seen) {
  if (seen || trailShown(data) || data?.coach?.assisted) return null;
  const first = (wps ?? []).filter(w => w?.kind === 'Indication' && !w.late)
    .reduce((a, w) => (!a || w.t < a.t ? w : a), null);
  return first ?? null;
}

/** Whether placing `wp` asks the question: it is now the earliest Indication. */
export const asksCall = (wps, wp, data, seen) => wp?.kind === 'Indication' && callOwed(wps, data, seen) === wp;

/** The marks with the question moved onto `wp`: any call another Indication
    carried is taken off, so a run never holds two first commitments. */
export const callMovedTo = (wps, wp) => (wps ?? []).map(w => {
  if (w === wp || w?.kind !== 'Indication' || !w.call) return w;
  const { call, ...rest } = w;
  return rest;
});

/** Whether the mark at `i` can be taken off. Freely while the answer is
    still hidden. Once it has been seen, an Indication placed before that is
    the record a blind call is scored against: taken off, a wrong "Certain"
    would quietly leave the record, or a call be made unscorable. So it stays
    while the run holds a blind call. Marks placed with the answer known
    (`late`) are only notes, and come off as they went on. */
export function removable(wps, i, hidden) {
  const w = (wps ?? [])[i];
  if (!w) return false;
  if (hidden || w.kind !== 'Indication' || w.late) return true;
  return !(wps ?? []).some(x => x?.kind === 'Indication' && x.call?.conf && !x.call.seen);
}

/** Was a call made at `at` (ms) made knowing the answer? Shown on the run
    screen (revealedAt), or seen after the run on the result or the replay
    (resultSeenAt). A new trail run is saved with `resultSeenAt: null` until
    then (app.js noteAnswerSeen). A run from before marks were placed
    afterwards has no such field: its calls were made live and are judged as
    they always were, and its marks can only be edited with the answer seen,
    so nothing is asked then. */
export function seenWhen(data, at) {
  if (trailShown(data) && at >= data.revealedAt) return true;
  const seen = data?.resultSeenAt;
  return fin(seen) && at >= seen;
}

/** One mark, as compared: everything that is saved with it. */
const markKey = (w) => [w?.kind, w?.t, w?.lat, w?.lon, w?.approx ? 1 : 0, w?.late ? 1 : 0, w?.call?.conf ?? ''].join('|');

/** Whether two lists of marks say the same thing, whatever their order. */
export function sameMarks(a, b) {
  const ka = (a ?? []).map(markKey).sort(), kb = (b ?? []).map(markKey).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i]);
}

/** What ending the marking has to do: save the marks when they changed,
    and grade the run again when the wind did (the trail's grade is read
    from the dog's route in the wind, not from the marks). A blind trail
    with no line keeps them, and is graded with them once its line comes. */
export function markingSave({ before, after, feltBefore, feltAfter }) {
  return {
    marks: !sameMarks(before, after),
    wind: JSON.stringify(feltBefore ?? null) !== JSON.stringify(feltAfter ?? null),
  };
}
