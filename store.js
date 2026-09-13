/* On-device storage: profiles, targets, sessions. localStorage, one JSON per
   table, no accounts, no sync. The backend is injectable so Node can test the
   whole store against a plain Map — the browser hands in localStorage.

   Mirrors the native app's store (trailcraft-native/src/store/db.ts) so the
   two stay one product: same tables, same remembered choices, same wording. */

import { pathLen } from './geo.js';

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

/** Verbs for the two big buttons and the session sentence. */
export const verbs = (t) => t.kind === 'person'
  ? { lay: 'Lay a trail', laySub: 'walks it', run: 'Run a trail',
      runSub: 'Scan a trail card, or pick one laid on this phone', setter: 'Who lays the trail' }
  : { lay: 'Set a hide', laySub: 'places it', run: 'Search',
      runSub: 'Scan a hide card, or pick one set on this phone', setter: 'Who sets the hide' };

/* ── Store ──────────────────────────────────────────────────────────
   Tables: handlers [{id,name,photo}], dogs [{id,handlerId,name,photo,level,lineM}],
   layers [{id,name,photo}] (shared across handlers), sessions (newest first).
   kv: lastHandlerId, lastDogId, lastLayerId, lastTargetId, tutorialDone. */

const K = {
  handlers: 'tc.handlers', dogs: 'tc.dogs', layers: 'tc.layers',
  sessions: 'tc.sessions2', kv: 'tc.kv',
};

export function createStore(backend) {
  const read = (k, f) => {
    try { return JSON.parse(backend.getItem(k)) ?? f; } catch { return f; }
  };
  const write = (k, v) => backend.setItem(k, JSON.stringify(v));

  const table = (key) => ({
    all: () => read(key, []),
    upsert(row) {
      const rows = read(key, []);
      const i = rows.findIndex(r => r.id === row.id);
      if (i >= 0) rows[i] = row; else rows.push(row);
      write(key, rows);
      return row;
    },
    remove(id) { write(key, read(key, []).filter(r => r.id !== id)); },
    byId(id) { return read(key, []).find(r => r.id === id) ?? null; },
  });

  const handlers = table(K.handlers);
  const dogs = table(K.dogs);
  const layers = table(K.layers);

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
    sessions: () => read(K.sessions, []),
    addSession(s) {
      const all = read(K.sessions, []);
      all.unshift(s);
      write(K.sessions, all);
      return s;
    },
    updateSession(id, patch) {
      const all = read(K.sessions, []);
      const i = all.findIndex(s => s.id === id);
      if (i < 0) return null;
      all[i] = { ...all[i], ...patch };
      write(K.sessions, all);
      return all[i];
    },
    deleteSession(id) { write(K.sessions, read(K.sessions, []).filter(s => s.id !== id)); },

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
        sessions: store.sessions(),
        tutorialDone: !!kv.get('tutorialDone'),
      };
    },

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
