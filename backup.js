/* A backup the handler can hold, and the way back in from one.

   "Export everything" used to write a file nothing could read back, without
   the one thing on the phone that took months to earn: what each dog's graded
   runs taught the drift model. The Wipe dialog still told handlers to export
   first, as if that kept anything. Now the file carries every record and the
   calibration with a version, and Restore reads it back.

   The file is read as a stranger's input, the way a shared link is
   (share.js): a backup can be sent by anyone and chosen by mistake. Its size,
   its counts, every id and every field the screens rely on are checked before
   one record is kept, and a key that would reach an object's prototype never
   gets through. Restoring only ever adds: a record already on the phone is
   replaced only by a newer copy of itself (the same rule as syncing,
   sync-core.js mergeOne), and nothing on the phone is deleted. */

import { mergeOne, mergeCalibration, calibrationDiffers } from './sync-core.js';

export const BACKUP_VERSION = 3;
const APP = 'trailcraft';
export const BACKUP_TABLES = ['handlers', 'dogs', 'layers', 'sessions'];
/* Two answers the handler gave on this phone, which no record holds: that
   they only lay trails for someone else's dog, and that they have seen the
   tutorial. Without them a layer restoring onto a new phone was sent to the
   dog form, whose first-launch screen has no way back to the choice. */
export const BACKUP_FLAGS = ['layerOnly', 'tutorialDone'];

/* Limits no genuine backup comes near. The iPhone app keeps about fifty
   megabytes of records, and the file is the same records written once. */
export const BACKUP_MAX_BYTES = 64 * 1024 * 1024;
const MAX_ROWS = { handlers: 500, dogs: 2000, layers: 2000, sessions: 20000 };
const MAX_DEPTH = 24;
const MAX_ITEMS = 200000;          // points in one line, as sync-core.js unpacks at most
const MAX_KEYS = 2000;
const MAX_TEXT = 2_000_000;        // a profile photo is the longest text the app writes
const MAX_CAL_ROWS = 500;

const NOT_OURS = 'This is not a Trailcraft backup file';
const NEWER = 'This backup is from a newer Trailcraft. Update the app, then try again';
const TOO_BIG = 'This file is too big to be a Trailcraft backup';
const DAMAGED = 'This backup file is damaged';
/* The errors written here are meant to be read, as share.js does it. */
const refuse = (msg) => Object.assign(new Error(msg), { plain: true });

const fin = Number.isFinite;
const plainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const T_MIN = Date.UTC(2000, 0, 1), T_MAX = Date.UTC(2100, 0, 1);
const inEra = (ms) => fin(ms) && ms >= T_MIN && ms <= T_MAX;

/** The file itself: every live record, and what each dog has taught the model. */
export function makeBackup({ handlers = [], dogs = [], layers = [], sessions = [], calibration = [], flags = {} } = {}, now = new Date()) {
  const kept = new Set(dogs.map(d => d.id));
  return {
    app: APP, version: BACKUP_VERSION, exportedAt: now.toISOString(),
    handlers, dogs, layers, sessions,
    flags: Object.fromEntries(BACKUP_FLAGS.filter(k => flags?.[k] === true).map(k => [k, true])),
    /* Only for dogs that are in the file: a deleted dog's rows are kept on
       the phone but nothing can reach them, and a restore would skip them. */
    calibration: calibration.filter(c => kept.has(c?.id) && c.rows?.length),
  };
}

/* ── Reading a file back ─────────────────────────────────────────── */

/* An id becomes a Firestore document name, a key in the phone's tables and a
   value in the page's markup, so only the characters the app itself uses get
   through (uid() in store.js, and the first version's `s${Date.now()}`). A
   name shaped like __x__ is refused by the cloud, and one that is a property
   every object already has (__proto__, toString) would reach the prototype of
   any object it is used to look something up in. */
const okId = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v)
  && !/^__.*__$/.test(v) && !(v in Object.prototype);
const idOrNull = (v) => v == null || okId(v);

/* Keys that would write onto an object's prototype, or that the cloud refuses
   and that would stop a whole backup batch (sync-core.js toCloud), and the
   cloud's own bookkeeping, which never belongs on the phone. */
const dropKey = (k) => !k || k === '__proto__' || k === 'constructor' || k === 'prototype'
  || /^__.*__$/.test(k);
const CLOUD_ONLY = new Set(['baseAt', 'syncedAt']);

class Damaged extends Error {}

/** A copy made only of plain JSON values, within the limits above. JSON.parse
    turns "__proto__" into an ordinary key, but copying that key onto another
    object by assignment sets the object's prototype, so it is left out here
    rather than trusted to every later copy. */
function plain(v, depth = 0) {
  if (v === null || typeof v === 'boolean') return v;
  if (typeof v === 'number') { if (!fin(v)) throw new Damaged(); return v; }
  if (typeof v === 'string') { if (v.length > MAX_TEXT) throw new Damaged(); return v; }
  if (depth >= MAX_DEPTH || typeof v !== 'object') throw new Damaged();
  if (Array.isArray(v)) {
    if (v.length > MAX_ITEMS) throw new Damaged();
    return v.map(x => plain(x, depth + 1));
  }
  const out = {};
  let n = 0;
  for (const k of Object.keys(v)) {
    if (dropKey(k)) continue;
    if (++n > MAX_KEYS) throw new Damaged();
    out[k] = plain(v[k], depth + 1);
  }
  return out;
}

const text = (v, n) => v == null || (typeof v === 'string' && v.length <= n);
/* The same test the screens make before a photo goes into a style attribute
   (app.js avaHtml). Anything else is dropped, and the profile keeps its initial. */
const PHOTO_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

/* A point the map and the grading can use: a real place. */
const isPoint = (p) => plainObject(p) && fin(p.lat) && fin(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;
/* One time out of its era and the whole line's clock goes, as it does for a
   shared link: a line with no clock still draws, and an impossible one breaks
   the GPX file and the dates on the screen. */
function line(pts) {
  if (pts == null) return pts;
  if (!Array.isArray(pts) || !pts.every(isPoint)) throw new Damaged();
  if (pts.some(p => p.t != null && !inEra(p.t))) for (const p of pts) delete p.t;
  return pts;
}
const LINES = ['trail', 'track', 'hides', 'waypoints', 'trackWaypoints'];
const OBJECTS = ['result', 'debrief', 'weather', 'coach', 'seen'];

/** The fields every row shares: an id, a clock, and no bookkeeping. A clock
    in the future is brought back to now: newest wins, and a copy stamped a
    thousand years ahead would otherwise beat every later edit on every phone. */
function common(raw, now) {
  if (!plainObject(raw) || !okId(raw.id)) throw new Damaged();
  const row = plain(raw);
  for (const k of CLOUD_ONLY) delete row[k];
  row.updatedAt = fin(row.updatedAt) && row.updatedAt > 0 ? Math.min(row.updatedAt, now) : 1;
  return row;
}

/* The name forms have no length limit, so the app itself can save a longer
   name than this. Such a row is the app's own and is kept, cut to a length
   the screens can show, rather than refused as damaged while the dogs and
   sessions that point at it come back without it. */
const NAME_MAX = 200;
function profile(raw, now) {
  const row = common(raw, now);
  if (typeof row.name !== 'string') throw new Damaged();
  if (row.name.length > NAME_MAX) row.name = row.name.slice(0, NAME_MAX).replace(/[\uD800-\uDBFF]$/, '');
  if (row.photo != null && !(typeof row.photo === 'string' && PHOTO_RE.test(row.photo))) row.photo = null;
  return row;
}

const CLEAN = {
  handlers: profile,
  layers: profile,
  dogs(raw, now) {
    const row = profile(raw, now);
    if (!idOrNull(row.handlerId)) throw new Damaged();
    if (!text(row.level, 40) || !(row.lineM == null || fin(row.lineM))) throw new Damaged();
    return row;
  },
  sessions(raw, now) {
    const row = common(raw, now);
    if (!idOrNull(row.handlerId) || !idOrNull(row.dogId) || !idOrNull(row.layerId)) throw new Damaged();
    if (!text(row.targetId, 40) || !text(row.summary, 4000) || !text(row.name, 400) || !text(row.odour, 400)) throw new Damaged();
    if (!(row.startedAt == null || inEra(row.startedAt))) throw new Damaged();
    if (row.data == null) row.data = {};
    if (!plainObject(row.data)) throw new Damaged();
    const d = row.data;
    for (const k of LINES) line(d[k]);
    if (d.contamination != null) {
      if (!Array.isArray(d.contamination)) throw new Damaged();
      for (const c of d.contamination) { if (!plainObject(c)) throw new Damaged(); line(c.points); }
    }
    for (const k of OBJECTS) if (d[k] != null && !plainObject(d[k])) throw new Damaged();
    return row;
  },
};

/* One graded run as addCalibration writes it: numbers, a side, a word. */
function calRow(r) {
  if (!plainObject(r) || !inEra(r.t)) return null;
  const num = (v) => (fin(v) ? v : null);
  return {
    t: r.t,
    predSide: [-1, 0, 1].includes(r.predSide) ? r.predSide : null,
    mean: num(r.mean), wind: num(r.wind), k: num(r.k),
    stability: typeof r.stability === 'string' ? r.stability.slice(0, 40) : null,
    /* Set aside when its run was deleted (store.js, driftRows). */
    ...(r.skip === true ? { skip: true } : {}),
  };
}

/** A backup file's text, checked, or a thrown Error whose message can be
    shown as it is. What comes back is only rows that passed, and a count of
    those that did not, by table. */
export function readBackup(textIn, { now = Date.now() } = {}) {
  if (typeof textIn !== 'string') throw refuse(NOT_OURS);
  if (textIn.length > BACKUP_MAX_BYTES) throw refuse(TOO_BIG);
  let o;
  try { o = JSON.parse(textIn); } catch { throw refuse(NOT_OURS); }
  if (!plainObject(o)) throw refuse(NOT_OURS);
  /* Version 2 is what "Export everything" wrote before this: the same
     records with no calibration and no name on the file. */
  if (Number.isInteger(o.version) && o.version > BACKUP_VERSION && o.app === APP) throw refuse(NEWER);
  const ours = o.version === BACKUP_VERSION ? o.app === APP : o.version === 2;
  if (!ours) throw refuse(NOT_OURS);
  if (!BACKUP_TABLES.every(k => o[k] == null || Array.isArray(o[k]))) throw refuse(DAMAGED);
  if (o.calibration != null && !Array.isArray(o.calibration)) throw refuse(DAMAGED);

  const out = { version: o.version, exportedAt: null, damaged: {}, calibration: [], flags: null };
  const at = typeof o.exportedAt === 'string' ? Date.parse(o.exportedAt) : NaN;
  if (inEra(at)) out.exportedAt = at;
  for (const name of BACKUP_TABLES) {
    const rows = o[name] || [];
    if (rows.length > MAX_ROWS[name]) throw refuse(TOO_BIG);
    const byId = new Map();
    let bad = 0;
    for (const raw of rows) {
      /* A deletion is this file's bookkeeping, not a record: a restore never
         takes anything off the phone. */
      if (plainObject(raw) && raw.deleted) continue;
      let row;
      try { row = CLEAN[name](raw, now); } catch (e) { if (e instanceof Damaged) { bad++; continue; } throw e; }
      const had = byId.get(row.id);
      if (!had || row.updatedAt > had.updatedAt) byId.set(row.id, row);
    }
    out[name] = [...byId.values()];
    out.damaged[name] = bad;
  }
  const cal = new Map();
  for (const c of (o.calibration || []).slice(0, MAX_ROWS.dogs)) {
    if (!plainObject(c) || !okId(c.id) || !Array.isArray(c.rows) || c.rows.length > MAX_CAL_ROWS) continue;
    const rows = c.rows.map(calRow).filter(Boolean);
    if (rows.length) cal.set(c.id, mergeCalibration(cal.get(c.id), rows));
  }
  out.calibration = [...cal].map(([id, rows]) => ({ id, rows }));
  /* Only the two answers, and only ever switched on. null is a file from
     before backups carried them (planRestore). */
  if (plainObject(o.flags)) out.flags = Object.fromEntries(BACKUP_FLAGS.filter(k => o.flags[k] === true).map(k => [k, true]));
  return out;
}

/* ── What a restore would do ─────────────────────────────────────── */

/** Lay a checked backup over the phone's own tables, without writing
    anything. `phone` holds each table's rows tombstones and all, plus
    `calibration` as [{ id, rows }] and `flags`, the answers set on it.
    For each table: `rows`, what the table would hold; `changed`, the rows
    that are new or different and so must be saved and backed up; and counts
    of what was added, brought up to date, and deleted here since the backup
    (which stays deleted). `flags`: the answers the file switches on that
    the phone has not. */
export function planRestore(phone, file) {
  const plan = { tables: {}, calibration: [], learned: 0, damaged: { ...(file?.damaged || {}) }, flags: [] };
  for (const name of BACKUP_TABLES) {
    const rows = [...(phone?.[name] || [])];
    const at = new Map(rows.map((r, i) => [r?.id, i]));
    const changed = [];
    let added = 0, updated = 0, stayDeleted = 0;
    for (const theirs of file?.[name] || []) {
      const i = at.get(theirs.id);
      const mine = i === undefined ? null : rows[i];
      /* The file is "local" and the phone "remote" to mergeOne, so a tie
         keeps the phone's copy. Sessions keep a field only one copy has, as
         they do when two phones sync. */
      const { keep } = mergeOne(theirs, mine, { union: name === 'sessions' });
      if (keep === mine) { if (mine?.deleted) stayDeleted++; continue; }
      if (!mine || mine.deleted) added++; else updated++;
      changed.push(keep);
      if (i === undefined) { at.set(keep.id, rows.length); rows.push(keep); } else rows[i] = keep;
    }
    plan.tables[name] = { rows, changed, added, updated, stayDeleted };
  }

  /* What each dog taught the model comes back for dogs the phone will have. */
  const dogs = new Set(plan.tables.dogs.rows.filter(d => d && !d.deleted).map(d => d.id));
  const mineCal = new Map((phone?.calibration || []).map(c => [c.id, c.rows || []]));
  for (const { id, rows } of file?.calibration || []) {
    if (!dogs.has(id)) continue;
    const had = mineCal.get(id) || [];
    const merged = mergeCalibration(had, rows);
    if (!calibrationDiffers(merged, had)) continue;
    plan.calibration.push({ id, rows: merged });
    plan.learned++;
  }

  const has = (k) => phone?.flags?.[k] === true;
  plan.flags = BACKUP_FLAGS.filter(k => file?.flags?.[k] === true && !has(k));
  /* A backup made before the file carried the answers: a phone left with a
     handler and no dog is someone who only lays trails, since everyone else
     adds a dog before the app opens. Home, where a dog can be added any day,
     is better than a dog form with no way back. */
  if (file && !file.flags && !has('layerOnly')) {
    const live = (name) => plan.tables[name].rows.some(r => r && !r.deleted);
    if (live('handlers') && !live('dogs')) plan.flags.push('layerOnly');
  }
  return plan;
}

const WORDS = { sessions: ['session', 'sessions'], dogs: ['dog', 'dogs'], handlers: ['handler', 'handlers'], layers: ['layer', 'layers'] };
const ORDER = ['sessions', 'dogs', 'handlers', 'layers'];
const count = (name, n) => `${n} ${WORDS[name][n === 1 ? 0 : 1]}`;
const andList = (xs) => (xs.length < 2 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const firstUp = (s) => s.charAt(0).toUpperCase() + s.slice(1);
/* "12 sessions and 2 dogs", and how many that is in all, for the verb. */
function tally(counts) {
  const names = ORDER.filter(n => counts[n] > 0);
  return { words: andList(names.map(n => count(n, counts[n]))), n: names.reduce((a, n) => a + counts[n], 0) };
}
const column = (plan, key) => Object.fromEntries(ORDER.map(n => [n, plan.tables[n]?.[key] ?? 0]));

/** Whether a restore would change anything at all. */
export const restoreChanges = (plan) =>
  ORDER.some(n => plan.tables[n].changed.length > 0) || plan.calibration.length > 0;

/** The question asked before a restore: what it adds, what it brings up to
    date, what it leaves alone and why, and that nothing on the phone goes.
    `when` is the backup's date as the screen writes it. */
export function restoreQuestion(plan, when = '') {
  const adds = tally(column(plan, 'added')).words;
  const ups = tally(column(plan, 'updated')).words;
  const does = [adds && `adds ${adds}`, ups && `brings ${ups} up to date`].filter(Boolean);
  const dogs = plan.learned === 1 ? '1 dog' : `${plan.learned} dogs`;
  const say = [];
  if (does.length) say.push(`It ${andList(does)}.`);
  if (plan.learned) say.push(`It ${does.length ? 'also ' : ''}brings back what the app learned about ${dogs}.`);
  const kept = tally(column(plan, 'stayDeleted'));
  if (kept.n) say.push(`${firstUp(kept.words)} deleted since the backup was made ${kept.n === 1 ? 'stays' : 'stay'} deleted.`);
  const bad = tally(plan.damaged);
  if (bad.n) say.push(`${firstUp(bad.words)} in the file ${bad.n === 1 ? 'is' : 'are'} damaged and left out.`);
  say.push('Nothing on this phone is deleted.');
  return `Restore the backup${when ? ` from ${when}` : ''}? ${say.join(' ')}`;
}

/** What to say when a restore would change nothing. That is not always
    because it is all here already: the file's records may have been deleted
    on this phone since the backup, and a deletion stays, or every row in
    the file may be damaged. Saying "already on this phone" then sent the
    handler looking for a session that is not there. */
export function restoreNothing(plan) {
  const kept = tally(column(plan, 'stayDeleted'));
  const bad = tally(plan.damaged || {});
  const say = [];
  if (kept.n) {
    say.push(`${firstUp(kept.words)} in this backup ${kept.n === 1 ? 'was' : 'were'} deleted since the backup was made, `
      + `so ${kept.n === 1 ? 'it stays' : 'they stay'} deleted.`);
  }
  if (bad.n) say.push(`${firstUp(bad.words)} in the file ${bad.n === 1 ? 'is' : 'are'} damaged and cannot be restored.`);
  return say.length ? say.join(' ') : 'Everything in this backup is already on this phone.';
}
