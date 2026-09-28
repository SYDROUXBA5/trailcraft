/* The session list, kept in order.

   A handler with a season behind them has hundreds of sessions, and one long
   column of cards, newest first, stops being a record anyone can find
   anything in. So the list is grouped by day, narrowed by dog, handler or
   folder, and searched by what the handler would remember: the trail's
   name, the dog, who laid it, a note they wrote.

   Everything here is pure (no page, no store), so the rules that decide
   which runs a handler sees can be tested on a laptop. The app builds the
   rows once each time the sessions change, and every tap of a filter or
   letter typed only filters and groups what is already built.

   ── Folders, and where they are kept ────────────────────────────────
   A folder is the handler's own ("Seminar Wells", "Rex – cold trails"). Sync
   carries only handlers, dogs, layers, sessions and calibration, and a new
   table is not wanted. The other places a list of folders could live were
   weighed and turned down:
   - on a handler's record: a phone can hold several handlers, while the
     folders belong to the whole list, and a handler's record is newest-wins
     as a whole, so a folder made on one phone and a photo changed on the
     other would lose one of the two;
   - a reserved record in an existing table: every older build on the
     handler's other phones would show it as a handler, a layer or a run.
   So the folder list is not kept anywhere. It is read off the sessions: each
   one carries the folders it is in, as data.folders [{ id, name, at }], and
   travels with its session through sync, backups and restores. `at` is when
   that name was given, so two phones that disagree about a folder's name
   (one renamed it, the other had not heard) settle on the newest.
   The one thing sessions cannot carry is a folder with nothing in it yet.
   That is held on this phone alone, beside the device's other preferences,
   until a session goes in it (emptyHeld). A folder emptied on another phone
   therefore goes from this one when the change arrives. */

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
const fin = Number.isFinite;

/* ── Matching as a handler types ───────────────────────────────────── */

/* Letters NFD does not take apart. A French or Scandinavian name is typed on
   an English keyboard as often as the other way round. */
const PLAIN = { ø: 'o', ł: 'l', đ: 'd', œ: 'oe', æ: 'ae', ß: 'ss', ı: 'i' };

/** Text as a search compares it: no accents, no capitals, and any run of
    spaces or punctuation as one space, so "rex cold" finds "Rex – cold
    trails" and "o'brien" finds "O’Brien". */
export function fold(text) {
  return String(text ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[øłđœæßı]/g, (c) => PLAIN[c])
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** The words of a search. A session matches when it has every one of them,
    in any order and anywhere in its words. */
export const searchWords = (query) => fold(query).split(' ').filter(Boolean);

/* ── Days and months ───────────────────────────────────────────────── */

const midnight = (t) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };

/** The heading a session sits under: Today, Yesterday, the weekday and date
    for the rest of the last seven days, then one heading a month. Whole
    days either way, so a training day is never split between two headings.
    Days are counted on the phone's own calendar, not in 24-hour steps, which
    a change of the clocks would throw out by an hour. */
export function dayGroup(t, now = Date.now()) {
  if (!fin(t)) return { key: 'none', label: 'Date not known' };
  const d = new Date(t);
  const ago = Math.round((midnight(now) - midnight(t)) / 864e5);
  if (ago >= 7) return { key: `m${d.getFullYear()}-${d.getMonth()}`, label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}` };
  const key = `d${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  if (ago === 0) return { key, label: 'Today' };
  if (ago === 1) return { key, label: 'Yesterday' };
  /* A day ahead of the phone's (a clock put right, a phone across a time
     zone) is named by its date like any recent one, with its year when that
     is not this one. */
  const year = d.getFullYear() !== new Date(now).getFullYear() ? ` ${d.getFullYear()}` : '';
  return { key, label: `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}${year}` };
}

/** Rows as headed groups, in the order the rows came (logRows puts the
    newest first). A heading is never drawn twice. */
export function groupRows(rows) {
  const groups = new Map();
  for (const r of rows || []) {
    const g = r.g ?? { key: 'none', label: 'Date not known' };
    if (!groups.has(g.key)) groups.set(g.key, { key: g.key, label: g.label, rows: [] });
    groups.get(g.key).rows.push(r);
  }
  return [...groups.values()];
}

/* ── Rows: built once for each change to the sessions ──────────────── */

/* A dog or handler as a filter knows it: this phone's own by id, one that
   came in someone else's link by its name, which is all it has. */
const who = (p) => {
  const name = typeof p?.name === 'string' ? p.name.trim() : '';
  const key = typeof p?.id === 'string' && p.id ? p.id : name ? `n:${fold(name)}` : null;
  return key ? { key, name } : null;
};

/* The words a search can find a session by. Not its result sentence: every
   run says "left" or "on the line", and a search for either would find all
   of them. The app keeps no place name, so a place is found by the name
   the trail was given ("Church lane loop"). */
function wordsOf(s, people) {
  const d = s?.data || {};
  const notes = Array.isArray(d.surfFix) ? d.surfFix.map(f => f?.note) : [];
  return fold([s?.name, people?.dog?.name, people?.handler?.name, people?.layer?.name, d.debrief?.note, ...notes]
    .filter(x => typeof x === 'string').join(' '));
}

/** One row per session, newest first, holding everything the list is
    narrowed, searched and grouped by. `peopleOf(s)` gives the dog, handler
    and layer as the app shows them ({ id?, name }). */
export function logRows(sessions, peopleOf = () => ({}), now = Date.now()) {
  const rows = (sessions || []).filter(Boolean).map((s) => {
    const people = peopleOf(s) || {};
    return {
      s, t: fin(s.startedAt) ? s.startedAt : null,
      dog: who(people.dog), handler: who(people.handler),
      folders: foldersOf(s).map(f => f.id),
      words: wordsOf(s, people),
      g: dayGroup(s.startedAt, now),
    };
  });
  /* Newest first, whatever order the sessions were kept in; undated last. */
  return rows.sort((a, b) => (b.t ?? -Infinity) - (a.t ?? -Infinity) || 0);
}

/** The dogs (or handlers) that actually have sessions, by name, each with
    how many. Only these are offered as filters: a dog with no runs would
    only ever narrow the list to nothing. */
export function facets(rows, which) {
  const by = new Map();
  for (const r of rows || []) {
    const p = r[which];
    if (!p?.name) continue;
    const had = by.get(p.key);
    if (had) had.n++; else by.set(p.key, { key: p.key, name: p.name, n: 1 });
  }
  return [...by.values()].sort(byName);
}

/** The rows a filter keeps. The dog, the handler, the folder and the search
    all apply at once: Rex's runs, with Sam handling, in "Seminar Wells". */
export function filterRows(rows, { dog = null, handler = null, folder = null, words = [] } = {}) {
  return (rows || []).filter(r => (!dog || r.dog?.key === dog)
    && (!handler || r.handler?.key === handler)
    && (!folder || r.folders.includes(folder))
    && words.every(w => r.words.includes(w)));
}

/* ── Folders ───────────────────────────────────────────────────────── */

export const FOLDER_NAME_MAX = 40;
const FOLDER_ID = /^[A-Za-z0-9_-]{1,40}$/;

/** A folder's name as it is kept: one line, no spaces at either end. */
export const cleanFolderName = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, FOLDER_NAME_MAX) : '');

const fold1 = (f) => fold(f.name);
function byName(a, b) {
  const x = fold1(a), y = fold1(b);
  return x < y ? -1 : x > y ? 1 : (a.id ?? a.key) < (b.id ?? b.key) ? -1 : 1;
}

/** The folders one session is in, as it carries them. Whatever it carries
    came from a synced record or a backup file, so anything that is not a
    folder is left out rather than trusted, and a folder listed twice is
    counted once, under its newer name. */
export function foldersOf(s) {
  const raw = s?.data?.folders;
  if (!Array.isArray(raw)) return [];
  const by = new Map();
  for (const f of raw) {
    if (!f || typeof f !== 'object' || typeof f.id !== 'string' || !FOLDER_ID.test(f.id)) continue;
    const name = cleanFolderName(f.name);
    if (!name) continue;
    const at = fin(f.at) ? f.at : 0;
    const had = by.get(f.id);
    if (!had || at > had.at) by.set(f.id, { id: f.id, name, at });
  }
  return [...by.values()];
}

export const inFolder = (s, id) => foldersOf(s).some(f => f.id === id);

/** Every folder, by name: those the sessions carry, with how many each
    holds, and the empty ones held on this phone (`held`). */
export function folderList(sessions = [], held = []) {
  const by = new Map();
  const see = (f, n) => {
    const had = by.get(f.id);
    if (!had) { by.set(f.id, { ...f, n }); return; }
    had.n += n;
    if (f.at > had.at) { had.name = f.name; had.at = f.at; }
  };
  for (const s of sessions || []) for (const f of foldersOf(s)) see(f, 1);
  for (const f of foldersOf({ data: { folders: held } })) see(f, 0);
  return [...by.values()].sort(byName);
}

/** A folder already called this, however it is capitalised or accented,
    other than `except`. Two folders both called "Wells" could not be told
    apart in a row of chips. */
export function folderNamed(list, name, except = null) {
  const want = fold(name);
  return (list || []).find(f => f.id !== except && fold(f.name) === want) ?? null;
}

const entry = (f) => ({ id: f.id, name: f.name, at: fin(f.at) ? f.at : 0 });

/** A session's folders with this one added, under the folder's current name. */
export const putIn = (s, folder) => [...foldersOf(s).filter(f => f.id !== folder.id), entry(folder)];
/** A session's folders without this one. */
export const takeOut = (s, id) => foldersOf(s).filter(f => f.id !== id);

/* Changes are [{ id, folders }]: a session and the whole list it now carries,
   so a save lays down one field and nothing else. */

/** Put these sessions in a folder. One already in it is left alone. */
export function putMany(sessions, ids, folder) {
  const want = new Set(ids);
  return (sessions || []).filter(s => want.has(s?.id) && !inFolder(s, folder.id))
    .map(s => ({ id: s.id, folders: putIn(s, folder) }));
}

/** A tap on a folder with sessions chosen: when every one of them is in it
    already, they come out; otherwise the rest go in. `on` says which. */
export function toggleFolder(sessions, ids, folder) {
  const want = new Set(ids);
  const chosen = (sessions || []).filter(s => want.has(s?.id));
  const on = !chosen.every(s => inFolder(s, folder.id));
  const changes = on ? putMany(chosen, ids, folder)
    : chosen.map(s => ({ id: s.id, folders: takeOut(s, folder.id) }));
  return { on, changes };
}

/** A folder renamed: every session in it carries the new name, stamped `at`. */
export function renameIn(sessions, id, name, at) {
  return (sessions || []).filter(s => inFolder(s, id))
    .map(s => ({ id: s.id, folders: foldersOf(s).map(f => (f.id === id ? { id, name, at } : f)) }));
}

/** A folder deleted: every session in it is taken out, and that is all. The
    sessions themselves stay exactly as they are. */
export function dropFrom(sessions, id) {
  return (sessions || []).filter(s => inFolder(s, id)).map(s => ({ id: s.id, folders: takeOut(s, id) }));
}

/** What this phone holds for itself after a change: every folder it knew of
    (`known`, as it now stands) that no session carries. A folder that
    sessions carry is theirs to keep; holding it here as well would bring it
    back after another phone deleted it. */
export function emptyHeld(known, sessions) {
  const carried = new Set();
  for (const s of sessions || []) for (const f of foldersOf(s)) carried.add(f.id);
  const out = new Map();
  for (const f of known || []) {
    if (!f?.id || carried.has(f.id) || !cleanFolderName(f.name)) continue;
    out.set(f.id, entry({ ...f, name: cleanFolderName(f.name) }));
  }
  return [...out.values()];
}
