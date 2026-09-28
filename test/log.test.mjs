/* The session list kept in order (log.js), and the folders that ride on the
   sessions through a save, a sync and a backup.

   What is pinned: a day's runs are never split between two headings; a
   search finds a run however its name was accented or capitalised, and only
   by what a handler would remember; filters combine; a folder is only ever
   read off the sessions (plus the empty ones this phone holds), survives a
   merge of two phones' copies and a restore, and taking a session out of a
   folder is not undone by a phone that had not heard. */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fold, searchWords, dayGroup, groupRows, logRows, facets, filterRows,
         foldersOf, inFolder, folderList, folderNamed, cleanFolderName, FOLDER_NAME_MAX,
         putIn, takeOut, putMany, toggleFolder, renameIn, dropFrom, emptyHeld,
         runAt, midnight, folderPatch, mergeFolders } from '../public/log.js';
import { createStore, runAgain } from '../public/store.js';
import { mergeOne, mergeRecords } from '../public/sync-core.js';
import { readBackup, planRestore } from '../public/backup.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log(`  ok  ${name}`); };

const fakeBackend = () => {
  const m = new Map();
  let writes = 0;
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { writes++; m.set(k, String(v)); },
    removeItem: (k) => m.delete(k),
    writes: () => writes,
  };
};

/* Local times, so the tests say the same thing in any time zone. */
const at = (y, mo, d, h = 10, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const NOW = at(2026, 9, 28, 15);   // Monday 28 September 2026, mid-afternoon

const W = { id: 'fWells', name: 'Seminar Wells', at: 100 };
const C = { id: 'fCold', name: 'Rex – cold trails', at: 200 };
const sess = (id, startedAt, extra = {}) => ({ id, startedAt, handlerId: 'h1', dogId: 'rex', summary: 'Mostly on the line.', data: {}, ...extra });

/* ── Words ─────────────────────────────────────────────────────────── */

t('a search ignores accents, capitals and punctuation, and needs every word', () => {
  assert.equal(fold('  Chloé’s  Église–Loop! '), 'chloe s eglise loop');
  assert.equal(fold('Søren Æbelø Straße'), 'soren aebelo strasse');
  assert.deepEqual(searchWords('  REX,   cold '), ['rex', 'cold']);
  assert.deepEqual(searchWords(''), []);
  assert.deepEqual(searchWords('– · –'), [], 'punctuation alone searches for nothing');
});

/* ── Days and months ───────────────────────────────────────────────── */

t('headings: Today, Yesterday, the weekday and date for the week, then months', () => {
  assert.deepEqual(dayGroup(at(2026, 9, 28, 0, 5), NOW).label, 'Today');
  assert.deepEqual(dayGroup(at(2026, 9, 27, 23, 55), NOW).label, 'Yesterday', 'by the calendar, not 24 hours');
  assert.equal(dayGroup(at(2026, 9, 26, 9), NOW).label, 'Saturday 26 September');
  assert.equal(dayGroup(at(2026, 9, 22, 9), NOW).label, 'Tuesday 22 September', 'six days ago is still a day');
  assert.equal(dayGroup(at(2026, 9, 21, 9), NOW).label, 'September 2026', 'a week ago is under its month');
  assert.equal(dayGroup(at(2026, 8, 30, 9), NOW).label, 'August 2026');
  assert.equal(dayGroup(at(2025, 12, 24, 9), NOW).label, 'December 2025');
  assert.equal(dayGroup(at(2026, 9, 29, 9), NOW).label, 'Tuesday 29 September', 'a day ahead of the phone is named by its date');
  assert.equal(dayGroup(at(2027, 1, 2, 9), at(2026, 12, 31, 12)).label, 'Saturday 2 January 2027', 'with its year when not this one');
  assert.equal(dayGroup(undefined, NOW).label, 'Date not known');
  assert.equal(dayGroup(at(2026, 9, 26, 7), NOW).key, dayGroup(at(2026, 9, 26, 21), NOW).key, 'one key for the whole day');
});

t('a training day stays under one heading, newest first, and no heading is drawn twice', () => {
  const list = [
    sess('a', at(2026, 9, 26, 9)), sess('b', at(2026, 9, 28, 8)), sess('c', at(2026, 9, 26, 16)),
    sess('d', at(2026, 8, 3)), sess('e', at(2026, 9, 27, 12)), sess('f', at(2026, 8, 29)), sess('g', null),
    sess('h', at(2026, 9, 26, 12)),
  ];
  const groups = groupRows(logRows(list, () => ({}), NOW));
  assert.deepEqual(groups.map(g => g.label), ['Today', 'Yesterday', 'Saturday 26 September', 'August 2026', 'Date not known']);
  assert.deepEqual(groups[2].rows.map(r => r.s.id), ['c', 'h', 'a'], 'the day is whole, and newest first within it');
  assert.deepEqual(groups[3].rows.map(r => r.s.id), ['f', 'd']);
  assert.equal(groupRows([]).length, 0);
});

/* ── Rows, filters and search ──────────────────────────────────────── */

const DOGS = { rex: { id: 'rex', name: 'Rex' }, bo: { id: 'bo', name: 'Bø' } };
const HANDLERS = { h1: { id: 'h1', name: 'Sam' }, h2: { id: 'h2', name: 'Chloé' } };
const people = (s) => ({
  dog: DOGS[s.dogId] ?? (s.data?.imported ? s.data.imported.dog : null),
  handler: HANDLERS[s.handlerId] ?? (s.data?.imported ? { name: s.data.imported.handler } : null),
  layer: s.layerId === 'l1' ? { id: 'l1', name: 'Margaux' } : null,
});
const season = [
  sess('s1', at(2026, 9, 28, 9), { name: 'Church lane loop', layerId: 'l1', data: { folders: [W] } }),
  sess('s2', at(2026, 9, 27, 9), { dogId: 'bo', handlerId: 'h2', name: 'Église de Wells', data: { folders: [W, C] } }),
  sess('s3', at(2026, 9, 20, 9), { name: null, data: { debrief: { note: 'Too much traffic near the école' }, folders: [C] } }),
  sess('s4', at(2026, 8, 12, 9), { dogId: 'bo', data: { surfFix: [{ note: 'Wet grass, not tarmac' }] } }),
  sess('s5', at(2026, 8, 2, 9), { dogId: null, handlerId: null, data: { imported: { dog: { name: 'Juno' }, handler: 'Kit' } } }),
];

t('rows are built once, newest first, with every word a handler might search by', () => {
  let asked = 0;
  const rows = logRows([...season].reverse(), (s) => { asked++; return people(s); }, NOW);
  assert.equal(asked, season.length, 'the names are looked up once a session, when the rows are built');
  assert.deepEqual(rows.map(r => r.s.id), ['s1', 's2', 's3', 's4', 's5']);
  filterRows(rows, { words: searchWords('rex') });
  assert.equal(asked, season.length, 'a search does not look anything up again');
  assert.match(rows[0].words, /church lane loop/);
  assert.match(rows[0].words, /margaux/, 'the layer');
  assert.match(rows[2].words, /ecole/, 'the debrief note, unaccented');
  assert.match(rows[3].words, /wet grass/, 'a note on a corrected stretch');
  assert.ok(!/line/.test(rows[0].words), 'not the result sentence, which every run has');
  assert.deepEqual(rows[4].dog, { key: 'n:juno', name: 'Juno' }, 'a run from someone else’s link is known by its names');
  assert.deepEqual(rows[1].folders, ['fWells', 'fCold']);
});

t('only dogs and handlers that have sessions are offered, by name', () => {
  const rows = logRows(season, people, NOW);
  assert.deepEqual(facets(rows, 'dog').map(d => [d.name, d.n]), [['Bø', 2], ['Juno', 1], ['Rex', 2]]);
  assert.deepEqual(facets(rows, 'handler').map(h => h.name), ['Chloé', 'Kit', 'Sam']);
  assert.deepEqual(facets([], 'dog'), []);
});

t('filters combine, and a search matches however it was typed', () => {
  const rows = logRows(season, people, NOW);
  const ids = (o) => filterRows(rows, o).map(r => r.s.id);
  assert.deepEqual(ids({}), ['s1', 's2', 's3', 's4', 's5'], 'nothing chosen, everything shown');
  assert.deepEqual(ids({ dog: 'bo' }), ['s2', 's4']);
  assert.deepEqual(ids({ dog: 'bo', handler: 'h2' }), ['s2'], 'the dog and the handler together');
  assert.deepEqual(ids({ dog: 'rex', handler: 'h2' }), [], 'which can be nothing');
  assert.deepEqual(ids({ folder: 'fWells' }), ['s1', 's2']);
  assert.deepEqual(ids({ folder: 'fCold', dog: 'rex' }), ['s3']);
  assert.deepEqual(ids({ words: searchWords('EGLISE') }), ['s2'], 'no accent typed, none needed');
  assert.deepEqual(ids({ words: searchWords('école traffic') }), ['s3'], 'an accent typed still matches, and every word must');
  assert.deepEqual(ids({ words: searchWords('chloe') }), ['s2'], 'the handler');
  assert.deepEqual(ids({ words: searchWords('juno') }), ['s5'], 'a dog known only by name');
  assert.deepEqual(ids({ words: searchWords('wells'), folder: 'fCold' }), ['s2'], 'a search inside a folder');
  assert.deepEqual(ids({ words: searchWords('nowhere') }), []);
});

/* ── Folders ───────────────────────────────────────────────────────── */

t('what a session carries is read as folders only when it is one', () => {
  const junk = { data: { folders: [W, null, 'fWells', { id: 'bad id!', name: 'X' }, { id: 'fEmpty', name: '   ' },
    { id: 'fWells', name: 'Seminar Wells (old)', at: 50 }, { id: 'fLong', name: 'x'.repeat(90) }, { id: 'fNoAt', name: ' Pairs\n work ' }] } };
  assert.deepEqual(foldersOf(junk), [W, { id: 'fLong', name: 'x'.repeat(FOLDER_NAME_MAX), at: 0 }, { id: 'fNoAt', name: 'Pairs work', at: 0 }]);
  assert.deepEqual(foldersOf({ data: { folders: 'fWells' } }), []);
  assert.deepEqual(foldersOf({}), []);
  assert.deepEqual(foldersOf(null), []);
  assert.equal(cleanFolderName(42), '');
  assert.ok(inFolder(season[1], 'fCold') && !inFolder(season[0], 'fCold'));
});

t('the folder list is read off the sessions, plus the empty ones this phone holds', () => {
  const held = [{ id: 'fNew', name: 'After Christmas', at: 300 }, { id: 'fWells', name: 'Old Wells', at: 1 }];
  const list = folderList(season, held);
  assert.deepEqual(list.map(f => [f.name, f.n]), [['After Christmas', 0], ['Rex – cold trails', 2], ['Seminar Wells', 2]],
    'by name, each with how many it holds; a held copy of a used folder counts nothing');
  assert.deepEqual(folderList([], []), []);
});

t('two phones that disagree about a name settle on the newest', () => {
  const renamed = { ...W, name: 'Wells, spring seminar', at: 900 };
  const a = sess('a', 1, { data: { folders: [W] } });          // a phone that had not heard of the rename
  const b = sess('b', 2, { data: { folders: [renamed] } });
  assert.deepEqual(folderList([a, b]).map(f => f.name), ['Wells, spring seminar']);
  assert.deepEqual(folderList([b, a]).map(f => f.name), ['Wells, spring seminar'], 'whichever order they come in');
});

t('a folder is never named the same as another, however it is written', () => {
  const list = folderList(season);
  assert.equal(folderNamed(list, 'seminar wells')?.id, 'fWells');
  assert.equal(folderNamed(list, 'REX - COLD TRAILS')?.id, 'fCold', 'a plain hyphen for the dash');
  assert.equal(folderNamed(list, 'Seminar Wells', 'fWells'), null, 'a folder may keep its own name when renamed');
  assert.equal(folderNamed(list, 'Wells'), null);
});

t('putting sessions in, taking them out, renaming and deleting', () => {
  const s = season[0];
  assert.deepEqual(putIn(s, { ...C, n: 2 }), [W, C], 'what is kept is the folder, not its count');
  assert.deepEqual(putIn(s, { ...W, name: 'New name', at: 5 }), [{ ...W, name: 'New name', at: 5 }], 'once, under its current name');
  assert.deepEqual(takeOut(season[1], 'fWells'), [C]);

  assert.deepEqual(putMany(season, ['s1', 's3', 'gone'], C), [{ id: 's1', folders: [W, C] }],
    'only the ones not in it yet, and none that is not there');

  const mixed = toggleFolder(season, ['s1', 's2'], C);
  assert.equal(mixed.on, true, 'some chosen are not in it: the rest go in');
  assert.deepEqual(mixed.changes, [{ id: 's1', folders: [W, C] }]);
  const all = toggleFolder(season, ['s1', 's2'], W);
  assert.equal(all.on, false, 'every one chosen is in it: they come out');
  assert.deepEqual(all.changes, [{ id: 's1', folders: [] }, { id: 's2', folders: [C] }]);

  assert.deepEqual(renameIn(season, 'fCold', 'Cold trails', 777), [
    { id: 's2', folders: [W, { id: 'fCold', name: 'Cold trails', at: 777 }] },
    { id: 's3', folders: [{ id: 'fCold', name: 'Cold trails', at: 777 }] },
  ]);
  assert.deepEqual(dropFrom(season, 'fWells'), [{ id: 's1', folders: [] }, { id: 's2', folders: [C] }],
    'a deleted folder takes nothing with it but itself');
});

t('this phone holds a folder only while nothing carries it', () => {
  const known = [...folderList(season), { id: 'fNew', name: 'After Christmas', at: 300, n: 0 }];
  assert.deepEqual(emptyHeld(known, season), [{ id: 'fNew', name: 'After Christmas', at: 300 }]);
  const emptied = season.map(s => ({ ...s, data: { ...s.data, folders: takeOut(s, 'fCold') } }));
  assert.deepEqual(emptyHeld(known, emptied).map(f => f.id), ['fCold', 'fNew'], 'a folder emptied here stays here');
  assert.deepEqual(emptyHeld(known.filter(f => f.id !== 'fCold'), emptied).map(f => f.id), ['fNew'], 'a deleted one does not');
});

/* ── Saved, synced, backed up ──────────────────────────────────────── */

t('many sessions change in one write, each announced as its own save', () => {
  const backend = fakeBackend();
  const db = createStore(backend);
  for (const s of season) db.addSession(s);
  db.deleteSession('s5');
  const heard = [];
  db.onChange((table, rec) => heard.push([table, rec.id]));
  const before = backend.writes();
  const done = db.updateSessions([
    { id: 's1', patch: { data: { folders: [W, C] } } },
    { id: 's5', patch: { data: { folders: [W] } } },           // deleted: not brought back
    { id: 'nope', patch: { data: { folders: [W] } } },
    { id: 's3', patch: { data: { folders: [] } } },
  ]);
  assert.equal(backend.writes() - before, 1, 'one write for all of them');
  assert.deepEqual(done.map(s => s.id), ['s1', 's3']);
  assert.deepEqual(heard, [['sessions', 's1'], ['sessions', 's3']]);
  const s1 = db.sessions().find(s => s.id === 's1'), s3 = db.sessions().find(s => s.id === 's3');
  assert.deepEqual(s1.data.folders, [W, C]);
  assert.equal(s1.name, 'Church lane loop', 'nothing else moved');
  assert.deepEqual(s3.data.debrief, { note: 'Too much traffic near the école' }, 'data is merged, not replaced');
  assert.deepEqual(s3.data.folders, []);
  assert.ok(s1.updatedAt > 0);
  assert.ok(!db.sessions().some(s => s.id === 's5'));
  assert.deepEqual(db.updateSessions([]), []);
  assert.equal(backend.writes() - before, 1, 'and nothing written when nothing changed');
});

t('a second run of a trail starts in no folder', () => {
  const again = runAgain(season[1], { id: 'x', summary: '' });
  assert.equal(again.data.folders, undefined);
  assert.deepEqual(season[1].data.folders, [W, C], 'the first run keeps its own');
});

t('a session taken out of its folders stays out when two phones’ copies meet', () => {
  const older = { ...sess('s', 1), updatedAt: 1000, data: { folders: [W], weather: { t: 1 } } };
  const emptied = { ...sess('s', 1), updatedAt: 2000, data: { folders: [] } };
  for (const [l, r] of [[older, emptied], [emptied, older]]) {
    const { keep } = mergeOne(l, r, { union: true });
    assert.deepEqual(keep.data.folders, [], 'the newer copy’s empty list is a decision');
    assert.deepEqual(keep.data.weather, { t: 1 }, 'while a field only the older copy has is still kept');
  }
  // A phone on an older build never wrote a list at all: it takes the other's.
  const unaware = { ...sess('s', 1), updatedAt: 3000, name: 'Renamed there', data: {} };
  const { keep } = mergeOne(unaware, older, { union: true });
  assert.deepEqual(keep.data.folders, [W]);
  assert.equal(keep.name, 'Renamed there');
  // Two phones each filing it: the newer list wins, as for any field.
  const here = { ...sess('s', 1), updatedAt: 4000, data: { folders: [W, C] } };
  assert.deepEqual(mergeOne(older, here, { union: true }).keep.data.folders, [W, C]);
  // And whole tables, as a pull merges them.
  const { merged } = mergeRecords([emptied, { ...sess('t', 2), updatedAt: 10, data: { folders: [C] } }], [older], { union: true });
  assert.deepEqual(folderList(merged).map(f => f.id), ['fCold'], 'the folder emptied on one phone is not refilled by the other');
});

t('folders come back with a restored backup, and a restore does not refile what was taken out', () => {
  const home = createStore(fakeBackend());
  for (const s of season) home.addSession(s);
  const text = home.exportAll();

  const fresh = createStore(fakeBackend());
  fresh.restore(readBackup(text));
  const names = (db) => folderList(db.sessions()).map(f => `${f.name}:${f.n}`);
  assert.deepEqual(names(fresh), names(home), 'every folder, with what is in it');

  /* After the backup, s1 is taken out of Seminar Wells; the older file then
     restored over it must leave it out. */
  home.updateSessions([{ id: 's1', patch: { data: { folders: [] } } }]);
  home.restore(readBackup(text));
  assert.deepEqual(home.sessions().find(s => s.id === 's1').data.folders, []);
  assert.deepEqual(names(home), ['Rex – cold trails:2', 'Seminar Wells:1']);
});

t('folders add no synced table, so the cloud rules need nothing new', () => {
  const sync = readFileSync(new URL('../public/sync.js', import.meta.url), 'utf8');
  assert.match(sync, /const TABLES = \['handlers', 'dogs', 'layers', 'sessions'\];/);
  const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
  assert.match(rules, /table in \['handlers', 'dogs', 'layers', 'sessions', 'calibration'\]/);
});

t('a long history is narrowed without being built again', () => {
  const many = Array.from({ length: 600 }, (_, i) => sess(`s${i}`, NOW - i * 3600e3,
    { name: i % 7 ? `Trail ${i}` : `Église ${i}`, dogId: i % 2 ? 'rex' : 'bo', data: { folders: i % 5 ? [] : [W] } }));
  let asked = 0;
  const rows = logRows(many, (s) => { asked++; return people(s); }, NOW);
  const t0 = Date.now();
  for (const q of ['e', 'eg', 'egl', 'egli', 'eglis', 'eglise']) filterRows(rows, { dog: 'bo', words: searchWords(q) });
  const shown = filterRows(rows, { folder: 'fWells', words: searchWords('eglise') });
  assert.equal(asked, 600);
  assert.ok(Date.now() - t0 < 250, 'a search over 600 sessions is quick');
  assert.deepEqual(shown.map(r => r.s.id).slice(0, 2), ['s0', 's35']);
  assert.ok(groupRows(shown).length >= 2);
});

/* ── When it was run, not when it was laid ─────────────────────────── */

t('a trail is listed on the day it was run, however long it was aged', () => {
  /* startedAt is when the trail was laid, and a second run keeps it. The day
     the dog ran it is the day the handler remembers. */
  const a = { ...sess('a', at(2026, 9, 10, 9)), data: { trackStarted: at(2026, 9, 10, 10) } };
  const b = runAgain(a, { id: 'b', summary: '' });
  b.data.trackStarted = NOW - 10 * 60e3;                                   // run again ten minutes ago
  const c = sess('c', NOW - 3 * 3600e3);                                    // laid this morning, not run yet
  const d = { ...sess('d', at(2026, 9, 27, 21)), data: { trackStarted: at(2026, 9, 28, 8) } };   // aged overnight
  const rows = logRows([a, b, c, d], () => ({}), NOW);
  assert.deepEqual(rows.map(r => r.s.id), ['b', 'c', 'd', 'a'], 'newest run first');
  assert.deepEqual(groupRows(rows).map(g => `${g.label}: ${g.rows.map(r => r.s.id)}`),
    ['Today: b,c,d', 'September 2026: a']);
  assert.equal(runAt(b), b.data.trackStarted);
  assert.equal(runAt(c), c.startedAt, 'not run yet: when it was laid');
  assert.equal(runAt({ data: {} }), null);
  // The card shows the same time as the heading it sits under.
  const js = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(js, /<div class="meta"><span>\$\{fmtWhen\(runAt\(s\) \?\? s\.startedAt\)\}<\/span>/);
});

/* ── Folders changed on one phone, something else on the other ─────── */

t('a folder change is not undone by a later edit to something else on a stale copy', () => {
  const G = { id: 'fG', name: 'Gate trails', at: 25 };
  const stale = (extra) => ({ ...sess('s', 1), updatedAt: 40, ...extra,
    data: { folders: [W], foldersAt: 10, debrief: { note: 'Good turn at the gate' } } });
  const cases = [
    ['taken out', [], 'the empty list'],
    ['renamed', [{ ...W, name: 'Wells, spring', at: 30 }], 'the new name'],
    ['filed', [W, G], 'the second folder'],
  ];
  for (const [what, list, keeps] of cases) {
    const here = { ...sess('s', 1), updatedAt: 30, data: { ...folderPatch(list, 30).data } };
    const there = stale(what === 'renamed' ? { name: 'Renamed there' } : {});
    for (const [l, r] of [[here, there], [there, here]]) {
      const { keep, up } = mergeOne(l, r, { union: true });
      assert.deepEqual(keep.data.folders, list, `${what}: ${keeps} stands`);
      assert.equal(keep.data.foldersAt, 30);
      assert.deepEqual(keep.data.debrief, { note: 'Good turn at the gate' }, 'and the later edit is kept too');
      assert.equal(keep.updatedAt, 41, 'stamped newer than both, so every phone takes it');
      assert.equal(up, true);
      if (what === 'renamed') assert.equal(keep.name, 'Renamed there');
    }
    // A backup of the stale copy restored over the phone leaves it alone too.
    const plan = planRestore({ sessions: [here] }, { sessions: [there] });
    assert.deepEqual(plan.tables.sessions.rows[0].data.folders, list, `${what}: a restore does not bring the old list back`);
  }
  // Neither list has a time (saved before lists had one): the newer copy's, as before.
  const older = { ...sess('s', 1), updatedAt: 10, data: { folders: [W] } };
  const newer = { ...sess('s', 1), updatedAt: 20, data: { folders: [] } };
  assert.deepEqual(mergeOne(older, newer, { union: true }).keep.data.folders, []);
  // Saved together, the list and its time; and a second run carries neither.
  assert.deepEqual(folderPatch([W], 5), { data: { folders: [W], foldersAt: 5 } });
  const js = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const save = js.slice(js.indexOf('\nfunction saveFolders('), js.indexOf('\n}', js.indexOf('\nfunction saveFolders(')));
  assert.match(save, /patch: folderPatch\(c\.folders, at\)/);
  assert.match(save, /patchSession\(x, folderPatch\(now\.get\(x\.id\), at\)\)/);
  const again = runAgain({ ...sess('r', 1), data: folderPatch([W], 5).data }, { id: 'r2', summary: '' });
  assert.ok(!('folders' in again.data) && !('foldersAt' in again.data));
});

t('folder names of emoji or symbols alone are told apart; twins can be made one', () => {
  const dog = [{ id: 'x1', name: '🐕' }];
  assert.equal(folderNamed(dog, '🌲'), null, 'a tree is not a dog');
  assert.equal(folderNamed(dog, ' 🐕 ')?.id, 'x1', 'the same emoji is the same folder');
  assert.equal(folderNamed([{ id: 'q', name: '???' }], '!!!'), null);
  assert.equal(folderNamed([{ id: 'q', name: '🐕' }], 'Dog'), null);
  assert.equal(folderNamed([{ id: 'w', name: 'Wells' }], '🐕'), null);
  /* Two phones each made "Wells" before either had heard of the other:
     renaming one to the other's name makes them one folder. */
  const aaa = { id: 'aaa', name: 'Wells', at: 1 }, bbb = { id: 'bbb', name: 'wells', at: 2 };
  const s1 = sess('s1', 1, { data: { folders: [aaa] } });
  const s2 = sess('s2', 2, { data: { folders: [bbb] } });
  const s3 = sess('s3', 3, { data: { folders: [bbb, aaa, C] } });
  assert.equal(folderList([s1, s2]).length, 2);
  const changes = mergeFolders([s1, s2, s3], 'bbb', aaa);
  assert.deepEqual(changes.map(c => c.id), ['s2', 's3'], 'only the sessions in the twin change');
  const after = [s1, ...changes.map(c => ({ ...sess(c.id, 1), data: { folders: c.folders } }))];
  assert.deepEqual(folderList(after).map(f => `${f.name}:${f.n}`), ['Rex – cold trails:1', 'Wells:3']);
  assert.deepEqual(changes[1].folders.map(f => f.id), ['fCold', 'aaa'], 'in each folder once');
});

t('day headings are worked out again once the day has turned', () => {
  /* Rows built at 23:59 call a run at 22:59 Today; five minutes later it is
     Yesterday, and the list has to be built again to say so. */
  const late = at(2026, 9, 28, 23, 59), after = at(2026, 9, 29, 0, 5);
  const run = sess('late', at(2026, 9, 28, 22, 59));
  assert.equal(logRows([run], () => ({}), late)[0].g.label, 'Today');
  assert.equal(logRows([run], () => ({}), after)[0].g.label, 'Yesterday');
  assert.notEqual(midnight(late), midnight(after));
  const js = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const fn = (head) => js.slice(js.indexOf(`\n${head}`), js.indexOf('\n}', js.indexOf(`\n${head}`)));
  assert.match(fn('function renderSessions('), /logRows\(all, peopleFor, now\)[^\n]*day: midnight\(now\)/, 'the rows remember the day they were built on');
  assert.match(fn('function paintLog('), /if \(logIx\.day !== midnight\(Date\.now\(\)\)\) \{ renderSessions\(\); return; \}/,
    'a filter or letter typed after midnight builds them again');
  assert.match(js, /addEventListener\('visibilitychange', \(\) => \{\n  if \(document\.visibilityState === 'visible' && currentScreen === 'scrSessions'\) renderSessions\(\);/,
    'and so does coming back to the phone with the list open');
});

console.log(`\n${pass} passed total\n`);
