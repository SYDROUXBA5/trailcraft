/* An incident in the cloud: starting and ending it, the marks on it, each
   member's movements during it, and following it live.

   Every call takes the same handle as squad-cloud.js, { f, fs, uid }, so the
   tests can run several phones on the fake cloud. firestore.rules decides
   who may do what (Command starts and ends; the trailing team alone calls
   the scent; each member writes only their own track); what comes back is
   cleaned (incident.js) before anything draws it. */

import { PATHS, INCIDENT_TTL } from './squad.js';
import { incidentDoc, cleanIncident, markDoc, cleanMark, cleanTrack, joinTracks } from './incident.js';

const ref = (h, parts) => h.f.doc(h.fs, ...parts);
const col = (h, parts) => h.f.collection(h.fs, ...parts);
/* The two forms of the same moment, as in squad-cloud.js: the number the
   app and the rules read, and the Timestamp the clean-up reads. */
const ttl = (h, ms) => ({ expiresAt: ms, deleteAt: h.f.Timestamp.fromMillis(ms) });

const newId = () => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let out = '';
  for (const b of bytes) if (b < 248 && out.length < 16) out += alphabet[b % 62];
  return out;
};

/** Command starts an incident. Returns it, cleaned, as every member will
    see it. */
export async function startIncident(h, sid, { name, lkp, k9Uid, lastSeenAt = null, pace = null, brief = null, now = Date.now() }) {
  const id = newId();
  const d = incidentDoc({ name, lkp, k9Uid, uid: h.uid, now, lastSeenAt, pace, brief });
  await h.f.setDoc(ref(h, PATHS.incident(sid, id)), { ...d, ...ttl(h, d.expiresAt) });
  return cleanIncident(d, id);
}

/** Command ends it, with the few numbers the list of past incidents shows.
    An ended incident is final: the rules refuse any change after. */
export async function endIncident(h, sid, inc, summary, now = Date.now()) {
  await h.f.setDoc(ref(h, PATHS.incident(sid, inc.id)),
    { ...again(h, inc), status: 'ended', endedAt: now, summary });
}

/* The incident written out again whole, as it stands, for Command's next
   change to it: what was said about last seen and the brief rides along, so
   ending it or correcting one thing never wipes the rest. */
function again(h, inc, patch = {}) {
  const d = incidentDoc({ name: inc.name, lkp: inc.lkp, k9Uid: inc.k9Uid, uid: inc.startedBy, now: inc.startedAt,
    lastSeenAt: inc.lastSeenAt, pace: inc.pace, brief: inc.brief, ...patch });
  return { ...d, ...ttl(h, d.expiresAt) };
}

/** Command corrects when the person was last seen, how they left, or the
    handler's brief, while the incident runs. */
export function updateSeen(h, sid, inc, { lastSeenAt, pace, brief }) {
  return h.f.setDoc(ref(h, PATHS.incident(sid, inc.id)), again(h, inc, { lastSeenAt, pace, brief }));
}

/** Every incident of the squad, active and ended (ended ones are kept a
    week, for the debrief). `cb` gets a Map id → incident on each change.
    Refusals are left to the squad's own listener, which says why. */
export function watchIncidents(h, sid, cb) {
  const all = new Map();
  return h.f.onSnapshot(col(h, PATHS.incidents(sid)), (qs) => {
    for (const ch of qs.docChanges()) {
      if (ch.type === 'removed') { all.delete(ch.doc.id); continue; }
      const i = cleanIncident(ch.doc.data(), ch.doc.id);
      if (i) all.set(i.id, i); else all.delete(ch.doc.id);
    }
    cb(new Map(all));
  }, () => { /* squad-cloud's listener reports a lost membership */ });
}

/** Follow one incident: its marks, and the trailing team's track (only
    theirs: everyone else's is read once, for the replay, which keeps what
    each member's map reads down to what it shows). `cb` gets
    { marks: Map, trail: [{ lat, lon, t }] }. Returns the stop. */
export function watchIncident(h, sid, inc, cb) {
  const marks = new Map();
  const minutes = new Map();
  let trail = [];
  const push = () => cb({ marks: new Map(marks), trail });
  const offs = [];
  offs.push(h.f.onSnapshot(col(h, PATHS.marks(sid, inc.id)), (qs) => {
    for (const ch of qs.docChanges()) {
      sawMark(h.uid, inc.id, ch.doc.id);
      if (ch.type === 'removed') { marks.delete(ch.doc.id); continue; }
      const m = cleanMark(ch.doc.data(), ch.doc.id);
      if (m) marks.set(m.id, m); else marks.delete(ch.doc.id);
    }
    push();
  }, () => {}));
  if (inc.k9Uid) {
    const q = h.f.query(col(h, PATHS.tracks(sid, inc.id)), h.f.where('uid', '==', inc.k9Uid));
    offs.push(h.f.onSnapshot(q, (qs) => {
      for (const ch of qs.docChanges()) {
        if (ch.type === 'removed') { minutes.delete(ch.doc.id); continue; }
        const tr = cleanTrack(ch.doc.data(), ch.doc.id);
        /* Filed under the trailing team's name, or it is not their trail. */
        if (tr && tr.uid === inc.k9Uid) minutes.set(ch.doc.id, tr);
      }
      trail = joinTracks([...minutes.values()]).get(inc.k9Uid)?.pts ?? [];
      push();
    }, () => {}));
  }
  return () => { for (const off of offs.splice(0)) { try { off(); } catch { /* gone */ } } };
}

/* A member's marks on an incident are numbered {uid}_0, {uid}_1 and so on,
   and the rules take no number past 999: a cap on what one phone with the
   code can make every other phone read. The next number is one past the
   highest this phone has made or seen of its own, so a mark is never
   written over another. */
const MARK_MAX = 999;
const markCount = new Map();   // `${uid}/${iid}` → the next number
function sawMark(uid, iid, id) {
  const m = /^(.+)_(\d{1,3})$/.exec(id);
  if (!m || m[1] !== uid) return;
  const k = `${uid}/${iid}`;
  markCount.set(k, Math.max(markCount.get(k) ?? 0, Number(m[2]) + 1));
}

/** A mark on the incident map. Returns its id. */
export async function putMark(h, sid, iid, m, now = Date.now()) {
  const k = `${h.uid}/${iid}`;
  const n = markCount.get(k) ?? 0;
  if (n > MARK_MAX) throw new Error('You have made as many marks as one incident takes');
  markCount.set(k, n + 1);
  const id = `${h.uid}_${n}`;
  const d = markDoc({ ...m, uid: h.uid, at: now });
  await h.f.setDoc(ref(h, PATHS.mark(sid, iid, id)), { ...d, ...ttl(h, d.expiresAt) });
  return id;
}

/** Takes a mark back. It is not deleted: it is marked withdrawn, by whom and
    when, so the log keeps it crossed out and the debrief shows what was
    called and then taken back. The rules let these two fields be added once,
    by the mark's maker or Command, and change nothing else. */
export const withdrawMark = (h, sid, iid, mid, now = Date.now()) =>
  h.f.setDoc(ref(h, PATHS.mark(sid, iid, mid)), { withdrawnBy: h.uid, withdrawnAt: now }, { merge: true });

/** One minute of this member's movements. Rewritten whole each time it
    grows: a minute holds at most a few dozen fixes. */
export function putTrack(h, sid, iid, { n, lat, lon, t }, { callSign = '', role = 'officer', now = Date.now() } = {}) {
  return h.f.setDoc(ref(h, PATHS.track(sid, iid, h.uid, n)),
    { uid: h.uid, n, lat, lon, t, cs: callSign, role, ...ttl(h, now + INCIDENT_TTL) });
}

/** Everything the replay needs, read once: every member's movements and
    every mark. */
export async function loadIncident(h, sid, iid) {
  const [tq, mq] = await Promise.all([
    h.f.getDocs(col(h, PATHS.tracks(sid, iid))),
    h.f.getDocs(col(h, PATHS.marks(sid, iid))),
  ]);
  const tracks = tq.docs.map(d => cleanTrack(d.data(), d.id)).filter(Boolean);
  const marks = new Map();
  for (const d of mq.docs) { const m = cleanMark(d.data(), d.id); if (m) marks.set(m.id, m); }
  return { tracks: joinTracks(tracks), marks };
}
