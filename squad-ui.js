/* The squad's screens: making or joining a squad, the roster, the On duty
   switch, and the command map with every on-duty member on it.

   app.js owns the map, the screens and sign-in; it hands them over once, in
   initSquad(ctx), and this module does the rest. The rules of the squad are
   in squad.js and the cloud in squad-cloud.js; this file only draws and
   listens.

   Names, call signs and dogs here were typed on other people's phones. They
   reach the page through textContent, or through html`` below, which escapes
   every value put into it. Nothing else writes HTML here. */

import { DEMO_LABEL, ROLES, JOIN_ROLES, roleOf, isCommand, canSetRole, canRemove, canLeave,
         cleanSquadName, cleanCallSign, cleanDogName, codeFromText, showCode, squadLink,
         SEND, shouldSend, headingOf, roster, onDutyCount, fitPoints, freshness, ageWords, compass,
         createSim, SIM_SQUAD } from './squad.js';
import { createSquad, findSquad, joinSquad, myMember, watchSquad, putPosition, clearPosition,
         setRole, removeMember, leaveSquad, newCode, deleteSquad, getSquad } from './squad-cloud.js';

/* ── Escaping ─────────────────────────────────────────────────────────── */
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);
const SAFE = Symbol('safe');
const safe = (s) => ({ [SAFE]: s });
/** A piece of HTML in which every value is escaped, unless it is itself a
    piece made this way (or a list of them). */
export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => {
    const one = (x) => (x && typeof x === 'object' && SAFE in x ? x[SAFE] : esc(x));
    out += (Array.isArray(v) ? v.map(one).join('') : one(v)) + strings[i + 1];
  });
  return safe(out);
}
/** The one way html`` pieces reach the page (incident-ui.js uses it too). */
export const put = (el, piece) => { el.innerHTML = piece[SAFE]; };

/* ── State ────────────────────────────────────────────────────────────── */
let ctx = null;
const S = {
  squad: null,          // { id, name, code, createdBy } while in one
  members: new Map(),
  positions: new Map(),
  stop: null,           // the squad listener's stop
  sim: null,            // pretend officers, while the demo runs
  view: false,          // the command map is up
  markers: new Map(),   // uid → { marker, el }
  tick: 0,
  fitted: false,
  found: null,          // the squad a code led to, waiting for a yes
  painters: new Set(),  // more to draw on the command map (incidents)
  watchers: new Set(),  // told when the squad or its members change (incidents)
  sent: new Set(),      // told of each position sent while on duty (incident tracks)
  override: null,       // a replay drawing the map instead of the live squad
  simClock: null,       // { real, base, speed }: the pretend squad's own clock
  lead: null,           // the unit drawn above the rest (the trailing K9 team)
};
const duty = { on: false, watch: 0, bg: null, last: null, prev: null, fix: null, starting: false, beat: 0 };
/* Moved on by every stop: a start that was waiting (on the iPhone's location
   prompt, say) when duty was switched off finds it has been overtaken, and
   undoes itself rather than leaving a location watcher nothing can stop. */
let dutyGen = 0;
/* How often the duty timer looks for a heartbeat to send. */
const BEAT_CHECK_MS = 15e3;

const $ = (id) => ctx.$(id);
const me = () => ctx.user()?.uid ?? null;
const myRow = () => S.members.get(me()) ?? null;

/* ── Where this phone keeps which squad it is in ─────────────────────── */
const remembered = () => { try { return ctx.kv.get('squad', null); } catch { return null; } };
const remember = (sq) => { try { ctx.kv.set('squad', sq ? { id: sq.id, name: sq.name } : null); } catch { /* full */ } };
const dutyWanted = () => { try { return ctx.kv.get('squadDuty', null); } catch { return null; } };
const wantDuty = (id) => { try { ctx.kv.set('squadDuty', id); } catch { /* full */ } };

async function handle() {
  const h = await ctx.handle();
  if (!h) throw new Error('Sign in first (Settings → Account)');
  return h;
}

/* ── Following the squad ──────────────────────────────────────────────── */
async function follow(id) {
  S.stop?.(); S.stop = null;
  let h;
  try { h = await ctx.handle(); } catch { h = null; }
  if (!h) return;
  S.stop = watchSquad(h, id, (u) => {
    if (u.gone) return lost();
    if (u.error) { ctx.toast(u.error); return; }
    S.squad = u.squad;
    S.members = u.members;
    S.positions = u.positions;
    remember(S.squad);
    paintAll();
  });
}

/** No longer a member: removed by Command, or the squad was deleted. */
function lost() {
  const name = S.squad?.name || remembered()?.name || 'the squad';
  stopDuty({ clear: false });
  S.stop?.(); S.stop = null;
  S.squad = null; S.members = new Map(); S.positions = new Map();
  remember(null); wantDuty(null);
  ctx.toast(`You are no longer in ${name}`);
  if (S.view && !S.sim) closeCommand();
  paintAll();
}

/* ── On duty ──────────────────────────────────────────────────────────── */
/* Only while the switch is on is anything sent. In the iPhone app the same
   background location the recorder uses keeps it going with the phone in a
   pocket; on the website it runs while the page is open, and stops when the
   browser stops giving the page fixes. */
async function startDuty() {
  if (duty.on || duty.starting || !S.squad) return;
  duty.starting = true;
  const gen = ++dutyGen;
  try {
    let h;
    try { h = await handle(); } catch (e) { ctx.toast(e.message); return; }
    if (gen !== dutyGen) return;
    const sid = S.squad.id;
    const send = (fix, now) => {
      duty.last = { ...fix, at: now };
      putPosition(h, sid, fix, now).catch(() => { /* Firestore retries; the next fix replaces it */ });
      for (const fn of S.sent) { try { fn({ ...fix, t: now }); } catch { /* their own */ } }
    };
    const onFix = (p) => {
      if (!duty.on || gen !== dutyGen || !S.squad || S.squad.id !== sid) return;
      const c = p.coords;
      const fix = { lat: c.latitude, lon: c.longitude, acc: c.accuracy ?? null, spd: c.speed ?? null, hdg: c.heading ?? null };
      fix.hdg = headingOf(duty.prev, fix);
      duty.prev = fix;
      duty.fix = { ...fix, at: Date.now() };
      const now = Date.now();
      if (!shouldSend(duty.last, fix, now)) return;
      send(fix, now);
    };
    const onErr = (e) => {
      const blocked = e?.code === 1 || e?.code === 'NOT_AUTHORIZED';
      if (blocked) { ctx.toast('Location is off for Trailcraft, so nothing is shared'); stopDuty(); }
    };
    duty.on = true;
    duty.last = null; duty.prev = null; duty.fix = null;
    if (ctx.isNative()) {
      let bg = null;
      try { bg = await ctx.watchBackground(onFix, onErr, { message: 'On duty: your squad can see where you are' }); }
      catch { bg = null; }
      /* Switched off (or signed out) while the prompt was up: stop what just
         started, and leave the switch off. */
      if (gen !== dutyGen) { try { bg?.stop?.(); } catch { /* gone */ } return; }
      if (!bg) { duty.on = false; ctx.toast('Could not start GPS'); return; }
      duty.bg = bg;
    } else {
      if (!navigator.geolocation || !window.isSecureContext) { duty.on = false; ctx.toast('This browser cannot share a position'); return; }
      duty.watch = navigator.geolocation.watchPosition(onFix, onErr,
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
    }
    if (gen !== dutyGen) return;
    /* A browser, and often a phone, stops handing out fixes while it is not
       moving. Standing still is still on duty: the last fix goes again,
       timed now, once a heartbeat is due, so the member does not dim and
       then grey out while their switch is on. */
    clearInterval(duty.beat);
    duty.beat = setInterval(() => {
      if (!duty.on || gen !== dutyGen || !duty.fix || !S.squad || S.squad.id !== sid) return;
      const now = Date.now();
      if (duty.last && now - duty.last.at < SEND.heartbeatMs) return;
      const { at, ...fix } = duty.fix;
      send(fix, now);
    }, BEAT_CHECK_MS);
    wantDuty(sid);
  } finally {
    if (gen === dutyGen) duty.starting = false;
    paintDuty();
  }
}

/** Off duty. The last position is deleted from the squad (clear), unless
    the account can no longer write there. */
export async function stopDuty({ clear = true } = {}) {
  const was = duty.on;
  dutyGen++;
  duty.on = false;
  duty.starting = false;
  clearInterval(duty.beat); duty.beat = 0;
  if (duty.watch) navigator.geolocation?.clearWatch(duty.watch);
  duty.watch = 0;
  duty.bg?.stop?.(); duty.bg = null;
  duty.last = null; duty.prev = null; duty.fix = null;
  wantDuty(null);
  if (was && clear && S.squad) {
    try { const h = await ctx.handle(); if (h) await clearPosition(h, S.squad.id); } catch { /* TTL clears it */ }
  }
  paintDuty();
}

function paintDuty() {
  for (const id of ['sqDuty', 'cmdDuty']) {
    const el = $(id);
    if (el) { el.checked = duty.on; el.disabled = duty.starting || !S.squad; }
  }
  const note = duty.on
    ? (ctx.isNative() ? 'Your squad sees where you are, even with the phone locked' : 'Your squad sees where you are while this page is open')
    : 'Nothing is shared while this is off';
  for (const id of ['sqDutyNote', 'cmdDutyNote']) { const el = $(id); if (el) el.textContent = note; }
}

/* ── The squad screen ─────────────────────────────────────────────────── */
export function paintSquad() {
  if (!ctx) return;
  const signedIn = !!ctx.user();
  const configured = ctx.configured();
  const inSquad = !!S.squad;
  $('sqNone').hidden = inSquad;
  $('sqIn').hidden = !inSquad;
  $('sqSignInBtn').hidden = !configured || signedIn;
  $('sqNoCloud').hidden = configured;
  $('sqCreate').hidden = !signedIn;
  $('sqJoin').hidden = !signedIn;
  if (!inSquad) {
    /* Remembered from last time but not heard from yet: still loading. */
    $('sqLoading').hidden = !(signedIn && remembered());
    return;
  }
  $('sqLoading').hidden = true;
  const mine = myRow();
  const cmd = isCommand(mine);
  $('sqName').textContent = S.squad.name;
  $('sqMe').textContent = mine ? `You: ${mine.callSign} · ${roleOf(mine.role).label}` : '';
  $('sqOpenMap').querySelector('b').textContent = cmd ? 'Command view' : 'Squad map';
  $('sqInvite').hidden = !cmd;
  if (cmd) paintInvite();
  const rows = roster(S.members, S.positions, Date.now());
  $('sqCount').textContent = `${rows.length} ${rows.length === 1 ? 'member' : 'members'} · ${onDutyCount(rows)} on duty`;
  put($('sqRoster'), html`${rows.map(r => rosterRow(r, mine))}`);
  $('sqLeave').hidden = !canLeave(mine, S.squad.createdBy);
  $('sqDelete').hidden = !(mine && mine.uid === S.squad.createdBy);
  paintDuty();
}

function rosterRow(r, mine) {
  const role = roleOf(r.role);
  const status = r.pos ? (r.fresh === 'stale' ? `Quiet ${ageWords(r.pos.at, Date.now())}` : 'On duty') : 'Off duty';
  const tools = [];
  if (canSetRole(mine, r, S.squad.createdBy)) {
    tools.push(isCommand(r)
      ? html`<button type="button" class="btn ghost small" data-sq-role="${r.uid}" data-to="officer">Step down</button>`
      : html`<button type="button" class="btn ghost small" data-sq-role="${r.uid}" data-to="command">Make Command</button>`);
  }
  if (canRemove(mine, r, S.squad.createdBy)) {
    tools.push(html`<button type="button" class="btn ghost small sq-remove" data-sq-remove="${r.uid}">Remove</button>`);
  }
  return html`<li class="sq-row sq-${r.fresh}">
    <span class="sq-dot" aria-hidden="true"></span>
    <span class="sq-who"><b>${r.callSign}</b> ${r.name}${r.uid === me() ? ' (you)' : ''}
      <i>${role.label}${r.dog ? ` · ${r.dog}` : ''}${r.uid === S.squad.createdBy ? ' · created the squad' : ''} · ${status}${r.dup && isCommand(mine) ? ' · same call sign as another member' : ''}</i></span>
    ${tools.length ? html`<span class="sq-tools">${tools}</span>` : ''}
  </li>`;
}

function paintInvite() {
  const code = S.squad.code;
  $('sqCode').textContent = showCode(code);
  const link = squadLink(ctx.shareBase(), code);
  try {
    const qr = window.qrcode?.(0, 'M');
    if (!qr) throw new Error('QR library missing');
    qr.addData(link, 'Byte');
    qr.make();
    /* The library's own SVG: built from the link's bits, no text of ours in it. */
    $('sqQr').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  } catch { $('sqQr').textContent = ''; }
}

/* ── Making a squad ───────────────────────────────────────────────────── */
function openCreate() {
  if (!ctx.user()) return ctx.openSignIn();
  $('sqnName').value = '';
  $('sqnCall').value = '';
  $('sqnErr').textContent = '';
  ctx.go('scrSquadNew');
}

async function doCreate() {
  const name = cleanSquadName($('sqnName').value);
  const callSign = cleanCallSign($('sqnCall').value);
  if (!name) return ($('sqnErr').textContent = 'Give the squad a name');
  if (!callSign) return ($('sqnErr').textContent = 'Give yourself a call sign, like “Chief” or “Sgt 1”');
  const b = $('sqnSave');
  b.disabled = true;
  try {
    const h = await handle();
    /* Known to the squad by call sign alone: the account's own name (often
       a full Google or Apple name) is never sent. */
    const sq = await createSquad(h, { name, callSign, displayName: '' });
    S.squad = { id: sq.id, name: sq.name, code: sq.code, createdBy: h.uid };
    remember(S.squad);
    await follow(sq.id);
    ctx.toast(`${sq.name} is ready. Share the code to bring your team in`);
    ctx.go('scrSquad');
  } catch (e) {
    $('sqnErr').textContent = e?.message?.includes('permission') ? 'The cloud refused it. Is the app up to date?' : (e?.message || 'Could not make the squad');
  } finally { b.disabled = false; }
}

/* ── Joining ──────────────────────────────────────────────────────────── */
/** The join screen, with a code from a link or a scan already in it. Nothing
    is joined until the person has seen which squad it is and said yes. */
export function openJoin(code = '') {
  S.found = null;
  $('sqjCode').value = code ? showCode(code) : '';
  $('sqjErr').textContent = '';
  $('sqjFound').hidden = true;
  $('sqjFind').hidden = false;
  $('sqjNeedSignIn').hidden = !!ctx.user() || !ctx.configured();
  $('sqjNoCloud').hidden = ctx.configured();
  /* Signed out, the code waits here for after signing in. */
  if (code && !ctx.user()) { try { ctx.kv.set('squadJoinPending', code); } catch { /* full */ } }
  ctx.go('scrSquadJoin');
  if (code && ctx.user()) findFromCode();
}

async function findFromCode() {
  const code = codeFromText($('sqjCode').value);
  $('sqjErr').textContent = '';
  if (!code) return ($('sqjErr').textContent = 'A code is eight letters and numbers, like K7MP-4XQ2');
  if (!ctx.user()) return ctx.openSignIn();
  $('sqjFindBtn').disabled = true;
  try {
    const h = await handle();
    const found = await findSquad(h, code);
    if (!found) return ($('sqjErr').textContent = 'No squad has that code. Check it with whoever sent it');
    S.found = found;
    $('sqjName').textContent = found.name;
    $('sqjBy').textContent = found.by ? `Made by ${found.by}` : '';
    $('sqjCall').value = myRow()?.callSign ?? '';
    pickRole(S.found.role || 'officer');
    paintDogs();
    $('sqjFind').hidden = true;
    $('sqjFound').hidden = false;
  } catch (e) {
    $('sqjErr').textContent = e?.message || 'Could not look that code up';
  } finally { $('sqjFindBtn').disabled = false; }
}

function pickRole(role) {
  if (!S.found) return;
  S.found.role = JOIN_ROLES.includes(role) ? role : 'officer';
  for (const b of $('sqjRoles').querySelectorAll('[data-role]')) {
    b.setAttribute('aria-pressed', String(b.dataset.role === S.found.role));
  }
  $('sqjDogWrap').hidden = S.found.role !== 'k9';
}

function paintDogs() {
  const dogs = ctx.dogs().map(d => d.name).filter(Boolean);
  put($('sqjDogs'), html`${dogs.map(n => html`<button type="button" class="chip" data-dog="${n}">${n}</button>`)}`);
  $('sqjDog').value = dogs[0] ?? '';
}

async function doJoin() {
  if (!S.found) return;
  const callSign = cleanCallSign($('sqjCall').value);
  const dog = cleanDogName($('sqjDog').value);
  if (!callSign) return ($('sqjErr').textContent = 'Give yourself a call sign, like “K9-1” or “2A12”');
  if (S.found.role === 'k9' && !dog) return ($('sqjErr').textContent = 'Which dog are you working?');
  $('sqjJoin').disabled = true;
  try {
    const h = await handle();
    /* Already in this squad (a second phone, a new call sign): keep the role
       Command gave them. */
    const already = await myMember(h, S.found.id).catch(() => null);
    await joinSquad(h, { id: S.found.id, code: S.found.code, role: S.found.role, callSign, dog,
                         displayName: '', keepRole: already?.role ?? null });
    if (S.squad && S.squad.id !== S.found.id) await stopDuty();
    S.squad = { id: S.found.id, name: S.found.name, code: '', createdBy: '' };
    remember(S.squad);
    const name = S.found.name;
    S.found = null;
    try { ctx.kv.set('squadJoinPending', null); } catch { /* full */ }
    await follow(S.squad.id);
    ctx.toast(`You are in ${name}. Switch On duty when you start`);
    ctx.go('scrSquad');
  } catch (e) {
    $('sqjErr').textContent = String(e?.code || e?.message || '').includes('permission')
      ? 'That code no longer works. Ask for the new one'
      : (e?.message || 'Could not join');
  } finally { $('sqjJoin').disabled = false; }
}

/* ── Command: roles, removing, the code, leaving ─────────────────────── */
async function onRosterClick(e) {
  const roleBtn = e.target.closest('[data-sq-role]');
  const rmBtn = e.target.closest('[data-sq-remove]');
  if (!roleBtn && !rmBtn) return;
  const uid = (roleBtn || rmBtn).dataset[roleBtn ? 'sqRole' : 'sqRemove'];
  const them = S.members.get(uid);
  if (!them || !S.squad) return;
  try {
    const h = await handle();
    if (roleBtn) {
      const to = roleBtn.dataset.to === 'command' ? 'command' : (them.dog ? 'k9' : 'officer');
      await setRole(h, S.squad.id, uid, to);
      ctx.toast(to === 'command' ? `${them.callSign} is now Command` : `${them.callSign} is no longer Command`);
    } else {
      if (!confirm(`Remove ${them.callSign} from ${S.squad.name}? They stop seeing the squad at once, and the code changes so they cannot rejoin with the old one.`)) return;
      await removeMember(h, S.squad, uid, { by: myRow()?.callSign || '' });
      ctx.toast(`${them.callSign} removed. The join code has changed`);
    }
  } catch (err) {
    ctx.toast(String(err?.code || '').includes('permission') ? 'Only Command can do that' : (err?.message || 'That did not work'));
  }
}

async function doNewCode() {
  if (!S.squad || !confirm('Make a new code? The old code and its QR stop working; members already in stay in.')) return;
  try {
    const h = await handle();
    await newCode(h, S.squad, { by: myRow()?.callSign || '' });
    ctx.toast('New code made');
  } catch (e) { ctx.toast(e?.message || 'Could not make a new code'); }
}

async function doLeave() {
  if (!S.squad || !confirm(`Leave ${S.squad.name}? You stop sharing and seeing the squad. You can join again with its code.`)) return;
  const sq = S.squad;
  try {
    await stopDuty();
    const h = await handle();
    S.stop?.(); S.stop = null;
    await leaveSquad(h, sq.id);
    S.squad = null; S.members = new Map(); S.positions = new Map();
    remember(null);
    ctx.toast(`You have left ${sq.name}`);
    paintAll();
  } catch (e) { ctx.toast(e?.message || 'Could not leave'); follow(sq.id); }
}

async function doDelete() {
  if (!S.squad || !confirm(`Delete ${S.squad.name} for everyone? Every member is taken off it and its code stops working. This cannot be undone.`)) return;
  const sq = S.squad;
  try {
    await stopDuty();
    const h = await handle();
    S.stop?.(); S.stop = null;
    await deleteSquad(h, sq);
    S.squad = null; S.members = new Map(); S.positions = new Map();
    remember(null);
    ctx.toast(`${sq.name} deleted`);
    paintAll();
  } catch (e) { ctx.toast(e?.message || 'Could not delete the squad'); follow(sq.id); }
}

/* ── The command map ─────────────────────────────────────────────────── */
/* Units are drawn as markers of their own (an arrow for the heading and a
   tag with the call sign) rather than as map layers: the street map used
   without a Mapbox key has no fonts for map labels, and a chief needs to
   read every call sign on either. */

/** The squad map: the real squad, or the pretend one. */
export function openCommand({ sim = false } = {}) {
  if (sim) startSim();
  else if (!S.squad) return;
  S.view = true;
  S.fitted = false;
  $('cmdSim').hidden = !S.sim;
  $('cmdDutyRow').hidden = !!S.sim;
  ctx.go('scrCommand');
  const g = ctx.getMap();
  g.map?.on('rotate', turnArrows);
  clearInterval(S.tick);
  S.tick = setInterval(() => { if (S.sim) S.sim.step(viewNow()); paintCommand(); }, 1000);
  paintCommand();
}

/** Leaving the map, by Close or the back gesture. */
export function closeCommand() {
  S.view = false;
  clearInterval(S.tick); S.tick = 0;
  ctx.getMap().map?.off('rotate', turnArrows);
  for (const { marker } of S.markers.values()) marker.remove();
  S.markers.clear();
  listKey = '';
  for (const p of S.painters) { try { p(null); } catch { /* their own */ } }
  if (S.sim) stopSim();
}

function viewState() {
  if (S.override) {
    const o = S.override();
    if (o) return { createdBy: S.squad?.createdBy ?? null, sim: !!S.sim, replay: true, ...o };
  }
  if (S.sim) {
    return { name: SIM_SQUAD, members: S.sim.members(), positions: S.sim.positions(), createdBy: null, sim: true };
  }
  return { name: S.squad?.name ?? 'Squad', members: S.members, positions: S.positions,
           createdBy: S.squad?.createdBy ?? null, sim: false };
}

function paintCommand() {
  if (!S.view) return;
  const st = viewState();
  const now = st.now ?? viewNow();
  const rows = roster(st.members, st.positions, now);
  const on = onDutyCount(rows);
  $('cmdTitle').textContent = st.name;
  /* The name is at the top of the list; the pill keeps to what changes. */
  $('cmdHud').textContent = `${on} on duty`;
  $('cmdCount').textContent = `${rows.length} ${rows.length === 1 ? 'member' : 'members'}`;
  paintList(rows, now);
  paintMarkers(rows, now);
  if (!S.fitted && on) { S.fitted = true; fitAll(); }
  for (const p of S.painters) { try { p({ ...st, rows, now }); } catch { /* their own */ } }
  if (!st.sim) paintDuty();
}

/* The list is built again only when who is on it, or how, changes; the
   seconds-ago text and the freshness colour are changed in place. Rebuilt
   every second (four times a second in a replay), a row was replaced
   between the press and the release of a tap, and the tap was lost. */
let listKey = '';
const FRESH_CLASSES = ['sq-live', 'sq-quiet', 'sq-stale', 'sq-off'];
function paintList(rows, now) {
  const list = $('cmdList');
  const key = rows.map(r => [r.uid, r.role, r.callSign, r.name, r.dog || '', r.pos ? 1 : 0].join('\u0001')).join('\u0002');
  if (key !== listKey || list.children.length !== rows.length) {
    listKey = key;
    put(list, html`${rows.map(r => commandRow(r, now))}`);
    return;
  }
  for (const r of rows) {
    const b = list.querySelector(`[data-uid="${CSS.escape(r.uid)}"]`);
    if (!b) continue;
    for (const c of FRESH_CLASSES) b.classList.toggle(c, c === `sq-${r.fresh}`);
    const age = b.querySelector('.cmd-age');
    const w = whereWords(r, now);
    if (age && age.textContent !== w) age.textContent = w;
  }
}

const whereWords = (r, now) => (r.pos
  ? `${ageWords(r.pos.at, now)}${r.pos.spd > 0.5 && r.pos.hdg != null ? ` · heading ${compass(r.pos.hdg)}` : ''}`
  : 'Off duty');

function commandRow(r, now) {
  const role = roleOf(r.role);
  const where = whereWords(r, now);
  return html`<li><button type="button" class="cmd-row sq-${r.fresh} sq-role-${r.role}" data-uid="${r.uid}" ${r.pos ? '' : safe('disabled')}>
    <span class="sq-dot" aria-hidden="true"></span>
    <span class="cmd-who"><b>${r.callSign}</b> ${r.name}<i>${role.label}${r.dog ? ` · ${r.dog}` : ''}</i></span>
    <span class="cmd-age">${where}</span>
  </button></li>`;
}

function paintMarkers(rows, now) {
  const g = ctx.getMap();
  if (!g.map || !g.GL) return;
  const keep = new Set();
  for (const r of rows) {
    if (!r.pos) continue;
    keep.add(r.uid);
    let m = S.markers.get(r.uid);
    if (!m) {
      const el = document.createElement('div');
      /* Set once, before Mapbox adds its own classes (mapboxgl-marker, which
         places it): assigning className afterwards wiped those, and every
         unit then sat one marker's height lower than the one before. */
      el.className = 'sq-unit';
      const arrow = document.createElement('span');
      arrow.className = 'sq-arrow';
      const tag = document.createElement('span');
      tag.className = 'sq-tag';
      el.append(arrow, tag);
      el.addEventListener('click', () => focusUnit(r.uid));
      m = { el, arrow, tag, marker: new g.GL.Marker({ element: el, anchor: 'center' }).setLngLat([r.pos.lon, r.pos.lat]).addTo(g.map) };
      S.markers.set(r.uid, m);
    }
    m.marker.setLngLat([r.pos.lon, r.pos.lat]);
    const fresh = `sq-${freshness(r.pos.at, now)}`;
    for (const role of Object.keys(ROLES)) m.el.classList.toggle(`sq-role-${role}`, role === r.role);
    for (const c of FRESH_CLASSES) m.el.classList.toggle(c, c === fresh);
    m.el.classList.toggle('sq-me', r.uid === me() && !S.sim);
    /* The trailing team above everything else on the map, its calls' pins
       included: it is the unit everyone is watching. */
    const z = r.uid === S.lead ? '5' : '';
    if (m.el.style.zIndex !== z) m.el.style.zIndex = z;
    m.hdg = r.pos.hdg;
    m.arrow.classList.toggle('still', r.pos.hdg == null);
    const label = `${r.callSign}${r.dog ? ` · ${r.dog}` : ''}`;
    if (m.tag.textContent !== label) m.tag.textContent = label;
    m.el.setAttribute('aria-label', `${r.callSign}, ${roleOf(r.role).label}, ${ageWords(r.pos.at, now)}`);
  }
  for (const [uid, m] of S.markers) if (!keep.has(uid)) { m.marker.remove(); S.markers.delete(uid); }
  turnArrows();
}

/* The arrow points the way the unit is going on the ground, so it turns
   with the map. */
function turnArrows() {
  const b = ctx.getMap().map?.getBearing?.() ?? 0;
  for (const m of S.markers.values()) {
    m.arrow.style.transform = m.hdg == null ? '' : `rotate(${Math.round(m.hdg - b)}deg)`;
  }
}

function focusUnit(uid) {
  const st = viewState();
  const p = st.positions.get(uid);
  const g = ctx.getMap();
  if (!p || !g.map) return;
  g.map.easeTo({ center: [p.lon, p.lat], zoom: Math.max(g.map.getZoom(), 16), duration: 600 });
}

/** Everyone on duty in view, clear of the panel that lists them. */
function fitAll() {
  const g = ctx.getMap();
  if (!g.map || !g.GL) return;
  const st = viewState();
  const pts = fitPoints(roster(st.members, st.positions, st.now ?? viewNow()));
  if (!pts.length) return ctx.toast('Nobody is on duty yet');
  fitOnMap(pts);
}

/** Points in view, clear of the panel (an incident's ground, or everyone). */
export function fitOnMap(pts, maxZoom = 17) {
  const g = ctx.getMap();
  if (!g.map || !g.GL || !pts.length) return;
  const panel = $('cmdPanel');
  const wide = window.matchMedia('(min-width: 900px)').matches;
  /* On a phone the weather panel, the pill and the compass take the top
     ~110 px: below them, or the newest of the trail lands underneath. */
  let top = 90;
  if (!wide) {
    for (const el of [document.querySelector('#scrCommand .hud-pill'), $('wxPanel')]) {
      const r = el && !el.hidden ? el.getBoundingClientRect() : null;
      if (r && r.height) top = Math.max(top, Math.round(r.bottom) + 16);
    }
  }
  const pad = wide
    ? { top, bottom: 40, left: 40, right: (panel?.offsetWidth || 340) + 40 }
    : { top, left: 30, right: 30, bottom: (panel?.offsetHeight || 260) + 30 };
  if (pts.length === 1) return g.map.easeTo({ center: [pts[0].lon, pts[0].lat], zoom: 16, padding: pad, duration: 600 });
  const b = new g.GL.LngLatBounds();
  for (const p of pts) b.extend([p.lon, p.lat]);
  g.map.fitBounds(b, { padding: pad, pitch: 0, bearing: 0, maxZoom, duration: 700 });
}

/* ── Pretend officers ─────────────────────────────────────────────────── */
function startSim() {
  const g = ctx.getMap();
  const fix = ctx.here();
  const c = g.map?.getCenter?.();
  /* Around the chief if the phone knows where that is; else wherever the map
     is looking, if it is close enough in to mean a place; else the demo's
     own ground. */
  const center = fix || (c && g.map.getZoom() >= 10 ? { lat: c.lat, lon: c.lng } : ctx.demoPlace());
  const now = Date.now();
  S.simClock = { real: now, base: now, speed: 1 };
  S.sim = createSim({ center, now, seed: (now / 1000) | 0 });
  paintSimSpeed();
}
function stopSim() { S.sim = null; S.simClock = null; }

/** The clock the map runs on: the pretend squad's, which the demo can run
    faster so that a twenty-minute trail plays out while a chief watches;
    the real one otherwise. */
export function viewNow() {
  const c = S.simClock;
  return S.sim && c ? c.base + (Date.now() - c.real) * c.speed : Date.now();
}
const SIM_SPEEDS = [1, 4, 10];
/** The pretend clock at `speed` (one of SIM_SPEEDS), from now on. */
export function setSimSpeed(speed) {
  const c = S.simClock;
  if (!c || !SIM_SPEEDS.includes(speed) || c.speed === speed) return;
  const now = viewNow();
  c.speed = speed; c.base = now; c.real = Date.now();
  paintSimSpeed();
}
function nextSimSpeed() {
  const c = S.simClock;
  if (!c) return;
  const now = viewNow();
  c.speed = SIM_SPEEDS[(SIM_SPEEDS.indexOf(c.speed) + 1) % SIM_SPEEDS.length];
  c.base = now; c.real = Date.now();
  paintSimSpeed();
}
function paintSimSpeed() {
  const b = $('cmdSimSpeed');
  if (!b || !S.simClock) return;
  b.textContent = `Speed ×${S.simClock.speed}`;
  b.setAttribute('aria-label', `Pretend clock at ${S.simClock.speed} times real speed. Change`);
}

/** For what is drawn on top of the command map (an incident): fn gets the
    view on every paint, and null when the map closes. Returns the undo. */
export function onCommandPaint(fn) { S.painters.add(fn); return () => S.painters.delete(fn); }
/** What the command map shows right now, for whatever is drawn on top. */
/* sim is the pretend squad itself here (viewState only says whether it runs). */
export const commandView = () => ({ ...viewState(), squad: S.squad, sim: S.sim, me: me(), member: myRow() });
/** Draw the command map again now (a replay moving faster than the clock). */
export const paintCommandNow = () => paintCommand();
/** The unit drawn above all others (the trailing K9 team), or null. */
export function setLeadUnit(uid) { S.lead = uid || null; }
/** Fold the command panel away (true) or open it, as its own button does. */
export function foldPanel(folded) {
  const p = $('cmdPanel');
  if (!p) return;
  p.classList.toggle('folded', folded);
  $('cmdFold').setAttribute('aria-expanded', String(!folded));
  $('cmdFold').textContent = folded ? 'Show list' : 'Hide list';
}
/** The middle of the squad, for the weather on the command map: the
    pretend squad's centre, or the middle of everyone on duty. null if
    nobody is. */
export function squadCentre() {
  if (S.sim) return { lat: S.sim.center.lat, lon: S.sim.center.lon };
  const pts = [...S.positions.values()].filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  if (!pts.length) return null;
  return { lat: pts.reduce((a, p) => a + p.lat, 0) / pts.length, lon: pts.reduce((a, p) => a + p.lon, 0) / pts.length };
}
/** For the incident layer: told when the squad or its members change. */
export function onSquadChange(fn) { S.watchers.add(fn); return () => S.watchers.delete(fn); }
/** For the incident layer: each position this phone sends while on duty. */
export function onPositionSent(fn) { S.sent.add(fn); return () => S.sent.delete(fn); }
/** A replay draws the map in place of the live squad while fn returns
    { name, members, positions, now }; null hands it back. */
export function setViewOverride(fn) { S.override = fn; if (S.view) paintCommand(); }
/** The squad as this phone knows it, for the incident layer. */
export const squadState = () => ({ squad: S.squad, members: S.members, positions: S.positions, me: me(), member: myRow(),
                                   onDuty: duty.on, fix: duty.fix, view: S.view, sim: S.sim });

/* ── Everything that shows squad state ───────────────────────────────── */
function paintAll() {
  if (!ctx) return;
  for (const fn of S.watchers) { try { fn(squadState()); } catch { /* their own */ } }
  if (!$('scrSquad').hidden) paintSquad();
  if (S.view) paintCommand();
  paintHome();
}
function paintHome() {
  const b = $('btnSquadHome');
  if (!b) return;
  b.querySelector('i').textContent = S.squad
    ? `${S.squad.name}${duty.on ? ' · on duty' : ''}`
    : 'Demo: your team on one map';
}

/* ── Start up ─────────────────────────────────────────────────────────── */
export function initSquad(c) {
  ctx = c;
  for (const el of document.querySelectorAll('[data-demo-label]')) el.textContent = DEMO_LABEL;
  $('btnSquadHome').addEventListener('click', () => ctx.go('scrSquad'));
  $('sqSignInBtn').addEventListener('click', () => ctx.openSignIn());
  $('sqCreate').addEventListener('click', openCreate);
  $('sqJoin').addEventListener('click', () => {
    let pending = '';
    try { pending = codeFromText(ctx.kv.get('squadJoinPending', '')); } catch { /* none */ }
    openJoin(pending);
  });
  $('sqSim').addEventListener('click', () => openCommand({ sim: true }));
  $('sqSim2').addEventListener('click', () => openCommand({ sim: true }));
  $('sqOpenMap').addEventListener('click', () => openCommand());
  $('sqDuty').addEventListener('change', (e) => (e.target.checked ? startDuty() : stopDuty()));
  $('cmdDuty').addEventListener('change', (e) => (e.target.checked ? startDuty() : stopDuty()));
  $('sqRoster').addEventListener('click', onRosterClick);
  $('sqNewCode').addEventListener('click', doNewCode);
  $('sqCopy').addEventListener('click', async () => {
    const link = squadLink(ctx.shareBase(), S.squad?.code || '');
    try { await navigator.clipboard.writeText(link); ctx.toast('Link copied'); }
    catch { ctx.toast(`The code is ${showCode(S.squad?.code || '')}`); }
  });
  $('sqLeave').addEventListener('click', doLeave);
  $('sqDelete').addEventListener('click', doDelete);
  $('sqnSave').addEventListener('click', doCreate);
  $('sqnCancel').addEventListener('click', () => ctx.goBack());
  $('sqjFindBtn').addEventListener('click', findFromCode);
  $('sqjCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') findFromCode(); });
  $('sqjSignIn').addEventListener('click', () => ctx.openSignIn());
  $('sqjRoles').addEventListener('click', (e) => { const b = e.target.closest('[data-role]'); if (b) pickRole(b.dataset.role); });
  $('sqjDogs').addEventListener('click', (e) => { const b = e.target.closest('[data-dog]'); if (b) $('sqjDog').value = b.dataset.dog; });
  $('sqjJoin').addEventListener('click', doJoin);
  $('sqjCancel').addEventListener('click', () => { S.found = null; ctx.leave(); });
  $('cmdFit').addEventListener('click', fitAll);
  $('cmdClose').addEventListener('click', () => ctx.goBack());
  $('cmdSimStop').addEventListener('click', () => ctx.goBack());
  $('cmdSimSpeed').addEventListener('click', nextSimSpeed);
  $('cmdFold').addEventListener('click', () => foldPanel(!$('cmdPanel').classList.contains('folded')));
  $('cmdList').addEventListener('click', (e) => { const b = e.target.closest('[data-uid]'); if (b) focusUnit(b.dataset.uid); });
  for (const r of JOIN_ROLES) {
    const b = $('sqjRoles').querySelector(`[data-role="${r}"]`);
    if (b) b.textContent = ROLES[r].label;
  }

  /* Pick the squad back up once the account is known, and duty with it if
     the switch was left on: it means "share while I work", and the work did
     not stop because the app was closed. Signed out, both stop. */
  let seenUser = null;
  ctx.onSync(() => {
    const u = me();
    if (u === seenUser) return;
    seenUser = u;
    if (!u) {
      stopDuty({ clear: false });
      /* Another account signing in on this phone must not pick the squad up. */
      remember(null);
      S.stop?.(); S.stop = null;
      S.squad = null; S.members = new Map(); S.positions = new Map();
      paintAll();
      return;
    }
    const sq = remembered();
    if (!sq?.id) return paintAll();
    follow(sq.id).then(() => {
      if (dutyWanted() === sq.id) {
        S.squad = S.squad || { id: sq.id, name: sq.name, code: '', createdBy: '' };
        startDuty().then(() => { if (duty.on) ctx.toast(`On duty: sharing your position with ${sq.name}`); });
      }
    });
  });
  paintHome();
}

/** Before signing out: off duty, and the position taken off the map. */
export const squadSignOut = () => stopDuty();

/** Before the account is deleted: off duty, and out of the squad, so that
    neither the member record (call sign, dog) nor a squad nobody else could
    ever delete is left behind. The creator deletes the squad; anyone else
    leaves it. A refusal means it is already gone. Uses the squad this phone
    remembers even if it has not been heard from yet. */
export async function squadForget() {
  await stopDuty();
  const sq = S.squad || remembered();
  if (!sq?.id) return;
  try {
    const h = await ctx.handle();
    if (!h) return;
    S.stop?.(); S.stop = null;
    const squad = S.squad?.id === sq.id && S.squad.createdBy ? S.squad : await getSquad(h, sq.id).catch(() => null);
    if (squad && squad.createdBy === h.uid) await deleteSquad(h, squad);
    else await leaveSquad(h, sq.id);
  } catch (e) {
    if (!String(e?.code || '').includes('permission')) throw e;
  }
  S.squad = null; S.members = new Map(); S.positions = new Map();
  remember(null); wantDuty(null);
  paintAll();
}

/** The code in a squad link opened from outside, or '' (squad.js). */
export const squadCodeIn = (hash) => codeFromText(hash);
