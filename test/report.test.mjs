/* The deployment report (incident-report.js): an ended incident as a PDF,
   a GPX of the K9 team's track and the words of a replay video. A pretend
   incident is run from start to end on the pretend squad, and a real-shaped
   one is built as the cloud would hand it back, and both are turned into
   files here. Nothing here touches a screen or the cloud. */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSim, callSignsOf, RECORD_SAYS, RECORD_NOTE, pretendRecord, DEMO_LABEL } from '../public/squad.js';
import { createSimIncident, buildReplay, cleanIncident, incidentDoc, logLines, standingOf, SCENE_NOTE,
         scentStart } from '../public/incident.js';
import { reportDoc, reportShapes, reportGpx, reportFileBase, reportClipWords, reportClipMarks, reportScene,
         reportHeadline, conditionsSection, cleanAir, teamOf, k9Track, REPORT_STAMP, PRETEND_MARK, REPORT_NOTE,
         PRETEND_NOTE, MAP_NOTE } from '../public/incident-report.js';
import { buildPdf } from '../public/pdf.js';
import { project, pathLen } from '../public/geo.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log(`  ok  ${name}`); };
const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const bin = (bytes) => Array.from(bytes, b => String.fromCharCode(b)).join('');

/* Words the app never uses about itself (the spec's honest-words rule). */
const OVERCLAIM = /\b(secure|evidence-grade|sealed|CJIS|prediction|predicts?|proof|proves?|certified)\b/i;

/* ── A pretend incident, run to its end ──────────────────────────────── */
const center = { lat: 51.2094, lon: -2.6476 };
const t0 = 1_800_000_000_000;
const sim = createSim({ center, now: t0, seed: 11 });
const lkp = project(sim.unit('sim-1'), 30, 120);
const si = createSimIncident({ sim, lkp, k9Uid: 'sim-1', name: 'Missing <b>walker</b>', now: t0, seed: 5,
  lastSeenAt: t0 - 4 * 60e3, pace: 'walk', k9Record: pretendRecord(0, 'Rex', t0) });
let clock = t0;
while (clock < t0 + 40 * 60e3 && si.phase !== 'found') { clock += 4000; sim.step(clock); si.step(clock); }
// Someone takes a point back: it stays in the report's log, crossed out.
const wid = si.addMark({ kind: 'roadblock', by: 'you', at: clock, lat: center.lat, lon: center.lon });
si.removeMark(wid, 'you', clock + 500);
si.end(clock + 1000);
const rp = si.replay(sim.members());
const names = callSignsOf(sim.members());
const who = (uid) => (uid === 'you' ? 'You' : names.get(uid)?.callSign || 'A member');
const air = cleanAir({ temp: 12, soil_temp: 9, humidity: 81, wind_speed: 4, wind_direction: 225 }, rp.start + 5 * 60e3);
const inside = [{ uid: 'sim-5', callSign: 'Foot 5', m: 262, t: rp.start + 6 * 60e3, at: center }];
const pretend = reportDoc({ rp, who, squad: 'Avon <Police>', air, inside, pretend: true });

const allText = (doc) => [doc.title, doc.eyebrow, doc.headline, doc.meta, doc.mapNote, doc.footer, doc.stamp,
  ...doc.notes, ...doc.sections.flatMap(s => [s.title, s.note, ...s.rows.flatMap(r => [r[0], r[1]])])].filter(Boolean).join('\n');

t('the pretend report says what it is on every page: a draft record, and pretend data', () => {
  assert.equal(pretend.stamp, `${REPORT_STAMP} · ${PRETEND_MARK}`);
  assert.equal(pretend.watermark, PRETEND_MARK);
  assert.ok(pretend.notes.includes(PRETEND_NOTE) && pretend.notes.includes(REPORT_NOTE) && pretend.notes.includes(DEMO_LABEL));
  assert.match(pretend.footer, /Draft record, not an evidence system · PRETEND DATA/);
  const s = bin(buildPdf({ ...pretend, map: null }));
  const pages = (s.match(/\/Type \/Page /g) || []).length;
  assert.ok(pages >= 2, `a report of a whole incident runs over pages (${pages})`);
  assert.equal((s.match(/\(DRAFT RECORD, NOT AN EVIDENCE SYSTEM \xB7 PRETEND DATA\) Tj/g) || []).length, pages, 'the stamp heads every page');
  assert.equal((s.match(/\(PRETEND DATA\) Tj/g) || []).length, pages, 'the pretend word across every page');
});

t('the PDF is still a file every reader opens: each cross-reference lands on its object', () => {
  const s = bin(buildPdf({ ...pretend, map: { aspect: 600 / 340, paths: [{ pts: [[0.1, 0.1], [0.9, 0.9]], stroke: [1, 1, 0], width: 2 }], dots: [] } }));
  const start = Number(s.match(/startxref\n(\d+)\n%%EOF\n$/)[1]);
  const entries = s.slice(start).match(/\d{10} \d{5} [nf] \n/g);
  entries.slice(1).forEach((e, i) => assert.ok(s.startsWith(`${i + 1} 0 obj\n`, Number(e.slice(0, 10))), `object ${i + 1}`));
});

t('it holds everything the spec lists: timings, the K9 team, the scene, weather, units, the map key, the record and the log', () => {
  const titles = pretend.sections.map(s => s.title);
  for (const want of ['The incident', 'From last seen to the dog', 'K9 team', 'Who walked the scene',
    'Officers inside the perimeter', 'Weather and scent when the dog started', 'Units involved', 'On the map at the end', 'Log']) {
    assert.ok(titles.includes(want), `a section "${want}" (has ${titles.join(' | ')})`);
  }
  assert.ok(titles.some(x => /’s record, as it stood when the team was picked$/.test(x)), 'the dog’s record card, frozen');
  assert.equal(pretend.mapNote, MAP_NOTE);
  const units = pretend.sections.find(s => s.title === 'Units involved');
  assert.equal(units.rows.length, rp.units.length, 'every unit with positions');
  assert.equal(units.rows[0][1], 'Command', 'Command first');
  const scene = pretend.sections.find(s => s.title === 'Who walked the scene');
  assert.equal(scene.note, SCENE_NOTE);
  const rec = pretend.sections.find(s => /record/.test(s.title));
  assert.ok(rec.note.includes(RECORD_SAYS) && rec.note.includes(RECORD_NOTE), 'the supervisor decides; a log is not a licence');
  assert.ok(rec.rows.some(r => r[0] === 'From' && /^Pretend/.test(r[1])), 'the pretend record says it is pretend');
  assert.ok(rec.rows.some(r => /^Licence/.test(r[0])));
});

t('the delay is from last seen to the dog at the point, said by position, never "on scent"', () => {
  const sec = pretend.sections.find(s => s.title === 'From last seen to the dog');
  const on = scentStart(k9Track(rp), rp.inc.lkp);
  assert.ok(on, 'the pretend team reached the point');
  assert.match(sec.rows[0][1], /^Last seen, \d\d:\d\d$/);
  assert.ok(sec.rows.some(r => r[0] === 'Delay' && /^about \d+ min$/.test(r[1])), JSON.stringify(sec.rows));
  /* The headline leads with the track and the calls; the delay, which needs
     its explanation, is in the timings section only. */
  assert.match(pretend.headline, /^K9-1 Rex covered [\d.]+ k?m, (no calls|\d+ [a-z -]+(, \d+ [a-z -]+)*)\.$/);
  assert.doesNotMatch(pretend.headline, /after last seen|on scent/i);
  assert.match(sec.note, /not the same as the dog being on scent/);
});

t('the log is the incident’s whole log, a withdrawn point crossed out and kept', () => {
  const log = pretend.sections.find(s => s.title === 'Log');
  assert.equal(log.log, true);
  const want = logLines({ inc: rp.inc, marks: rp.marks, trail: k9Track(rp), who, team: teamOf(rp, who), now: Infinity,
    scene: reportScene(rp, who).started ? reportScene(rp, who).text : '', inside, imperial: false });
  assert.equal(log.rows.length, want.length);
  const off = log.rows.filter(r => r[2]?.struck);
  assert.equal(off.length, rp.marks.filter(m => Number.isFinite(m.withdrawnAt)).length, 'each withdrawn point once');
  assert.ok(off.some(r => /\(withdrawn by You, \d\d:\d\d\)$/.test(r[1])), 'who withdrew it and when');
  assert.ok(log.rows.some(r => /Foot 5 went inside the perimeter, about 260 m in/.test(r[1])), 'the inside alert this device saw');
  const s = bin(buildPdf({ ...pretend, map: null }));
  assert.match(s, /0\.7 w [\d.]+ [\d.]+ m [\d.]+ [\d.]+ l S Q/, 'a struck line is drawn through');
});

t('the weather is the forecast held when the dog started, or plainly not recorded', () => {
  const sec = conditionsSection(air);
  assert.deepEqual(sec.rows.map(r => r[0]), ['Wind', 'Air', 'Ground', 'Humidity', 'Scent (modelled guide)']);
  assert.equal(sec.rows[0][1], 'from SW, 14 km/h');
  assert.match(sec.note, /Not measured on the ground\./);
  assert.match(conditionsSection(air, true).rows[1][1], /°F/);
  /* The time printed is the forecast's own, beside the dog's: never one
     presented as the other. */
  const fetched = cleanAir({ temp: 12, fetchedAt: air.at - 50 * 60e3 }, air.at);
  assert.equal(fetched.fetchedAt, air.at - 50 * 60e3);
  assert.equal(cleanAir({ temp: 12, fetchedAt: 'soon' }, 5).fetchedAt, null);
  const hm = (t) => `${String(new Date(t).getHours()).padStart(2, '0')}:${String(new Date(t).getMinutes()).padStart(2, '0')}`;
  assert.equal(conditionsSection(fetched).note.split('. ').slice(-2).join('. '),
    `Forecast fetched ${hm(fetched.fetchedAt)} near the last known point (Open-Meteo); the dog reached the point at ${hm(air.at)}. Not measured on the ground.`);
  assert.doesNotMatch(conditionsSection(air).note, /forecast near the last known point at/, 'no forecast time is claimed that is not known');
  const none = conditionsSection(null);
  assert.deepEqual(none.rows, [['Recorded', 'Not on this device']]);
  assert.equal(cleanAir(null, 1), null);
  assert.equal(cleanAir({ temp: 999, humidity: -4 }, 1), null, 'numbers no forecast gives are dropped');
  assert.equal(cleanAir({ temp: 10 }, NaN), null);
  assert.deepEqual(cleanAir(cleanAir({ temp: 10, wind_direction: 90 }, 5), 5), cleanAir({ temp: 10, wind_direction: 90 }, 5), 'kept and read back the same');
});

t('honest words only, in every line of a report', () => {
  assert.doesNotMatch(allText(pretend), OVERCLAIM);
  assert.doesNotMatch(reportGpx(rp, who, { pretend: true }), OVERCLAIM);
  const w = reportClipWords(rp, who, { pretend: true });
  assert.doesNotMatch(JSON.stringify(w), OVERCLAIM);
});

/* ── A real squad's incident, as the cloud hands it back ─────────────── */
const lkp2 = { lat: 51.21, lon: -2.65 };
const s0 = 1_800_100_000_000;
const inc2 = { ...cleanIncident({ ...incidentDoc({ name: 'Burglary', lkp: lkp2, k9Uid: 'h1', uid: 'c1', now: s0, lastSeenAt: s0 - 20 * 60e3,
  pace: 'run', brief: { dir: 'north', desc: 'Black jacket', article: false }, coverUid: 'o1', k9Record: { ...pretendRecord(0, 'Rex', s0), pretend: false } }),
  status: 'ended', endedAt: s0 + 30 * 60e3 }, 'inc1') };
const line = (from, b, n, dt) => Array.from({ length: n }, (_, i) => ({ ...project(from, b, i * 15), t: s0 + 9 * 60e3 + i * dt }));
const tracks = new Map([
  ['h1', { uid: 'h1', pts: line(lkp2, 10, 40, 10e3) }],
  ['o1', { uid: 'o1', pts: [{ ...project(lkp2, 200, 5), t: s0 + 2 * 60e3 }, { ...project(lkp2, 200, 8), t: s0 + 3 * 60e3 }] }],
  ['c1', { uid: 'c1', pts: [{ ...project(lkp2, 90, 400), t: s0 }] }],
]);
const members2 = new Map([
  ['c1', { uid: 'c1', role: 'command', callSign: 'Sgt <1>', name: '', joinedAt: 1 }],
  ['h1', { uid: 'h1', role: 'k9', callSign: 'K9-1', name: '', dog: 'Rex', joinedAt: 2 }],
  ['o1', { uid: 'o1', role: 'officer', callSign: '2A12', name: '', joinedAt: 3 }],
]);
const marks2 = [
  { id: 'a', kind: 'perimeter', by: 'c1', at: s0 + 60e3, pts: [project(lkp2, 0, 300), project(lkp2, 120, 300), project(lkp2, 240, 300), project(lkp2, 0, 300)] },
  { id: 'b', kind: 'perimeter', by: 'c1', at: s0 + 90e3, pts: [project(lkp2, 0, 500), project(lkp2, 180, 500)], withdrawnBy: 'c1', withdrawnAt: s0 + 5 * 60e3 },
  { id: 'c', kind: 'sighting', by: 'o1', at: s0 + 12 * 60e3, lat: project(lkp2, 10, 300).lat, lon: project(lkp2, 10, 300).lon, label: 'Man <running>' },
  { id: 'd', kind: 'lost', by: 'h1', at: s0 + 14 * 60e3, ...project(lkp2, 10, 200) },
];
const rp2 = buildReplay({ inc: inc2, tracks, marks: marks2, members: members2 });
const names2 = callSignsOf(members2);
const who2 = (uid) => names2.get(uid)?.callSign || 'A member';
const real = reportDoc({ rp: rp2, who: who2, squad: 'Somerset K9', air: null, inside: [] });

t('a real squad’s report is stamped a draft record and nothing says pretend', () => {
  assert.equal(real.stamp, REPORT_STAMP);
  assert.equal(real.watermark, null);
  assert.doesNotMatch(allText(real), /pretend/i);
  const s = bin(buildPdf({ ...real, map: null }));
  const pages = (s.match(/\/Type \/Page /g) || []).length;
  assert.equal((s.match(/\(DRAFT RECORD, NOT AN EVIDENCE SYSTEM\) Tj/g) || []).length, pages);
  assert.doesNotMatch(s, /PRETEND DATA/);
});

t('a real report: the delay from last seen, the cover officer, who walked the scene, the brief', () => {
  const rows = Object.fromEntries(real.sections.flatMap(s => s.rows.map(r => [r[0], r[1]])));
  assert.equal(rows.Delay, 'about 29 min', 'last seen 20 min before the opening, the dog at the point 9 min after it');
  assert.equal(rows['Cover officer'], '2A12');
  assert.equal(rows['Before the dog'], '2A12', 'the officer stood on the point before the dog');
  assert.equal(rows['Handler’s brief'], 'Heading north · Black jacket · Scent article: no');
  assert.equal(rows['Last seen'], `${String(new Date(s0 - 20 * 60e3).getHours()).padStart(2, '0')}:${String(new Date(s0 - 20 * 60e3).getMinutes()).padStart(2, '0')}, running`);
  assert.equal(rows.Recorded, 'Not on this device');
  assert.equal(rows.Calls, '1 lost it');
  assert.equal(rows.Perimeter, '1 perimeter line');
  assert.equal(rows.Withdrawn, '1 point, kept in the log');
  /* Never left out: a missing section would read as nobody going inside. */
  const ins = (d) => d.sections.find(s => s.title === 'Officers inside the perimeter');
  assert.deepEqual(ins(real).rows, [['Recorded', 'None seen by this device']], 'watched, and nobody seen inside');
  const unwatched = reportDoc({ rp: rp2, who: who2, squad: 'Somerset K9', air: null, inside: null });
  assert.deepEqual(ins(unwatched).rows, [['Recorded', 'Not on this device']], 'not watched here: says it cannot tell');
  assert.match(ins(unwatched).note, /Only the device showing the command map during the incident keeps this\./);
  assert.deepEqual(ins(reportDoc({ rp: rp2, who: who2 })).rows, [['Recorded', 'Not on this device']], 'by default, not recorded');
  assert.match(real.meta, /^Somerset K9 · \d+ \w{3} \d{4} · \d\d:\d\d–\d\d:\d\d$/);
});

t('ended before the dog got there, the report says it did not reach the point', () => {
  const far = new Map([...tracks, ['h1', { uid: 'h1', pts: line(project(lkp2, 90, 900), 10, 10, 10e3) }]]);
  const rp3 = buildReplay({ inc: inc2, tracks: far, marks: marks2, members: members2 });
  assert.match(reportHeadline(rp3, who2), /^K9-1 Rex covered \d+ m, 1 lost it\. The dog did not reach the last known point\.$/);
  const rows = Object.fromEntries(reportDoc({ rp: rp3, who: who2 }).sections.flatMap(s => s.rows.map(r => [r[0], r[1]])));
  assert.equal(rows['Dog at the last known point'], 'Not reached');
  assert.equal(rows.Delay, undefined);
});

t('the map: other units thin, perimeters (withdrawn dashed), the K9 track on top, then the points', () => {
  const sh = reportShapes(rp2);
  const k9 = sh.paths[sh.paths.length - 1];
  assert.equal(k9.pts.length, tracks.get('h1').pts.length, 'the K9 track is drawn last, over everything');
  const perims = sh.paths.filter(p => p.dash);
  assert.equal(perims.length, 2);
  const red = [0.851, 0.188, 0.145];   // #D93025, the live map's perimeter
  const standing = perims.find(p => p.width === 2.2);
  assert.deepEqual(standing.stroke, red, 'the standing perimeter is the live map’s red');
  assert.deepEqual(standing.dash, [4, 2], 'and dashed, as on the live map and the video');
  assert.deepEqual(standing.casing, [1, 1, 1]);
  const off = perims.find(p => p !== standing);
  assert.deepEqual(off.dash, [1, 2], 'the withdrawn one dotted');
  assert.ok(off.width < 1 && off.stroke.every((v, i) => v > red[i]), 'thin and pale');
  assert.deepEqual(k9.stroke, [0.851, 0.51, 0.169], 'the K9 track orange, as on the live map');
  const other = sh.paths.find(p => p.width === 0.6);
  assert.ok(other, 'another unit’s movements, thin');
  assert.equal(other.casing, undefined, 'with no dark casing');
  const withdrawn = marks2.find(m => Number.isFinite(m.withdrawnAt) && m.pts?.length);
  if (withdrawn) for (const q of withdrawn.pts) assert.ok(sh.points.some(p => p.lat === q.lat && p.lon === q.lon), 'a withdrawn perimeter is framed, not cut off');
  assert.deepEqual(sh.dots[sh.dots.length - 1].p, lkp2, 'the last known point on top');
  assert.match(MAP_NOTE, /^Orange: the K9 team’s track\. Red dashed: perimeter \(faint dotted: withdrawn\)/);
  assert.equal(sh.dots.length, 3, 'the sighting, the lost-it call and the point');
  assert.ok(sh.points.length >= 4 + k9.pts.length, 'the ground round the point and the track');
  assert.ok(sh.points.every(p => Number.isFinite(p.lat) && Number.isFinite(p.lon)));
});

t('the GPX is the K9 track with the point and the points standing, through share.js, typed words escaped', () => {
  const gpx = reportGpx(rp2, who2, {});
  assert.equal((gpx.match(/<trkpt /g) || []).length, tracks.get('h1').pts.length);
  assert.match(gpx, /<metadata>\n\s*<name>Draft · K9-1 Rex — trail<\/name>\n\s*<desc>Draft record, not an evidence system\. Incident track from the handler’s phone\.<\/desc>/);
  assert.match(gpx, /<trk>\s*<name>Draft · K9-1 Rex’s run<\/name>/, 'the track’s own name says draft, where a mapping app shows it');
  assert.match(gpx, /<name>Last known point<\/name>/);
  assert.match(gpx, /<name>Sighting: Man &lt;running&gt;<\/name>/, 'a label typed on another phone, escaped');
  assert.doesNotMatch(gpx, /PRETEND/);
  const fake = reportGpx(rp, who, { pretend: true });
  assert.match(fake, /<desc>Draft record, not an evidence system\. PRETEND DATA\./);
  /* A mapping app shows names and hides descriptions: every name says it. */
  const named = fake.match(/<name>[^<]*<\/name>/g) || [];
  assert.ok(named.length >= 3, 'the title, the track and the waypoints');
  for (const n of named) assert.match(n, /PRETEND/, n);
  assert.equal(reportGpx({ ...rp2, units: rp2.units.filter(u => u.uid !== 'h1') }, who2, {}), null, 'no track, no file');
});

t('file names sort by date and say pretend', () => {
  const d = new Date(s0);
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  assert.equal(reportFileBase(rp2), `trailcraft-${day}-deployment-burglary`);
  assert.match(reportFileBase(rp, { pretend: true }), /^trailcraft-\d{4}-\d\d-\d\d-deployment-missing-b-walker-b-pretend$/);
});

t('the video’s words carry the team, the incident and what the file is on every frame', () => {
  const w = reportClipWords(rp, who, { squad: 'Avon Police', pretend: true });
  assert.equal(w.lines.title, 'K9-1 Rex');
  assert.equal(w.lines.stats, 'Missing <b>walker</b> · Avon Police', 'drawn on a canvas as text, never as HTML');
  assert.equal(w.lines.level, 'PRETEND DATA · Draft record');
  assert.equal(w.closing.sentence, reportHeadline(rp, who));
  assert.equal(w.closing.tag, REPORT_STAMP);
  assert.equal(reportClipWords(rp2, who2).lines.level, REPORT_STAMP);
  const early = reportClipMarks(rp2, s0 + 30e3, who2);
  assert.equal(early[0].kind, 'Last known point');
  assert.ok(early.some(m => m.kind === 'Sgt <1>'), 'units named where they were');
  assert.ok(!early.some(m => m.kind === 'Sighting'), 'a point not yet made is not on the frame');
  const late = reportClipMarks(rp2, s0 + 20 * 60e3, who2);
  assert.ok(late.some(m => m.kind === 'Sighting') && late.some(m => m.kind === 'Lost it'));
  assert.ok(late.filter(m => m.kind === 'Sighting' || m.kind === 'Lost it').every(m => m.t > rp2.start), 'points are named before units');
  assert.ok(late.filter(m => ['Sgt <1>', 'K9-1', '2A12'].includes(m.kind)).every(m => m.t < rp2.start));
});

t('nothing in the report reads the pretend person’s hidden route', () => {
  const src = read('public/incident-report.js');
  assert.doesNotMatch(src, /hiddenRoute|\.hidden\b|scentPath/);
  const ui = read('public/incident-ui.js');
  const from = ui.indexOf('/* ── The deployment report');
  const to = ui.indexOf("/* ── The command map's incident layer");
  assert.ok(from > 0 && to > from);
  assert.doesNotMatch(ui.slice(from, to), /hiddenRoute|scentPath/);
  assert.ok(!('hiddenRoute' in rp), 'the replay the report is made from has no hidden route in it');
});

/* ── Wiring: the screen goes by these functions ──────────────────────── */
const ui = read('public/incident-ui.js');
const app = read('public/app.js');
const fn = (src, head) => { const i = src.indexOf(head); assert.ok(i >= 0, head); const j = src.indexOf('\n}\n', i); return src.slice(i, j + 2); };

t('wired: Deployment report is Command’s, after End, from the ended card and the replay', () => {
  assert.match(ui, /\$\{cmd \? html`<button type="button" class="btn ghost small" data-inc-act="report" data-inc-id="\$\{st\.sim \? 'sim' : lastEnded\.id\}">Deployment report<\/button>` : ''\}/);
  assert.match(ui, /\$\{cmd && r\.source \? html`<button[^`]*data-inc-act="report"[^`]*>Deployment report<\/button>` : ''\}/);
  assert.match(ui, /if \(act === 'report'\) return openReport\(b\.dataset\.incId\);/);
  const open = fn(ui, 'async function openReport(');
  assert.match(open, /rp\.inc\.status !== 'ended'/, 'only once it is ended');
  assert.match(open, /await choose\(/, 'an in-app sheet, never confirm()');
  assert.doesNotMatch(ui, /\bconfirm\(/);
  /* The pretend incident never went to the cloud, and its sheet does not say it did. */
  const body = open.match(/body: pretend \? (`[^`]*`)\s*: (`[^`]*`),/);
  assert.ok(body, 'the sheet has a pretend body of its own');
  assert.doesNotMatch(body[1], /cloud|server|7 days/i);
  assert.match(body[1], /Nothing was sent anywhere\./);
  assert.match(body[2], /cloud is deleted after 7 days/, 'a real squad’s sheet keeps the 7 days');
});

t('wired: who went inside is kept on the device for the report, and an unwatched incident says so', () => {
  const bits = fn(ui, 'function reportBits(');
  assert.match(bits, /inside: insideKept\(rp\.inc\.id\),/);
  const kept = fn(ui, 'function insideKept(');
  assert.match(kept, /if \(I\.inside\.for === id\) return I\.inside\.seen;/);
  assert.match(kept, /: null;/, 'never watched here: null, which the report says');
  const keep = fn(ui, 'function speakInside(');
  assert.match(keep, /const keep = !!v\.inc && !v\.replay && !v\.sim && v\.inc\.status === 'active';/, 'a real incident watched live only');
  assert.doesNotMatch(fn(ui, 'function keepInside('), /put|handle\(/, 'on this device, never the cloud');
});

t('wired: the PDF goes through pdf.js buildPdf, the app’s report map and the app’s file delivery', () => {
  const pdf = fn(ui, 'async function reportPdf(');
  assert.match(pdf, /reportDoc\(b\)/);
  assert.match(pdf, /ctx\.reportMap\?\.\(reportShapes\(b\.rp\)\)/);
  assert.match(pdf, /buildPdf\(\{ \.\.\.doc, map: pic \|\| null \}\)/);
  assert.match(pdf, /ctx\.deliver\(bytes, `\$\{reportFileBase\(b\.rp, b\)\}\.pdf`, 'application\/pdf'\)/);
  assert.match(pdf, /catch \{\n\s*ctx\.toast\('Could not make the report'\);/);
  assert.match(fn(ui, 'async function reportGpxFile('), /ctx\.deliver\(gpx, `\$\{reportFileBase\(b\.rp, b\)\}\.gpx`, 'application\/gpx\+xml'\)/);
  assert.match(app, /deliver: \(bytes, name, type\) => deliverFile\(bytes, name, type\),/);
  assert.match(app, /reportMap: \(shapes\) => incidentReportMap\(shapes\),/);
  const map = fn(app, 'async function incidentReportMap(');
  assert.match(map, /miniView\(/);
  assert.match(map, /staticJpeg\(view\)\.catch\(\(\) => null\)/);
  // deliverFile is the one that reaches the iPhone app's share sheet (native.js shareFile).
  assert.match(fn(app, 'async function deliverFile('), /await shareFile\(bytes, name\)/);
});

t('wired: the video is clip.js recordClip over the incident’s own replay, and saved only on a tap', () => {
  const v = fn(ui, 'async function reportVideo(');
  assert.match(v, /recordClip\(\{/);
  assert.match(v, /paint\(at\) \{ if \(I\.replay === r\) \{ r\.t = at; paintCommandNow\(\); \} \}/);
  assert.match(v, /marks: \(at\) => reportClipMarks\(rp, at, b\.who\)/);
  assert.match(v, /reveal: 'none'/, 'nothing is revealed: there is no hidden answer in a real incident');
  assert.match(v, /r\.fitted = true;[\s\S]*recordClip\(/, 'the replay’s own fit cannot move the camera mid-recording');
  assert.match(v, /if \(await sheet\.stopped !== 'yes'\) return;\n\s*try \{ await ctx\.deliver\(out\.blob/, 'the file leaves only on Save video');
  assert.match(v, /if \(I\.replay === r\) \{ r\.t = was; if \(opened\) r\.fitted = false; paintCommandNow\(\); \}/, 'the replay is put back');
  assert.match(app, /clipLook: \(\) => mapCredit\(\),/);
});

t('wired: the forecast is kept on this device when the dog reaches the point, never in the cloud', () => {
  const note = fn(ui, 'function noteAir(');
  assert.match(note, /scentStart\(v\.trail, inc\.lkp\)/);
  assert.match(note, /ctx\.kv\.set\('squadIncAir'/);
  assert.match(note, /if \(v\.sim\) return;/, 'a pretend incident’s weather is not kept past the session');
  assert.doesNotMatch(note, /put|set[A-Z]\w*\(h,|handle\(/, 'nothing written to the cloud');
  assert.match(fn(ui, 'function paint('), /noteAir\(v\);/);
  assert.match(app, /airNear: \(p\) => \{[\s\S]*?dist\(wxNow\.near, p\) > 5000\) return null;/);
});

t('wired: the sheets put every word in by textContent', () => {
  const sheet = read('public/sheet.js');
  assert.doesNotMatch(sheet, /innerHTML|insertAdjacentHTML/);
  assert.match(sheet, /export function choose\(/);
  assert.match(sheet, /export function progress\(/);
});

t('wired: the report module ships with the app and in the single-file build', () => {
  assert.match(read('public/sw.js'), /'incident-report\.js'/);
  assert.match(read('scripts/build-single.mjs'), /'incident-cloud', 'incident-report', 'sheet'/);
  assert.match(read('package.json'), /node test\/report\.test\.mjs/);
});

console.log(`\n${pass} passed total\n`);
