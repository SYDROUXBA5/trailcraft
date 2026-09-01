/* The team — who laid the trail, which dog worked it, and how aged it was.

   A session records what happened on the ground; this module records who it
   happened to. The one modelling decision here is that hot / warm / cold is a
   property of the WORKING, not of the trail: the same line is hot at twenty
   minutes and cold the next morning, so the class is computed from the real
   gap between laying and starting the dog — timestamps the app already keeps
   honestly — never self-reported.

   Pure functions, no DOM, tested in Node like the rest of the maths. */

import { pathLen } from './geo.js';

/* Scent-work convention, stated openly in the UI rather than tuned in secret:
   hot inside half an hour, warm to three hours, cold beyond. Clubs differ at
   the edges; the timestamps are stored, so a future setting can re-cut these
   without losing anything. */
export const CLASS_BOUNDS = { hot: 30 * 60000, warm: 3 * 3600000 };

/* A dog's level speaks the same language as the trails: a Hot dog works only
   fresh trails, a Warm dog handles aged ones, a Cold dog runs anything. One
   vocabulary for the dog and the ground it can work. */
export const LEVELS = [
  { id: 'hot', label: 'Hot' },
  { id: 'warm', label: 'Warm' },
  { id: 'cold', label: 'Cold' },
];

export const levelLabel = (id) =>
  LEVELS.find(l => l.id === id)?.label ?? 'Hot';

/** Age of the trail when the dog started → 'hot' | 'warm' | 'cold'.
    Null when there is nothing to classify (no linked trail, or a clock that
    ran backwards — a drawn trail dated after the dog ran it). */
export function trailClass(ageMs) {
  if (ageMs == null || !Number.isFinite(ageMs) || ageMs < 0) return null;
  if (ageMs <= CLASS_BOUNDS.hot) return 'hot';
  if (ageMs <= CLASS_BOUNDS.warm) return 'warm';
  return 'cold';
}

/** The class a dog session carries: an override wins, else the computed one. */
export const classOf = (s) => s?.klassManual ?? s?.klass ?? null;

/** One dog's record: every trail worked, by class, and the ground covered. */
export function dogStats(sessions, dogId) {
  const out = { trails: 0, meters: 0, hot: 0, warm: 0, cold: 0 };
  for (const s of sessions) {
    if (s.mode !== 'dog' || s.dogId !== dogId) continue;
    out.trails++;
    out.meters += pathLen(s.points || []);
    const k = classOf(s);
    if (k) out[k]++;
  }
  out.meters = Math.round(out.meters);
  return out;
}

/** The handler's record: trails walked out (drawn ones planned, not walked). */
export function handlerStats(sessions) {
  const out = { laid: 0, drawn: 0, meters: 0 };
  for (const s of sessions) {
    if (s.mode !== 'runner') continue;
    if (s.drawn) { out.drawn++; continue; }
    out.laid++;
    out.meters += pathLen(s.points || []);
  }
  out.meters = Math.round(out.meters);
  return out;
}

/** Class the past: sessions saved before classification existed carry the
    timestamps but not the class. Compute it once from what was stored —
    idempotent, and it never touches a session that already has one. */
export function backfillClasses(sessions) {
  let changed = 0;
  const byId = new Map(sessions.map(s => [s.id, s]));
  for (const s of sessions) {
    if (s.mode !== 'dog' || s.klass !== undefined || !s.linkTo) continue;
    const laid = byId.get(s.linkTo);
    if (!laid) continue;
    s.klass = trailClass(s.started - laid.started);
    changed++;
  }
  return changed;
}

/** Adopt the past: dog sessions saved before the team existed carry only a
    typed name. Where that name matches a registered dog, attach the id — and
    never touch a session already attributed. Returns how many were adopted. */
export function attributeByName(sessions, dogs) {
  let changed = 0;
  const byName = new Map(dogs.map(d => [d.name.trim().toLowerCase(), d.id]));
  for (const s of sessions) {
    if (s.mode !== 'dog' || s.dogId) continue;
    const id = byName.get(String(s.dog || '').trim().toLowerCase());
    if (id) { s.dogId = id; changed++; }
  }
  return changed;
}
