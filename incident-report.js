/* The deployment report: an ended incident as a file Command can forward.

   After End, Command taps Deployment report and gets a PDF (the map of the
   trail, perimeter and points; the log; the dog's record card as it was
   frozen when the team was picked; the weather when the dog started; the
   delay from last seen to the dog at the last known point; who walked the
   scene; the units involved), a GPX file of the K9 team's track, and a
   short replay video. All of it is made on this device and saved to it:
   cloud incidents are deleted after seven days, the files are not.

   This half has no screen: it turns the incident's replay (incident.js
   buildReplay) into words, rows and shapes, and is tested in node
   (test/report.test.mjs). pdf.js lays the rows out, share.js writes the
   GPX, clip.js records the video; incident-ui.js puts it together.

   What it is and is not is said on every page: a draft record, not an
   evidence system. Nothing here is sealed, signed or fingerprinted, and a
   pretend incident says PRETEND DATA across every page. Every name and
   label in it was typed by someone (call signs, the incident's name, the
   brief); the PDF and GPX writers escape what they write, and nothing here
   builds HTML. */

import { pathLen, cardinal, fmtSpeed, fmtTemp } from './geo.js';
import { stability } from './field.js';
import { toGpx } from './share.js';
import { ROLES, DEMO_LABEL, recordWords, RECORD_SAYS, RECORD_NOTE, dayWords } from './squad.js';
import { MARKS, INC_COLOURS, countWords, PACES, seenAt, hhmm, elapsedWords, scentStart, briefWords, logLines,
         sceneWalkers, sceneWords, SCENE_NOTE, standingOf, replayAt, ring, aboutWords, metresWords } from './incident.js';

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/** Said at the head of every page, on the video and in the GPX. */
export const REPORT_STAMP = 'Draft record, not an evidence system';
/** Said across every page of a pretend report, and on its video. */
export const PRETEND_MARK = 'PRETEND DATA';
/** What the report is made from, and what it cannot know. */
export const REPORT_NOTE = 'Made on this device from the app’s own positions, marks and forecast. Positions are often 10–30 s old, and a minute or more when a phone is standing still or locked, and 5–20 m off; and officers whose app was off are not in it. The radio log stays the record of what was said.';
export const PRETEND_NOTE = 'Pretend data: every unit, position, call and record in this report was made up on this device for a demonstration.';
/** The key to the map's colours, under it. */
export const MAP_NOTE = 'Orange: the K9 team’s track. Red dashed: perimeter (faint dotted: withdrawn). Grey: other units. Black: last known point. Amber: sighting. Red: roadblock. Teal: rally point. Green, red, blue: indication, lost it, re-found. Purple: article.';

/* ── Who was there ───────────────────────────────────────────────────── */

/** The K9 team as the log names it ("K9-1 Rex"), or ''. */
export function teamOf(rp, who) {
  const k9 = rp.units.find(u => u.uid === rp.inc.k9Uid);
  if (!rp.inc.k9Uid) return '';
  const sign = who(rp.inc.k9Uid);
  return `${sign}${k9?.dog ? ` ${k9.dog}` : ''}`;
}

/** The K9 team's track, oldest first (the replay's whole line for it). */
export const k9Track = (rp) => rp.units.find(u => u.uid === rp.inc.k9Uid)?.pts ?? [];

/** Who walked the scene before the dog reached the last known point, from
    everyone's movements in the replay (incident.js sceneWalkers). */
export function reportScene(rp, who) {
  const on = scentStart(k9Track(rp), rp.inc.lkp);
  const lines = new Map(rp.units.map(u => [u.uid, u]));
  const names = sceneWalkers({ inc: rp.inc, lines, until: on ? on.t : rp.end }).map(w => who(w.uid));
  return { names, started: !!on, text: sceneWords(names, !!on) };
}

/* ── The air when the dog started ────────────────────────────────────── */

/** The forecast this device held near the last known point when the dog
    reached it, kept to the few numbers the report says, or null. */
export function cleanAir(wx, at) {
  if (!wx || typeof wx !== 'object' || !finite(at)) return null;
  const num = (v, lo, hi) => (finite(v) && v >= lo && v <= hi ? v : null);
  const out = {
    at,
    /* When the forecast was fetched, which the report prints: it is not the
       dog's time, and can be up to an hour before it. */
    fetchedAt: finite(wx.fetchedAt) ? wx.fetchedAt : null,
    temp: num(wx.temp, -60, 60),
    soil: num(wx.soil_temp ?? wx.soil, -60, 80),
    humidity: num(wx.humidity, 0, 100),
    windSpeed: num(wx.wind_speed ?? wx.windSpeed, 0, 80),
    windFrom: num(wx.wind_direction ?? wx.windFrom, 0, 360),
  };
  return [out.temp, out.soil, out.humidity, out.windSpeed, out.windFrom].some(v => v != null) ? out : null;
}

/** The weather and scent section: what the forecast said, and what the
    app's scent model makes of the ground against the air. `story`: a
    pretend scenario on a story clock (02:16), whose forecast is the one
    the device held today; the section says so rather than reading as the
    air at the story's time. */
export const STORY_AIR = 'Today’s forecast, used for the demo: not the weather at the story’s time.';
export function conditionsSection(air, imperial = false, { story = false } = {}) {
  const title = story ? 'Weather and scent (today’s forecast, pretend)' : 'Weather and scent when the dog started';
  if (!air) {
    return { title, rows: [['Recorded', 'Not on this device']],
      note: 'This device had no forecast near the last known point when the dog reached it.' };
  }
  const rows = [];
  if (air.windFrom != null || air.windSpeed != null) {
    rows.push(['Wind', [air.windFrom != null ? `from ${cardinal(air.windFrom)}` : null,
      air.windSpeed != null ? fmtSpeed(air.windSpeed, imperial) : null].filter(Boolean).join(', ')]);
  }
  if (air.temp != null) rows.push(['Air', fmtTemp(air.temp, imperial)]);
  if (air.soil != null) rows.push(['Ground', fmtTemp(air.soil, imperial)]);
  if (air.humidity != null) rows.push(['Humidity', `${Math.round(air.humidity)}%`]);
  const st = stability(air.soil, air.temp);
  rows.push(['Scent (modelled guide)', st.label]);
  if (story) return { title, rows: [['Forecast', 'Today’s, not the story’s time'], ...rows], note: `${STORY_AIR} ${st.plain} Not measured on the ground.` };
  const from = air.fetchedAt != null
    ? `Forecast fetched ${hhmm(air.fetchedAt)} near the last known point (Open-Meteo); the dog reached the point at ${hhmm(air.at)}.`
    : `From a forecast this device held near the last known point when the dog reached it at ${hhmm(air.at)} (Open-Meteo).`;
  return { title, rows, note: `${st.plain} ${from} Not measured on the ground.` };
}

/* ── The report's words ──────────────────────────────────────────────── */

const roleWords = (u) => `${ROLES[u.role]?.label ?? 'Officer'}${u.role === 'k9' && u.dog ? ` · ${u.dog}` : ''}`;

/** One line, as the top of the report and the video's closing card say
    it: what the team did, its track and its calls. The delay from last
    seen is in the timings section, where it is explained: on its own at
    the top it is the number a reader is least likely to take on trust (a
    pretend incident's clock is compressed). A dog that never got to the
    point says so. Position only: being at the point is not being on scent. */
export function reportHeadline(rp, who, imperial = false) {
  const team = teamOf(rp, who);
  const track = k9Track(rp);
  /* Ended, a dog that never got there "did not reach" it: the live card's
     "not at the point yet" is for an incident still running. */
  const miss = scentStart(track, rp.inc.lkp) ? '' : ' The dog did not reach the last known point.';
  if (!team) return `${rp.inc.name}: no K9 team on it.${miss}`;
  const m = trailM(rp);
  const calls = ['indication', 'lost', 'refound'].map(k => [k, rp.marks.filter(x => x.kind === k && x.by === rp.inc.k9Uid).length])
    .filter(([, n]) => n).map(([k, n]) => countWords(k, n));
  return `${team} covered ${metresWords(m, imperial)}, ${calls.length ? calls.join(', ') : 'no calls'}.${miss}`;
}

/** How far the K9 team went from the last known point on: the track from
    its first fix there, as the live card counts "of trail". The walk in to
    the point is not trail; a team that never got there counts it all. */
export function trailM(rp) {
  const track = k9Track(rp);
  const on = scentStart(track, rp.inc.lkp);
  return pathLen(track.filter(p => p.t >= (on ? on.t : rp.start) && p.t <= rp.end));
}

/** The PDF's words and rows (pdf.js buildPdf), without the map, which the
    screen side fetches. `who(uid)` names a member; `squad` is the squad's
    name; `air` is cleanAir's; `inside` is each time this device saw a unit
    go inside the perimeter (incident-ui.js), as the log has them, or null
    when this device did not watch the incident's map and so cannot say;
    `pretend` marks every page. */
export function reportDoc({ rp, who, squad = '', air = null, inside = null, imperial = false, pretend = false, story = false }) {
  const inc = rp.inc;
  const track = k9Track(rp);
  const team = teamOf(rp, who);
  const on = scentStart(track, inc.lkp);
  const scene = reportScene(rp, who);
  const end = finite(inc.endedAt) ? inc.endedAt : rp.end;
  const said = finite(inc.lastSeenAt) && inc.lastSeenAt < inc.startedAt;

  const sections = [];
  sections.push({ title: 'The incident', rows: [
    ['Name', inc.name],
    squad ? ['Squad', squad] : null,
    ['Opened', `${dayWords(inc.startedAt)}, ${hhmm(inc.startedAt)}, by ${inc.startedBy ? who(inc.startedBy) : 'Command'}`],
    ['Last seen', said ? `${hhmm(inc.lastSeenAt)}${inc.pace ? `, ${PACES[inc.pace].label.toLowerCase()}` : ''}` : `Not given${inc.pace ? ` · ${PACES[inc.pace].label.toLowerCase()}` : ''}`],
    ['Ended', hhmm(end)],
    ['Length', elapsedWords(end - inc.startedAt)],
    briefWords(inc.brief) ? ['Handler’s brief', briefWords(inc.brief)] : null,
  ].filter(Boolean) });

  sections.push({ title: 'From last seen to the dog', rows: [
    ['Counted from', said ? `Last seen, ${hhmm(inc.lastSeenAt)}` : `The incident opening, ${hhmm(inc.startedAt)}`],
    ['Dog at the last known point', on ? hhmm(on.t) : 'Not reached'],
    on ? ['Delay', `about ${elapsedWords(on.t - seenAt(inc))}`] : null,
  ].filter(Boolean), note: 'From the handler’s phone’s positions: the first one within about 40 m of the point. Being at the point is not the same as the dog being on scent.' });

  const calls = ['indication', 'lost', 'refound'].map(k => [k, rp.marks.filter(m => m.kind === k && m.by === inc.k9Uid).length]);
  sections.push({ title: 'K9 team', rows: [
    ['Team', team || 'None picked'],
    inc.coverUid ? ['Cover officer', who(inc.coverUid)] : null,
    team ? [on ? 'Distance from the point' : 'Distance covered', metresWords(trailM(rp), imperial)] : null,
    team ? ['Calls', calls.some(([, n]) => n) ? calls.filter(([, n]) => n).map(([k, n]) => countWords(k, n)).join(' · ') : 'None'] : null,
  ].filter(Boolean) });

  sections.push({ title: 'Who walked the scene', rows: [
    [scene.started ? 'Before the dog' : 'At the point', scene.names.length ? scene.names.join(', ') : 'Nobody, by the app’s positions'],
  ], note: SCENE_NOTE });

  /* Always said, one way or the other: a section left out reads as "nobody
     went inside", which a device that was not watching cannot say. */
  const ins = (inside || []).filter(w => finite(w.t) && w.t >= inc.startedAt && w.t <= end);
  sections.push(inside == null
    ? { title: 'Officers inside the perimeter', rows: [['Recorded', 'Not on this device']],
        note: 'Only the device showing the command map during the incident keeps this.' }
    : ins.length
      ? { title: 'Officers inside the perimeter', log: true,
          rows: ins.map(w => [hhmm(w.t), `${w.callSign} went inside the perimeter, ${aboutWords(w.m, imperial)} in`]),
          note: 'As this device saw it during the incident, from the app’s positions.' }
      : { title: 'Officers inside the perimeter', rows: [['Recorded', 'None seen by this device']],
          note: 'As this device saw it during the incident, from the app’s positions.' });

  sections.push(conditionsSection(air, imperial, { story: pretend && story }));

  const units = [...rp.units].sort((a, b) => (ROLES[a.role]?.order ?? 9) - (ROLES[b.role]?.order ?? 9)
    || who(a.uid).localeCompare(who(b.uid), undefined, { numeric: true }));
  sections.push({ title: 'Units involved', rows: units.map(u => [who(u.uid), roleWords(u)]),
    note: `${units.length} unit${units.length === 1 ? '' : 's'} with positions from the app during the incident.` });

  const standingNow = standingOf(rp.marks);
  const kinds = ['perimeter', 'roadblock', 'sighting', 'rally', 'article'];
  const left = rp.marks.filter(m => finite(m.withdrawnAt)).length;
  const counts = kinds.map(k => [k, standingNow.filter(m => m.kind === k).length]).filter(([, n]) => n);
  sections.push({ title: 'On the map at the end', rows: [
    ...counts.map(([k, n]) => [MARKS[k].label, countWords(k, n)]),
    left ? ['Withdrawn', `${left} point${left === 1 ? '' : 's'}, kept in the log`] : null,
  ].filter(Boolean) });

  const rec = inc.k9Record;
  if (rec) {
    const k9 = rp.units.find(u => u.uid === inc.k9Uid);
    const w = recordWords(rec, inc.startedAt, k9?.dog ?? null);
    sections.push({ title: `${w.title}, as it stood when the team was picked`, rows: [
      ['From', w.from],
      ...w.rows.map(r => [r.k, r.sub ? `${r.v} · ${r.sub}` : r.v]),
      w.gaps.length ? ['Gaps in the record', w.gaps.join(' ')] : null,
      ['Licence, as typed by the handler', w.lic.text],
    ].filter(Boolean), note: `${RECORD_SAYS} ${RECORD_NOTE}` });
  }

  const log = logLines({ inc, marks: rp.marks, trail: track, who, team, now: Infinity,
    scene: scene.started ? scene.text : '', inside: ins, imperial });
  sections.push({ title: 'Log', log: true,
    rows: log.map(l => [l.time, l.withdrawn ? `${l.text} (${l.withdrawn})` : l.text, l.withdrawn ? { struck: true } : null]) });

  return {
    title: `Deployment report — ${inc.name}`,
    eyebrow: `Trailcraft · deployment report${pretend ? ' · pretend' : ''}`,
    headline: reportHeadline(rp, who, imperial),
    meta: [squad, dayWords(inc.startedAt), `${hhmm(inc.startedAt)}–${hhmm(end)}`].filter(Boolean).join(' · '),
    mapNote: MAP_NOTE,
    sections,
    notes: [pretend ? PRETEND_NOTE : null, REPORT_NOTE, DEMO_LABEL].filter(Boolean),
    footer: `Trailcraft · ${REPORT_STAMP}${pretend ? ` · ${PRETEND_MARK}` : ''}`,
    stamp: pretend ? `${REPORT_STAMP} · ${PRETEND_MARK}` : REPORT_STAMP,
    watermark: pretend ? PRETEND_MARK : null,
    date: inc.startedAt,
  };
}

/* ── The map ─────────────────────────────────────────────────────────── */

const INK = [0.059, 0.122, 0.239];
/* The live map's colours (incident.js INC_COLOURS) as pdf.js takes them,
   so the PDF, the command map and the replay video read alike. */
const rgb = (hex) => [1, 3, 5].map(i => Math.round(parseInt(hex.slice(i, i + 2), 16) / 255 * 1000) / 1000);
const pale = (c, k = 0.55) => c.map(v => Math.round((v + (1 - v) * k) * 1000) / 1000);
const COLOURS = {
  ...Object.fromEntries(Object.entries(INC_COLOURS).map(([k, v]) => [k, rgb(v)])),
  k9: rgb(INC_COLOURS.trail), other: [0.72, 0.75, 0.80],
};

/** The map's lines and dots on the ground ({ lat, lon }), for the screen
    side to project onto its picture: everyone's movements during the
    incident, the perimeters (withdrawn ones dashed), the K9 team's track
    over them, then the points. `points` is what the picture must hold: the
    incident's ground round the last known point, the track and the marks,
    not every patrol driven before it began. */
export function reportShapes(rp) {
  const inc = rp.inc;
  const during = (pts) => pts.filter(p => p.t >= rp.start && p.t <= rp.end);
  const paths = [], dots = [];
  for (const u of rp.units) {
    if (u.uid === inc.k9Uid) continue;
    const pts = during(u.pts);
    /* Thin and uncased: the pretend squad's drives are context, not a web
       of dark lines over the trail. */
    if (pts.length > 1) paths.push({ pts, stroke: COLOURS.other, width: 0.6 });
  }
  const lines = rp.marks.filter(m => MARKS[m.kind]?.line && m.pts?.length > 1);
  for (const m of lines) {
    const off = finite(m.withdrawnAt);
    paths.push(off ? { pts: m.pts, stroke: pale(COLOURS.perimeter), width: 0.9, dash: [1, 2] }
      : { pts: m.pts, stroke: COLOURS.perimeter, casing: [1, 1, 1], width: 2.2, dash: [4, 2] });
  }
  const track = k9Track(rp);
  if (track.length > 1) paths.push({ pts: track, stroke: COLOURS.k9, casing: INK, width: 2.6 });
  for (const m of standingOf(rp.marks)) {
    if (MARKS[m.kind]?.line || !finite(m.lat)) continue;
    const call = MARKS[m.kind]?.k9;
    dots.push({ p: { lat: m.lat, lon: m.lon }, fill: COLOURS[m.kind] ?? INK, rim: [1, 1, 1], r: call ? 3 : 4 });
  }
  dots.push({ p: inc.lkp, fill: COLOURS.lkp, rim: [1, 1, 1], r: 5.5 });
  const points = [...ring(inc.lkp, 250, 4), ...track];
  for (const m of standingOf(rp.marks)) points.push(...(m.pts || (finite(m.lat) ? [m] : [])));
  /* A withdrawn perimeter is drawn too, so it is framed too, not cut off at
     the edge of the picture. */
  for (const m of lines) if (finite(m.withdrawnAt)) points.push(...m.pts);
  return { points: points.map(p => ({ lat: p.lat, lon: p.lon })), paths, dots };
}

/* ── The GPX ─────────────────────────────────────────────────────────── */

/** The K9 team's track as a GPX file, with the last known point, the
    points still standing at the end and the team's calls as waypoints.
    Written by share.js toGpx, as every other GPX the app makes, with what
    the file is said in its description. Null with no track to write. */
export function reportGpx(rp, who, { pretend = false } = {}) {
  const track = k9Track(rp);
  if (track.length < 2) return null;
  const team = teamOf(rp, who) || 'K9 team';
  /* A mapping app shows the names and hides the descriptions (share.js), so
     what the file is goes in the names too: the track and its title always
     say draft, and a pretend file says PRETEND on every name, or on real
     streets it reads as a real deployment. */
  const shown = pretend ? `${PRETEND_MARK.split(' ')[0]} · ${team}` : `Draft · ${team}`;
  const tag = pretend ? `${PRETEND_MARK.split(' ')[0]} · ` : '';
  const wps = [{ lat: rp.inc.lkp.lat, lon: rp.inc.lkp.lon, t: seenAt(rp.inc), kind: `${tag}Last known point` }];
  for (const m of standingOf(rp.marks)) {
    if (MARKS[m.kind]?.line || !finite(m.lat)) continue;
    wps.push({ lat: m.lat, lon: m.lon, t: m.at, kind: `${tag}${MARKS[m.kind].label}${m.label ? `: ${m.label}` : ''}` });
  }
  const gpx = toGpx({ kind: 'trail', dog: { name: shown }, trail: null, track, hides: [], wps, contamination: [],
    laidAt: rp.start });
  /* The words are the app's own and a pretend mark: nothing typed reaches
     the description, so it needs no escaping beyond what toGpx does. */
  const desc = `${REPORT_STAMP}.${pretend ? ` ${PRETEND_MARK}.` : ''} Incident track from the handler’s phone.`;
  return gpx.replace(/(<metadata>\n\s*<name>[^<]*<\/name>\n)/, `$1    <desc>${desc}</desc>\n`);
}

/** A file name that sorts by date: trailcraft-2026-11-05-deployment-missing-person. */
export function reportFileBase(rp, { pretend = false } = {}) {
  const d = new Date(rp.inc.startedAt);
  const day = Number.isFinite(d.getTime())
    ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '';
  const slug = String(rp.inc.name ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return ['trailcraft', day, 'deployment', slug, pretend ? 'pretend' : ''].filter(Boolean).join('-');
}

/* ── The video ───────────────────────────────────────────────────────── */

/** The strips and closing card of the replay video (clip.js host.lines and
    host.closing): the team, the incident and squad, and what the file is,
    on every frame. */
export function reportClipWords(rp, who, { squad = '', pretend = false, imperial = false } = {}) {
  const team = teamOf(rp, who);
  return {
    lines: { title: team || rp.inc.name, stats: [team ? rp.inc.name : null, squad].filter(Boolean).join(' · '),
      level: pretend ? `${PRETEND_MARK} · Draft record` : REPORT_STAMP },
    /* The card's gold line says what the file is; the pretend mark is on
       the line under it, as on every frame before. */
    closing: { sentence: reportHeadline(rp, who, imperial), tag: REPORT_STAMP },
  };
}

/** What the video names on the frame at `at` (clip.js host.marks): the last
    known point, the points standing by then, and each unit where it was.
    The units' names are drawn on the map by the app as DOM pins, which a
    recording of the map's picture does not hold, so the video names them.
    Units carry the incident's opening as their time, so the points are
    named first when the frame is crowded. */
export function reportClipMarks(rp, at, who) {
  const out = [{ kind: 'Last known point', lat: rp.inc.lkp.lat, lon: rp.inc.lkp.lon, t: rp.start }];
  for (const m of standingOf(rp.marks, at)) {
    if (MARKS[m.kind]?.line || !finite(m.lat)) continue;
    out.push({ kind: MARKS[m.kind].label, lat: m.lat, lon: m.lon, t: m.at });
  }
  for (const p of replayAt(rp, at).positions.values()) out.push({ kind: who(p.uid), lat: p.lat, lon: p.lon, t: rp.start - 1 });
  return out;
}
