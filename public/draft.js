/* An unfinished recording, kept on the phone while it happens.

   A trail is only a session once it is confirmed, and a run only once it is
   graded — and grading waits on the weather, which waits on the network. Until
   then the walk lived in memory alone: a crash, a phone short of memory, or an
   update reloading the page took an hour in a field with it. That is the worst
   thing this app can do, so the points are written down as they arrive.

   One draft at a time, because one phone records one thing at a time. It is
   cleared the moment the real save succeeds, so what is offered back is never
   a copy of something already kept. */

import { pathLen } from './geo.js';
import { packPoints, unpackPoints } from './sync-core.js';

export const DRAFT_V = 1;

/** Older than this and it is not this morning's walk. Long enough to survive
    a phone left on the kitchen table overnight, short enough that nobody is
    ever offered last week. */
export const DRAFT_MAX_AGE = 18 * 3600e3;

const KINDS = new Set(['lay', 'hide', 'run']);
const fin = (n) => typeof n === 'number' && Number.isFinite(n);
const str = (v) => (typeof v === 'string' && v ? v : null);

/** What the phone writes down. Points go through the same columnar packing the
    backup uses, so a long track costs a few kilobytes rather than a hundred. */
export function packDraft({
  kind, startedAt, sessionId = null, targetId = null, layerId = null, dogId = null,
  odour = null, liveId = null, liveUrl = null, revealedAt = 0, pts = [], wps = [], hides = [],
} = {}, now = Date.now()) {
  if (!KINDS.has(kind)) return null;
  return {
    v: DRAFT_V,
    kind,
    at: now,
    startedAt: fin(startedAt) ? startedAt : now,
    sessionId: str(sessionId), targetId: str(targetId), layerId: str(layerId),
    dogId: str(dogId), odour: str(odour),
    /* A run being watched: the link must be closed with its result, or whoever
       is following is left staring at a track that stopped. */
    liveId: str(liveId), liveUrl: str(liveUrl),
    /* Whether the answer had been shown before the app died: a recovered run
       must not turn a call made after looking into a blind one. */
    revealedAt: fin(revealedAt) && revealedAt > 0 ? revealedAt : null,
    /* Short form: this is rewritten every few seconds while walking, and it
       lives in the phone's own text store where every character is paid for. */
    pts: pts?.length ? packPoints(pts, { compact: true }) : null,
    wps: wps?.length ? packPoints(wps, { compact: true }) : null,
    hides: hides?.length ? packPoints(hides, { compact: true }) : null,
  };
}

/** Read one back. Anything that isn't a draft this version wrote is nothing:
    a half-written or older record must never be handed to the app as a walk. */
export function unpackDraft(o) {
  if (!o || typeof o !== 'object' || o.v !== DRAFT_V || !KINDS.has(o.kind)) return null;
  const pts = o.pts ? unpackPoints(o.pts) ?? [] : [];
  const wps = o.wps ? unpackPoints(o.wps) ?? [] : [];
  const hides = o.hides ? unpackPoints(o.hides) ?? [] : [];
  if (!fin(o.at)) return null;
  return {
    kind: o.kind, at: o.at, startedAt: fin(o.startedAt) ? o.startedAt : o.at,
    sessionId: str(o.sessionId), targetId: str(o.targetId), layerId: str(o.layerId),
    dogId: str(o.dogId), odour: str(o.odour),
    liveId: str(o.liveId), liveUrl: str(o.liveUrl),
    revealedAt: fin(o.revealedAt) ? o.revealedAt : 0,
    pts, wps, hides,
  };
}

/** Is this worth offering back? A tap or two of GPS is not a walk, and a
    recording from yesterday is not what anyone is standing in a field for. */
export function draftAlive(d, now = Date.now()) {
  if (!d) return false;
  if (!fin(d.at) || now - d.at > DRAFT_MAX_AGE || now - d.at < 0) return false;
  return d.kind === 'hide' ? d.hides.length > 0 : d.pts.length > 1;
}

/** The numbers the offer is written from. */
export function draftStats(d) {
  if (!d) return null;
  const pts = d.kind === 'hide' ? d.hides : d.pts;
  const last = pts[pts.length - 1];
  return {
    kind: d.kind,
    points: pts.length,
    hides: d.hides.length,
    metres: d.kind === 'hide' ? 0 : Math.round(pathLen(d.pts)),
    startedAt: d.startedAt,
    /* How long it ran for, from the points themselves: the clock on the last
       fix, not when it happened to be written down. */
    lastedMs: fin(last?.t) && fin(pts[0]?.t) ? Math.max(0, last.t - pts[0].t) : 0,
    at: d.at,
  };
}
