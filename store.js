/* On-device storage: profiles, targets, sessions. localStorage, one JSON per
   table, no accounts, no sync. The backend is injectable so Node can test the
   whole store against a plain Map — the browser hands in localStorage.

   Mirrors the native app's store (trailcraft-native/src/store/db.ts) so the
   two stay one product: same tables, same remembered choices, same wording. */

import { pathLen } from './geo.js';
import { visible, tombstone, pruneTombstones } from './sync-core.js';

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

/* ── Targets ────────────────────────────────────────────────────────
   What the dog is looking for. Two kinds only, as far as the engine cares:
   a person who walked (a trail with a clock along it) or a hide that was
   placed (a single stationary source with a long dwell). Everything else is
   a label for the handler's records. */
export const TARGETS = [
  { id: 'person',     kind: 'person', label: 'A person',   sub: 'trail, mantrailing or tracking' },
  { id: 'article',    kind: 'hide',   label: 'Article',    sub: 'human-scented object' },
  { id: 'cadaver',    kind: 'hide',   label: 'Cadaver',    sub: 'HRD source' },
  { id: 'narcotics',  kind: 'hide',   label: 'Narcotics',  sub: 'detection hide' },
  { id: 'explosives', kind: 'hide',   label: 'Explosives', sub: 'detection hide' },
  { id: 'firearms',   kind: 'hide',   label: 'Firearms',   sub: 'detection hide' },
  { id: 'sport',      kind: 'hide',   label: 'Sport odour', sub: 'birch, anise, clove, gun oil…' },
  { id: 'other',      kind: 'hide',   label: 'Other',      sub: 'anything else' },
];

export const targetById = (id) => TARGETS.find(t => t.id === id) ?? TARGETS[0];

/* The odours a detection dog is imprinted on, as the certifying bodies name
   them. Labels for the handler's records and nothing more: the engine treats
   every one as a hide. Anything missing can be typed in. */
export const ODOURS = {
  narcotics: {
    ask: 'Which narcotic', name: 'Name the narcotic',
    list: ['Marijuana', 'Hashish', 'Cocaine', 'Crack cocaine', 'Heroin', 'Methamphetamine',
      'MDMA (ecstasy)', 'Amphetamine', 'Fentanyl', 'Opium', 'Ketamine', 'Psilocybin',
      'Synthetic cannabinoids', 'Pseudo training aid'],
  },
  explosives: {
    ask: 'Which explosive', name: 'Name the explosive',
    list: ['Black powder', 'Smokeless powder', 'Pyrodex', 'Dynamite', 'TNT', 'RDX', 'C-4',
      'PETN', 'Det cord', 'Semtex', 'Ammonium nitrate', 'ANFO', 'Emulsion / water gel',
      'TATP', 'HMTD', 'Chlorates', 'Nitromethane', 'Urea nitrate', 'Cast booster', 'Safety fuse'],
  },
};

/** What the record calls the thing searched for: "Narcotics · Cocaine", or
    the handler's own word when they chose Other and named it. */
export const targetText = (s) => {
  const t = targetById(s?.targetId);
  const odour = typeof s?.odour === 'string' ? s.odour.trim() : '';
  if (!odour) return t.label;
  return t.id === 'other' ? odour : `${t.label} · ${odour}`;
};

/** Verbs for the two big buttons and the session sentence. */
export const verbs = (t) => t.kind === 'person'
  ? { lay: 'Lay a trail', laySub: 'walks it', run: 'Run a trail',
      runSub: 'Pick one laid on this phone', setter: 'Who lays the trail' }
  : { lay: 'Set a hide', laySub: 'places it', run: 'Search',
      runSub: 'Scan a hide card, or pick one set on this phone', setter: 'Who sets the hide' };

/* ── Store ──────────────────────────────────────────────────────────
   Tables: handlers [{id,name,photo}], dogs [{id,handlerId,name,photo,level,lineM}],
   layers [{id,name,photo}] (shared across handlers), sessions (newest first).
   kv: lastHandlerId, lastDogId, lastLayerId, lastTargetId, tutorialDone, layerOnly. */

const K = {
  handlers: 'tc.handlers', dogs: 'tc.dogs', layers: 'tc.layers',
  sessions: 'tc.sessions2', kv: 'tc.kv',
};

/** A save that did not happen. `full` means the phone refused for lack of
    room — the one failure a handler can do something about. Thrown, never
    swallowed: a run lost in silence is the worst thing this app could do. */
export class SaveError extends Error {
  constructor(key, cause, chars = 0) {
    super(isQuota(cause) ? 'The phone has no room left to save this' : `Could not save ${key}`);
    this.name = 'SaveError';
    this.key = key;
    this.full = isQuota(cause);
    this.chars = chars;
    this.cause = cause;
  }
}
const isQuota = (e) => !!e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014);

export function createStore(backend) {
  const read = (k, f) => {
    try { return JSON.parse(backend.getItem(k)) ?? f; } catch { return f; }
  };
  const write = (k, v) => {
    const text = JSON.stringify(v);
    try { backend.setItem(k, text); } catch (e) { throw new SaveError(k, e, text.length); }
  };
  /** How much of the phone's room the records take: bytes as the browser
      counts them (two per character), and what the biggest record is. */
  const usage = () => {
    let bytes = 0, biggest = 0;
    for (const k of Object.values(K)) {
      const v = backend.getItem(k);
      if (v == null) continue;
      const b = (k.length + v.length) * 2;
      bytes += b;
      biggest = Math.max(biggest, b);
    }
    return { bytes, biggest };
  };

  /* Anyone listening for changes — the cloud mirror, when signed in. The
     store does not know or care what is listening; it only says what moved. */
  const listeners = new Set();
  const notify = (tableName, record) => { for (const fn of listeners) { try { fn(tableName, record); } catch { /* a listener never breaks a save */ } } };

  /* Every row carries updatedAt, so two phones can agree which edit is newer.
     A removal leaves a tombstone rather than an absence: an absence is
     indistinguishable from "never synced", and the next phone would put the
     deleted row straight back. The app only ever sees live rows. */
  const table = (key, name) => ({
    all: () => visible(read(key, [])),
    raw: () => read(key, []),
    upsert(row) {
      const rows = read(key, []);
      const stamped = { ...row, updatedAt: Date.now() };
      delete stamped.deleted;
      const i = rows.findIndex(r => r.id === row.id);
      if (i >= 0) rows[i] = stamped; else rows.push(stamped);
      write(key, rows);
      notify(name, stamped);
      return stamped;
    },
    remove(id) {
      const gone = tombstone(id);
      write(key, pruneTombstones([...read(key, []).filter(r => r.id !== id), gone]));
      notify(name, gone);
    },
    byId(id) { return visible(read(key, [])).find(r => r.id === id) ?? null; },
    /** Replace everything — used only when the cloud's copy has been merged in. */
    replaceAll(rows) { write(key, pruneTombstones(rows)); },
  });

  const handlers = table(K.handlers, 'handlers');
  const dogs = table(K.dogs, 'dogs');
  const layers = table(K.layers, 'layers');

  const kv = {
    get: (k, f = null) => read(K.kv, {})[k] ?? f,
    set(k, v) { const o = read(K.kv, {}); o[k] = v; write(K.kv, o); },
  };

  const store = {
    handlers, dogs, layers, kv,

    /* Deleting a handler orphans nothing silently: their dogs go with them,
       exactly as the native app does it. */
    deleteHandler(id) {
      handlers.remove(id);
      for (const d of dogs.all().filter(d => d.handlerId === id)) dogs.remove(d.id);
    },

    /* Sessions, newest first. {id, handlerId, dogId, layerId|null, targetId,
       startedAt, summary, data} — `data` carries the trail, track, waypoints,
       weather, hides and verdict, opaque to the store. */
    sessions: () => visible(read(K.sessions, [])),
    rawSessions: () => read(K.sessions, []),
    addSession(s) {
      const all = read(K.sessions, []);
      const stamped = { ...s, updatedAt: Date.now() };
      all.unshift(stamped);
      write(K.sessions, all);
      notify('sessions', stamped);
      return stamped;
    },
    updateSession(id, patch) {
      const all = read(K.sessions, []);
      const i = all.findIndex(s => s.id === id && !s.deleted);
      if (i < 0) return null;
      all[i] = { ...all[i], ...patch, updatedAt: Date.now() };
      write(K.sessions, all);
      notify('sessions', all[i]);
      return all[i];
    },
    deleteSession(id) {
      const gone = tombstone(id);
      write(K.sessions, pruneTombstones([...read(K.sessions, []).filter(s => s.id !== id), gone]));
      notify('sessions', gone);
    },
    /** Replace everything, newest first — used only after a cloud merge. */
    replaceSessions(rows) {
      const sorted = [...rows].sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
      write(K.sessions, pruneTombstones(sorted));
    },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    /** Everything the home screen needs, resolved: the active handler, their
        team, the remembered layer and target — with stale ids healed. */
    snapshot() {
      const hs = handlers.all();
      const handler = hs.find(h => h.id === kv.get('lastHandlerId')) ?? hs[0] ?? null;
      const team = handler ? dogs.all().filter(d => d.handlerId === handler.id) : [];
      const dog = team.find(d => d.id === kv.get('lastDogId')) ?? team[0] ?? null;
      const layer = layers.all().find(l => l.id === kv.get('lastLayerId')) ?? null;
      return {
        handlers: hs, handler, dogs: dogs.all(), team, dog,
        layers: layers.all(), layer,
        target: targetById(kv.get('lastTargetId')),
        /* Remembered per target, so going back to Explosives finds TNT still
           chosen and Other still says what it said. */
        odour: String(kv.get(`odour.${targetById(kv.get('lastTargetId')).id}`) ?? '').trim(),
        /* Seeded from the dog's usual standard, then it is the handler's to
           change for the day — a hot dog can be given a cold trail. */
        level: levelById(kv.get('lastLevel') ?? dog?.level),
        sessions: store.sessions(),
        tutorialDone: !!kv.get('tutorialDone'),
        layerOnly: !!kv.get('layerOnly'),      // here to lay trails for someone else's dog
      };
    },

    /* ── Calibration ─────────────────────────────────────────────────
       Every graded run banks one row: predicted side, observed signed offset,
       wind, stability, and the drift constant that run implies. Nothing is
       fitted until a dog has FIVE — one gusty afternoon must not rewrite the
       model — and then the median replaces the literature default. */
    addCalibration(dogId, row) {
      if (!dogId) return;
      const key = `cal:${dogId}`;
      const rows = kv.get(key, []);
      rows.push(row);
      kv.set(key, rows.slice(-50));
      /* What a dog has taught the model is the one thing here that took
         months of real trails to earn, so it is announced like any row. */
      notify('calibration', { id: dogId, rows: rows.slice(-50), updatedAt: Date.now() });
    },
    calibration(dogId) { return kv.get(`cal:${dogId}`, []); },
    /** Every dog's calibration, for the cloud mirror. Device preferences in kv
        (last dog, last target) are deliberately NOT here: each phone keeps
        its own. */
    allCalibration() {
      const o = read(K.kv, {});
      return Object.keys(o).filter(k => k.startsWith('cal:'))
        .map(k => ({ id: k.slice(4), rows: o[k] }));
    },
    setCalibration(dogId, rows) { kv.set(`cal:${dogId}`, (rows || []).slice(-50)); },
    /** Per-dog metres-per-(m/s) drift constant, or null while under-evidenced. */
    dogDrift(dogId) {
      const ks = kv.get(`cal:${dogId}`, []).map(r => r.k).filter(k => Number.isFinite(k) && k > 0);
      if (ks.length < 5) return null;
      const sorted = [...ks].sort((a, b) => a - b);
      const med = sorted[Math.floor(sorted.length / 2)];
      return Math.min(6, Math.max(0.5, med));   // no single dog rewrites physics
    },

    usage,

    exportAll() {
      return JSON.stringify({
        version: 2, exportedAt: new Date().toISOString(),
        handlers: handlers.all(), dogs: dogs.all(), layers: layers.all(),
        sessions: store.sessions(),
      }, null, 2);
    },

    wipeAll() {
      for (const k of Object.values(K)) backend.removeItem(k);
    },
  };
  return store;
}

/* ── Migration from the map-first app ───────────────────────────────
   The phone in the field already carries a team (tc.team) and trails
   (tc.sessions, mode-based runner/dog pairs). Nothing a handler recorded is
   allowed to vanish under a redesign. Runs once; keyed on the new tables
   being empty while the old ones are not. */
export function migrateV1(backend, store) {
  const read = (k) => { try { return JSON.parse(backend.getItem(k)); } catch { return null; } };
  if (store.handlers.all().length) return 0;          // already on the new model

  let moved = 0;
  const team = read('tc.team');
  let handlerId = null;
  if (team?.handler?.name) {
    handlerId = uid();
    store.handlers.upsert({ id: handlerId, name: team.handler.name, photo: team.handler.photo ?? null });
    store.kv.set('lastHandlerId', handlerId);
    const LVL = { hot: 'Hot', warm: 'Warm', cold: 'Cold' };
    for (const d of team.dogs ?? []) {
      store.dogs.upsert({
        id: d.id || uid(), handlerId, name: d.name, photo: d.photo ?? null,
        level: LVL[d.level] ?? 'Hot', lineM: 10,
      });
    }
    if (team.lastDog) store.kv.set('lastDogId', team.lastDog);
    moved++;
  }

  const old = read('tc.sessions');
  if (Array.isArray(old) && old.length && !store.sessions().length) {
    /* Runner trails become person-target sessions; each dog run folds into the
       trail it worked, so a pair reads as ONE training session, as it was. */
    const runs = old.filter(s => s.mode === 'dog');
    // Old list is newest-first and addSession unshifts, so walk it oldest-first
    // to land the migrated list newest-first again.
    for (const s of old.filter(x => x.mode === 'runner').reverse()) {
      const run = runs.find(r => r.linkTo === s.id);
      const m = Math.round(pathLen(s.points ?? []));
      store.addSession({
        id: s.id, handlerId, dogId: run?.dogId ?? null, layerId: null,
        targetId: 'person', startedAt: s.started,
        summary: run ? `${run.dog ?? 'The dog'} ran this ${m} m trail.` : `${m} m trail laid.`,
        data: {
          trail: s.points, waypoints: s.waypoints ?? [], weather: s.weather ?? null,
          drawn: !!s.drawn, imported: s.imported ?? null,
          track: run?.points ?? null, trackStarted: run?.started ?? null,
          trackWaypoints: run?.waypoints ?? [], klass: run?.klass ?? null,
        },
      });
      moved++;
    }
  }
  return moved;
}

/* ── What a dog has actually done ─────────────────────────────────────
   The record exists so a handler can answer "is this dog getting better?"
   without scrolling. That means counting, not opinion: how many trails, how
   far, how old were they, and what the model has learned from watching.

   Pure, so it can be checked without a phone. */

/* A trail's age at the moment the dog started it decides what KIND of trail
   it was, and those are the words the sport already uses. The boundaries are
   stated here rather than implied, because a handler is entitled to know
   what counts as cold. */
/* ── Trail age, chosen before the work ────────────────────────────────
   What KIND of trail this is going to be. It applies to a person only —
   a hide has no walk behind it to age, it simply sits there from the moment
   it is placed.

   Coldest first, because that is the order a handler thinks in when they are
   deciding how hard to make the day: how far up from the easy end am I
   going? The ages match AGE_BANDS, so what you set out to do and what the
   record says you did are the same words. */
export const LEVELS = [
  { id: 'cold', label: 'Cold', sub: 'hours old',    minutes: 180 },
  { id: 'warm', label: 'Warm', sub: 'up to an hour', minutes: 45 },
  { id: 'hot',  label: 'Hot',  sub: 'minutes old',   minutes: 10 },
];

export const levelById = (id) =>
  LEVELS.find(l => l.id === String(id || '').toLowerCase()) ?? LEVELS[2];

export const AGE_BANDS = [
  { key: 'hot',  label: 'Hot',  under: 30,   blurb: 'under 30 min' },
  { key: 'warm', label: 'Warm', under: 120,  blurb: '30 min – 2 h' },
  { key: 'cold', label: 'Cold', under: Infinity, blurb: 'over 2 h' },
];

export function ageBand(mins) {
  if (!Number.isFinite(mins) || mins < 0) return null;
  return AGE_BANDS.find(b => mins < b.under) ?? AGE_BANDS[AGE_BANDS.length - 1];
}

/** Everything worth showing about one dog's work. `sessions` is newest-first,
    as the store keeps them. Only RUN sessions count — a trail that was laid
    and never worked says nothing about the dog. */
/** Everything the phone knows about a handler's work: the runs they handled
    (a session with a track), the trails they walked themselves (laid with no
    other layer), time on the trail, the age of the trails at the start, the
    dogs they ran, and how far the tracks sat from the line. */
export function handlerStats(handlerId, sessions) {
  const all = (sessions || []).filter(s => s.handlerId === handlerId && s.data);
  const runs = all.filter(s => s.data.track);
  const laid = all.filter(s => s.data.trail && !s.layerId);
  const out = {
    runs: runs.length, laid: laid.length,
    metres: 0, laidMetres: 0, seconds: 0, longest: 0,
    firstAt: null, lastAt: null,
    bands: { hot: 0, warm: 0, cold: 0 }, unknownAge: 0,
    dogs: {}, assisted: 0, blind: 0, medOff: null,
  };
  for (const s of laid) out.laidMetres += pathLenOf(s.data.trail);
  const offs = [];
  for (const s of runs) {
    const tr = s.data.track;
    const len = pathLenOf(tr);
    out.metres += len;
    out.longest = Math.max(out.longest, len);
    if (tr.length > 1 && Number.isFinite(tr[0].t) && Number.isFinite(tr[tr.length - 1].t)) {
      out.seconds += Math.max(0, (tr[tr.length - 1].t - tr[0].t) / 1000);
    }
    const at = s.data.trackStarted ?? s.startedAt;
    out.firstAt = out.firstAt == null ? at : Math.min(out.firstAt, at);
    out.lastAt = out.lastAt == null ? at : Math.max(out.lastAt, at);
    const band = ageBand(s.data.result?.ageMin);
    if (band) out.bands[band.key]++; else out.unknownAge++;
    if (s.dogId) out.dogs[s.dogId] = (out.dogs[s.dogId] || 0) + 1;
    if (s.data.coach) { if (s.data.coach.assisted) out.assisted++; else out.blind++; }
    const r = s.data.result;
    if (r && Number.isFinite(r.medAbs)) offs.push(r.medAbs);
  }
  if (offs.length) { const a = [...offs].sort((x, y) => x - y); out.medOff = a[Math.floor(a.length / 2)]; }
  return out;
}

export function dogStats(dogId, sessions, calibration = []) {
  const runs = (sessions || []).filter(s => s.dogId === dogId && s.data && s.data.track);
  const out = {
    runs: runs.length,
    metres: 0,
    longest: 0,
    firstAt: null,
    lastAt: null,
    bands: { hot: 0, warm: 0, cold: 0 },
    unknownAge: 0,
    targets: {},
    graded: 0,
    meanOffset: null,
    sideAgree: null,
    calRows: (calibration || []).filter(r => Number.isFinite(r?.k) && r.k > 0).length,
  };
  if (!runs.length) return out;

  const offs = [], sides = [];
  for (const s of runs) {
    const len = pathLenOf(s.data.track);
    out.metres += len;
    out.longest = Math.max(out.longest, len);
    const at = s.data.trackStarted ?? s.startedAt;
    out.firstAt = out.firstAt == null ? at : Math.min(out.firstAt, at);
    out.lastAt = out.lastAt == null ? at : Math.max(out.lastAt, at);

    const band = ageBand(s.data.result?.ageMin);
    if (band) out.bands[band.key]++; else out.unknownAge++;

    const t = s.targetId || 'person';
    out.targets[t] = (out.targets[t] || 0) + 1;

    const r = s.data.result;
    if (r && Number.isFinite(r.mean)) { offs.push(Math.abs(r.mean)); out.graded++; }
    if (r && typeof r.sideAgreement === 'number') sides.push(r.sideAgreement);
  }
  if (offs.length) out.meanOffset = offs.reduce((a, b) => a + b, 0) / offs.length;
  if (sides.length) out.sideAgree = sides.reduce((a, b) => a + b, 0) / sides.length;
  return out;
}

/* store.js must not depend on geo.js — the store is about rows, not geometry —
   so the one length it needs is computed here, on the same sphere. */
function pathLenOf(pts) {
  if (!pts || pts.length < 2) return 0;
  const R = 6371000, rad = (d) => d * Math.PI / 180;
  let sum = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const dLat = rad(b.lat - a.lat);
    const dLon = rad(b.lon - a.lon) * Math.cos(rad((a.lat + b.lat) / 2));
    sum += Math.hypot(dLat, dLon) * R;
  }
  return sum;
}

/** A dog's age from its date of birth, so the record stays right without
    anyone remembering to update it. Returns null for a missing or future
    date rather than a number nobody should trust. */
export function dogAge(dobMs, nowMs = Date.now()) {
  if (!Number.isFinite(dobMs) || dobMs > nowMs) return null;
  const d = new Date(dobMs), n = new Date(nowMs);
  let months = (n.getFullYear() - d.getFullYear()) * 12 + (n.getMonth() - d.getMonth());
  if (n.getDate() < d.getDate()) months -= 1;
  if (months < 0) return null;
  const years = Math.floor(months / 12), rem = months % 12;
  return {
    years, months: rem, totalMonths: months,
    text: months === 0 ? 'under a month'
      : years === 0 ? `${rem} mo`
      : rem === 0 ? `${years} yr`
      : `${years} yr ${rem} mo`,
  };
}
