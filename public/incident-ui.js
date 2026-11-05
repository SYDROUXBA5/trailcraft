/* An incident on the squad map: Command starts it, every member is told and
   shown the map, the K9 team's trail and calls appear as they happen, the
   others draw a perimeter and drop points round it, and once it is ended it
   can be played back for the debrief.

   It draws on top of the command map (squad-ui.js onCommandPaint) and works
   the same way for a real squad in the cloud and for the pretend one the
   demo runs on this device. The rules of it are in incident.js, the cloud in
   incident-cloud.js.

   Incident names, call signs and labels were typed on other people's
   phones. They reach the page through textContent, or through html``
   (squad-ui.js), which escapes every value put into it. */

import { isCommand, recordWords, RECORD_SAYS, callSignsOf, roster } from './squad.js';
import { project, dist } from './geo.js';
import { MARKS, countWords, DRAW_TOOLS, RUN_MARKS, LINE_MAX, activeOf, pastOf, trailInfo, aheadLine, elapsedWords, clockWords,
         metresWords, summarise, mayMark, mayUnmark, mayShareRun, trackBuffer, buildReplay, replayAt, createSimIncident,
         cleanIncidentName, callWords, stripWords, quietLines, followPoints, allInView, standingOf, PACES, PACE_KEYS,
         DIR_MAX, DESC_MAX, cleanPaces, cleanBrief, seenAt, lastSeenFrom, hhmm, reachRings, passedLines, warnWords,
         reachWords, onScentWords, briefWords, logLines, ring, scentStart, downwindBand, BAND_WORDS, bandWindWords,
         sceneWalkers, sceneWords, SCENE_NOTE, insideWalkers, insideWords, insideNow, coverWords, aboutWords,
         runShareStep, heldCalls, handlerFrame, frameCamera, darkAt, INC_COLOURS, runSquadOn, CALL_UNDO_MS,
         SCRIPTS, scriptChoices, scriptClock, beatWords, REVEAL_WORDS, REVEAL_NOTE } from './incident.js';
import { initHandler, paintHandler, clearHandler, handlerOn } from './handler-ui.js';
import { startIncident, endIncident, watchIncidents, watchIncident, putMark, withdrawMark, putTrack,
         loadIncident, updateSeen, setCover } from './incident-cloud.js';
import { html, put, onCommandPaint, commandView, onSquadChange, onPositionSent, setViewOverride, squadState,
         openCommand, viewNow, fitOnMap, paintCommandNow, setSimSpeed, simSpeed, setLeadUnit, setCoverUnit, foldPanel, mapPad, onLook, wallOn,
         onWall, onSimStep, restartSim, simPaused, setSimPaused, simJump, nextSimSpeed, simWallsReady } from './squad-ui.js';
import { ask, form, info, choose, progress } from './sheet.js';
import { reportDoc, reportShapes, reportGpx, reportFileBase, reportClipWords, reportClipMarks, cleanAir,
         REPORT_STAMP, PRETEND_MARK } from './incident-report.js';
import { buildPdf } from './pdf.js';
import { recordClip, clipSupport, windLine, creditLine, CLIP, CLIP_SAYS } from './clip.js';

const EMPTY = { type: 'FeatureCollection', features: [] };
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const SIM_ME = 'you';
/* How often a member's movements go to the cloud during an incident: the
   trailing team's often, as everyone watches that line grow; the rest once a
   minute, as nobody looks at those until the debrief. */
const TRAIL_FLUSH_MS = 10e3;
const TRACK_FLUSH_MS = 60e3;

let ctx = null;
const I = {
  sid: null,                // the squad followed
  incidents: new Map(),     // every incident of the squad, active and ended
  active: null,             // the one in force
  marks: new Map(),
  trail: [],                // the K9 team's line
  stopAll: null, stopOne: null,
  seen: new Set(),          // incidents already announced on this phone
  hidden: new Set(),        // banners put away by the person
  sim: null,                // the pretend incident
  simEnded: null,           // the last pretend incident, ended, for its replay
  form: null,               // { name, lkp, k9Uid } while Command fills it in
  tool: null,               // { kind, pts } while drawing
  replay: null,             // { rp, t, playing, speed, timer, scene }
  on: false,                // drawing on the command map
  markers: new Map(),       // mark id → { marker, el, sig }
  pins: new Map(),          // 'lkp' | 'form' → marker
  panelKey: '',
  buf: null, bufFor: null, flushAt: 0,
  run: { for: 0, idx: 0, wps: 0 },
  consent: null,            // the incident this phone's handler pressed Start trailing for
  tick: 0,
  foldedFor: null,          // the incident the phone's panel was folded for, once
  follow: { paused: false, at: 0, for: null },  // the map following the K9 team, until a hand moves it
  said: { for: null, ids: new Set() },          // K9 calls already spoken on this screen
  voice: true,              // the command screen speaks the K9 team's calls
  recOpen: null,            // the dog's record card unfolded on the live card, kept across redraws (null: not yet chosen)
  wallKey: '',
  paces: cleanPaces(null),  // km/h for the reach rings, this device's own guess
  log: [], logKey: '',      // the live log as last drawn, for a tap on a line
  reachTag: null,           // the ring's "rough guide" tag on the map
  bandTag: null,            // the downwind band's "modelled guide" tag
  walked: { for: null, lines: new Map() },     // positions this device saw during the incident (real squad)
  bandLook: null,           // 'day' | 'wall': how the downwind band is drawn now (null: set it again)
  inside: { for: null, ids: new Map(), seen: [] }, // uid → when last inside the perimeter; and each time one went in
  air: new Map(),           // incident id → the forecast held here when the dog reached the point (for the report)
  report: null,             // the deployment report being made: { kind } while one is in hand
  hv: false,                // pretend mode: "Handler's view", what K9-1's phone shows
  hvLayers: null,           // whether the command layers are hidden for it now (null: set them again)
  reveal: null,             // pretend: where the pretend person walked, once asked for after the end
  capKey: '',               // the scenario caption as last drawn
  capOn: false,             // whether a scenario's captions are up (the forecast's line says whose time it is)
};
/* The last pretend incident, ended, with the pretend squad it ran on: kept
   when the map closes, so the debrief replay is not lost to one tap on
   Close. Cleared when a new pretend incident starts. */
let lastSim = null;

const $ = (id) => ctx.$(id);
const map = () => ctx.getMap();
const sq = () => squadState();
const meUid = () => (sq().sim ? SIM_ME : sq().me);
const amCommand = () => !!sq().sim || isCommand(sq().member);
const imperial = () => !!ctx.imperial?.();
const distWords = (m) => metresWords(m, imperial());

/* ── Which incident is on the map ─────────────────────────────────────── */
/** The incident drawn right now: the replay's, the pretend one, or the
    squad's own, with its marks and the trail so far. */
function shown() {
  /* marks: what stands, which the map draws; said: every mark made, the
     withdrawn ones too, which the log keeps crossed out. */
  if (I.replay) {
    const s = I.replay.scene || replayAt(I.replay.rp, I.replay.t);
    return { inc: I.replay.rp.inc, marks: s.marks, said: s.said, trail: s.trail, now: I.replay.t, replay: true };
  }
  if (sq().sim) {
    const si = I.sim;
    return si ? { inc: si.inc, marks: standingOf(si.marks), said: [...si.marks.values()], trail: si.trail, now: viewNow(), sim: true }
              : { inc: null, marks: [], said: [], trail: [], now: viewNow(), sim: true };
  }
  return { inc: I.active, marks: standingOf(I.marks), said: [...I.marks.values()], trail: I.trail, now: Date.now() };
}

/** Who a uid is, in the words of the map: a call sign, with the "(2)" the
    roster gives a second member using the same one (squad.js callSignsOf),
    so the log, the scene line and the cover never show two units as one.
    Worked out once for each members map. */
const marked = new WeakMap();
function who(uid, members) {
  if (uid === SIM_ME && sq().sim) return 'You';
  if (!members?.get?.(uid)) return 'A member';
  let names = marked.get(members);
  if (!names) { names = callSignsOf(members); marked.set(members, names); }
  return names.get(uid)?.callSign || 'A member';
}

/* ── Following the squad's incidents ─────────────────────────────────── */
async function follow(sid) {
  I.stopAll?.(); I.stopAll = null;
  I.stopOne?.(); I.stopOne = null;
  if (I.active) leftHeld(I.active, 'You left the squad.');
  I.incidents = new Map(); I.active = null; I.marks = new Map(); I.trail = [];
  stopContributing();
  /* Out of the squad, the run screen is a training run's again at once:
     with no incident paintRun takes the squad box and its markers away. */
  paintRun();
  I.sid = sid;
  if (!sid) return paintOutside();
  let h;
  try { h = await ctx.handle(); } catch { h = null; }
  if (!h || I.sid !== sid) return;
  I.stopAll = watchIncidents(h, sid, (all) => {
    if (I.sid !== sid) return;
    I.incidents = all;
    const a = activeOf(all);
    if (a?.id !== I.active?.id) setActive(h, sid, a);
    else I.active = a;
    paintOutside();
    if (sq().view) paintCommandNow();
  });
}

function setActive(h, sid, a) {
  const was = I.active;
  I.stopOne?.(); I.stopOne = null;
  if (was) {
    /* The last of this phone's movements goes before the door shuts. */
    flush(true);
    const ended = I.incidents.get(was.id);
    const said = ended?.status === 'ended' ? `${ended.name}: incident ended.` : '';
    if (!leftHeld(was, said) && said) ctx.toast(said.slice(0, -1));
    stopContributing();
  }
  I.active = a;
  I.marks = new Map(); I.trail = [];
  I.tool = null;
  /* The ticks that kept the run screen's squad box fresh stop with the
     incident, so it is taken down here, not left frozen as if live: the
     rest of the run is a training run and looks like one. */
  paintRun();
  if (!a) return;
  I.stopOne = watchIncident(h, sid, a, ({ marks, trail }) => {
    if (I.active?.id !== a.id) return;
    I.marks = marks; I.trail = trail;
    if (sq().view) paintCommandNow();
  });
  startContributing(a);
  announce(a);
}

/* Seen once per phone, so that opening the app again does not throw the
   map up again for an incident already looked at. */
function loadSeen() { try { for (const id of ctx.kv.get('squadIncSeen', []) || []) I.seen.add(id); } catch { /* none */ } }
function saveSeen() { try { ctx.kv.set('squadIncSeen', [...I.seen].slice(-20)); } catch { /* full */ } }

/** A new incident: a banner on every screen, and the map opened, unless a
    recording is going (a run must not be swept off the screen) or this is
    the phone that started it. */
function announce(a) {
  if (I.seen.has(a.id)) return;
  I.seen.add(a.id); saveSeen();
  if (a.startedBy === sq().me) return;
  navigator.vibrate?.([120, 80, 120]);
  paintBanner();
  if (!ctx.busy() && !sq().view) { openCommand(); setTimeout(fitIncident, 800); }
}

/* ── This phone's share of the incident ──────────────────────────────── */
/* Every member on duty sends their movements, for the replay; the trailing
   team's, which come from the run screen's recording when a run is going
   (it records every few metres, far finer than the duty positions), are
   the trail everyone watches. */
function startContributing(a) {
  I.buf = trackBuffer(a.startedAt);
  I.bufFor = a.id;
  I.run = { for: 0, idx: 0, wps: 0, list: null };
  I.flushAt = Date.now() + TRAIL_FLUSH_MS;
  const fix = sq().fix;
  if (sq().onDuty && fix) I.buf.add({ lat: fix.lat, lon: fix.lon, t: Math.max(fix.at, a.startedAt) });
  clearInterval(I.tick);
  I.tick = setInterval(everySecond, 1000);
}
function stopContributing() {
  clearInterval(I.tick); I.tick = 0;
  I.buf = null; I.bufFor = null;
  I.consent = null;
}
/* A call made in the last few seconds is still in its hold when the
   incident ends or the squad is left. It cannot go now (the rules refuse a
   mark on a closed incident), so it is not tried: it stays in the run's
   own marks, and the handler is told so rather than left thinking the
   squad has it. True when the handler was told. */
function leftHeld(inc, said) {
  if (!sharingRun()) return false;
  const r = runGoing();
  const n = heldCalls(r && I.run?.for === r.startedAt ? { ...I.run, list: r.wps } : I.run, inc.startedAt);
  if (!n) return false;
  ctx.toast(`${said ? `${said} ` : ''}Your last ${n === 1 ? 'call' : `${n} calls`} stayed on this phone, not sent to the squad.`);
  return true;
}

const trailing = () => !!I.active && I.active.k9Uid === sq().me;
/** This phone's run is the incident's trail right now (incident.js mayShareRun). */
const sharingRun = () => mayShareRun({ inc: I.active, me: sq().me, onDuty: sq().onDuty, consent: I.consent });
function runGoing() {
  const r = ctx.runState();
  return r.on && r.kind === 'run' ? r : null;
}

function onSent(fix) {
  if (!I.buf || !sq().onDuty || (sharingRun() && runGoing())) return;
  I.buf.add(fix);
}

function everySecond() {
  const a = I.active;
  if (!a || !I.buf) return;
  /* Off duty, or picked but not yet said yes with Start trailing: the run
     stays on this phone. A call waits out its few seconds of Undo before
     the squad sees it; a run that ends sends the rest; a stretch off duty
     is skipped, never queued (incident.js runShareStep). */
  const sharing = sharingRun();
  const r = sharing ? runGoing() : null;
  const step = runShareStep(I.run, { rec: runGoing(), sharing, onDuty: sq().onDuty,
                                     startedAt: a.startedAt, now: Date.now() });
  I.run = step.run;
  for (const p of step.pts) I.buf.add({ lat: p.lat, lon: p.lon, t: p.t });
  for (const w of step.calls) cloudMark(RUN_MARKS[w.kind], { lat: w.lat, lon: w.lon });
  if (Date.now() >= I.flushAt) {
    I.flushAt = Date.now() + (r ? TRAIL_FLUSH_MS : (trailing() ? TRAIL_FLUSH_MS : TRACK_FLUSH_MS));
    flush();
  }
  paintBanner();
  paintRun();
}

/* ── The handler's run screen during an incident (handler-ui.js) ────────
   The squad's points round the dog, one line of words and the big call
   buttons, on the run screen itself, only while this phone's run is the
   incident's trail. A training run with no incident never gets here: there
   is no incident, so runSquadOn is false and nothing is drawn. */
function paintRun() {
  const r = runGoing();
  const a = I.active;
  if (!runSquadOn({ screen: ctx.screen(), inc: a, sharing: sharingRun(), running: r })) {
    if (handlerOn() === 'run') clearHandler();
    return;
  }
  const st = sq();
  const me = r.pts.length ? r.pts[r.pts.length - 1] : null;
  /* The way the handler is going, from the last stretch of the run. */
  const heading = trailInfo(r.pts.slice(-400), null, Date.now()).heading;
  paintHandler({
    where: 'run', box: $('runSquadBox'), inc: a, marks: standingOf(I.marks), me, heading,
    cover: a.coverUid ? st.positions.get(a.coverUid) ?? null : null,
    coverName: a.coverUid ? who(a.coverUid, st.members) : '',
    now: Date.now(), myUid: st.me, name: (uid) => who(uid, st.members), voice: true,
    /* Dim red by the sun where the handler stands, not by the phone's
       theme: a phone left in dark mode all day keeps its colours. */
    night: darkAt(me, Date.now()),
    /* The box covers the lower part of the map: the run's camera keeps the
       handler above it (app.js runPadding). */
    lift: $('runSquadBox')?.closest?.('.glass-bottom') || $('runSquadBox'),
    call: (key) => ctx.addCall?.(key) ?? null,
    undo: (wp) => undoRunCall(wp),
  });
}
/** Undo on the run screen: only a call the squad has not been sent yet. */
function undoRunCall(wp) {
  const r = runGoing();
  const i = r ? r.wps.indexOf(wp) : -1;
  if (i < 0 || i < I.run.wps || Date.now() - wp.t >= CALL_UNDO_MS) return false;
  return !!ctx.undoCall?.(wp);
}

/** This phone's run is an incident's trail right now: the run screen then
    leaves out "How sure are you?" (call.js asksHowSure). */
export const incidentRunOn = () => !!ctx && !!I.active && sharingRun() && !!runGoing();

async function flush(all = false) {
  const a = I.active;
  const buf = I.buf;
  if (!a || !buf || !buf.pending || I.bufFor !== a.id) return;
  /* Switched off duty: what is waiting stays on the phone. */
  if (!sq().onDuty) return;
  let h;
  try { h = await ctx.handle(); } catch { h = null; }
  if (!h) return;
  const m = sq().member;
  for (const doc of buf.take()) {
    putTrack(h, I.sid, a.id, doc, { callSign: m?.callSign || '', role: m?.role || 'officer' })
      .catch(() => { if (!all) buf.again(doc.n); });
  }
}

/* ── Doing things ─────────────────────────────────────────────────────── */
async function cloudMark(kind, geom, label = null) {
  const a = I.active;
  if (!a) return;
  try {
    const h = await ctx.handle();
    if (!h) throw new Error('Sign in first');
    await putMark(h, I.sid, a.id, { kind, ...geom, label });
  } catch (e) {
    ctx.toast(String(e?.code || '').includes('permission') ? 'The squad refused that mark' : (e?.message || 'Could not add the mark'));
  }
}

function addMark(kind, geom) {
  const v = shown();
  if (!v.inc || v.inc.status !== 'active' || v.replay) return;
  if (v.sim) {
    I.sim.addMark({ kind, by: SIM_ME, at: viewNow(), ...geom });
  } else {
    if (!mayMark(v.inc, meUid(), kind)) return ctx.toast('Only the trailing team calls the scent');
    cloudMark(kind, geom);
  }
  ctx.toast(`${MARKS[kind].label} added`);
  paintCommandNow();
}

/* Taking a mark back withdraws it: it goes off the map and stays in the log,
   crossed out, with who withdrew it and when (incident-cloud.js withdrawMark). */
async function takeBack(mark, about = '') {
  const v = shown();
  if (v.replay || !mayUnmark(mark, meUid(), amCommand())) return;
  const body = `${about ? `${about}. ` : ''}It comes off the map and stays in the incident log, crossed out.`;
  if (!await ask({ title: `Withdraw this ${(MARKS[mark.kind].one || MARKS[mark.kind].label).toLowerCase()}?`, body, yes: 'Withdraw', danger: true })) return;
  /* The sheet was up a while: the incident may have ended under it. */
  if (shown().inc?.id !== v.inc?.id || v.inc?.status !== 'active') return;
  if (v.sim) { I.sim.removeMark(mark.id, SIM_ME, viewNow()); paintCommandNow(); return; }
  try {
    const h = await ctx.handle();
    await withdrawMark(h, I.sid, v.inc.id, mark.id);
  } catch { ctx.toast('Could not withdraw it'); }
}

/* The description is personal data every member reads: said where it is typed. */
const DESC_HINT = 'Every squad member sees this. Keep it short.';

function openForm() {
  const st = commandView();
  /* A new incident begins: the last story's revealed line comes off the map. */
  if (I.reveal) { I.reveal = null; I.panelKey = ''; }
  /* The team to trail: the first K9 handler on duty, if there is one. */
  const k9s = k9Options(st);
  I.form = { name: 'Missing person', lkp: null, k9Uid: k9s.find(k => k.on)?.uid ?? k9s[0]?.uid ?? null,
             seen: '', pace: null, dir: '', desc: '', article: null };
  I.tool = null;
  /* On a phone the panel is short, and the form (with the dog's record
     under the K9 chips) needs it more than the member list does: the list
     folds away, as it does when an incident comes on. */
  if (!window.matchMedia('(min-width: 900px)').matches) foldPanel(true);
  paintCommandNow();
}

function k9Options(st) {
  const out = [];
  for (const m of st.members.values()) {
    if (m.role !== 'k9') continue;
    out.push({ uid: m.uid, callSign: m.callSign, dog: m.dog, on: st.positions.has(m.uid), record: m.record ?? null });
  }
  return out.sort((a, b) => Number(b.on) - Number(a.on) || a.callSign.localeCompare(b.callSign));
}

/* What is typed in the form is read back before the panel is drawn again
   (a tap on a chip redraws it), so nothing typed is lost. */
function readForm(box) {
  const f = I.form;
  if (!f || !box) return;
  const val = (k) => box.querySelector(`[data-inc-${k}]`)?.value;
  for (const [k, field] of [['name', 'name'], ['seen', 'seen'], ['dir', 'dir'], ['desc', 'desc']]) {
    const v = val(field);
    if (v != null) f[k] = v;
  }
}

/* ── The dog's record card ────────────────────────────────────────────────
   The record the handler shared (squad.js dogRecord), shown when Command
   picks the K9 team and copied into the incident as it opens: the debrief
   shows what the team was picked on. It shows the record; the supervisor
   decides. */
/** The picked team's record as it stands now, to be frozen into the incident. */
const frozenRecord = (st, k9Uid) => (k9Uid ? st.members.get(k9Uid)?.record ?? null : null);
/** The card. `frozen`: the copy kept with the incident, read at the moment
    it opened, so "last trained" and the licence chip are as they were then. */
function recordCard(rec, now, { frozen = false, dog = null } = {}) {
  const w = recordWords(rec, now, dog);
  return html`<div class="inc-rec-card">
    <p class="inc-rec-head"><b>${w.title}</b>${w.pretend ? html` <span class="inc-rec-pretend">Pretend</span>` : ''}</p>
    <p class="inc-rec-from">${frozen ? `As it stood when the team was picked. ${w.from}` : w.from}</p>
    ${w.old ? html`<p class="inc-rec-old">${w.old}</p>` : ''}
    <dl class="inc-rec-rows">${w.rows.map(r => html`<div><dt>${r.k}</dt><dd><b>${r.v}</b>${r.sub ? html` <span>${r.sub}</span>` : ''}</dd></div>`)}</dl>
    ${w.gaps.length ? html`<p class="inc-rec-label">Gaps in the record</p><ul class="inc-rec-gaps">${w.gaps.map(g => html`<li>${g}</li>`)}</ul>` : ''}
    <p class="inc-rec-lic inc-lic-${w.lic.cls}"><span>Licence, as typed by the handler</span> ${w.lic.text}</p>
    <p class="inc-rec-says">${RECORD_SAYS}</p>
  </div>`;
}
/** Under the K9 chips while Command fills the form in. */
function pickCardHtml(k9s, uid, now) {
  const k = k9s.find(x => x.uid === uid);
  if (!k) return '';
  if (k.record) return recordCard(k.record, now, { dog: k.dog });
  return html`<p class="inc-hint">${k.callSign} has not shared ${k.dog ? `${k.dog}’s` : 'the dog’s'} record. The handler can share it from the Squad screen.</p>`;
}
/** The frozen copy, folded on the live card and in the replay, with what
    matters most on the fold itself (how many trails, the licence), so it
    is seen even folded. `dog`: the team's dog as the squad knows it. */
function frozenCardHtml(inc, dog = null) {
  const rec = inc?.k9Record;
  if (!rec) return '';
  const w = recordWords(rec, inc.startedAt, dog);
  const lic = w.lic.cls === 'none' ? '' : ` · ${w.lic.text}`;
  return html`<details class="inc-rec"${I.recOpen ? ' open' : ''}><summary>${w.title} · ${rec.trails} trail${rec.trails === 1 ? '' : 's'}${lic}${rec.pretend ? ' (pretend)' : ''}</summary>
    ${recordCard(rec, inc.startedAt, { frozen: true, dog })}</details>`;
}

/* A pretend incident from the form is seeded too: the same last known
   point gives the same story, as a rehearsed one should. */
const FREE_SEED = 3;
async function doStart() {
  const f = I.form;
  if (!f) return;
  const box = $('cmdIncident');
  const err = (t) => { const e = box.querySelector('[data-inc-err]'); if (e) e.textContent = t; };
  readForm(box);
  f.name = cleanIncidentName(f.name);
  if (!f.name) return err('Give the incident a name');
  if (!f.lkp) return err('Tap the map where the person was last seen');
  const st = commandView();
  const now = st.sim ? viewNow() : Date.now();
  /* Empty: last seen as the incident opens. */
  const lastSeenAt = f.seenAt ?? (f.seen ? lastSeenFrom(f.seen, now) : null);
  if (f.seen && lastSeenAt == null) return err('Last seen: a time like 14:05, or leave it empty for now');
  if (Number.isNaN(lastSeenAt)) return err('That time is after now');
  const seen = { lastSeenAt, pace: f.pace, brief: cleanBrief({ dir: f.dir, desc: f.desc, article: f.article }) };
  if (st.sim) {
    const k9Uid = f.k9Uid || 'sim-1';
    I.sim = createSimIncident({ sim: st.sim, lkp: f.lkp, k9Uid, name: f.name, now, wind: ctx.windNear?.(f.lkp) ?? null,
                                seed: FREE_SEED, by: SIM_ME, ...seen, k9Record: frozenRecord(st, k9Uid) });
    /* The last story's ending goes with it: its "where the pretend person
       walked" belongs to that story, and nothing shows it during an incident. */
    I.simEnded = null; lastSim = null; I.reveal = null;
    /* The first pretend incident opens with the dog's record unfolded, so
       the chief sees what the team was picked on whichever button started
       it; after that it stays as the person at the screen left it. */
    if (I.recOpen == null) I.recOpen = true;
    /* Four times real speed: a trail that takes twenty minutes plays out in
       five while the chief watches. The switch beside it goes back to ×1. */
    setSimSpeed(4);
    I.form = null;
    demoBanner(I.sim.inc);
    fitIncident();
    paintCommandNow();
    return;
  }
  const btn = box.querySelector('[data-inc-act="go"]');
  if (btn) btn.disabled = true;
  try {
    const h = await ctx.handle();
    if (!h) throw new Error('Sign in first');
    const inc = await startIncident(h, I.sid, { name: f.name, lkp: f.lkp, k9Uid: f.k9Uid, ...seen, k9Record: frozenRecord(st, f.k9Uid) });
    I.seen.add(inc.id); saveSeen();
    I.form = null;
    fitIncident();
    ctx.toast(`${inc.name} started. Every member is being told`);
    paintCommandNow();
  } catch (e) {
    err(String(e?.code || '').includes('permission') ? 'Only Command can start an incident' : (e?.message || 'Could not start it'));
    if (btn) btn.disabled = false;
  }
}

/* ── The scenario (pretend mode) ─────────────────────────────────────────
   "Start scenario" plays a call-out as a story (incident.js SCRIPTS): the
   pretend squad starts again at the story's time of day, on the same
   ground with the department's own names, and captions say each step in
   police order. The presenter keeps the clock: pause, speed, next step. */
const SCRIPT_SEED_LKP = { brg: 40, m: 70 };
const WALLS_WAIT_MS = 4000;
async function startScenario() {
  const st0 = commandView();
  if (!st0.sim) return;
  const key = await choose({
    title: 'Start scenario',
    body: 'A pretend call-out told step by step, with your department’s names. It plays the same way each time here.',
    options: scriptChoices(),
    note: 'Made up for the demo, on this device only.',
  });
  if (!SCRIPTS[key] || !commandView().sim || I.sim) return;
  /* The story is laid round the buildings, so it waits a few seconds for
     them: laid without, on slow venue Wi-Fi, it would play differently from
     the rehearsal (and walk through houses). Still not in by then, it plays
     the open-ground story, and that one keeps playing even if they come. */
  let ready = !!commandView().sim?.walls;
  if (!ready) {
    const wait = progress({ title: 'Start scenario', body: 'Loading the buildings…', stop: 'Cancel' });
    ready = await Promise.race([simWallsReady(WALLS_WAIT_MS), wait.stopped.then(() => 'stop')]);
    if (ready === 'stop') return;
    wait.close();
  }
  const sc = SCRIPTS[key];
  if (!commandView().sim || I.sim) return;
  const when = scriptClock(key, Date.now());
  const sim = restartSim(when.openAt);
  if (!sim) return;
  closeReplay(false);
  I.simEnded = null; lastSim = null; I.reveal = null;
  /* The last known point is fixed on the ground the squad started round
     (the chief's own place), so a rehearsal and the real showing match. */
  const lkp = project(sim.center, SCRIPT_SEED_LKP.brg, SCRIPT_SEED_LKP.m);
  const st = commandView();
  I.sim = createSimIncident({ sim, lkp, k9Uid: 'sim-1', name: sc.title, now: when.openAt, seed: sc.seed, by: SIM_ME, wind: ctx.windNear?.(lkp) ?? null,
                              lastSeenAt: when.seenAt, pace: sc.pace, brief: sc.brief, k9Record: frozenRecord(st, 'sim-1'), script: key });
  if (I.recOpen == null) I.recOpen = true;
  I.capKey = '';
  /* Four times real speed: the story takes about a quarter of an hour of
     pretend time, so it plays out in four minutes; the presenter can
     pause, step or change it. */
  setSimPaused(false);
  setSimSpeed(4);
  I.form = null;
  I.panelKey = '';
  demoBanner(I.sim.inc);
  /* Drawn first, so the captions are up when the map is fitted round them. */
  paintCommandNow();
  fitIncident();
}
/** Next step: the story played on to its next caption (or a few minutes). */
function nextBeat() {
  const si = I.sim;
  if (!si || !si.script || si.done) return;
  const n = si.beats.length;
  simJump(() => I.sim !== si || si.beats.length > n || si.done);
}
/* The caption box over the map: the story clock, the department and the
   call, the step before (small) and this one, the presenter's controls and
   the demo label. Text only: names in it are the department's own. */
function paintCaption(v, st) {
  const box = $('cmdCap');
  if (!box) return;
  const si = I.sim;
  const on = !!(si && si.script && v.sim && !v.replay && si.inc.status === 'active');
  box.hidden = !on;
  $('scrCommand')?.classList.toggle('cap-on', on);
  if (I.capOn !== on) { I.capOn = on; ctx.storyWeather?.(); }
  if (!on) { I.capKey = ''; return; }
  const sc = SCRIPTS[si.script];
  const clock = hhmm(v.now);
  const cl = $('cmdCapClock');
  if (cl.textContent !== clock) cl.textContent = clock;
  const title = `${st.name} · ${sc.title}, last seen ${sc.seen}`;
  const tl = $('cmdCapTitle');
  if (tl.textContent !== title) tl.textContent = title;
  const team = st.members?.get(si.inc.k9Uid);
  const say = (b) => (b ? beatWords(b, { who: (uid) => who(uid, st.members), dog: team?.dog || '', script: si.script, imperial: imperial() }) : '');
  const last = si.beats[si.beats.length - 1] || null;
  const prev = si.beats[si.beats.length - 2] || null;
  const key = `${si.beats.length}|${say(last)}|${say(prev)}`;
  if (key !== I.capKey) {
    const fresh = !I.capKey.startsWith(`${si.beats.length}|`);
    I.capKey = key;
    $('cmdCapPrev').textContent = say(prev);
    const tx = $('cmdCapText');
    tx.textContent = say(last);
    /* A new step comes in with a short slide (only where motion is on:
       app.css keys it to html[data-motion="on"]). */
    if (fresh) { tx.classList.remove('cap-new'); void tx.offsetWidth; tx.classList.add('cap-new'); }
  }
  const nx = $('cmdCapNext');
  if (nx) nx.disabled = !!si.done;
}

/* ── Where the pretend person walked ─────────────────────────────────────
   After a pretend incident has ended, and only when asked, the map draws
   the line the pretend person walked. This is the one place anything reads
   it (the incident.js hidden line): never during the incident, never in the
   report, the replay video or the handler's view. It shows the story, not
   whether the modelled guides or the dog were right. */
async function revealRoute() {
  const ended = lastSim?.ended;
  if (!sq().sim || !ended || ended.inc.status !== 'ended') return;
  if (I.reveal) { I.reveal = null; I.panelKey = ''; return paintCommandNow(); }
  /* Drawn over the end of the replay, with the dog's trail, the perimeter
     and the points as they stood, so the room sees the two lines together. */
  if (I.replay?.source !== 'sim') await openReplay('sim');
  const r = I.replay;
  if (r) { playReplay(false); r.t = r.rp.end; r.fitted = true; }
  I.reveal = ended.hiddenRoute();
  I.panelKey = '';
  /* On a phone the list folds away, so the card has the room for the
     button and its note, which are brought into view. */
  if (!window.matchMedia('(min-width: 900px)').matches) foldPanel(true);
  paintCommandNow();
  $('cmdIncident')?.querySelector('.inc-reveal-note')?.scrollIntoView?.({ block: 'nearest' });
  fitOnMap(I.reveal.concat(ended.trail, [ended.inc.lkp]), 17);
}
/** Whether the revealed line may be on the map now: pretend, its story
    ended, and no incident running (a new one, from the form or a scenario,
    never carries the last story's line). */
function revealShown(v) {
  return I.reveal?.length >= 2 && !!sq().sim && lastSim?.ended?.inc.status === 'ended'
    && !(I.sim && I.sim.inc.status === 'active') && !(v?.inc?.status === 'active' && !v.replay);
}
/** The reveal's button and its plain note, for the ended card and the replay. */
function revealHtml() {
  return html`<p class="inc-reveal-row"><button type="button" class="btn small inc-reveal-btn" data-inc-act="reveal" aria-pressed="${String(!!I.reveal)}">${I.reveal ? 'Hide where the pretend person walked' : 'Show where the pretend person walked'}</button></p>
    ${I.reveal ? html`<p class="inc-reveal-note"><b>${REVEAL_WORDS}.</b> ${REVEAL_NOTE}</p>` : ''}`;
}

async function doEnd() {
  const v = shown();
  if (!v.inc || v.inc.status !== 'active') return;
  if (!await ask({ title: `End “${v.inc.name}”?`, body: 'It is kept for the debrief, with a replay of everyone’s movements.', yes: 'End incident', danger: true })) return;
  /* The sheet was up a while: the incident may have ended under it. */
  const now = shown();
  if (!now.inc || now.inc.id !== v.inc.id || now.inc.status !== 'active') return;
  I.tool = null;
  /* On a phone the list folds away: the ended card's Replay and Deployment
     report are the next thing to do, and must not sit below the list. */
  if (!window.matchMedia('(min-width: 900px)').matches) foldPanel(true);
  if (v.sim) {
    I.sim.end(viewNow());
    I.simEnded = I.sim;
    lastSim = { ended: I.sim, members: commandView().sim.members() };
    I.sim = null;
    ctx.toast('Incident ended. Replay it, or make the deployment report');
    paintCommandNow();
    /* On a phone the card is short: the reveal the last caption pointed to
       is brought into view, not left cut off under the map's buttons. */
    if (!window.matchMedia('(min-width: 900px)').matches) $('cmdIncident')?.querySelector('[data-inc-act="reveal"]')?.scrollIntoView?.({ block: 'nearest' });
    return;
  }
  try {
    const h = await ctx.handle();
    const st = commandView();
    const units = [...st.positions.keys()].length;
    await endIncident(h, I.sid, v.inc, summarise({ inc: v.inc, trail: I.trail, marks: I.marks, units, now: Date.now() }));
  } catch (e) {
    ctx.toast(String(e?.code || '').includes('permission') ? 'Only Command can end it' : (e?.message || 'Could not end it'));
  }
}

/** The incident's ground in view: the last known point, the trail, every
    mark and the trailing team, with room round them. */
function fitIncident() {
  const v = shown();
  if (!v.inc) return;
  const st = commandView();
  const pts = [v.inc.lkp, ...v.trail];
  for (const mk of v.marks) pts.push(...(mk.pts || [mk]));
  const k9 = v.inc.k9Uid ? st.positions.get(v.inc.k9Uid) : null;
  if (k9) pts.push(k9);
  /* Never closer in than a few hundred metres round the point: the ground
     officers will close off, not just the spot. */
  pts.push(...ringAround(v.inc.lkp));
  fitOnMap(pts, 17);
}
const ringAround = (c) => [0, 90, 180, 270].map(b => project(c, b, 250));

/* ── Replay ───────────────────────────────────────────────────────────── */
const REPLAY_SPEEDS = [10, 30, 60, 120];
const REPLAY_STEP_MS = 250;

/** An ended incident's replay: the pretend one from this device, a real
    one loaded from the cloud. Null (and said) when it cannot be had. */
async function loadReplay(source) {
  try {
    if (source === 'sim') return lastSim ? lastSim.ended.replay(lastSim.members) : null;
    const inc = I.incidents.get(source);
    if (!inc) return null;
    const h = await ctx.handle();
    if (!h) throw new Error('Sign in first');
    const { tracks, marks } = await loadIncident(h, I.sid, inc.id);
    return buildReplay({ inc, tracks, marks, members: sq().members });
  } catch (e) { ctx.toast(e?.message || 'Could not load the replay'); return null; }
}

async function openReplay(source, loaded = null) {
  const rp = loaded || await loadReplay(source);
  if (!rp) return;
  closeReplay(false);
  if (!sq().view) openCommand();
  const dur = rp.end - rp.start;
  /* Fast enough that a whole incident plays in about a minute. */
  const speed = REPLAY_SPEEDS.find(s => dur / s <= 75e3) ?? REPLAY_SPEEDS[REPLAY_SPEEDS.length - 1];
  I.replay = { rp, t: rp.start, playing: true, speed, timer: 0, scene: null, fitted: false, source };
  I.form = null; I.tool = null;
  setViewOverride(() => {
    const r = I.replay;
    if (!r) return null;
    r.scene = replayAt(r.rp, r.t);
    return { name: `Replay · ${r.rp.inc.name}`, members: r.scene.members, positions: r.scene.positions, now: r.t };
  });
  playReplay(true);
}

/** The whole of a replay in view: everyone's movements and every mark. */
function fitReplay() {
  const r = I.replay;
  if (!r) return;
  /* The incident's ground, not every patrol driven before it began. */
  const pts = [...ringAround(r.rp.inc.lkp)];
  const k9 = r.rp.units.find(u => u.uid === r.rp.inc.k9Uid);
  if (k9) pts.push(...k9.pts);
  for (const mk of r.rp.marks) pts.push(...(mk.pts || [mk]));
  fitOnMap(pts, 17);
}

function playReplay(on) {
  const r = I.replay;
  if (!r) return;
  clearInterval(r.timer); r.timer = 0;
  r.playing = on;
  if (on) {
    if (r.t >= r.rp.end) r.t = r.rp.start;
    r.timer = setInterval(() => {
      r.t = Math.min(r.rp.end, r.t + REPLAY_STEP_MS * r.speed);
      if (r.t >= r.rp.end) playReplay(false);
      paintCommandNow();
    }, REPLAY_STEP_MS);
  }
  paintCommandNow();
}

function closeReplay(repaint = true) {
  if (!I.replay) return;
  clearInterval(I.replay.timer);
  I.replay = null;
  setViewOverride(null);
  if (repaint) paintCommandNow();
}

/* ── The deployment report ────────────────────────────────────────────────
   After End, Command makes the record of it to forward: a PDF, a GPX of the
   K9 team's track, and a replay video (incident-report.js has the words and
   shapes; pdf.js, share.js and clip.js make the files). It is made on this
   device and saved to it, because the cloud deletes incidents after seven
   days. A draft record, never presented as evidence: every page, the video
   and the GPX say so, and a pretend one says PRETEND DATA. */

/* The forecast this device held near the last known point when the dog got
   there, kept for the report. Tried each paint until the dog is at the
   point and a forecast is in hand, for half an hour of the incident's clock
   after that; then the report says it was not recorded here. Kept on this
   device only: nothing about the weather is written to the cloud. */
const AIR_TRY_MS = 30 * 60e3;
const AIR_KEPT = 10;
const AIR_LATE_MS = 10 * 60e3;
function noteAir(v) {
  const inc = v.inc;
  if (!inc || inc.status !== 'active' || v.replay || I.air.has(inc.id)) return;
  const on = scentStart(v.trail, inc.lkp);
  if (!on || v.now - on.t > AIR_TRY_MS) return;
  const air = cleanAir(ctx.airNear?.(inc.lkp), on.t);
  if (!air) return;
  /* A forecast fetched long after the dog got there is not the weather
     when it started: wait no more than a few minutes past that moment.
     The pretend clock runs fast, so it is measured on the wall clock. */
  if (!v.sim && air.fetchedAt != null && air.fetchedAt > on.t + AIR_LATE_MS) return;
  I.air.set(inc.id, air);
  if (v.sim) return;
  try {
    const kept = (ctx.kv.get('squadIncAir', []) || []).filter(e => Array.isArray(e) && e[0] !== inc.id);
    ctx.kv.set('squadIncAir', [...kept, [inc.id, air]].slice(-AIR_KEPT));
  } catch { /* full: the report says it was not recorded */ }
}
/* Each unit this device saw go inside the perimeter, kept on this device
   for the report as the forecast is (the last ten incidents), so a report
   made after a reload still has it. Null when this device never watched
   the incident's map: the report then says it cannot tell, rather than
   leave the section out, which would read as nobody going inside. */
const INSIDE_KEPT = 10;
function keepInside(id) {
  try {
    const kept = (ctx.kv.get('squadIncInside', []) || []).filter(e => Array.isArray(e) && e[0] !== id);
    ctx.kv.set('squadIncInside', [...kept, [id, I.inside.seen.slice()]].slice(-INSIDE_KEPT));
  } catch { /* full: the report says it was not recorded here */ }
}
function insideKept(id) {
  if (I.inside.for === id) return I.inside.seen;
  try {
    const hit = (ctx.kv.get('squadIncInside', []) || []).find(e => Array.isArray(e) && e[0] === id);
    return hit && Array.isArray(hit[1]) ? hit[1].filter(w => w && typeof w === 'object') : null;
  } catch { return null; }
}
function airOf(id) {
  if (I.air.has(id)) return I.air.get(id);
  try {
    const hit = (ctx.kv.get('squadIncAir', []) || []).find(e => Array.isArray(e) && e[0] === id);
    return hit ? cleanAir(hit[1], hit[1]?.at) : null;
  } catch { return null; }
}

/** What the report needs besides the replay: who each uid is, the squad's
    name, the forecast, who went inside the perimeter, and whether it is pretend. */
function reportBits(rp, source) {
  const members = replayAt(rp, rp.end).members;
  const pretend = source === 'sim';
  return {
    rp, pretend,
    who: (uid) => who(uid, members),
    squad: pretend ? (sq().simName || '') : (sq().squad?.name || ''),
    air: airOf(rp.inc.id),
    /* A scenario on a story clock: its forecast is today's, and the report says so. */
    story: pretend && !!lastSim?.ended?.script && lastSim.ended.inc.id === rp.inc.id,
    inside: insideKept(rp.inc.id),
    imperial: imperial(),
  };
}

async function openReport(source) {
  if (I.report) return;
  /* The replay video films the live map: the pretend person's line comes
     off it first, so no part of the report ever shows it. */
  if (I.reveal) { I.reveal = null; paintCommandNow(); }
  const rp = await loadReplay(source);
  if (!rp || rp.inc.status !== 'ended') return;
  const pretend = source === 'sim';
  const canVideo = !!clipSupport() && !!map()?.map;
  const pick = await choose({
    title: 'Deployment report',
    /* The pretend incident never went near the cloud: saying it did would
       tell a chief that demo data sits on a server. */
    body: pretend ? `A draft record of the pretend incident “${rp.inc.name}”, made on this device only. Nothing was sent anywhere.`
      : `A draft record of “${rp.inc.name}”, made on this device and saved to it. The squad’s copy in the cloud is deleted after 7 days; these files stay.`,
    options: [
      { value: 'pdf', text: 'PDF report', hint: 'Map, log, the dog’s record, weather, timings, who walked the scene, units' },
      { value: 'gpx', text: 'GPX of the K9 track', hint: 'For a mapping app, with the last known point and the map’s points' },
      ...(canVideo ? [{ value: 'v30', text: `Replay video · ${CLIP.LENGTHS[1]} s`, hint: 'A tall video of the whole incident, to forward' },
        { value: 'v60', text: `Replay video · ${CLIP.LENGTHS[2]} s`, hint: 'Slower, for a debrief' }] : []),
    ],
    note: `Every page says “${REPORT_STAMP}”${pretend ? ` and “${PRETEND_MARK}”` : ''}.${canVideo ? '' : ` ${CLIP_SAYS.unsupported}`}`,
  });
  if (!pick) return;
  const bits = reportBits(rp, source);
  I.report = { kind: pick };
  try {
    if (pick === 'pdf') await reportPdf(bits);
    else if (pick === 'gpx') await reportGpxFile(bits);
    else await reportVideo(source, bits, pick === 'v60' ? CLIP.LENGTHS[2] : CLIP.LENGTHS[1]);
  } finally { I.report = null; }
}

async function reportPdf(b) {
  ctx.toast('Making the report…');
  try {
    const doc = reportDoc(b);
    /* The map is a picture fetched for the report, like a trail report's
       (app.js); offline or with no map key it is plain paper with the lines. */
    const pic = await Promise.resolve(ctx.reportMap?.(reportShapes(b.rp))).catch(() => null);
    const bytes = buildPdf({ ...doc, map: pic || null });
    await ctx.deliver(bytes, `${reportFileBase(b.rp, b)}.pdf`, 'application/pdf');
  } catch {
    ctx.toast('Could not make the report');
  }
}

async function reportGpxFile(b) {
  const gpx = reportGpx(b.rp, b.who, b);
  if (!gpx) { ctx.toast('No K9 track to save'); return; }
  try { await ctx.deliver(gpx, `${reportFileBase(b.rp, b)}.gpx`, 'application/gpx+xml'); }
  catch { ctx.toast('Could not make the file'); }
}

/* The replay video: the incident's own replay on the command map, played
   once on the video's clock while clip.js records it. The canvas is the
   sheet's preview, which a browser needs in the page to record. Afterwards
   the replay is put back where its slider was. */
async function reportVideo(source, b, seconds) {
  const { rp } = b;
  if (!sq().view) openCommand(source === 'sim' ? { sim: true } : {});
  const opened = !I.replay || I.replay.rp.inc.id !== rp.inc.id;
  if (opened) await openReplay(source, rp);
  const r = I.replay;
  const m = map()?.map;
  if (!r || !m) return;
  playReplay(false);
  /* The video frames the incident itself (clip.js, north up, fitted to the
     tall frame); the replay's own fit, which leaves room for the panel,
     must not move the camera under it once recording starts. */
  r.fitted = true;
  /* The command map may hold padding for the panel (an ease with padding
     keeps it), which would push the video's framing off to one side: the
     camera goes in without it and comes back exactly as it was. */
  const pad = m.getPadding?.() ?? null;
  const cam0 = { center: m.getCenter(), zoom: m.getZoom(), bearing: m.getBearing(), pitch: m.getPitch() };
  if (pad) { try { m.jumpTo({ ...cam0, padding: { top: 0, bottom: 0, left: 0, right: 0 } }); } catch { /* a map with no padding */ } }
  const was = r.t;
  const canvas = document.createElement('canvas');
  canvas.className = 'app-sheet-clip';
  canvas.setAttribute('aria-hidden', 'true');
  const sheet = progress({ title: 'Replay video', body: `A ${seconds} s video of the whole incident. Keep Trailcraft on screen while it records.`, extra: canvas });
  sheet.say('Getting the map ready…');
  const words = reportClipWords(rp, b.who, b);
  const look = ctx.clipLook?.() || { credit: creditLine('', { mapbox: false }), logo: null };
  const air = b.air;
  const wind = air && air.windFrom != null ? windLine({ wind_direction: air.windFrom, wind_speed: air.windSpeed }, { imperial: b.imperial }) : null;
  let said = -1;
  const job = recordClip({
    map: m, canvas, seconds,
    host: {
      from: rp.start, to: rp.end,
      points: reportShapes(rp).points,
      reveal: 'none', revealWords: '', key: null,
      lines: words.lines, closing: words.closing,
      credit: look.credit, logo: look.logo,
      route: () => [], dog: { colour: '#F5D14A', casing: '#0B1630' },
      answer() {},
      paint(at) { if (I.replay === r) { r.t = at; paintCommandNow(); } },
      marks: (at) => reportClipMarks(rp, at, b.who),
      wind: () => wind,
      hold: (on) => ctx.keepAwake?.(on),
    },
    onProgress: ({ stage, t, total }) => {
      if (stage === 'finish') { sheet.say('Finishing the video…'); return; }
      if (stage !== 'record' || Math.floor(t) === said) return;
      said = Math.floor(t);
      sheet.say(`Recording… ${said} s of ${total} s`);
    },
  });
  let gone = false;
  sheet.stopped.then((how) => { if (how === 'stop' || how === 'closed') { gone = true; job.cancel('stopped'); } });
  const out = await job.done;
  if (pad) { try { m.jumpTo({ ...cam0, padding: pad }); } catch { /* the map has gone */ } }
  /* A replay the video opened has not been fitted yet: it is, now. */
  if (I.replay === r) { r.t = was; if (opened) r.fitted = false; paintCommandNow(); }
  if (gone) return;
  if (out.status !== 'done') {
    sheet.offer({ body: out.status === 'failed' ? out.say : CLIP_SAYS.background, no: 'Close' });
    await sheet.stopped;
    return;
  }
  const webm = out.ext === 'webm' ? ' It is a .webm file: it plays in a browser, but Photos and some apps won’t take it.' : '';
  sheet.offer({ body: `Your ${out.seconds} s video is ready.${webm} Tap Save video to keep it.`, yes: 'Save video', no: 'Discard' });
  if (await sheet.stopped !== 'yes') return;
  try { await ctx.deliver(out.blob, `${reportFileBase(rp, b)}.${out.ext === 'webm' ? 'webm' : 'mp4'}`, out.type || out.mime || 'video/mp4'); }
  catch { ctx.toast('Could not save the video'); }
}

/* ── The command map's incident layer ─────────────────────────────────── */
/* Lines (the trail, the way ahead, perimeters) are map layers; points (the
   last known point, the team's calls, roadblocks) are markers of their own,
   with their words in textContent, because the street map without a Mapbox
   key has no fonts to write labels with. */
/* The reach rings sit under everything else of the incident's: a soft fill
   and edge at the pace Command chose, and a dashed ring for if they ran. A
   perimeter line the main ring has grown past turns amber. */
const RING_C = '#4F5BD5';
const WARN_C = '#F2A900';
/* The downwind band sits lowest of all: a pale wash the rest draws over. */
const BAND_C = '#1A9BB0';
/* Magenta: no other line on the command map is anywhere near it. */
const REVEAL_C = '#E040A0';
const LAYERS = [
  { id: 'inc-band-fill', src: 'inc-band', type: 'fill', paint: { 'fill-color': BAND_C, 'fill-opacity': 0.24 } },
  { id: 'inc-band-edge', src: 'inc-band', type: 'line',
    paint: { 'line-color': BAND_C, 'line-width': 2, 'line-opacity': 0.9, 'line-dasharray': [1.5, 1.5] } },
  { id: 'inc-reach-fill', src: 'inc-reach', type: 'fill', paint: { 'fill-color': RING_C, 'fill-opacity': 0.1 } },
  { id: 'inc-reach-edge', src: 'inc-reach', type: 'line', paint: { 'line-color': RING_C, 'line-width': 2, 'line-opacity': 0.8 } },
  { id: 'inc-reach-wide', src: 'inc-reach-wide', type: 'line',
    paint: { 'line-color': RING_C, 'line-width': 2, 'line-opacity': 0.7, 'line-dasharray': [2, 2] } },
  { id: 'inc-lines', src: 'inc-lines', type: 'line',
    paint: { 'line-color': ['case', ['boolean', ['get', 'warn'], false], WARN_C, INC_COLOURS.perimeter], 'line-width': 4, 'line-dasharray': [2, 1.2] } },
  { id: 'inc-draft', src: 'inc-draft', type: 'line', paint: { 'line-color': INC_COLOURS.perimeter, 'line-width': 3, 'line-dasharray': [1, 1] } },
  { id: 'inc-draft-pts', src: 'inc-draft-pts', type: 'circle',
    paint: { 'circle-radius': 6, 'circle-color': '#ffffff', 'circle-stroke-color': INC_COLOURS.perimeter, 'circle-stroke-width': 3 } },
  { id: 'inc-trail-case', src: 'inc-trail', type: 'line', paint: { 'line-color': '#ffffff', 'line-width': 9, 'line-opacity': 0.85 } },
  { id: 'inc-trail', src: 'inc-trail', type: 'line', paint: { 'line-color': INC_COLOURS.trail, 'line-width': 5 } },
  { id: 'inc-ahead', src: 'inc-ahead', type: 'line', paint: { 'line-color': INC_COLOURS.trail, 'line-width': 3, 'line-dasharray': [1.5, 1.5] } },
  /* Pretend, after the end and only when asked: where the pretend person
     walked, dotted in a colour nothing else on the map uses. */
  { id: 'inc-reveal-case', src: 'inc-reveal', type: 'line', paint: { 'line-color': '#1B1B1B', 'line-width': 8, 'line-opacity': 0.55 } },
  { id: 'inc-reveal', src: 'inc-reveal', type: 'line', paint: { 'line-color': REVEAL_C, 'line-width': 4, 'line-dasharray': [1, 1.4] } },
];
const SOURCES = ['inc-band', 'inc-reach', 'inc-reach-wide', 'inc-lines', 'inc-draft', 'inc-draft-pts', 'inc-trail', 'inc-ahead', 'inc-reveal'];

function ensureLayers(m) {
  /* All there already: draw. isStyleLoaded is false whenever a tile is still
     coming in (after a fly to the incident, say), which is no reason to skip
     setting the lines' data. */
  if (SOURCES.every(id => m.getSource(id)) && LAYERS.every(l => m.getLayer(l.id))) return true;
  if (!m.isStyleLoaded?.()) return false;
  for (const id of SOURCES) if (!m.getSource(id)) m.addSource(id, { type: 'geojson', data: EMPTY });
  /* Mapbox's own maps light their layers with the time of day: the
     incident's lines glow at full strength, so Wall mode's night look dims
     the map round them and not them. (MapLibre, the map with no key, has no
     such setting and would refuse it.) */
  const lit = typeof m.setConfigProperty === 'function';
  for (const l of LAYERS) {
    if (m.getLayer(l.id)) continue;
    if (l.src === 'inc-band') I.bandLook = null;   // put back with the day look: set again
    I.hvLayers = null;                               // and shown or hidden for Handler's view again
    const paint = lit ? { ...l.paint, [`${l.type}-emissive-strength`]: 1 } : l.paint;
    /* In order, under any the style already has above them. */
    const above = LAYERS.slice(LAYERS.indexOf(l) + 1).find(x => m.getLayer(x.id));
    m.addLayer({ id: l.id, type: l.type, source: l.src, paint,
                 ...(l.type === 'line' ? { layout: { 'line-cap': 'round', 'line-join': 'round' } } : {}) }, above?.id);
  }
  return true;
}
function dropLayers(m) {
  if (!m) return;
  for (const l of LAYERS) { try { if (m.getLayer(l.id)) m.removeLayer(l.id); } catch { /* style gone */ } }
  for (const id of SOURCES) { try { if (m.getSource(id)) m.removeSource(id); } catch { /* style gone */ } }
}
const setData = (m, id, data) => m.getSource(id)?.setData(data);
const lineFeature = (pts, props = {}) => ({ type: 'Feature', properties: props,
  geometry: { type: 'LineString', coordinates: pts.map(p => [p.lon, p.lat]) } });
const lines = (list) => ({ type: 'FeatureCollection', features: list.filter(Boolean) });

const polygon = (pts) => ({ type: 'Feature', properties: {},
  geometry: { type: 'Polygon', coordinates: [pts.map(p => [p.lon, p.lat])] } });

/* On the dimmed Wall map, across a room, the band's pale wash is a smudge:
   it is drawn stronger there, so "keep cars off this side" can be read on
   the TV. Set again whenever the layers are put back (a style reload). */
const BAND_LOOK = {
  day: { color: BAND_C, fill: 0.24, width: 2, dash: [1.5, 1.5] },
  /* Lighter teal: the night look darkens the map, and the day teal sinks into it. */
  wall: { color: '#3FD3EA', fill: 0.4, width: 3.5, dash: [3, 1.5] },
};
function bandLook(m) {
  const look = wallOn() ? 'wall' : 'day';
  if (I.bandLook === look) return;
  const k = BAND_LOOK[look];
  try {
    m.setPaintProperty('inc-band-fill', 'fill-color', k.color);
    m.setPaintProperty('inc-band-fill', 'fill-opacity', k.fill);
    m.setPaintProperty('inc-band-edge', 'line-color', k.color);
    m.setPaintProperty('inc-band-edge', 'line-width', k.width);
    m.setPaintProperty('inc-band-edge', 'line-dasharray', k.dash);
    I.bandLook = look;
  } catch { I.bandLook = null; /* style still loading: next paint */ }
}
function paintLayers(v) {
  const { map: m } = map();
  if (!m || !ensureLayers(m)) return;
  bandLook(m);
  cmdLayers(m);
  const rn = reachNow(v);
  const band = bandOf(v);
  setData(m, 'inc-band', lines(band ? [polygon(band.pts)] : []));
  paintBandTag(band);
  const passed = new Set(rn.passed);
  const perim = v.marks.filter(x => MARKS[x.kind]?.line && x.pts?.length >= 2);
  setData(m, 'inc-lines', lines(perim.map(x => lineFeature(x.pts, { id: x.id, warn: passed.has(x.id) }))));
  const main = rn.reach?.main.m >= 1 ? ring(v.inc.lkp, rn.reach.main.m, 72) : null;
  setData(m, 'inc-reach', lines(main ? [polygon(main)] : []));
  const wide = rn.reach?.wide?.m >= 1 ? ring(v.inc.lkp, rn.reach.wide.m, 72) : null;
  setData(m, 'inc-reach-wide', lines(wide ? [lineFeature(wide)] : []));
  paintReachTag(main, rn.reach);
  setData(m, 'inc-trail', lines(v.trail.length >= 2 ? [lineFeature(v.trail)] : []));
  const ahead = v.inc?.status === 'active' || v.replay ? aheadLine(trailInfo(v.trail, v.inc, v.now)) : null;
  setData(m, 'inc-ahead', lines(ahead ? [lineFeature(ahead)] : []));
  setData(m, 'inc-reveal', lines(revealShown(v) ? [lineFeature(I.reveal)] : []));
  const draft = I.tool?.kind === 'perimeter' ? I.tool.pts : [];
  setData(m, 'inc-draft', lines(draft.length >= 2 ? [lineFeature(draft)] : []));
  setData(m, 'inc-draft-pts', { type: 'FeatureCollection', features: draft.map(p => ({ type: 'Feature', properties: {},
    geometry: { type: 'Point', coordinates: [p.lon, p.lat] } })) });
}

/* Where a caveat tag on the map can be read: inside what the side panel,
   the phone sheet and the status pill leave (mapPad), clear of the Wall
   box (clock and log, over one corner rather than a whole side) and clear
   of the pins and their labels. Both tags go by this, so neither can hide
   its "rough guide" or "modelled guide" under something else. Boxes are in
   the map canvas's pixels: x0, y0 its top-left corner, tw by th. */
function tagRoom() {
  const g = map();
  const box = g.map.getCanvas();
  const W = box.clientWidth, H = box.clientHeight;
  const pad = mapPad();
  const cr = box.getBoundingClientRect();
  const wb = wallOn() ? $('cmdWall') : null;
  const wr = wb && !wb.hidden ? wb.getBoundingClientRect() : null;
  const pins = [...g.map.getContainer().querySelectorAll('.inc-mark .inc-pin, .inc-mark-tag:not(.inc-tag-off), .sq-unit, .sq-tag, .inc-band-tag, .inc-reach-tag')]
    .map(e => e.getBoundingClientRect()).filter(r => r.width > 0);
  const lo = { x: 4, y: Math.min(pad.top, H / 3) };
  const hi = { x: W - Math.min(pad.right, W / 2) - 4, y: H - Math.min(pad.bottom, H / 2) - 4 };
  const over = (r, x0, y0, tw, th, m) => x0 + cr.left < r.right + m && x0 + tw + cr.left > r.left - m &&
    y0 + cr.top < r.bottom + m && y0 + th + cr.top > r.top - m;
  return {
    W, H, lo, hi,
    /** Under the Wall box. */
    underWall: (x0, y0, tw, th) => !!wr && wr.width > 0 && over(wr, x0, y0, tw, th, 6),
    /** On a pin or a pin's label. */
    onPin: (x0, y0, tw, th) => pins.some(r => over(r, x0, y0, tw, th, 2)),
    /** Inside the room left and clear of the Wall box and the pins. */
    clear(x0, y0, tw, th) {
      return x0 >= lo.x && y0 >= lo.y && x0 + tw <= hi.x && y0 + th <= hi.y
        && !this.underWall(x0, y0, tw, th) && !this.onPin(x0, y0, tw, th);
    },
  };
}

/* A small tag on the ring's edge, so the chief never reads the ring as
   where the person is. On a phone it is the only caveat the map shows, so
   it goes on whichever edge it can be read whole: west first (the status
   pill covers the north, the panel the south), then east, south, north;
   inside the ring each time, and never on a pin's label. Hidden when no
   edge will do, and on a phone while the downwind tag shows, so the two
   caveats do not crowd the small screen; the card says both. */
const TAG_SPOTS = [
  { i: 54, anchor: 'left', offset: [6, 0] },     // west
  { i: 18, anchor: 'right', offset: [-6, 0] },   // east
  { i: 36, anchor: 'bottom', offset: [0, -6] },  // south (the ring runs clockwise from north)
  { i: 0, anchor: 'top', offset: [0, 6] },       // north
];
const NARROW = '(max-width: 899px)';
function paintReachTag(main, reach) {
  const g = map();
  if (!main || !g.map || !g.GL) { I.reachTag?.marker.remove(); I.reachTag = null; return; }
  const text = `${PACES[reach.pace].label} range · rough guide`;
  if (!I.reachTag) {
    const el = document.createElement('div');
    el.className = 'inc-reach-tag';
    el.setAttribute('aria-hidden', 'true');
    I.reachTag = { el, spot: null, marker: new g.GL.Marker({ element: el, anchor: 'left', offset: [6, 0], occludedOpacity: FULL }).setLngLat([main[54].lon, main[54].lat]).addTo(g.map) };
  }
  const tag = I.reachTag;
  if (tag.el.textContent !== text) tag.el.textContent = text;
  if (I.bandTag && !I.bandTag.el.hidden && window.matchMedia(NARROW).matches) { tag.el.hidden = true; return; }
  tag.el.hidden = false;
  const tw = tag.el.offsetWidth || 160, th = tag.el.offsetHeight || 20;
  tag.el.hidden = true;   // its own box is not a pin to keep clear of
  const room = tagRoom();
  /* Where the tag's box would be for each edge. */
  const fits = (s) => {
    const p = g.map.project([main[s.i].lon, main[s.i].lat]);
    const x0 = s.anchor === 'left' ? p.x + 6 : s.anchor === 'right' ? p.x - 6 - tw : p.x - tw / 2;
    const y0 = s.anchor === 'bottom' ? p.y - 6 - th : s.anchor === 'top' ? p.y + 6 : p.y - th / 2;
    return room.W > 0 && room.clear(x0, y0, tw, th);
  };
  const spot = TAG_SPOTS.find(fits) || null;
  tag.el.hidden = !spot;
  if (!spot) return;
  /* Mapbox anchors a marker once: a different edge means a new marker. */
  if (tag.spot !== spot) {
    tag.marker.remove();
    tag.marker = new g.GL.Marker({ element: tag.el, anchor: spot.anchor, offset: spot.offset, occludedOpacity: FULL })
      .setLngLat([main[spot.i].lon, main[spot.i].lat]).addTo(g.map);
    tag.spot = spot;
  }
  tag.marker.setLngLat([main[spot.i].lon, main[spot.i].lat]);
}

/* The band's tag hangs off its far end, on the side away from the last
   known point, so it clears the pins crowded there and is never read as a
   route. Zoomed out, the band is a few pixels long and lies under the pins
   at the point: then the tag is left off (it would label nothing) and the
   card's line, which says "modelled guide" too, carries it. Otherwise it is
   pushed on out along the band, then turned to either side, until it is
   clear of the pins, the panel and the Wall box; and left off if nowhere
   is. Mapbox anchors a marker once: another side is a new marker. */
const BAND_ANCHORS = ['bottom', 'bottom-left', 'left', 'top-left', 'top', 'top-right', 'right', 'bottom-right'];
const BAND_CLEAR_PX = 80;
const BAND_MIN_PX = 40;
function paintBandTag(band) {
  const g = map();
  if (!band || !g.map || !g.GL) { I.bandTag?.marker?.remove(); I.bandTag = null; return; }
  const anchor = BAND_ANCHORS[Math.round(band.to / 45) % 8];
  if (!I.bandTag) {
    const el = document.createElement('div');
    el.className = 'inc-band-tag';
    el.setAttribute('aria-hidden', 'true');
    el.textContent = 'Downwind · modelled guide';
    I.bandTag = { el, anchor: null, marker: null };
  }
  const tag = I.bandTag;
  if (tag.anchor !== anchor) {
    tag.marker?.remove();
    tag.marker = new g.GL.Marker({ element: tag.el, anchor, occludedOpacity: FULL }).setLngLat([band.tip.lon, band.tip.lat]).addTo(g.map);
    tag.anchor = anchor;
  }
  tag.marker.setLngLat([band.tip.lon, band.tip.lat]);
  const a = g.map.project([band.pts[0].lon, band.pts[0].lat]), b = g.map.project([band.tip.lon, band.tip.lat]);
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < BAND_MIN_PX) { tag.el.hidden = true; return; }
  tag.el.hidden = false;
  const tw = tag.el.offsetWidth || 160, th = tag.el.offsetHeight || 20;
  tag.el.hidden = true;   // its own box is not a pin to keep clear of
  const room = tagRoom();
  if (!room.W || !room.H) return;
  const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
  const corner = (x, y) => [x - (anchor.includes('left') ? 0 : anchor.includes('right') ? tw : tw / 2),
                            y - (anchor.startsWith('top') ? 0 : anchor.startsWith('bottom') ? th : th / 2)];
  /* Out along the band first, then a little to either side of it. */
  const tries = [];
  for (const out of [Math.max(0, BAND_CLEAR_PX - len), Math.max(0, BAND_CLEAR_PX - len) + 50, Math.max(0, BAND_CLEAR_PX - len) + 100]) {
    for (const side of [0, 1, -1]) tries.push([ux * out - uy * side * (th + 8), uy * out + ux * side * (th + 8)]);
  }
  for (const [ox, oy] of tries) {
    const [x0, y0] = corner(b.x + ox, b.y + oy);
    if (room.clear(x0, y0, tw, th)) {
      tag.marker.setOffset([ox, oy]);
      tag.el.hidden = false;
      return;
    }
  }
}

/* Mapbox fades a marker behind a 3D building on the satellite map. The
   last known point, the calls and the caveat tags are what the chief must
   see wherever the camera is, so they stay at full strength. (MapLibre, the
   map with no key, has no 3D buildings and ignores it.) */
const FULL = 1;
function pinEl(cls, short, tagText) {
  const el = document.createElement('div');
  el.className = `inc-mark ${cls}`;
  const pin = document.createElement('span');
  pin.className = 'inc-pin';
  pin.textContent = short;
  const tag = document.createElement('span');
  tag.className = 'inc-mark-tag';
  tag.textContent = tagText;
  el.append(pin, tag);
  return { el, pin, tag };
}

const PIN_W = 44;   // about the widest pin ("LOST"), so a pin moved aside clears the one it sat on
function paintPins(v, members) {
  const g = map();
  if (!g.map || !g.GL) return;
  const keep = new Set();
  /* The last known point first: the calls move aside for it, never it for them. */
  const placed = v.inc ? [g.map.project([v.inc.lkp.lon, v.inc.lkp.lat])] : [];
  const marks = v.marks.filter(x => !MARKS[x.kind]?.line).sort((a, b) => a.at - b.at);
  for (const mk of marks) {
    keep.add(mk.id);
    const since = v.inc ? `+${elapsedWords(mk.at - v.inc.startedAt)}` : '';
    const text = `${mk.label || MARKS[mk.kind].label} · ${who(mk.by, members)} · ${since}`;
    let p = I.markers.get(mk.id);
    if (!p) {
      const parts = pinEl(`inc-k-${mk.kind}`, MARKS[mk.kind].short, text);
      parts.el.addEventListener('click', (e) => onPinClick(e, mk.id));
      p = { ...parts, mk, marker: new g.GL.Marker({ element: parts.el, anchor: 'bottom', occludedOpacity: FULL }).setLngLat([mk.lon, mk.lat]).addTo(g.map) };
      I.markers.set(mk.id, p);
    }
    p.mk = mk;
    p.text = text;
    if (p.tag.textContent !== text) p.tag.textContent = text;
    p.el.setAttribute('aria-label', text);
  }
  /* The team's calls fall within a few metres of each other: a pin that
     would sit on one already drawn moves along beside it. Sized from the
     pins as drawn (Wall mode makes them half as big again), so a pin moved
     aside clears the widest; and the latest call is always on top, so a
     newer "RE" never hides under an older "LOST". */
  let w = PIN_W, h = 24;
  for (const mk of marks) {
    const pe = I.markers.get(mk.id).pin;
    w = Math.max(w, pe.offsetWidth + 4);
    h = Math.max(h, pe.offsetHeight);
  }
  marks.forEach((mk, n) => {
    const p = I.markers.get(mk.id);
    const at = g.map.project([mk.lon, mk.lat]);
    const k = placed.filter(q => Math.abs(q.x - at.x) < w && Math.abs(q.y - at.y) < h).length;
    placed.push(at);
    if (p.shift !== k || p.w !== w) { p.shift = k; p.w = w; p.marker.setOffset([k * w, 0]); }
    const z = String(1 + n);
    if (p.el.style.zIndex !== z) p.el.style.zIndex = z;
  });
  placeTags(g, marks, w);
  for (const [id, p] of I.markers) if (!keep.has(id)) { p.marker.remove(); I.markers.delete(id); }
  /* LKP is what police call it, and needs no tag to crowd the others. */
  pin('lkp', v.inc ? v.inc.lkp : null, 'inc-k-lkp');
  pin('form', I.form?.lkp ?? null, 'inc-k-lkp inc-draft-pin');
}

/* Each call's label sits under its pin. At a find the calls stand close
   (the sighting, the car's roadblock at its post, the find itself, the K9
   team's own label on top of it) and the labels would pile up exactly when
   the chief is watching: so each goes under, beside or over its pin,
   wherever it clears the pins, the units and the labels already placed,
   the most telling first (the find, then a sighting, then the dog's calls,
   newest first). A roadblock's long label is left off rather than moved,
   and so is any label with nowhere to go: the pin stays, and a tap on it
   says what it is. Worked out in the map's pixels from the pins as drawn
   (Wall mode's are bigger; a phone hides the labels, and then nothing
   moves). */
const TAG_RANK = { indication: 0, sighting: 1, lost: 2, refound: 2, article: 2, rally: 3, roadblock: 4 };
const TAG_GAP = 4;
function placeTags(g, marks, w) {
  const canvas = g.map.getCanvas?.();
  const cr = canvas?.getBoundingClientRect?.();
  if (!cr) return;
  const near = (r) => ({ x: r.left - cr.left, y: r.top - cr.top, w: r.width, h: r.height });
  /* What a label must not cover: every pin (the last known point's too),
     and the units with their labels, as they stand on the map now. */
  const block = [...g.map.getContainer().querySelectorAll('.inc-mark .inc-pin, .sq-unit, .sq-tag')]
    .map(e => e.getBoundingClientRect()).filter(r => r.width > 0).map(near);
  const hits = (b, list) => list.some(r => b.x < r.x + r.w + 2 && b.x + b.w > r.x - 2 && b.y < r.y + r.h + 2 && b.y + b.h > r.y - 2);
  const W = cr.width, H = cr.height;
  const order = marks.slice().sort((a, b) => (TAG_RANK[a.kind] ?? 2) - (TAG_RANK[b.kind] ?? 2) || b.at - a.at);
  const placed = [];
  for (const mk of order) {
    const p = I.markers.get(mk.id);
    if (!p) continue;
    p.tag.style.transform = '';
    const tw = p.tag.offsetWidth, th = p.tag.offsetHeight;
    const own = p.pin.getBoundingClientRect();
    let spot = null;
    if (tw && th && own.width) {
      const pin = near(own);
      const home = { x: pin.x + pin.w / 2 - tw / 2, y: pin.y + pin.h + 3 };
      const side = pin.y + pin.h / 2 - th / 2;
      const tries = mk.kind === 'roadblock' ? [[home.x, home.y]] : [
        [home.x, home.y],                                    // under the pin
        [pin.x + pin.w + TAG_GAP, side],                     // to its right
        [pin.x - TAG_GAP - tw, side],                        // to its left
        [home.x, pin.y - TAG_GAP - th],                      // over it
        [home.x, home.y + th + TAG_GAP],                     // further under
      ];
      const mine = block.filter(r => !(Math.abs(r.x - pin.x) < 1 && Math.abs(r.y - pin.y) < 1));
      for (const [x, y] of tries) {
        const b = { x, y, w: tw, h: th };
        if (x < 0 || y < 0 || x + tw > W || y + th > H) continue;
        if (hits(b, mine) || hits(b, placed)) continue;
        spot = { b, tx: x - home.x, ty: y - home.y };
        break;
      }
    }
    const shown = !!spot || !tw;
    p.tag.classList.toggle('inc-tag-off', !shown);
    if (spot) {
      placed.push(spot.b);
      if (spot.tx || spot.ty) p.tag.style.transform = `translate(${Math.round(spot.tx)}px, ${Math.round(spot.ty)}px)`;
    }
  }
}

/* A tap on a pin. While drawing, it is a point of the drawing like any
   other tap on the map; otherwise it says what the pin is, who put it there
   and when, the only way to read that on a phone (the tags are hidden
   there), with Remove for whoever may take it back. */
function onPinClick(e, id) {
  const p = I.markers.get(id);
  if (!p) return;
  if (I.tool || I.form) {
    e.stopPropagation();
    onMapClick({ lngLat: { lat: p.mk.lat, lng: p.mk.lon }, point: null });
    return;
  }
  e.stopPropagation();
  const v = shown();
  const may = !v.replay && v.inc?.status === 'active' && mayUnmark(p.mk, meUid(), amCommand());
  if (!may) { ctx.toast(p.text); return; }
  takeBack(p.mk, p.text);
}

function pin(key, at, cls) {
  const g = map();
  let p = I.pins.get(key);
  if (!at) { if (p) { p.marker.remove(); I.pins.delete(key); } return; }
  if (!p) {
    const parts = pinEl(cls, 'LKP', '');
    parts.el.setAttribute('aria-label', 'Last known point');
    p = { ...parts, marker: new g.GL.Marker({ element: parts.el, anchor: 'bottom', occludedOpacity: FULL }).setLngLat([at.lon, at.lat]).addTo(g.map) };
    I.pins.set(key, p);
  }
  p.marker.setLngLat([at.lon, at.lat]);
}

function onMapClick(e) {
  const p = { lat: e.lngLat.lat, lon: e.lngLat.lng };
  if (I.replay) return;
  if (I.form) { I.form.lkp = p; paintCommandNow(); return; }
  if (I.tool) {
    if (I.tool.kind === 'perimeter') {
      if (I.tool.pts.length < LINE_MAX) I.tool.pts.push(p);
      paintCommandNow();
    } else {
      const kind = I.tool.kind;
      I.tool = null;
      addMark(kind, p);
    }
    return;
  }
  /* A tap on a perimeter line offers to take it back. */
  const m = map().map;
  const hit = m?.queryRenderedFeatures?.(e.point, { layers: ['inc-lines'] })?.[0];
  const id = hit?.properties?.id;
  const mark = id ? shown().marks.find(x => x.id === id) : null;
  if (mark) takeBack(mark);
}

function setCursor() {
  const c = map().map?.getCanvas?.();
  if (c) c.style.cursor = I.form || I.tool ? 'crosshair' : '';
}

function teardown() {
  const { map: m } = map();
  if (I.on) { m?.off('click', onMapClick); handsOff(m); I.on = false; }
  I.follow = { paused: false, at: 0, for: null };
  const fb = $('cmdFollow');
  if (fb) fb.hidden = true;
  for (const p of I.markers.values()) p.marker.remove();
  I.markers.clear();
  for (const p of I.pins.values()) p.marker.remove();
  I.pins.clear();
  I.reachTag?.marker.remove(); I.reachTag = null;
  I.bandTag?.marker?.remove(); I.bandTag = null;
  I.log = []; I.logKey = '';
  dropLayers(m);
  I.form = null; I.tool = null;
  closeReplay(false);
  /* The pretend squad has gone with the map, and a running pretend incident
     with it; an ended one stays in lastSim for its replay. */
  I.sim = null; I.simEnded = null; I.reveal = null;
  I.foldedFor = null;
  setHv(false, false);
  const cap = $('cmdCap');
  if (cap) cap.hidden = true;
  $('scrCommand')?.classList.remove('cap-on');
  if (I.capOn) { I.capOn = false; ctx.storyWeather?.(); }
  I.capKey = '';
  setLeadUnit(null);
  setCoverUnit(null);
  I.panelKey = '';
  const box = $('cmdIncident');
  if (box) { box.hidden = true; box.textContent = ''; }
  if (m) { const c = m.getCanvas?.(); if (c) c.style.cursor = ''; }
  paintBanner();
}

/** Every second while the command map is up, and on every change. */
function paint(st) {
  if (!st) return teardown();
  const { map: m } = map();
  if (!I.on && m) { m.on('click', onMapClick); handsOn(m); I.on = true; }
  const v = shown();
  const live = v.inc && v.inc.status === 'active' && !v.replay ? v.inc : null;
  setLeadUnit(v.inc?.k9Uid ?? null);
  setCoverUnit(v.inc?.coverUid ?? null);
  $('cmdPanel')?.classList.toggle('inc-on', !!live);
  $('cmdPanel')?.classList.toggle('inc-form', !!I.form);
  /* Close in, Wall mode's short pins show their details again. */
  if (m) $('map').classList.toggle('map-zoomed', m.getZoom() >= 17);
  /* On a phone the incident card and the map matter more than the list:
     the panel folds once when an incident comes on, and stays as the person
     leaves it after that. */
  if (live && I.foldedFor !== live.id) {
    I.foldedFor = live.id;
    if (!window.matchMedia('(min-width: 900px)').matches) foldPanel(true);
  }
  noteAir(v);
  paintLayers(v);
  paintPins(v, st.members);
  paintPanel(st, v);
  setCursor();
  if (I.replay && !I.replay.fitted) { I.replay.fitted = true; fitReplay(); }
  if (!I.hv) followTeam(v, st, live);
  speakCalls(v, st, live);
  paintWall(v, st);
  paintHv(v, st, live);
  paintCaption(v, st);
  paintBanner();
}

/** The pretend team's state where the story knows better than its track:
    kitting up before it is sent, walking in, found, or stood down once the
    person has got away. Null while it trails (the track says it). */
function simState(v) {
  const si = v.sim && !v.replay ? I.sim : null;
  if (!si || si.inc !== v.inc) return null;
  if (si.phase === 'found') return 'found, standing by';
  if (si.phase === 'away') return 'stood down';
  if (si.phase === 'responding') return v.now < si.dogFrom ? 'kitting up near the last known point' : 'walking in to the last known point';
  /* The trail's first fix is the dog standing on the point; until a second
     one comes there is no heading, and "on the way" would contradict the
     'starts at the last known point' caption shown at that moment. */
  if (si.phase === 'trailing' && (!v.trail || v.trail.length < 2)) return 'at the last known point, starting';
  return null;
}

/* ── Handler's view (pretend mode) ───────────────────────────────────────
   One laptop, no second phone: "Handler's view" turns the command map into
   what K9-1's phone shows on its run screen, driven by the same pretend
   incident (handler-ui.js draws both), and "Command view" turns it back.
   The command card, the reach ring, the band and the other units step
   aside; the dog's own line and arrow stay, as the run screen draws them. */
const HV_KEEP = new Set(['inc-trail-case', 'inc-trail']);
function cmdLayers(m) {
  const hide = !!I.hv;
  if (I.hvLayers === hide) return;
  try {
    for (const l of LAYERS) if (!HV_KEEP.has(l.id) && m.getLayer(l.id)) m.setLayoutProperty(l.id, 'visibility', hide ? 'none' : 'visible');
    I.hvLayers = hide;
  } catch { I.hvLayers = null; /* style still loading: next paint */ }
}
function setHv(on, repaint = true) {
  const want = !!on && !!sq().sim;
  if (I.hv === want && repaint) return;
  I.hv = want;
  I.follow.at = 0;
  $('scrCommand')?.classList.toggle('hv-on', want);
  $('map')?.classList.toggle('hv-on', want);
  const box = $('cmdHandler');
  if (box) box.hidden = !want;
  if (!want) {
    if (handlerOn() === 'pretend') clearHandler();
    /* Back to Command: the K9 team, the point and the perimeter in view again. */
    I.follow.paused = false;
  }
  const { map: m } = map();
  if (m) cmdLayers(m);
  if (repaint && sq().view) paintCommandNow();
}
/* A pretend call waits out its Undo time, then the pretend K9 team makes
   it where the dog was at the tap, as the real phone's run would. */
const hvHeld = new Set();
function pretendCall(key, live, k9) {
  const kind = RUN_MARKS[key];
  if (!kind || !k9 || !I.sim) return null;
  const si = I.sim;
  const tok = { kind, at: viewNow(), lat: k9.lat, lon: k9.lon, timer: 0 };
  tok.timer = setTimeout(() => {
    hvHeld.delete(tok);
    if (I.sim !== si || si.inc.status !== 'active') return;
    si.addMark({ kind, by: live.k9Uid, at: tok.at, lat: tok.lat, lon: tok.lon });
    if (sq().view) paintCommandNow();
  }, CALL_UNDO_MS);
  hvHeld.add(tok);
  ctx.toast(MARKS[kind].label);
  return tok;
}
function pretendUndo(tok) {
  if (!hvHeld.has(tok)) return false;
  clearTimeout(tok.timer);
  hvHeld.delete(tok);
  return true;
}
function paintHv(v, st, live) {
  const on = I.hv && v.sim && !!live && !!live.k9Uid && !v.replay;
  if (!on) {
    if (I.hv) setHv(false, false);
    return;
  }
  const k9 = st.positions?.get(live.k9Uid) ?? null;
  const info = trailInfo(v.trail.slice(-400), live, v.now);
  const going = v.trail.length > 1;
  const team = st.members?.get(live.k9Uid);
  const hud = $('cmdHandlerHud');
  if (hud) {
    const words = `${team?.dog || 'Dog'} · ${elapsedWords(v.now - live.startedAt)} · ${simState(v) || (going ? 'trailing' : 'on the way to the last known point')}`;
    if (hud.textContent !== words) hud.textContent = words;
  }
  const kick = $('cmdHandlerKick');
  if (kick) {
    const words = `Handler’s view · what ${team?.callSign || 'the K9 team'}’s phone shows · pretend`;
    if (kick.textContent !== words) kick.textContent = words;
  }
  const pic = paintHandler({
    where: 'pretend', box: $('cmdHandlerBox'), lift: $('cmdHandler'), night: !!st.night, inc: live, marks: v.marks,
    me: k9 ? { lat: k9.lat, lon: k9.lon } : null, heading: info.heading ?? (finite(k9?.hdg) ? k9.hdg : null),
    cover: live.coverUid ? st.positions?.get(live.coverUid) ?? null : null,
    coverName: live.coverUid ? who(live.coverUid, st.members) : '',
    now: v.now, myUid: live.k9Uid, name: (uid) => who(uid, st.members), voice: I.voice,
    call: (key) => pretendCall(key, live, k9),
    undo: (tok) => pretendUndo(tok),
  });
  followHandler(k9, pic);
}
/* Handler's view follows the dog, framed with the squad's picture round it:
   the cover officer, the nearest points and the nearest stretch of each
   perimeter line (incident.js handlerFrame), as close in as they allow
   (street level at best, never further out than about a kilometre across),
   until a hand moves the map (Follow K9 brings it back). With the dog
   alone in reach it stays close in on the dog, and the line of words says
   where the rest is. */
const HV_ZOOM = { max: 17, min: 15, alone: 16.3 };
function followHandler(k9, pic) {
  const g = map();
  paintFollowBtn();
  if (!g.map || !k9 || I.follow.paused || g.map.isMoving?.()) return;
  const c = g.map.getCanvas?.();
  const size = { w: c?.clientWidth || window.innerWidth, h: c?.clientHeight || window.innerHeight };
  /* The box covers the bottom of the map: the dog is kept in the top part. */
  const box = $('cmdHandler')?.getBoundingClientRect?.();
  const bottom = box && box.height ? Math.max(0, size.h - box.top) : 0;
  /* The top clears the weather card and the duty pill, and a scenario's
     captions when they are up there. */
  const cap = $('cmdCap');
  const capBottom = cap && !cap.hidden ? cap.getBoundingClientRect().bottom : 0;
  const pad = { top: Math.max(150, Math.round(capBottom) + 24), left: 40, right: 40, bottom: bottom + 30 };
  /* What fits at the widest zoom allowed: metres a pixel at that zoom (the
     map's tiles are 512 px), times half the smaller side left between the
     paddings, so points on both sides of the dog still fit. */
  const roomPx = Math.max(80, Math.min(size.w - pad.left - pad.right, size.h - pad.top - pad.bottom));
  const mpp = 156543.03 * Math.cos(k9.lat * Math.PI / 180) / Math.pow(2, HV_ZOOM.min + 1);
  const frame = handlerFrame(pic, k9, { maxM: mpp * roomPx / 2 });
  const others = !!(pic && (pic.items?.length || pic.cover?.pos));
  /* Squad points out of reach even at the widest zoom: the widest zoom,
     so whatever is near shows, not street level on the dog and its cover. */
  const pointsIn = frame.length - 1 - (pic?.cover?.pos && frame.includes(pic.cover.pos) ? 1 : 0);
  const zMax = pic?.items?.length && !pointsIn ? HV_ZOOM.min : HV_ZOOM.max;
  const z = g.map.getZoom();
  const inView = frame.every(q => allInView([g.map.project([q.lon, q.lat])], size, pad));
  if (z >= HV_ZOOM.min - 0.2 && z <= zMax + 0.2 && inView) return;
  if (Date.now() - I.follow.at < FOLLOW_GAP_MS) return;
  I.follow.at = Date.now();
  /* The app's own motion choice (Reduce Motion, or ?motion=on over it). */
  const still = document.documentElement.dataset.motion === 'off';
  const duration = still ? 0 : 700;
  /* One ease with the padding, as before: the camera is worked out here
     (incident.js frameCamera) rather than by fitBounds, which would add
     the map's own padding from the last ease to this one. */
  const cam = frame.length > 1
    ? frameCamera(frame, size.w - pad.left - pad.right, size.h - pad.top - pad.bottom, { min: HV_ZOOM.min, max: zMax })
    : { center: k9, zoom: others ? HV_ZOOM.min : HV_ZOOM.alone };
  g.map.easeTo({ center: [cam.center.lon, cam.center.lat], zoom: cam.zoom, padding: pad, duration });
}

/* ── Following the K9 team ───────────────────────────────────────────────
   During an incident the map keeps the team, the last known point and the
   perimeter in view by itself. A hand on the map (a drag, a pinch, a wheel,
   a tap on a unit in the list) means someone wants to look elsewhere: the
   map stops following and a Follow K9 button brings it back. Drawing a line
   or setting a point never moves the map under the finger either. */
const FOLLOW_GAP_MS = 2500;
function onHand(e) {
  /* Only the person's own moves: the map easing itself has no originalEvent. */
  if (e && !e.originalEvent) return;
  pauseFollow();
}
function pauseFollow() {
  if (I.follow.paused || !followable()) return;
  I.follow.paused = true;
  paintFollowBtn();
}
const HAND_EVENTS = ['dragstart', 'zoomstart', 'rotatestart', 'pitchstart'];
function handsOn(m) { for (const ev of HAND_EVENTS) m.on(ev, onHand); }
function handsOff(m) { for (const ev of HAND_EVENTS) m?.off(ev, onHand); }
/** There is a live incident with a team on the map to follow. */
function followable() {
  const v = shown();
  return !!(v.inc && v.inc.status === 'active' && !v.replay && v.inc.k9Uid);
}
function paintFollowBtn() {
  const b = $('cmdFollow');
  if (b) b.hidden = !(I.follow.paused && followable());
}
function resumeFollow() {
  I.follow.paused = false;
  I.follow.at = 0;
  paintFollowBtn();
  /* In Handler's view, back to the dog close in, on the next paint. */
  if (I.hv) return paintCommandNow();
  followTeam(shown(), commandView(), shown().inc, true);
}
function followTeam(v, st, live, force = false) {
  const g = map();
  if (!g.map || !live || !live.k9Uid) return paintFollowBtn();
  /* A new incident follows from the start, whatever the last one was left at. */
  if (I.follow.for !== live.id) I.follow = { paused: false, at: Date.now(), for: live.id };
  paintFollowBtn();
  if (I.follow.paused || I.tool || I.form || g.map.isMoving?.()) return;
  const k9 = st.positions?.get(live.k9Uid) ?? null;
  /* A scenario's ending (the find, or the trail going out of the ring) is
     the moment the room watches: the map closes in on it once, the last
     stretch of the trail and the points round the team, rather than
     the whole incident shrunk to the middle of the screen. */
  const ending = I.sim?.script && I.sim.over && I.sim.inc === live && k9 ? endingPoints(v.trail, k9, v.marks) : null;
  if (ending && I.follow.ending !== live.id) { I.follow.ending = live.id; force = true; }
  if (!force && Date.now() - I.follow.at < FOLLOW_GAP_MS) return;
  const pts = ending || followPoints({ inc: live, marks: v.marks, k9 });
  const c = g.map.getCanvas?.();
  const size = { w: c?.clientWidth || window.innerWidth, h: c?.clientHeight || window.innerHeight };
  const onScreen = pts.map(p => g.map.project([p.lon, p.lat]));
  if (!force && allInView(onScreen, size, mapPad())) return;
  I.follow.at = Date.now();
  /* Room round the team and the point, so the map does not move again at
     the team's very next step. */
  const room = [];
  if (k9) for (const b of [0, 90, 180, 270]) room.push(project(k9, b, ending ? 40 : 80));
  if (!ending) for (const b of [0, 90, 180, 270]) room.push(project(live.lkp, b, 120));
  fitOnMap([...pts, ...room], 17);
}
/* The ending's frame: the team, the last ENDING_M of its trail, and the
   points standing near it (a sighting, the car's post). */
const ENDING_M = 150;
function endingPoints(trail, k9, marks) {
  const pts = [{ lat: k9.lat, lon: k9.lon }];
  let m = 0;
  for (let i = trail.length - 1; i > 0 && m < ENDING_M; i--) { pts.push(trail[i]); m += dist(trail[i], trail[i - 1]); }
  for (const mk of marks) if (!MARKS[mk.kind]?.line && finite(mk.lat) && dist(mk, k9) <= 160) pts.push({ lat: mk.lat, lon: mk.lon });
  return pts;
}

/* ── Hearing the K9 team's calls ─────────────────────────────────────────
   The command screen says each call of the team out loud in the coach's
   voice ("K9-1, lost it"), so Command hears it without watching the map.
   Calls already made when the screen opens are not said; a handler does not
   hear their own. It can be switched off on the incident card. */
function speakCalls(v, st, live) {
  if (!live) return;
  if (I.said.for !== live.id) {
    I.said = { for: live.id, ids: new Set(v.marks.filter(mk => MARKS[mk.kind]?.k9).map(mk => mk.id)) };
    return;
  }
  const fresh = v.marks.filter(mk => MARKS[mk.kind]?.k9 && !I.said.ids.has(mk.id)).sort((a, b) => a.at - b.at);
  if (!fresh.length) return;
  for (const mk of fresh) I.said.ids.add(mk.id);
  /* In Handler's view the screen is the handler's phone, which never says
     the team's own calls back to them. */
  if (!I.voice || !ctx.speak || I.hv) return;
  const words = fresh.filter(mk => mk.by !== meUid()).map(mk => callWords(mk.kind, who(mk.by, st.members)));
  if (words.length) { try { ctx.speak(words.join('. ')); } catch { /* no voice here */ } }
}
function setVoice(on) {
  I.voice = !!on;
  try { ctx.kv.set('squadVoice', I.voice); } catch { /* full */ }
  paintCommandNow();
}

/* ── Wall mode's side (squad-ui.js draws the clock) ──────────────────────
   The incident and its latest lines, in big type. */
/* The last five lines of the live log, newest first as on the card, a
   withdrawn one crossed out; and the time since last seen with the
   perimeter warning. With no last-seen time given it says so, rather than
   show a last-seen clock nobody gave. */
function paintWall(v, st) {
  if (!wallOn()) { I.wallKey = ''; return; }
  const head = $('cmdWallInc');
  const line = v.inc
    ? `${v.inc.name} · ${v.replay ? 'replay' : v.inc.status === 'active' ? `${elapsedWords(v.now - v.inc.startedAt)} since start` : 'ended'}`
    : 'No incident';
  if (head.textContent !== line) head.textContent = line;
  const seen = $('cmdWallSeen');
  const rn = reachNow(v);
  const upTo = v.inc ? Math.min(v.now, v.inc.endedAt ?? Infinity) : 0;
  const since = !v.inc ? '' : finite(v.inc.lastSeenAt) ? `${elapsedWords(upTo - v.inc.lastSeenAt)} since last seen`
    : `Opened ${elapsedWords(upTo - v.inc.startedAt)} ago · last seen not given`;
  const seenLine = v.inc ? `${since}${rn.warn ? ` · ${rn.warn} · rough guide` : ''}` : '';
  if (seen.textContent !== seenLine) seen.textContent = seenLine;
  seen.classList.toggle('warn', !!rn.warn);
  const lines = v.inc ? logOf(v, st.members).filter(l => !l.ahead).slice(-5).reverse() : [];
  const key = lines.map(l => `${l.key}|${l.text}|${l.withdrawn || ''}`).join('\n');
  if (key === I.wallKey) return;
  I.wallKey = key;
  put($('cmdWallLog'), html`${lines.map(l => html`<li class="${l.withdrawn ? 'inc-log-off' : ''}"><span class="inc-log-text">${l.time} ${l.text}</span>${l.withdrawn ? html` <i class="inc-log-why">${l.withdrawn}</i>` : ''}</li>`)}`);
}

/* ── The panel ────────────────────────────────────────────────────────── */
function mode(v) {
  if (I.replay) return 'replay';
  if (I.form) return 'form';
  if (v.inc && v.inc.status === 'active') return 'active';
  return 'none';
}

function paintPanel(st, v = shown()) {
  const box = $('cmdIncident');
  const md = mode(v);
  const me = meUid();
  const cmd = amCommand();
  const lastEnded = st.sim ? (lastSim ? lastSim.ended.inc : null) : (pastOf(I.incidents)[0] ?? null);
  const running = !st.sim && sharingRun() && !!runGoing();
  const k9s = md === 'form' ? k9Options(st) : [];
  const key = JSON.stringify([md, v.inc?.id, I.tool?.kind, cmd, me, running, lastEnded?.id,
    k9s.map(k => [k.uid, k.on, k.record?.at ?? 0]), I.form?.k9Uid, !!I.form?.lkp, I.form?.pace, I.form?.article, I.replay?.playing, I.replay?.speed, I.voice, !!I.reveal]);
  if (md === 'none' && !cmd && !lastEnded) { box.hidden = true; I.panelKey = ''; return; }
  box.hidden = false;
  if (key !== I.panelKey) {
    I.panelKey = key;
    I.logKey = '';
    put(box, panelHtml(md, { st, v, me, cmd, lastEnded, running, k9s }));
  }
  paintLive(box, st, v);
  paintLog(box, st, v);
  /* A focus or a jump inside the card can scroll the panel itself, which
     has no scroll bar of its own: put it back, so the Demo label at its
     top is always in view (the card scrolls inside itself instead). */
  const panel = $('cmdPanel');
  if (panel && panel.scrollTop) panel.scrollTop = 0;
}

function panelHtml(md, { st, v, me, cmd, lastEnded, running, k9s }) {
  if (md === 'replay') {
    const r = I.replay;
    return html`<div class="inc-card inc-replay">
      <p class="inc-kicker">Debrief replay</p>
      <h3 class="inc-name">${r.rp.inc.name}</h3>
      <input type="range" class="inc-scrub" data-inc-scrub min="0" max="${Math.round((r.rp.end - r.rp.start) / 1000)}" step="1" value="0" aria-label="Replay time">
      <p class="inc-clock" data-inc-text="clock"></p>
      <p class="inc-onscent" data-inc-text="onScent"></p>
      <p class="inc-warn" data-inc-text="warn"></p>
      <div class="inc-tools">
        <button type="button" class="btn small moss" data-inc-act="play">${r.playing ? 'Pause' : 'Play'}</button>
        <button type="button" class="btn ghost small" data-inc-act="speed">×${r.speed}</button>
        <button type="button" class="btn ghost small" data-inc-act="unreplay">Back to live</button>
        ${cmd && r.source ? html`<button type="button" class="btn ghost small" data-inc-act="report" data-inc-id="${r.source}">Deployment report</button>` : ''}
      </div>
      ${r.source === 'sim' && lastSim?.ended?.inc.id === r.rp.inc.id ? revealHtml() : ''}
      ${frozenCardHtml(r.rp.inc, st.members?.get(r.rp.inc.k9Uid)?.dog ?? null)}
      ${logHtml()}
    </div>`;
  }
  if (md === 'form') {
    const f = I.form;
    return html`<div class="inc-card">
      <p class="inc-kicker">Start an incident</p>
      <label class="inc-field">Name<input type="text" data-inc-name maxlength="80" value="${f.name}" autocomplete="off"></label>
      <p class="inc-hint">${f.lkp ? 'Last known point set. Tap the map again to move it.' : 'Tap the map where the person was last seen.'}</p>
      <label class="inc-field">Last seen at<input type="time" data-inc-seen value="${f.seen}"></label>
      <p class="inc-hint">Leave it empty for when the incident opens.</p>
      <p class="inc-label">How they left</p>
      <div class="inc-chips">${[...PACE_KEYS.map(k => [k, PACES[k].label]), ['', 'Not known']].map(([k, t]) => html`<button type="button" class="chip" data-inc-pace="${k}" aria-pressed="${String((f.pace || '') === k)}">${t}</button>`)}</div>
      <p class="inc-label">Handler’s brief</p>
      <label class="inc-field">Direction of travel<input type="text" data-inc-dir maxlength="${DIR_MAX}" value="${f.dir}" placeholder="north, towards the station" autocomplete="off"></label>
      <label class="inc-field">Description<input type="text" data-inc-desc maxlength="${DESC_MAX}" value="${f.desc}" placeholder="what they look like, what they wear" autocomplete="off"></label>
      <p class="inc-hint">${DESC_HINT}</p>
      <p class="inc-label">Scent article</p>
      <div class="inc-chips">${[['yes', 'Yes'], ['no', 'No'], ['', 'Not known']].map(([k, t]) => html`<button type="button" class="chip" data-inc-art="${k}" aria-pressed="${String(artKey(f.article) === k)}">${t}</button>`)}</div>
      <p class="inc-label">K9 team to trail</p>
      <div class="inc-chips">
        ${k9s.length ? k9s.map(k => html`<button type="button" class="chip" data-inc-k9="${k.uid}" aria-pressed="${String(f.k9Uid === k.uid)}">${k.callSign}${k.dog ? ` · ${k.dog}` : ''}${k.on ? '' : ' (off duty)'}</button>`) : ''}
        <button type="button" class="chip" data-inc-k9="" aria-pressed="${String(!f.k9Uid)}">None yet</button>
      </div>
      ${k9s.some(k => k.uid === f.k9Uid && !k.on) ? html`<p class="inc-hint">That team is off duty: nothing of theirs is shared until they go On duty and tap Start trailing.</p>` : ''}
      ${pickCardHtml(k9s, f.k9Uid, st.sim ? viewNow() : Date.now())}
      <p class="sq-err" data-inc-err role="alert"></p>
      <div class="inc-tools">
        <button type="button" class="btn small moss" data-inc-act="go">Start incident</button>
        <button type="button" class="btn ghost small" data-inc-act="cancel">Cancel</button>
      </div>
    </div>`;
  }
  if (md === 'active') {
    const inc = v.inc;
    const k9 = inc.k9Uid ? st.members.get(inc.k9Uid) : null;
    const team = k9 ? `${k9.callSign}${k9.dog ? ` · ${k9.dog}` : ''}` : 'No K9 team';
    const mayDraw = me !== inc.k9Uid || cmd;
    const tool = I.tool;
    return html`<div class="inc-card inc-live">
      <button type="button" class="inc-strip" data-inc-act="unfold" aria-label="Show the incident card"><span class="inc-dot" aria-hidden="true"></span><span data-inc-text="strip"></span></button>
      <p class="inc-kicker"><span class="inc-dot" aria-hidden="true"></span> Incident</p>
      <h3 class="inc-name">${inc.name}</h3>
      <p class="inc-seen"><b class="inc-seen-clock" data-inc-text="seenClock"></b><span class="inc-seen-sub" data-inc-text="seenSub"></span></p>
      <p class="inc-warn" data-inc-text="warn" role="status"></p>
      <p class="inc-team"><b>${team}</b> <span data-inc-text="state"></span></p>
      <p class="inc-cover" data-inc-text="cover"></p>
      <p class="inc-onscent" data-inc-text="onScent"></p>
      <p class="inc-scene" data-inc-text="scene"></p>
      <p class="inc-inside" data-inc-text="inside" role="status"></p>
      <p class="inc-facts" data-inc-text="facts"></p>
      <p class="inc-brief" data-inc-text="brief"></p>
      <p class="inc-reach" data-inc-text="reach"></p>
      <p class="inc-band" data-inc-text="band"></p>
      <p class="inc-quiet" data-inc-text="quiet"></p>
      ${frozenCardHtml(inc, st.members?.get(inc.k9Uid)?.dog ?? null)}
      ${me === inc.k9Uid && !st.sim ? html`<div class="inc-tools">
        ${running ? html`<span class="inc-hint">Your run is streaming to the squad. Marks you drop on the run screen show here.</span>`
                  : html`<button type="button" class="btn small moss" data-inc-act="trail">Start trailing</button>
                     <button type="button" class="btn ghost small" data-inc-act="k9:indication">Indication</button>
                     <button type="button" class="btn ghost small" data-inc-act="k9:lost">Lost it</button>
                     <button type="button" class="btn ghost small" data-inc-act="k9:refound">Re-found</button>`}
      </div>` : ''}
      ${mayDraw && !tool ? html`<p class="inc-label">Add to the map</p>
      <div class="inc-tools">${DRAW_TOOLS.map(k => html`<button type="button" class="btn ghost small inc-tool inc-t-${k}" data-inc-act="tool:${k}">${MARKS[k].label}</button>`)}</div>` : ''}
      ${tool ? html`<p class="inc-hint">${tool.kind === 'perimeter' ? 'Tap the map along the line. Done when it is drawn.' : `Tap the map where the ${MARKS[tool.kind].label.toLowerCase()} is.`}</p>
      <div class="inc-tools">
        ${tool.kind === 'perimeter' ? html`<button type="button" class="btn small moss" data-inc-act="done">Done</button>
          <button type="button" class="btn ghost small" data-inc-act="undo">Undo point</button>` : ''}
        <button type="button" class="btn ghost small" data-inc-act="untool">Cancel</button>
      </div>` : ''}
      <div class="inc-tools">
        <button type="button" class="btn ghost small" data-inc-act="fit">Show the incident</button>
        ${st.sim && inc.k9Uid ? html`<button type="button" class="btn small moss" data-inc-act="hv">Handler’s view</button>` : ''}
        ${cmd ? html`<button type="button" class="btn ghost small" data-inc-act="seen">Last seen &amp; brief</button>
          <button type="button" class="btn ghost small" data-inc-act="cover">Cover officer</button>` : ''}
        <button type="button" class="btn ghost small" data-inc-act="paces">Paces</button>
        ${ctx.speak ? html`<button type="button" class="btn ghost small" data-inc-act="voice" aria-pressed="${String(I.voice)}">${I.voice ? 'Voice on' : 'Voice off'}</button>` : ''}
        ${cmd ? html`<button type="button" class="btn danger small" data-inc-act="end">End incident</button>` : ''}
      </div>
      ${logHtml()}
    </div>`;
  }
  /* The last incident comes first: on a phone its Deployment report is the
     next thing to do, and must not sit below the fold under the start buttons. */
  const shownEnded = st.sim && lastEnded && lastSim?.ended?.inc === lastEnded;
  return html`<div class="inc-card">
    ${lastEnded ? html`<p class="inc-last">Last incident: <b>${lastEnded.name}</b>
      <button type="button" class="btn ghost small" data-inc-act="replay" data-inc-id="${st.sim ? 'sim' : lastEnded.id}">Replay</button>
      ${cmd ? html`<button type="button" class="btn ghost small" data-inc-act="report" data-inc-id="${st.sim ? 'sim' : lastEnded.id}">Deployment report</button>` : ''}</p>
      ${shownEnded ? revealHtml() : ''}` : ''}
    ${cmd ? html`<div class="inc-tools">
      <button type="button" class="btn small ember" data-inc-act="start">Start incident</button>
      ${st.sim ? html`<button type="button" class="btn small moss" data-inc-act="scenario">Start scenario</button>` : ''}
    </div>` : ''}
  </div>`;
}

const artKey = (a) => (a === true ? 'yes' : a === false ? 'no' : '');

/** The rings and the perimeter lines they have passed, for what is on the
    map now (a replay's moment included). */
function reachNow(v) {
  if (!v.inc) return { reach: null, passed: [], warn: '' };
  /* A pretend story's own pace (a frail man walks slower) goes ahead of this
     device's: in memory, for that story only, never saved anywhere. */
  const story = [I.sim, lastSim?.ended].find(si => si?.inc?.id === v.inc.id && si.paces);
  const reach = reachRings({ inc: v.inc, now: v.now, paces: story && (v.sim || I.replay?.source === 'sim') ? { ...I.paces, ...story.paces } : I.paces });
  const passed = passedLines({ inc: v.inc, marks: v.marks, reach });
  return { reach, passed, warn: passed.length ? warnWords(reach.pace) : '' };
}

/* ── Keeping officers off the track ───────────────────────────────────────
   Worked out on this device from what it already has (incident.js): the
   pretend squad's own tracks, a replay's, or for a real squad the positions
   this device has seen since the incident opened. Nothing more is read
   from the cloud, and nothing of it is written there. */
const WALK_MAX = 2000;   // fixes kept a member: hours at the duty rate
function noteWalkers(st) {
  const a = I.active;
  if (!a || a.status !== 'active') return;
  if (I.walked.for !== a.id) I.walked = { for: a.id, lines: new Map() };
  for (const p of st.positions?.values?.() ?? []) {
    if (!(p.at >= a.startedAt)) continue;
    let u = I.walked.lines.get(p.uid);
    if (!u) I.walked.lines.set(p.uid, (u = { uid: p.uid, pts: [] }));
    const last = u.pts[u.pts.length - 1];
    if (last && p.at <= last.t) continue;
    u.pts.push({ lat: p.lat, lon: p.lon, t: p.at, spd: p.spd });
    if (u.pts.length > WALK_MAX) u.pts.shift();
  }
}
/** Everyone's movements for the incident on the map, uid → { uid, pts }. */
function linesOf(v) {
  if (v.replay && I.replay) return new Map(I.replay.rp.units.map(u => [u.uid, u]));
  if (v.sim) return new Map([...(I.sim?.tracks ?? [])].map(([uid, pts]) => [uid, { uid, pts }]));
  return I.walked.for === v.inc?.id ? I.walked.lines : new Map();
}
/** Who walked the scene before the dog (or so far, while it is on its way). */
function sceneOf(v, members, trail = v.trail, now = v.now) {
  if (!v.inc) return { names: [], started: false, text: '' };
  const on = scentStart(trail, v.inc.lkp);
  const started = !!on && on.t <= now;
  const names = sceneWalkers({ inc: v.inc, lines: linesOf(v), until: started ? on.t : now }).map(w => who(w.uid, members));
  return { names, started, text: sceneWords(names, started) };
}
/** The wind at the last known point, as the app already fetched it. */
const windAt = (p) => (p && ctx.windNear ? ctx.windNear(p) : null);
/** The downwind band, for a live incident only: today's wind says nothing
    about the air during a replay. */
function bandOf(v) {
  if (!v.inc || v.inc.status !== 'active' || v.replay) return null;
  return downwindBand(v.inc.lkp, windAt(v.inc.lkp));
}
function bandText(v) {
  if (!v.inc || v.inc.status !== 'active' || v.replay) return '';
  const w = windAt(v.inc.lkp);
  if (!w) return '';
  const said = bandWindWords(w, imperial());
  return bandOf(v) ? `${BAND_WORDS} (${said})` : `No downwind band: ${said}`;
}
/** Units inside the perimeter on foot, for a live incident. */
function insideOf(v, st) {
  if (!v.inc || v.inc.status !== 'active' || v.replay) return [];
  return insideWalkers({ inc: v.inc, marks: v.marks, rows: st.rows || [], lines: linesOf(v), now: v.now });
}
/* Each unit is said once as it goes in. Out for a couple of minutes and
   back in, it is said again; out for a moment (a detour round a building
   reads as walking out, GPS jumps) it is not, or the log would fill with
   the same line. Only one heard just now and staying put: walking out, or
   last heard minutes ago, is on the card in softer words but never said
   out loud. Each time is kept for the log too, so a moment that lasts
   seconds at ×10 is still there on the Wall and in the replay (this device
   only). Times are the incident's clock (the pretend one runs fast). */
const SEEN_IN_MAX = 200;
const BACK_IN_MS = 2 * 60e3;
function speakInside(v, list) {
  /* Kept on the device for a real incident watched live: never a replay
     (its clock is the past) and never the pretend one (memory only). */
  const keep = !!v.inc && !v.replay && !v.sim && v.inc.status === 'active';
  if (I.inside.for !== v.inc?.id) {
    I.inside = { for: v.inc?.id ?? null, ids: new Map(), seen: [] };
    if (keep) keepInside(v.inc.id);
  }
  /* One already said who now reads as walking out is still inside: keep
     their time fresh, or stopping again a few minutes later would log a
     second "went inside" for someone who never left. One never said is
     not marked, so they are still said if they stop inside. */
  for (const w of list || []) {
    if (!w.old && w.going && I.inside.ids.has(w.uid)) I.inside.ids.set(w.uid, v.now);
  }
  for (const w of insideNow(list)) {
    const last = I.inside.ids.get(w.uid);
    I.inside.ids.set(w.uid, v.now);
    if (last != null && v.now - last < BACK_IN_MS) continue;
    if (I.inside.seen.length < SEEN_IN_MAX) {
      I.inside.seen.push({ uid: w.uid, callSign: w.callSign, m: w.m, t: v.now, at: { lat: w.lat, lon: w.lon } });
      if (keep) keepInside(v.inc.id);
    }
    if (I.voice && ctx.speak && sq().view && !I.hv) { try { ctx.speak(`${w.callSign} is inside the perimeter`); } catch { /* no voice */ } }
  }
}

/** Command puts a cover officer with the K9 team. */
async function pickCover() {
  const v = shown();
  if (!v.inc || v.inc.status !== 'active' || v.replay || !amCommand()) return;
  const st = commandView();
  const rows = roster(st.members, st.positions || new Map(), v.now);
  /* Officers only: Command runs the scene and another dog's handler is the
     standby team. Nearest the handler first, by the app's positions; the
     roster's names, so a second "Foot 3" shows as "Foot 3 (2)". */
  const k9 = rows.find(r => r.uid === v.inc.k9Uid);
  const far = (r) => (r.pos && k9?.pos ? dist(r.pos, k9.pos) : Infinity);
  const officers = rows.filter(r => r.uid !== v.inc.k9Uid && r.role !== 'command' && r.role !== 'k9')
    .sort((a, b) => far(a) - far(b) || a.callSign.localeCompare(b.callSign, undefined, { numeric: true }));
  const choices = [{ value: '', text: 'None' }, ...officers.map(r => ({ value: r.uid,
    text: Number.isFinite(far(r)) ? `${r.callSign} · ${aboutWords(far(r), imperial())} from the handler` : r.callSign }))];
  /* An officer who was cover but has since been made Command still shows, so saving keeps them. */
  const kept = v.inc.coverUid && !officers.some(r => r.uid === v.inc.coverUid) ? rows.find(r => r.uid === v.inc.coverUid) : null;
  if (kept) choices.push({ value: kept.uid, text: kept.callSign });
  const got = await form({
    title: 'Cover officer',
    body: 'Who goes with the K9 team. The card shows how far they are from the handler, from the app’s positions.',
    fields: [{ key: 'uid', label: 'Cover', value: v.inc.coverUid || officers[0]?.uid || '', choices }],
    note: 'Positions can be 10–30 s old and 5–20 m off: the radio stays the way to check.',
    yes: 'Save',
  });
  if (!got) return;
  /* The sheet was up a while: the incident may have ended under it. */
  const now = shown();
  if (!now.inc || now.inc.id !== v.inc.id || now.inc.status !== 'active') return;
  if (now.sim) { I.sim.setCover(got.uid || null); paintCommandNow(); return; }
  try {
    const h = await ctx.handle();
    await setCover(h, I.sid, now.inc, got.uid || null);
  } catch (e) {
    ctx.toast(String(e?.code || '').includes('permission') ? 'Only Command can choose the cover' : 'Could not save it');
  }
}

/* ── The live log ─────────────────────────────────────────────────────────
   Built from the incident, the trail and every mark (incident.js logLines),
   newest first on the card. A tap on a line takes the map there, and in a
   replay the slider to that moment too. */
const logHtml = () => html`<p class="inc-label">Log</p><ol class="inc-log" data-inc-log aria-label="Incident log"></ol>`;

function logOf(v, members) {
  if (!v.inc) return [];
  const k9 = v.inc.k9Uid ? members?.get(v.inc.k9Uid) : null;
  const team = k9 ? `${who(v.inc.k9Uid, members)}${k9.dog ? ` ${k9.dog}` : ''}` : '';
  const sceneAt = (trail) => { const sc = sceneOf(v, members, trail, Infinity); return sc.started ? sc.text : ''; };
  const inside = I.inside.for === v.inc.id ? I.inside.seen : [];
  const base = { inc: v.inc, who: (uid) => who(uid, members), team, inside, imperial: imperial() };
  if (!v.replay || !I.replay) return logLines({ ...base, marks: v.said || v.marks, trail: v.trail, scene: sceneAt(v.trail) });
  /* A replay lists the whole incident, so a tap can jump forward as well as
     back, and no line arrives under a finger: what had happened by the
     slider's moment as it stood then, and what is still to come, dimmed. */
  const rp = I.replay.rp;
  const unit = rp.units.find(u => u.uid === rp.inc.k9Uid);
  const whole = sceneAt(unit ? unit.pts : []);
  const past = logLines({ ...base, marks: v.said, trail: v.trail, now: v.now, scene: whole });
  const ahead = logLines({ ...base, marks: rp.marks, trail: unit ? unit.pts : [], now: Infinity, scene: whole })
    .filter(l => l.t > v.now).map(l => ({ ...l, withdrawn: null, ahead: true }));
  return [...past, ...ahead];
}

function paintLog(box, st, v) {
  const el = box.querySelector('[data-inc-log]');
  if (!el) return;
  const lines = logOf(v, st.members);
  /* In a replay, the latest line by the slider's moment is marked. */
  let at = -1;
  if (v.replay) lines.forEach((l, i) => { if (!l.ahead) at = i; });
  const key = `${at}\n${lines.map(l => `${l.key}|${l.time}|${l.text}|${l.withdrawn || ''}|${l.ahead ? 1 : 0}`).join('\n')}`;
  if (key === I.logKey) return;
  I.logKey = key;
  I.log = lines;
  const cls = (l, i) => [l.withdrawn ? 'inc-log-off' : '', l.ahead ? 'inc-log-ahead' : '', i === at ? 'inc-log-now' : ''].filter(Boolean).join(' ');
  put(el, html`${lines.map((l, i) => html`<li class="${cls(l, i)}"><button type="button" class="inc-log-line" data-inc-log-i="${i}"${i === at ? html` aria-current="true"` : ''}><time>${l.time}</time> <span class="inc-log-text">${l.text}</span>${l.withdrawn ? html` <i class="inc-log-why">${l.withdrawn}</i>` : ''}</button></li>`).reverse()}`);
}

/** A tap on a line of the log. */
function onLogLine(i) {
  const l = I.log[i];
  if (!l) return;
  if (I.replay) {
    const r = I.replay;
    playReplay(false);
    r.t = Math.max(r.rp.start, Math.min(r.rp.end, l.t));
    paintCommandNow();
  } else {
    pauseFollow();
  }
  if (l.pts?.length) fitOnMap(l.pts, 17);
  else if (l.at) fitOnMap([l.at]);
}

/* ── Last seen, the brief and the paces, changed after the start ───────── */
async function editSeen() {
  const v = shown();
  if (!v.inc || v.inc.status !== 'active' || v.replay || !amCommand()) return;
  const inc = v.inc;
  const got = await form({
    title: 'Last seen and the brief',
    body: 'The clock and the rings start from last seen.',
    fields: [
      /* Only what Command said: an empty time and "Not known" stay so on
         Save, rather than the opening time and walking being written in. */
      { key: 'seen', label: 'Last seen at', type: 'time', value: finite(inc.lastSeenAt) ? hhmm(inc.lastSeenAt) : '',
        hint: 'Empty: not known, the clock runs from when the incident opened.' },
      { key: 'pace', label: 'How they left', value: inc.pace || '',
        choices: [{ value: '', text: 'Not known' }, ...PACE_KEYS.map(k => ({ value: k, text: PACES[k].label }))] },
      { key: 'dir', label: 'Direction of travel', value: inc.brief?.dir || '', max: DIR_MAX },
      { key: 'desc', label: 'Description', value: inc.brief?.desc || '', max: DESC_MAX, hint: DESC_HINT },
      { key: 'art', label: 'Scent article', value: artKey(inc.brief?.article ?? null),
        choices: [{ value: '', text: 'Not known' }, { value: 'yes', text: 'Yes' }, { value: 'no', text: 'No' }] },
    ],
    yes: 'Save',
  });
  if (!got) return;
  /* The sheet was up a while: the incident may have ended under it. */
  const now = shown();
  if (!now.inc || now.inc.id !== inc.id || now.inc.status !== 'active') return;
  const t = got.seen ? lastSeenFrom(got.seen, now.now) : null;
  if (got.seen && t == null) return ctx.toast('Last seen: a time like 14:05');
  if (Number.isNaN(t)) return ctx.toast('That time is after now');
  /* Refused rather than quietly moved to the opening: the clock and the
     rings hang on it, so Command should see it was not taken. */
  if (t != null && t > inc.startedAt) return ctx.toast('Last seen can’t be after the incident opened');
  const patch = { lastSeenAt: t, pace: got.pace || null,
                  brief: cleanBrief({ dir: got.dir, desc: got.desc, article: got.art === 'yes' ? true : got.art === 'no' ? false : null }) };
  if (now.sim) { I.sim.setSeen(patch); paintCommandNow(); return; }
  try {
    const h = await ctx.handle();
    await updateSeen(h, I.sid, now.inc, patch);
  } catch (e) {
    ctx.toast(String(e?.code || '').includes('permission') ? 'Only Command can change it' : 'Could not save it');
  }
}

async function editPaces() {
  const unit = imperial() ? 'mph' : 'km/h';
  const shownPace = (kmh) => String(imperial() ? Math.round(kmh / 1.609344) : kmh);
  const got = await form({
    title: 'Paces for the rings',
    body: `How far someone could go in an hour, in ${unit}.`,
    fields: PACE_KEYS.map(k => ({ key: k, label: PACES[k].label, value: shownPace(I.paces[k]), max: 5, inputmode: 'decimal' })),
    note: 'A rough guide, on this device only. It never moves or shrinks a perimeter: Command decides.',
    yes: 'Save', grid: true,
  });
  if (!got) return;
  const kmh = {};
  for (const k of PACE_KEYS) {
    const n = Number(String(got[k]).replace(',', '.'));
    kmh[k] = imperial() ? n * 1.609344 : n;
  }
  I.paces = cleanPaces(kmh);
  try { ctx.kv.set('squadPaces', I.paces); } catch { /* full */ }
  paintCommandNow();
}

/* What changes every second goes in by textContent, so the panel is not
   rebuilt under a finger or a cursor. */
function paintLive(box, st, v) {
  const text = (k, s) => { const el = box.querySelector(`[data-inc-text="${k}"]`); if (el && el.textContent !== s) el.textContent = s; };
  if (I.replay) {
    const r = I.replay;
    const nMarks = r.scene ? r.scene.marks.length : 0;
    text('clock', `${clockWords(r.t - r.rp.start)} of ${clockWords(r.rp.end - r.rp.start)} · ${nMarks} mark${nMarks === 1 ? '' : 's'}`);
    const s = box.querySelector('[data-inc-scrub]');
    if (s && document.activeElement !== s) s.value = String(Math.round((r.t - r.rp.start) / 1000));
    text('onScent', onScentWords({ inc: v.inc, trail: v.trail, now: v.now }));
    text('warn', reachNow(v).warn);
  }
  if (v.inc && v.inc.status === 'active' && !I.replay) {
    const info = trailInfo(v.trail, v.inc, v.now);
    const going = v.trail.length >= 2;
    /* The team's last call on the scent is what the others act on. */
    const call = v.marks.filter(mk => MARKS[mk.kind].k9).sort((a, b) => b.at - a.at)[0];
    const lastCall = call ? ` · last call: ${MARKS[call.kind].label}, ${elapsedWords(v.now - call.at)} ago` : '';
    const story = simState(v);
    text('state', story ? `${story}${lastCall}` : going ? `${info.heading != null ? `trailing, heading ${info.compass}` : 'trailing'}${lastCall}` : 'on the way to the last known point');
    const bits = [`${elapsedWords(info.elapsedMs)} since start`];
    if (going) bits.push(`${distWords(info.lengthM)} of trail`, `${distWords(info.fromLkpM)} from the last known point`);
    const counts = {};
    for (const mk of v.marks) counts[mk.kind] = (counts[mk.kind] || 0) + 1;
    const said = Object.keys(counts).map(k => countWords(k, counts[k]));
    if (said.length) bits.push(said.join(', '));
    text('facts', bits.join(' · '));
    const k9 = v.inc.k9Uid ? st.members.get(v.inc.k9Uid) : null;
    /* The clock from last seen, and how far that is at the chosen pace. */
    const rn = reachNow(v);
    /* The folded phone strip carries the same clock and warning as the card. */
    /* Who is inside the perimeter is for Command, who decides what to do. */
    const inside = amCommand() ? insideOf(v, st) : [];
    text('strip', stripWords({ k9, info, call, now: v.now, warn: rn.warn, inside,
                               seenMs: finite(v.inc.lastSeenAt) ? v.now - v.inc.lastSeenAt : null }));
    box.querySelector('.inc-strip')?.classList.toggle('warn', !!rn.warn || insideNow(inside).length > 0);
    text('quiet', quietLines(st.rows, v.now).join('\n'));
    const from = seenAt(v.inc);
    text('seenClock', clockWords(v.now - from));
    text('seenSub', ` since last seen at ${hhmm(from)}${from === v.inc.startedAt ? ' (when the incident opened)' : ''}`);
    text('warn', rn.warn);
    text('onScent', onScentWords({ inc: v.inc, trail: v.trail, now: v.now }));
    text('brief', briefWords(v.inc.brief, v.inc.pace));
    text('reach', reachWords(rn.reach, imperial()));
    const sc = sceneOf(v, st.members);
    text('scene', sc.text ? `${sc.text} (within about 30 m, by the app’s positions)` : '');
    text('inside', inside.map(w => insideWords(w, imperial(), v.now)).join('\n'));
    speakInside(v, inside);
    const row = (uid) => (st.rows || []).find(r => r.uid === uid) || null;
    const cover = v.inc.coverUid ? row(v.inc.coverUid) : null;
    text('cover', v.inc.coverUid ? coverWords({ name: cover?.callSign || who(v.inc.coverUid, st.members), cover,
      k9: row(v.inc.k9Uid), now: v.now, imperial: imperial() }) : '');
    text('band', bandText(v));
  }
}

function onPanelClick(e) {
  const box0 = $('cmdIncident');
  const k9 = e.target.closest('[data-inc-k9]');
  if (k9 && I.form) { readForm(box0); I.form.k9Uid = k9.dataset.incK9 || null; return paintCommandNow(); }
  const pace = e.target.closest('[data-inc-pace]');
  if (pace && I.form) { readForm(box0); I.form.pace = pace.dataset.incPace || null; return paintCommandNow(); }
  const art = e.target.closest('[data-inc-art]');
  if (art && I.form) {
    readForm(box0);
    I.form.article = art.dataset.incArt === 'yes' ? true : art.dataset.incArt === 'no' ? false : null;
    return paintCommandNow();
  }
  const line = e.target.closest('[data-inc-log-i]');
  if (line) return onLogLine(Number(line.dataset.incLogI));
  const b = e.target.closest('[data-inc-act]');
  if (!b) return;
  const act = b.dataset.incAct;
  if (I.form) readForm(box0);
  if (act === 'start') return openForm();
  if (act === 'scenario') return startScenario();
  if (act === 'reveal') return revealRoute();
  if (act === 'cancel') { I.form = null; return paintCommandNow(); }
  if (act === 'go') return doStart();
  if (act === 'end') return doEnd();
  if (act === 'fit') return fitIncident();
  if (act === 'hv') return setHv(true);
  if (act === 'unfold') return foldPanel(false);
  if (act === 'voice') return setVoice(!I.voice);
  if (act === 'seen') return editSeen();
  if (act === 'paces') return editPaces();
  if (act === 'cover') return pickCover();
  if (act === 'trail') return startTrailing();
  if (act.startsWith('k9:')) {
    const fix = sq().fix;
    if (!fix) return ctx.toast('No position yet. Switch On duty first');
    return addMark(act.slice(3), { lat: fix.lat, lon: fix.lon });
  }
  if (act.startsWith('tool:')) { I.tool = { kind: act.slice(5), pts: [] }; return paintCommandNow(); }
  if (act === 'undo') { I.tool?.pts.pop(); return paintCommandNow(); }
  if (act === 'untool') { I.tool = null; return paintCommandNow(); }
  if (act === 'done') {
    const pts = I.tool?.pts || [];
    if (pts.length < 2) return ctx.toast('Tap at least two points for a line');
    I.tool = null;
    return addMark('perimeter', { pts });
  }
  if (act === 'replay') return openReplay(b.dataset.incId);
  if (act === 'report') return openReport(b.dataset.incId);
  if (act === 'play') return playReplay(!I.replay?.playing);
  if (act === 'speed' && I.replay) {
    I.replay.speed = REPLAY_SPEEDS[(REPLAY_SPEEDS.indexOf(I.replay.speed) + 1) % REPLAY_SPEEDS.length];
    return paintCommandNow();
  }
  if (act === 'unreplay') return closeReplay();
}

function onScrub(e) {
  const s = e.target.closest('[data-inc-scrub]');
  if (!s || !I.replay) return;
  I.replay.t = I.replay.rp.start + Number(s.value) * 1000;
  paintCommandNow();
}

/** The trailing team starts a run: a blind trail from where they stand,
    recorded as any run is, and streamed into the incident as it goes. */
async function startTrailing() {
  if (!I.active || !trailing()) return;
  if (!sq().onDuty) return ctx.toast('Switch On duty first: your trail is shared only while you are on duty');
  /* Before the dog goes: who has already walked the point, from the
     positions this phone has seen, so the handler knows whose scent is
     on it. The run itself starts on the same tap. */
  const inc = I.active;
  const v = { inc, trail: I.trail, now: Date.now() };
  const sc = sceneOf(v, sq().members, [], v.now);
  if (sc.names.length) {
    await info({ title: 'Before you start', close: 'Start trailing',
      items: [{ head: 'Who walked the scene', text: sceneWords(sc.names, true) },
              { head: 'From the app', text: SCENE_NOTE }] });
    if (I.active?.id !== inc.id || !trailing()) return;
  }
  I.consent = I.active.id;
  hideBanner();
  /* A run already going (the team was out when it was called) streams from
     the incident's start; otherwise a new one starts. */
  if (runGoing()) { ctx.toast('Your run is now streaming to the squad'); paintCommandNow(); return; }
  ctx.startTrail();
}

/* ── The banner, on every screen ─────────────────────────────────────── */
let demoUntil = 0, demoInc = null;
/** In the pretend squad there are no other phones to tell, so the banner
    every member would get is shown here for a few seconds instead. */
function demoBanner(inc) {
  demoInc = inc;
  demoUntil = Date.now() + 8000;
  paintBanner();
  setTimeout(paintBanner, 8100);
}

function paintBanner() {
  const b = $('incBanner');
  if (!b) return;
  const a = I.active;
  const onMap = ctx.screen() === 'scrCommand';
  if (demoInc && Date.now() < demoUntil) {
    b.hidden = false;
    $('incBannerName').textContent = `Incident: ${demoInc.name}`;
    $('incBannerSub').textContent = 'This is what every member sees: a banner, and their map opens on the incident';
    $('incBannerTrail').hidden = true;
    $('incBannerOpen').hidden = true;
    return;
  }
  demoInc = null;
  const show = !!a && !I.hidden.has(a.id) && !onMap;
  b.hidden = !show;
  if (!show) return;
  const members = sq().members;
  const k9 = a.k9Uid ? members.get(a.k9Uid) : null;
  $('incBannerName').textContent = `Incident: ${a.name}`;
  $('incBannerSub').textContent = `${k9 ? `${k9.callSign} trailing` : 'No K9 team yet'} · ${elapsedWords(Date.now() - a.startedAt)} since start`;
  $('incBannerTrail').hidden = !(trailing() && !(sharingRun() && runGoing()));
  $('incBannerOpen').hidden = false;
}
function hideBanner() { demoUntil = 0; if (I.active) I.hidden.add(I.active.id); paintBanner(); }

/* ── The squad screen's list of past incidents ───────────────────────── */
function paintOutside() {
  paintBanner();
  for (const id of ['sqSimReplay', 'sqSimReplay2']) { const b = $(id); if (b) b.hidden = !lastSim; }
  const wrap = $('sqPast');
  if (!wrap) return;
  const past = pastOf(I.incidents);
  wrap.hidden = !past.length;
  put($('sqPastList'), html`${past.slice(0, 10).map(i => html`<li class="sq-row">
    <span class="sq-who"><b>${i.name}</b><i>${new Date(i.startedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}${i.summary ? ` · ${elapsedWords(i.summary.durationMs)} · ${distWords(i.summary.k9M)} of trail` : ''}</i></span>
    <span class="sq-tools"><button type="button" class="btn ghost small" data-inc-replay="${i.id}">Replay</button></span>
  </li>`)}`);
}

/* ── Start up ─────────────────────────────────────────────────────────── */
export function initIncidents(c) {
  ctx = c;
  initHandler(c);
  loadSeen();
  onCommandPaint(paint);
  onPositionSent(onSent);
  onSquadChange((st) => {
    const sid = st.squad?.id ?? null;
    if (sid !== I.sid) follow(sid);
    if (!st.sim) noteWalkers(st);
  });
  try { I.voice = ctx.kv.get('squadVoice', true) !== false; } catch { /* the default */ }
  try { I.paces = cleanPaces(ctx.kv.get('squadPaces', null)); } catch { /* the defaults */ }
  onLook(pauseFollow);
  onWall(() => { I.wallKey = ''; I.follow.at = 0; if (sq().view) paintCommandNow(); });
  /* The pretend incident plays each pretend second as the squad does, so a
     scenario comes out the same however fast the clock runs. */
  onSimStep((t) => { if (I.sim) I.sim.step(t, simSpeed()); });
  $('cmdCapPause').addEventListener('click', () => { setSimPaused(!simPaused()); paintCommandNow(); });
  $('cmdCapSpeed').addEventListener('click', nextSimSpeed);
  $('cmdCapNext').addEventListener('click', nextBeat);
  $('cmdFollow').addEventListener('click', resumeFollow);
  $('cmdHandlerBack').addEventListener('click', () => setHv(false));
  $('cmdIncident').addEventListener('click', onPanelClick);
  $('cmdIncident').addEventListener('input', onScrub);
  /* A toggle does not bubble: caught on the way down, so the record card
     stays open when the panel is drawn again. */
  $('cmdIncident').addEventListener('toggle', (e) => { if (e.target.classList?.contains('inc-rec')) I.recOpen = e.target.open; }, true);
  $('incBannerOpen').addEventListener('click', () => { hideBanner(); openCommand(); });
  $('incBannerHide').addEventListener('click', hideBanner);
  $('incBannerTrail').addEventListener('click', startTrailing);
  for (const id of ['sqSimReplay', 'sqSimReplay2']) $(id).addEventListener('click', replayPretend);
  $('sqPastList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-inc-replay]');
    if (b) openReplay(b.dataset.incReplay);
  });
}

/** Where the command map's weather is for: the incident's last known
    point while there is one on the map, else null. */
export function incidentAirPoint() {
  if (!ctx) return null;
  const inc = I.replay ? I.replay.rp.inc : (sq().sim ? I.sim?.inc : I.active);
  return inc?.lkp ? { lat: inc.lkp.lat, lon: inc.lkp.lon } : null;
}

/** The last pretend incident's replay, from the squad screen: the pretend
    squad comes back up and the replay plays over it. */
function replayPretend() {
  if (!lastSim) return;
  openCommand({ sim: true });
  openReplay('sim');
}

/** For a screen change: the banner shows everywhere but the map itself. */
export const incidentScreen = () => { if (ctx) { paintOutside(); paintRun(); } };
