/* A squad in the cloud: making one, joining one, following it, and sending
   where you are while on duty.

   Every call takes a handle, { f, fs, uid }: the Firebase functions, the
   Firestore instance and the signed-in account (sync.js squadHandle). Passed
   in rather than imported so that the tests can hand the same code a fake
   cloud (test/fake-firebase.mjs) with several phones on it.

   firestore.rules decides who may do any of this; nothing here is trusted
   by the cloud. What comes back is cleaned (squad.js) before it is drawn. */

import { PATHS, squadDoc, memberDoc, joinCodeDoc, positionDoc, cleanMember, cleanPosition,
         cleanSquadName, newJoinCode } from './squad.js';

const ref = (h, parts) => h.f.doc(h.fs, ...parts);
const col = (h, parts) => h.f.collection(h.fs, ...parts);
/* The same moment twice: the number the app and the rules read, and the
   Timestamp Firestore's clean-up (a TTL policy) reads. */
const ttl = (h, ms) => ({ expiresAt: ms, deleteAt: h.f.Timestamp.fromMillis(ms) });

const squadId = () => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(40));
  let out = '';
  for (const b of bytes) if (b < 248 && out.length < 20) out += alphabet[b % 62];
  return out;
};

/** A new squad, with its creator as Command. One batch, so there is never
    a squad nobody can run, or a code that leads nowhere. */
export async function createSquad(h, { name, callSign, displayName = '', now = Date.now() }) {
  const sid = squadId();
  const code = newJoinCode();
  const squad = squadDoc({ name, code, uid: h.uid, now });
  const b = h.f.writeBatch(h.fs);
  b.set(ref(h, PATHS.squad(sid)), squad);
  b.set(ref(h, PATHS.member(sid, h.uid)), memberDoc({ uid: h.uid, role: 'command', callSign, name: displayName, code, now }));
  b.set(ref(h, PATHS.joinCode(code)), joinCodeDoc({ sid, name: squad.name, by: callSign, now }));
  await b.commit();
  return { id: sid, name: squad.name, code };
}

/** What a code leads to, before joining: the squad's name and who made it,
    so the person can say yes or no to the right squad. null if no such code. */
export async function findSquad(h, code) {
  const snap = await h.f.getDoc(ref(h, PATHS.joinCode(code)));
  if (!snap.exists()) return null;
  const d = snap.data() || {};
  if (typeof d.squadId !== 'string' || !d.squadId) return null;
  return { id: d.squadId, name: cleanSquadName(d.name) || 'Squad', by: cleanSquadName(d.by), code };
}

/** Join with a code, as a K9 handler or an officer. Joining again (a new
    phone, a new call sign) rewrites the member's own record; a member who
    is already Command stays Command. */
export async function joinSquad(h, { id, code, role, callSign, dog = null, displayName = '', keepRole = null, now = Date.now() }) {
  const r = keepRole === 'command' ? 'command' : (role === 'k9' ? 'k9' : 'officer');
  await h.f.setDoc(ref(h, PATHS.member(id, h.uid)),
    memberDoc({ uid: h.uid, role: r, callSign, name: displayName, dog, code, now }));
}

/** This account's own record in a squad, or null: not a member (never was,
    or removed). Refused reads mean the same. */
export async function myMember(h, id) {
  try {
    const snap = await h.f.getDoc(ref(h, PATHS.member(id, h.uid)));
    return snap.exists() ? cleanMember(snap.data(), h.uid) : null;
  } catch (e) {
    if (String(e?.code || '').includes('permission')) return null;
    throw e;
  }
}

/** The squad itself, read once: { id, name, code, createdBy }, or null if
    there is none (or it was deleted). Refused for anyone not a member. */
export async function getSquad(h, id) {
  const snap = await h.f.getDoc(ref(h, PATHS.squad(id)));
  const d = snap.exists() ? (snap.data() || {}) : null;
  if (!d || d.gone === true) return null;
  return { id, name: cleanSquadName(d.name) || 'Squad', code: typeof d.code === 'string' ? d.code : '',
           createdBy: typeof d.createdBy === 'string' ? d.createdBy : '' };
}

/** Follow a squad: the squad, its members and every on-duty position.
    `cb` gets { squad, members, positions } on every change, or
    { gone: true } when this account is no longer a member (removed, or the
    squad deleted), or { error } for anything else. Returns the stop. */
export function watchSquad(h, id, cb) {
  const state = { squad: null, members: new Map(), positions: new Map() };
  let stopped = false, ready = { squad: false, members: false, positions: false };
  const offs = [];
  const stop = () => { stopped = true; for (const off of offs.splice(0)) { try { off(); } catch { /* already gone */ } } };
  const push = () => { if (!stopped && ready.squad && ready.members) cb(state); };
  const fail = (e) => {
    if (stopped) return;
    const denied = String(e?.code || '').includes('permission');
    stop();
    cb(denied ? { gone: true } : { error: e?.message || 'Lost touch with the squad' });
  };
  offs.push(h.f.onSnapshot(ref(h, PATHS.squad(id)), (snap) => {
    const d = snap.exists() ? (snap.data() || {}) : null;
    if (!d || d.gone === true) return fail({ code: 'permission-denied' });
    state.squad = { id, name: cleanSquadName(d.name) || 'Squad', code: typeof d.code === 'string' ? d.code : '',
                    createdBy: typeof d.createdBy === 'string' ? d.createdBy : '' };
    ready.squad = true;
    push();
  }, fail));
  offs.push(h.f.onSnapshot(col(h, PATHS.members(id)), (qs) => {
    for (const ch of qs.docChanges()) {
      if (ch.type === 'removed') { state.members.delete(ch.doc.id); continue; }
      const m = cleanMember(ch.doc.data(), ch.doc.id);
      if (m) state.members.set(m.uid, m); else state.members.delete(ch.doc.id);
    }
    /* Taken off the list while watching: the next read would be refused
       anyway, and the screen should say so now. */
    if (!state.members.has(h.uid) && ready.members) return fail({ code: 'permission-denied' });
    ready.members = true;
    push();
  }, fail));
  offs.push(h.f.onSnapshot(col(h, PATHS.positions(id)), (qs) => {
    for (const ch of qs.docChanges()) {
      if (ch.type === 'removed') { state.positions.delete(ch.doc.id); continue; }
      /* A position belongs to the account it is filed under, whatever it
         claims inside. */
      const p = cleanPosition(ch.doc.data(), ch.doc.id);
      if (p) state.positions.set(ch.doc.id, { ...p, uid: ch.doc.id }); else state.positions.delete(ch.doc.id);
    }
    ready.positions = true;
    push();
  }, () => { /* the squad and member listeners report why */ }));
  return stop;
}

/** On duty: where this phone is. Not awaited by the caller: Firestore queues
    it with no signal, and the next fix replaces it anyway. */
export function putPosition(h, id, fix, now = Date.now()) {
  const d = positionDoc(h.uid, fix, now);
  return h.f.setDoc(ref(h, PATHS.position(id, h.uid)), { ...d, ...ttl(h, d.expiresAt) });
}

/** Off duty: the last position goes too, so nobody sees a stale dot and
    takes it for the member. */
export function clearPosition(h, id) {
  return h.f.deleteDoc(ref(h, PATHS.position(id, h.uid)));
}

/** Command promotes a member to Command, or steps one back down. */
export async function setRole(h, id, uid, role) {
  /* Only the role: the rules refuse a change to anything else in someone
     else's record. */
  await h.f.setDoc(ref(h, PATHS.member(id, uid)), { role }, { merge: true });
}

/** Command removes a member, and their position with them. The code
    changes in the same batch: the person removed still has the old one (in
    their link, a photo of the QR), and a step left for later is a step
    skipped under pressure. Returns the new code. */
export async function removeMember(h, squad, uid, { by = '', now = Date.now() } = {}) {
  const code = newJoinCode();
  const b = h.f.writeBatch(h.fs);
  b.delete(ref(h, PATHS.position(squad.id, uid)));
  b.delete(ref(h, PATHS.member(squad.id, uid)));
  b.set(ref(h, PATHS.squad(squad.id)), { code }, { merge: true });
  b.set(ref(h, PATHS.joinCode(code)), joinCodeDoc({ sid: squad.id, name: squad.name, by, now }));
  if (squad.code) b.delete(ref(h, PATHS.joinCode(squad.code)));
  await b.commit();
  return code;
}

/** Leave: position first (it needs membership to be allowed), then the
    member record. */
export async function leaveSquad(h, id) {
  const b = h.f.writeBatch(h.fs);
  b.delete(ref(h, PATHS.position(id, h.uid)));
  b.delete(ref(h, PATHS.member(id, h.uid)));
  await b.commit();
}

/** A new join code, for when one has gone further than it should (someone
    removed could otherwise come straight back with the old one). */
export async function newCode(h, squad, { by = '', now = Date.now() } = {}) {
  const code = newJoinCode();
  const b = h.f.writeBatch(h.fs);
  b.set(ref(h, PATHS.squad(squad.id)), { code }, { merge: true });
  b.set(ref(h, PATHS.joinCode(code)), joinCodeDoc({ sid: squad.id, name: squad.name, by, now }));
  if (squad.code) b.delete(ref(h, PATHS.joinCode(squad.code)));
  await b.commit();
  return code;
}

/* Firestore takes at most 500 writes in a batch; a squad's incidents can
   hold more documents than that. */
async function deleteAll(h, paths) {
  for (let i = 0; i < paths.length; i += 400) {
    const b = h.f.writeBatch(h.fs);
    for (const p of paths.slice(i, i + 400)) b.delete(ref(h, p));
    await b.commit();
  }
}
const idsOf = async (h, parts) => (await h.f.getDocs(col(h, parts))).docs.map(d => d.id);

/** How long a deleted squad's tombstone is kept: longer than anything in
    the squad can live (an incident, eight days at most by the rules). */
export const TOMBSTONE_MS = 9 * 24 * 3600e3;

/** The creator deletes the squad. What is in it is read from the cloud, not
    from this phone's copy, so that nobody the phone had not heard of keeps a
    record: every incident with its marks and tracks, every position and
    member, the code. The squad itself becomes a tombstone, which keeps
    anyone from making it again under the same id; the creator's own record
    goes in that same last batch (the rules need it until then to say who may
    delete the rest). */
export async function deleteSquad(h, squad, { now = Date.now() } = {}) {
  const sid = squad.id;
  const found = (await h.f.getDocs(col(h, PATHS.incidents(sid)))).docs;
  const incidents = found.map(d => d.id);
  /* A running incident is ended first: the rules let nobody, Command
     included, delete a mark while its incident runs, so the live record
     cannot be thinned out under the squad's feet. */
  for (const d of found) {
    const x = d.data();
    if (x.status === 'active') await h.f.setDoc(ref(h, PATHS.incident(sid, d.id)), { ...x, status: 'ended', endedAt: now });
  }
  const inner = [];
  for (const iid of incidents) {
    for (const mid of await idsOf(h, PATHS.marks(sid, iid))) inner.push(PATHS.mark(sid, iid, mid));
    for (const tid of await idsOf(h, PATHS.tracks(sid, iid))) inner.push([...PATHS.tracks(sid, iid), tid]);
  }
  /* Marks and tracks before their incident: the rules look the incident up. */
  await deleteAll(h, inner);
  await deleteAll(h, incidents.map(iid => PATHS.incident(sid, iid)));
  const uids = await idsOf(h, PATHS.members(sid));
  const positions = await idsOf(h, PATHS.positions(sid));
  await deleteAll(h, [...positions.map(uid => PATHS.position(sid, uid)),
                      ...uids.filter(uid => uid !== h.uid).map(uid => PATHS.member(sid, uid))]);
  const b = h.f.writeBatch(h.fs);
  if (squad.code) b.delete(ref(h, PATHS.joinCode(squad.code)));
  b.set(ref(h, PATHS.squad(sid)), { gone: true, createdBy: h.uid, ...ttl(h, now + TOMBSTONE_MS) });
  b.delete(ref(h, PATHS.member(sid, h.uid)));
  await b.commit();
}

