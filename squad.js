/* A squad: a chief, the officers and the K9 teams, on one map.

   This is the part with no screen and no cloud in it: who may do what, when a
   position is worth sending, how fresh one is, what the cloud's documents
   look like, and the pretend officers the demo fills the map with. Everything
   that arrives from the cloud was written by someone else's phone, so it is
   cleaned here (cleanMember, cleanPosition) before anything draws it.

   A demo for a chief of police, not a tool for real operations: the screens
   say so (DEMO_LABEL), and firestore.rules keeps squad data to its members. */

import { dist, bearing, project } from './geo.js';
import { blockStep, outside } from './walls.js';
import { ownRun, ranBlind, debriefRates, varietyGaps, unwalkedPlan } from './debrief.js';
import { calibration, runsOf, MIN_PER_BAND, labelOf as confLabel } from './call.js';

export const DEMO_LABEL = 'Demo — not for real operations';

/* ── Roles ──────────────────────────────────────────────────────────── */
export const ROLES = {
  command: { id: 'command', label: 'Command', short: 'CMD', order: 0 },
  k9: { id: 'k9', label: 'K9 handler', short: 'K9', order: 1 },
  officer: { id: 'officer', label: 'Officer', short: 'OFC', order: 2 },
};
/* What a member may pick when they join. Command is only ever given: the
   squad's creator is Command, and Command promotes. */
export const JOIN_ROLES = ['k9', 'officer'];
export const roleOf = (r) => ROLES[r] ?? ROLES.officer;

export const isCommand = (m) => m?.role === 'command';
/** Command may promote or step down anyone but the squad's creator, who
    stays Command so that a squad always has someone who can run it. */
export const canSetRole = (me, them, createdBy) =>
  isCommand(me) && !!them && them.uid !== createdBy;
/** Command may remove anyone but the creator and themselves (they leave). */
export const canRemove = (me, them, createdBy) =>
  isCommand(me) && !!them && them.uid !== createdBy && them.uid !== me.uid;
/** The creator cannot leave: the squad would have nobody who could run it.
    They delete it instead. */
export const canLeave = (me, createdBy) => !!me && me.uid !== createdBy;

/* ── Text that other people typed ───────────────────────────────────── */
export const NAME_MAX = 60;
export const CALL_MAX = 24;
export const DOG_MAX = 40;
const tidy = (s, n) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
export const cleanSquadName = (s) => tidy(s, NAME_MAX);
export const cleanCallSign = (s) => tidy(s, CALL_MAX);
export const cleanDogName = (s) => tidy(s, DOG_MAX);

/* ── Join codes ─────────────────────────────────────────────────────────
   Eight characters, read aloud over a radio or typed off a screen, so none
   that look or sound alike (no 0/O, 1/I/L). 31^8 is about 850 billion: far
   too many to guess, and the rules let a code be read only one at a time,
   never listed. Shown as two groups of four. */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LEN = 8;

/** A new code. `bytes` is a source of random bytes (crypto.getRandomValues). */
export function newJoinCode(bytes = (n) => crypto.getRandomValues(new Uint8Array(n))) {
  let out = '';
  /* 31 does not divide 256: bytes of 248 and above are thrown away rather
     than folded in, which would make the first few letters likelier. */
  while (out.length < CODE_LEN) {
    for (const b of bytes(CODE_LEN * 2)) {
      if (b < 248 && out.length < CODE_LEN) out += CODE_ALPHABET[b % 31];
    }
  }
  return out;
}

/** A code as typed or scanned: a bare code, with or without the dash and in
    any case, or the squad link that carries one (#squad=XXXX-XXXX). Returns
    the eight characters, or '' when it is not a code. */
export function codeFromText(text) {
  let s = String(text ?? '').trim();
  const m = s.match(/[#&?]squad=([A-Za-z0-9-]{1,20})/);
  if (m) s = m[1];
  s = s.toUpperCase().replace(/[\s-]+/g, '');
  if (s.length !== CODE_LEN) return '';
  for (const c of s) if (!CODE_ALPHABET.includes(c)) return '';
  return s;
}
export const showCode = (code) => (code ? `${code.slice(0, 4)}-${code.slice(4)}` : '');
export const squadLink = (base, code) => `${base}#squad=${showCode(code)}`;

/* ── The cloud's documents ──────────────────────────────────────────────
   squads/{squadId}                         name, code, createdBy, createdAt, v, demo
   squads/{squadId}/members/{uid}           uid, role, callSign, name, dog, joinedAt, code, record
   squads/{squadId}/positions/{uid}         uid, lat, lon, acc, hdg, spd, at, expiresAt, deleteAt
   squads/{squadId}/incidents/{incidentId}  name, lkp, k9Uid, startedBy, startedAt, endedAt, status, expiresAt, deleteAt
     …/incidents/{incidentId}/marks/{markId}   kind, by, at, lat, lon, pts, label, expiresAt, deleteAt
     …/incidents/{incidentId}/tracks/{uid_n}   uid, n, lat[], lon[], t[], expiresAt, deleteAt
   joinCodes/{code}                         squadId, name, by, createdAt

   A position is its own document, apart from the member: it changes every
   few seconds, and the member list should not be sent again each time. The
   join code has a document of its own so that someone who is not yet a
   member can find the squad from it (and only from it: no listing). */
export const PATHS = {
  squad: (sid) => ['squads', sid],
  members: (sid) => ['squads', sid, 'members'],
  member: (sid, uid) => ['squads', sid, 'members', uid],
  positions: (sid) => ['squads', sid, 'positions'],
  position: (sid, uid) => ['squads', sid, 'positions', uid],
  incidents: (sid) => ['squads', sid, 'incidents'],
  incident: (sid, iid) => ['squads', sid, 'incidents', iid],
  marks: (sid, iid) => ['squads', sid, 'incidents', iid, 'marks'],
  mark: (sid, iid, mid) => ['squads', sid, 'incidents', iid, 'marks', mid],
  tracks: (sid, iid) => ['squads', sid, 'incidents', iid, 'tracks'],
  track: (sid, iid, uid, n) => ['squads', sid, 'incidents', iid, 'tracks', `${uid}_${n}`],
  joinCode: (code) => ['joinCodes', code],
};

/* How long the cloud keeps things. A position is deleted the moment its
   member goes off duty; this is only for a phone that died on duty. An
   incident is kept a week for the debrief. Firestore's clean-up (a TTL
   policy on deleteAt) can take up to a day after the moment, so viewers
   also stop drawing a position that is old (STALE_HIDE_MS). The rules allow
   a little more than each, for a phone whose clock is off. */
export const POSITION_TTL = 6 * 3600e3;
export const INCIDENT_TTL = 7 * 24 * 3600e3;
/* ── What's kept, and for how long ──────────────────────────────────────
   Worked out from the numbers above, so the sheet can never say one thing
   while the app does another. */
const hoursWords = (ms) => `${Math.round(ms / 3600e3)} hours`;
const daysWords = (ms) => `${Math.round(ms / 86400e3)} days`;
/** The plain lines of the "What's kept, and for how long" sheet. */
export function keptLines() {
  return [
    { head: 'Your position', text: `Shared with your squad only while On duty is on. Switch it off and it is deleted at once. If a phone dies on duty, its last position is set to be deleted ${hoursWords(POSITION_TTL)} after it was sent, and the map stops drawing it after ${Math.round(STALE_HIDE_MS / 60e3)} min.` },
    { head: 'Incidents', text: `The trail, the points on the map and everyone's movements are kept ${daysWords(INCIDENT_TTL)} for the debrief, then set to be deleted. When the person was last seen, how they left, and the brief (direction and description) are kept with the incident ${daysWords(INCIDENT_TTL)}, and every squad member can see them. Save anything you need to keep before then.` },
    { head: 'The squad', text: 'Its name, and each member\'s name, call sign, role and dog, stay until you leave or Command deletes the squad.' },
    { head: 'A dog\'s record', text: `Only when the handler taps Share: a short summary of the dog's training log (counts, dates, gaps and the licence as the handler typed it), seen by every squad member until they stop sharing or leave. A copy goes with an incident the dog is picked for and is kept ${daysWords(INCIDENT_TTL)}. The licence details stay on the handler's phone otherwise, and are deleted from it with the dog.` },
    { head: 'Pretend officers', text: 'Everything in the demo stays on this device. Nothing is sent and no account is needed. Your department name and call signs for it are kept on this device only.' },
    { head: 'Clean-up', text: 'The cloud\'s clean-up can run up to a day after the time above. This is a demo, not a records system.' },
  ];
}

/* ── The dog's record card ──────────────────────────────────────────────
   When Command picks the K9 team, the card shows what that dog's own
   training log says: how many trails and how old, how it did when nobody
   could steer it, the wrong calls, when it last trained, how often the
   handler's "Certain" was right, and what the dog has never been asked to
   do. It shows the record; the supervisor decides. Nothing here says the
   app clears a dog for anything.

   The handler's own phone works it out from its own sessions, with the same
   questions the rest of the app asks of a run (debrief.js ranBlind,
   debriefRates, varietyGaps; call.js calibration), so the card can never
   count a run differently from the dog's page. What goes to the squad is a
   short summary of counts and dates, bounded field by field, never a run.

   The card is copied into the incident when the dog is picked, so the
   debrief shows what Command saw then, not what the log says a week on. */
export const RECORD_V = 1;
export const LIC_MAX = 60;
export const GAP_MAX = 120;
export const GAPS_MAX = 5;
const COUNT_MAX = 100000;
const DAY = 86400e3;
const OLD_MIN = 240;           // "over 4 h old": a cold trail by any handler's measure
export const RECORD_KEYS = ['v', 'dog', 'pretend', 'at', 'trails', 'h1', 'h4', 'older', 'noAge', 'blind', 'blindReal',
  'blindFound', 'wrong', 'last', 'sure', 'sureRight', 'gaps', 'lic', 'licTo'];
/** Said wherever the card is shown: the card informs a decision a person makes. */
export const RECORD_SAYS = 'It shows the record; the supervisor decides.';
/** Said where the card is shared: a training log is not a licence, and it can be asked for. */
export const RECORD_NOTE = 'A self-kept training log is not licensing (NPCC in the UK) or certification (state, POST, NAPWDA or USPCA in the US). A court can ask to see it.';

/* store.js runAgeMin, asked the same way (store.js is not loaded here): a
   run graded against a drawn plan has no age until the walk is scanned. */
const runAge = (s) => (unwalkedPlan(s?.data) ? null : s?.data?.result?.ageMin ?? null);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const count = (v) => (Number.isInteger(v) && v >= 0 ? Math.min(v, COUNT_MAX) : 0);
/* The gaps are written to the handler ("one you knew"); on Command's card
   they are about the handler. */
const aboutHandler = (s) => s.replace(/\byour\b/g, 'the handler’s').replace(/\byou\b/g, 'the handler');
const packGaps = (list) => {
  const out = [];
  for (const g of list) {
    const t = tidy(g, GAP_MAX);
    if (t && !out.includes(t) && out.length < GAPS_MAX) out.push(t);
  }
  return out.length ? out.join('\n') : null;
};

/** The licence as the handler typed it: a body and an end date (ms), kept on
    the handler's phone and sent only inside a shared record. */
export function cleanLicence(l) {
  const lic = tidy(l?.body, LIC_MAX) || null;
  const licTo = isNum(l?.expires) ? l.expires : null;
  return { lic, licTo };
}
/** A date field's "2026-12-01" as the end of that day here, or null. */
export function licenceEnd(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text ?? '').trim());
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], 23, 59, 0, 0);
  return d.getMonth() === +m[2] - 1 && d.getFullYear() >= 2000 && d.getFullYear() <= 2100 ? d.getTime() : null;
}
/** The other way, for the date field: ms → "2026-12-01". */
export function licenceDay(ms) {
  if (!isNum(ms)) return '';
  const d = new Date(ms), p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** The record of one dog, from this phone's own sessions. `runs` are that
    dog's sessions; `handlerId` narrows the "Certain" figure to the handler
    sharing it (call.js runsOf: calibration measures one person). */
export function dogRecord({ dog, runs, handlerId = null, licence = null, now = Date.now() }) {
  /* A run kept from someone else's link is their dog and their judgement. */
  const own = (runs ?? []).filter(s => s?.data?.track && ownRun(s));
  const out = { v: RECORD_V, dog: cleanDogName(dog) || null, pretend: false, at: now,
    trails: own.length, h1: 0, h4: 0, older: 0, noAge: 0, blind: 0, blindReal: 0, blindFound: 0, wrong: 0,
    last: null, sure: 0, sureRight: 0, gaps: null, ...cleanLicence(licence) };
  for (const s of own) {
    const age = runAge(s);
    if (!isNum(age) || age < 0) out.noAge++;
    else if (age < 60) out.h1++;
    else if (age < OLD_MIN) out.h4++;
    else out.older++;
    const at = s.data.trackStarted ?? s.startedAt;
    if (isNum(at) && at <= now) out.last = out.last == null ? at : Math.max(out.last, at);
  }
  /* debrief.js findRate covers every run on a real person, the ones the
     handler could steer included. The blind figure is its own filter:
     only runs where nothing told the handler the answer. */
  const blind = own.filter(s => ranBlind(s.data));
  const blindReal = blind.filter(s => s.data.debrief?.target === 'real' && s.data.debrief?.outcome);
  out.blind = blind.length;
  out.blindReal = blindReal.length;
  out.blindFound = blindReal.filter(s => s.data.debrief.outcome === 'found').length;
  out.wrong = debriefRates(own).falseCalls;
  const sure = calibration(handlerId ? runsOf(own, handlerId) : own).bands.find(b => b.v === 'sure');
  out.sure = sure?.n ?? 0;
  out.sureRight = sure?.right ?? 0;
  const gaps = [];
  if (!own.length) gaps.push('No trails in the handler’s Trailcraft log yet.');
  else {
    if (!blind.length) gaps.push('No blind runs yet.');
    else if (!blind.some(s => runAge(s) >= OLD_MIN)) gaps.push('No blind runs over 4 h old.');
    if (out.last != null && now - out.last > 30 * DAY) gaps.push('Not trained in the last 30 days.');
    for (const g of varietyGaps(own)) gaps.push(aboutHandler(g));
  }
  out.gaps = packGaps(gaps);
  return out;
}

/** A record as another phone wrote it, bounded field by field, or null.
    Every count is a count of trails, so none is more than the trails, and
    the four age bands add up to them (dogRecord makes them so): a record
    where they do not was not made by the app, and is not shown at all
    (the rules refuse it too). */
export function cleanRecord(d) {
  if (!d || typeof d !== 'object' || d.v !== RECORD_V || !isNum(d.at)) return null;
  const trails = count(d.trails);
  if (count(d.h1) + count(d.h4) + count(d.older) + count(d.noAge) !== trails) return null;
  const blind = Math.min(count(d.blind), trails);
  const blindReal = Math.min(count(d.blindReal), blind);
  const sure = Math.min(count(d.sure), trails);
  return {
    v: RECORD_V, dog: cleanDogName(d.dog) || null, pretend: d.pretend === true, at: d.at,
    trails, h1: count(d.h1), h4: count(d.h4), older: count(d.older), noAge: count(d.noAge),
    blind, blindReal, blindFound: Math.min(count(d.blindFound), blindReal), wrong: count(d.wrong),
    last: isNum(d.last) ? d.last : null, sure, sureRight: Math.min(count(d.sureRight), sure),
    gaps: typeof d.gaps === 'string' ? packGaps(d.gaps.split('\n')) : null,
    ...cleanLicence({ body: d.lic, expires: d.licTo }),
  };
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "4 Nov 2026", the same on every phone whatever its language. */
export const dayWords = (ms) => { const d = new Date(ms); return `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`; };
function agoWords(at, now) {
  const d = Math.floor((now - at) / DAY);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d < 60 ? `${d} days ago` : `${Math.round(d / 30)} months ago`;
}
const ofWords = (got, n) => (n >= MIN_PER_BAND ? `${got} of ${n} (${Math.round((got / n) * 100)}%)` : `${got} of ${n}, too few to read much into`);

/** The licence chip at `now`: amber within 30 days of the end, red after. */
export function licenceState(rec, now) {
  if (!rec?.lic && !isNum(rec?.licTo)) return { cls: 'none', text: 'No licence typed in by the handler' };
  const body = rec.lic || 'Licence';
  if (!isNum(rec.licTo)) return { cls: 'none', text: `${body} · no end date typed in` };
  if (rec.licTo < now) return { cls: 'late', text: `${body} · ended ${dayWords(rec.licTo)}` };
  const days = Math.ceil((rec.licTo - now) / DAY);
  if (days <= 30) return { cls: 'soon', text: `${body} · ends ${dayWords(rec.licTo)}, in ${days} day${days === 1 ? '' : 's'}` };
  return { cls: 'ok', text: `${body} · to ${dayWords(rec.licTo)}` };
}

/* A record shared longer ago than this may not be the dog as it is now:
   the card says so, and asks for it again. */
export const RECORD_OLD_DAYS = 7;
/** The card's words, at `now` (a frozen card: when the dog was picked).
    `dog`: the team's dog as the squad knows it, which names the card, so a
    record shared under another name cannot pass for this dog's. Everything
    in it is as of the day it was shared, and says so. */
export function recordWords(rec, now, dog = null) {
  if (!rec) return null;
  const certain = confLabel('sure');
  const sharedDays = Math.floor((now - rec.at) / DAY);
  return {
    title: `${dog || rec.dog || 'The dog'}’s record`,
    pretend: rec.pretend,
    from: rec.pretend ? 'Pretend: made up for the demo'
      : `From the handler’s own Trailcraft log, worked out ${dayWords(rec.at)}`,
    old: !rec.pretend && sharedDays > RECORD_OLD_DAYS ? `Shared ${sharedDays} days ago: ask the handler to share it again` : '',
    rows: [
      { k: 'Trails', v: String(rec.trails),
        sub: `${rec.h1} under 1 h old · ${rec.h4} at 1–4 h · ${rec.older} over 4 h${rec.noAge ? ` · ${rec.noAge} age not known` : ''}` },
      { k: 'Blind runs', v: String(rec.blind),
        sub: rec.blindReal ? `${rec.blindReal} on a real person: found ${ofWords(rec.blindFound, rec.blindReal)}` : 'none on a real person yet' },
      { k: 'Wrong calls', v: String(rec.wrong), sub: `in ${rec.trails} trail${rec.trails === 1 ? '' : 's'}, from the handler’s debriefs` },
      /* Counted to the day it was shared, not to today: the record knows
         nothing of the runs since. */
      { k: 'Last trained', v: rec.last != null ? dayWords(rec.last) : 'not known',
        sub: rec.last != null ? `${agoWords(rec.last, rec.at)}, as of when it was shared` : '' },
      { k: `“${certain}” calls`, v: rec.sure ? `${rec.sureRight} of ${rec.sure} right` : 'none scored yet',
        sub: rec.sure >= MIN_PER_BAND ? `${Math.round((rec.sureRight / rec.sure) * 100)}%` : rec.sure ? 'too few to say' : '' },
    ],
    gaps: rec.gaps ? rec.gaps.split('\n') : [],
    lic: licenceState(rec, now),
  };
}

/* Two made-up dogs for the pretend squad: a seasoned one with an honest
   gap, and a younger one whose licence runs out this month, so the chief
   sees the amber chip. Labelled pretend wherever they show. */
const PRETEND_RECORDS = [
  { trails: 146, h1: 84, h4: 43, older: 14, noAge: 5, blind: 61, blindReal: 52, blindFound: 41, wrong: 6, lastDays: 2,
    sure: 23, sureRight: 21, gaps: ['No double-blind run yet, so nobody present has been unable to cue.'], lic: 'NPCC', licDays: 240 },
  { trails: 38, h1: 29, h4: 9, older: 0, noAge: 0, blind: 9, blindReal: 8, blindFound: 5, wrong: 3, lastDays: 6,
    sure: 4, sureRight: 3, gaps: ['No blind runs over 4 h old.', 'No blank searches yet — nothing has tested whether the dog will call an empty field.'],
    lic: 'NPCC', licDays: 18 },
];
/** The pretend record of the i-th pretend K9 team's dog. */
export function pretendRecord(i, dog, now) {
  const p = PRETEND_RECORDS[i] ?? PRETEND_RECORDS[PRETEND_RECORDS.length - 1];
  return cleanRecord({ ...p, v: RECORD_V, dog, pretend: true, at: now, last: now - p.lastDays * DAY,
    gaps: p.gaps.join('\n'), licTo: now + p.licDays * DAY });
}

export const MARK_KINDS = ['indication', 'lost', 'refound', 'article', 'sighting', 'roadblock', 'rally', 'perimeter'];
/* The K9 team's own calls about the scent; the rest anyone may drop. */
export const K9_MARKS = ['indication', 'lost', 'refound'];

export const squadDoc = ({ name, code, uid, now }) => ({
  name: cleanSquadName(name) || 'Squad', code, createdBy: uid, createdAt: now, v: 1, demo: true,
});
export const memberDoc = ({ uid, role, callSign, name, dog, code, now }) => ({
  uid,
  role: ROLES[role] ? role : 'officer',
  callSign: cleanCallSign(callSign) || 'Unit',
  name: tidy(name, NAME_MAX),
  dog: role === 'k9' ? (cleanDogName(dog) || null) : null,
  joinedAt: now,
  code,
});
export const joinCodeDoc = ({ sid, name, by, now }) => ({
  squadId: sid, name: cleanSquadName(name) || 'Squad', by: cleanCallSign(by), createdAt: now,
});

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const round = (v, dp) => { const k = 10 ** dp; return Math.round(v * k) / k; };

/** What goes to the cloud for one fix. Six decimal places is 11 cm, which
    is more than a phone knows; the rest is noise and bytes. */
export function positionDoc(uid, fix, now) {
  return {
    uid,
    lat: round(fix.lat, 6), lon: round(fix.lon, 6),
    acc: finite(fix.acc) ? Math.round(fix.acc) : null,
    hdg: finite(fix.hdg) ? Math.round(((fix.hdg % 360) + 360) % 360) : null,
    spd: finite(fix.spd) && fix.spd >= 0 ? round(fix.spd, 1) : null,
    at: now,
    expiresAt: now + POSITION_TTL,
  };
}

/** A member as another phone wrote it, made safe to show: only the fields
    the app writes, each of its kind, the text bounded. null if unusable. */
export function cleanMember(d, id) {
  if (!d || typeof d !== 'object') return null;
  const uid = typeof d.uid === 'string' && d.uid ? d.uid : id;
  if (!uid || typeof uid !== 'string') return null;
  const role = ROLES[d.role] ? d.role : 'officer';
  return {
    uid, role,
    callSign: cleanCallSign(d.callSign) || 'Unit',
    name: tidy(d.name, NAME_MAX),
    dog: role === 'k9' ? (cleanDogName(d.dog) || null) : null,
    joinedAt: finite(d.joinedAt) ? d.joinedAt : 0,
    /* The dog's record, when the handler shared it (dogRecord). */
    record: role === 'k9' ? cleanRecord(d.record) : null,
  };
}

/** A position as another phone wrote it. null when it is not a place. */
export function cleanPosition(d, id) {
  if (!d || typeof d !== 'object') return null;
  const { lat, lon, at } = d;
  if (!finite(lat) || !finite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || !finite(at)) return null;
  return {
    uid: typeof d.uid === 'string' && d.uid ? d.uid : id,
    lat, lon, at,
    acc: finite(d.acc) && d.acc >= 0 ? d.acc : null,
    hdg: finite(d.hdg) ? ((d.hdg % 360) + 360) % 360 : null,
    spd: finite(d.spd) && d.spd >= 0 ? d.spd : null,
  };
}

/* ── Sending a position, sparingly ──────────────────────────────────────
   Every write is read again by every member watching the map, so writes are
   what a free Firebase project runs out of first. A position goes when the
   member has moved far enough to show on the map, and no more often than
   every ten seconds; a member standing still sends one a minute (the duty
   timer re-sends the last fix when the phone stops giving new ones), which
   keeps them inside the 75 seconds before they dim and well inside the two
   minutes before they turn grey. A fix too vague to
   place anyone is not sent, unless nothing has been sent yet. */
export const SEND = {
  minGapMs: 10e3,      // never closer together than this
  moveM: 15,           // moved this far: worth sending
  turnDeg: 45,         // turned this much while moving: worth sending (the arrow is wrong)
  heartbeatMs: 60e3,   // standing still: once a minute
  worstAccM: 150,      // vaguer than this is not a position
};

/** Whether `fix` should go now, given the last one sent. */
export function shouldSend(last, fix, now, s = SEND) {
  if (!fix || !finite(fix.lat) || !finite(fix.lon)) return false;
  if (!last) return true;
  if (finite(fix.acc) && fix.acc > s.worstAccM) return false;
  const gap = now - last.at;
  if (gap < s.minGapMs) return false;
  if (gap >= s.heartbeatMs) return true;
  if (dist(last, fix) >= s.moveM) return true;
  if (finite(fix.hdg) && finite(last.hdg) && finite(fix.spd) && fix.spd > 1) {
    const turn = Math.abs(((fix.hdg - last.hdg + 540) % 360) - 180);
    if (turn >= s.turnDeg) return true;
  }
  return false;
}

/** The heading to show: the phone's own while it is moving, otherwise the
    way it went since the last fix, if that was far enough to mean anything. */
export function headingOf(prev, fix) {
  if (finite(fix.hdg) && fix.hdg >= 0 && (!finite(fix.spd) || fix.spd > 0.5)) return fix.hdg;
  if (prev && dist(prev, fix) >= 5) return bearing(prev, fix);
  return prev?.hdg ?? null;
}

/** Writes per member-hour, at the most, for a member who is moving all the
    time and for one standing still. Said in the summary for the chief. */
export const writesPerHour = (s = SEND) => ({ moving: Math.round(3600e3 / s.minGapMs), still: Math.round(3600e3 / s.heartbeatMs) });

/* ── Freshness ──────────────────────────────────────────────────────── */
/* Longer than the once-a-minute heartbeat of a member standing still, or
   everyone standing in a room would dim for half of every minute. */
export const FRESH_MS = 75e3;          // green: heard from within 75 seconds
export const STALE_MS = 2 * 60e3;      // grey: quiet for two minutes
export const STALE_HIDE_MS = 30 * 60e3; // older than this is not drawn at all

/** 'live' | 'quiet' | 'stale' | 'gone' for a position heard at `at`. */
export function freshness(at, now) {
  const age = now - at;
  if (!(age < STALE_HIDE_MS)) return 'gone';
  if (age >= STALE_MS) return 'stale';
  if (age >= FRESH_MS) return 'quiet';
  return 'live';
}

/** How long ago, in the fewest words that will do. */
export function ageWords(at, now) {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 10) return 'now';
  if (s < 60) return `${s} s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  return `${Math.round(m / 60)} h ago`;
}

/** Eight compass points, for the list: "heading NE". */
export function compass(hdg) {
  if (!finite(hdg)) return '';
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((hdg % 360) + 360) % 360 / 45) % 8];
}

/* ── The list ───────────────────────────────────────────────────────── */
/** Every member, with their position if they are on duty, in the order a
    chief reads a roster: on duty first, Command, then K9, then officers,
    then by call sign. Positions with no member (removed a moment ago) and
    positions too old to mean anything are left out. */
/* A call sign is typed by its member, so two can be the same, by mistake
   or to pass for another unit. The first to join keeps it; each later one
   shows a number after it, "(2)", and carries `dup` for Command to see.
   Every screen that names a member goes by this, so a picker or a log line
   never shows two units as one. uid → { callSign, n }. */
export function callSignsOf(members) {
  const seen = new Map();
  const out = new Map();
  const byJoin = [...(members?.values?.() ?? [])].sort((a, b) => (a.joinedAt ?? 0) - (b.joinedAt ?? 0) || (a.uid < b.uid ? -1 : 1));
  for (const m of byJoin) {
    const raw = String(m.callSign ?? '');
    const k = raw.toLowerCase();
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    out.set(m.uid, { callSign: n > 1 ? `${raw} (${n})` : raw, n });
  }
  return out;
}

export function roster(members, positions, now) {
  const rows = [];
  const marked = callSignsOf(members);
  for (const m of members.values()) {
    const p = positions.get(m.uid) || null;
    const fresh = p ? freshness(p.at, now) : 'off';
    const c = marked.get(m.uid);
    rows.push({ ...m, callSign: c.callSign, dup: c.n > 1,
                pos: fresh === 'gone' ? null : p, fresh: fresh === 'gone' ? 'off' : fresh });
  }
  const rank = (r) => (r.pos ? 0 : 1);
  return rows.sort((a, b) => rank(a) - rank(b)
    || roleOf(a.role).order - roleOf(b.role).order
    || a.callSign.localeCompare(b.callSign, undefined, { numeric: true }));
}

export const onDutyCount = (rows) => rows.filter(r => r.pos).length;

/** The points to fit the map to: everyone on duty (stale ones too: a
    quiet unit is exactly the one command wants to find). */
export const fitPoints = (rows) => rows.filter(r => r.pos).map(r => ({ lat: r.pos.lat, lon: r.pos.lon }));

/* ── Pretend officers ───────────────────────────────────────────────────
   The demo shows a chief the whole flow with nobody else in the room. It
   runs on this device only: no account, no cloud, nothing sent. Units patrol
   between points around the centre, cars along longer legs and faster than
   officers on foot, turning at a believable rate, stopping now and then, with
   a few metres of GPS wobble. One goes quiet for a while, so the chief sees a
   unit turn grey. The K9 teams are on foot; an incident (added on top of
   this) sends them trailing with goTo. Seeded, so a test sees the same
   squad every time. */

/** A small, fast, seeded random source (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SIM_SQUAD = 'Demo squad';
/* Call signs in the American style the chief will know. */
const SIM_UNITS = [
  { callSign: 'K9-1', name: 'Reyes', role: 'k9', dog: 'Rex', mode: 'foot' },
  { callSign: 'K9-2', name: 'Holt', role: 'k9', dog: 'Bella', mode: 'foot' },
  { callSign: '2A12', name: 'Martin', role: 'officer', mode: 'car' },
  { callSign: '2A14', name: 'Chen', role: 'officer', mode: 'car' },
  { callSign: 'Foot 3', name: 'Ortiz', role: 'officer', mode: 'foot' },
  { callSign: 'Foot 5', name: 'Walsh', role: 'officer', mode: 'foot' },
  { callSign: 'Sgt 1', name: 'Patel', role: 'command', mode: 'car' },
];
/** The pretend squad's call signs and dogs, for the form before it starts. */
export const simUnits = () => SIM_UNITS.map(u => ({ callSign: u.callSign, role: u.role, mode: u.mode, dog: u.dog || null }));
/** What the chief typed into that form, tidied: his department's name and
    his own call signs, each falling back to the pretend one when blank.
    Kept on this device only (it is never a squad in the cloud). */
export function cleanDemoNames(raw) {
  const squad = cleanSquadName(raw?.squad) || SIM_SQUAD;
  const callSigns = SIM_UNITS.map((u, i) => cleanCallSign(raw?.callSigns?.[i]) || u.callSign);
  return { squad, callSigns };
}

const MODES = {
  foot: { speed: [1.1, 1.7], turn: 70, leg: [60, 260], pause: [8, 40], pauseP: 0.35, radius: 450 },
  car: { speed: [6, 12], turn: 30, leg: [250, 700], pause: [10, 60], pauseP: 0.25, radius: 1100 },
};
const SIM_REPORT_MS = 5e3;      // how often a pretend phone reports
const SIM_WOBBLE_M = 3;

/** A pretend squad around `center`, starting at `now`. */
export function createSim({ center, now = Date.now(), seed = 7, count = SIM_UNITS.length, callSigns = null, walls = null } = {}) {
  const r = rng(seed);
  const span = (lo, hi) => lo + r() * (hi - lo);
  const units = SIM_UNITS.slice(0, Math.max(1, Math.min(count, SIM_UNITS.length))).map((u, i) => {
    const mode = MODES[u.mode];
    const start = project(center, r() * 360, span(80, mode.radius * 0.7));
    return {
      ...u, callSign: cleanCallSign(callSigns?.[i]) || u.callSign, uid: `sim-${i + 1}`, joinedAt: now,
      /* As if each pretend handler had shared their dog's record. */
      record: u.role === 'k9' ? pretendRecord(i, u.dog, now) : null,
      lat: start.lat, lon: start.lon, hdg: r() * 360, spd: 0,
      target: null, pauseUntil: now + span(0, 6) * 1000, goal: null,
      /* The third unit drops out for a few minutes: long enough to go grey. */
      quiet: i === 2 ? { from: now + 60e3, to: now + 60e3 + 4 * 60e3 } : null,
      report: null, nextReport: now,
    };
  });
  const sim = { center, units, at: now, r, span, walls };

  function pickTarget(u) {
    const mode = MODES[u.mode];
    /* A leg away from where it is, kept inside its patrol ring: pulled back
       towards the centre once it strays to the edge. On foot among
       buildings, a leg with a clear walk to its end, or a short one. */
    const off = dist(center, u);
    for (let tries = 0; tries < 6; tries++) {
      let brg = (u.hdg + span(-100, 100) + 360) % 360;
      if (off > mode.radius * 0.8) brg = bearing(u, center) + span(-50, 50);
      u.target = project(u, brg, span(...mode.leg) * (tries < 3 ? 1 : 0.3));
      u.best = null;
      if (!onFoot(u) || clear(u, u.target)) return;
    }
  }

  /* Walkers keep out of buildings (walls.js). Cars are left on the map as
     they were: they stay on longer, faster legs, and a car crossing a
     corner of a block reads as a road the map did not draw. */
  const onFoot = (u) => !!sim.walls && u.mode === 'foot';
  const clear = (a, b) => blockStep(sim.walls, a, b) === b;
  /** A point to walk to first when a building stands between a walker and
      where they are going: the open one that leaves the least to walk. */
  function detour(u, goal, wide = false) {
    const brg = bearing(u, goal);
    let best = null;
    for (const turn of [35, -35, 70, -70, 105, -105, 140, -140, ...(wide ? [170, -170] : [])]) {
      for (const d of wide ? [40, 80, 130] : [20, 40, 70]) {
        const c = project(u, brg + turn, d);
        if (!clear(u, c)) continue;
        const score = dist(c, goal) + d * 0.3;
        if (!best || score < best.score) best = { score, lat: c.lat, lon: c.lon };
      }
    }
    return best ? { lat: best.lat, lon: best.lon } : null;
  }

  /* On rails: a scripted walk along a line already laid clear of the
     buildings (the pretend dog on its trail, an officer walking in). It
     goes by distance along the line, never by heading and wall checks, so
     it cannot be boxed in short of the end: the scenario always plays to
     its finish, the same way every time. */
  function railMove(u, dtS, t) {
    const R = u.rail;
    if (t < R.from) { u.spd = 0; return; }
    const slow = R.slow && R.i >= R.slow.a && R.i < R.slow.b;
    const mps = slow ? R.slow.mps : R.mps;
    R.d = Math.min(R.len, R.d + mps * dtS);
    while (R.i < R.pts.length - 2 && R.cum[R.i + 1] <= R.d) R.i++;
    const a = R.pts[R.i], b = R.pts[Math.min(R.i + 1, R.pts.length - 1)];
    const seg = R.cum[Math.min(R.i + 1, R.pts.length - 1)] - R.cum[R.i];
    const f = seg > 0 ? Math.min(1, (R.d - R.cum[R.i]) / seg) : 1;
    u.lat = a.lat + (b.lat - a.lat) * f; u.lon = a.lon + (b.lon - a.lon) * f;
    if (seg > 0) u.hdg = bearing(a, b);
    u.spd = R.d < R.len ? mps : 0;
  }
  const railOf = (pts, d = 0) => {
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
    const len = cum[cum.length - 1];
    let i = 0;
    while (i < pts.length - 2 && cum[i + 1] <= d) i++;
    return { pts, cum, len, d: Math.min(d, len), i };
  };

  function move(u, dtS, t) {
    const mode = MODES[u.mode];
    if (u.rail) { railMove(u, dtS, t); return; }
    if (t < u.pauseUntil) { u.spd = 0; return; }
    /* On a path (a K9 team on a trail), the next point of it is the goal. */
    if (u.path) u.goal = u.path[u.pathAt] ?? u.goal;
    let goal = u.goal || u.target;
    if (!goal) { pickTarget(u); return; }
    /* A team on a trail walks the trail's own line, which already keeps
       out of buildings; anyone else on foot goes round them. */
    if (onFoot(u) && !u.path) {
      if (u.via && (dist(u, u.via) < 6 || t >= u.viaUntil)) u.via = null;
      /* Not getting any closer for a while: boxed in behind a terrace. */
      const d = dist(u, goal);
      if (u.best == null || d < u.best - 2) { u.best = d; u.bestAt = t; }
      const stuck = t - u.bestAt > 12e3;
      if (stuck) {
        u.best = d; u.bestAt = t; u.via = null;
        if (!u.goal) { u.target = null; return; }               // patrolling: another leg
        /* Close to where it was sent, a gap the map does not draw (an
           alley, a gate through a yard) is the likely way: through it. */
        if (d < 25) { const p = outside(sim.walls, goal); u.lat = p.lat; u.lon = p.lon; return; }
      }
      if (!u.via && !clear(u, goal)) {
        u.via = detour(u, goal, stuck);
        u.viaUntil = t + 20e3;
        if (!u.via && !u.goal) { u.target = null; return; }   // boxed in: another leg
      }
      if (u.via) goal = u.via;
    }
    const left = dist(u, goal);
    if (u.via && goal === u.via && left < 6) { u.via = null; return; }
    if (left < 6) {
      /* The next point at once, in the same step: a pause at each one would
         make a trail look like stop-start. */
      if (u.path && u.pathAt < u.path.length - 1) { u.pathAt++; u.goal = u.path[u.pathAt]; move(u, dtS, t); return; }
      if (u.goal) { u.spd = 0; return; }   // sent somewhere: it holds there
      u.target = null;
      if (r() < mode.pauseP) u.pauseUntil = t + span(...mode.pause) * 1000;
      return;
    }
    /* Turn towards the goal no faster than a person or a car turns. */
    const want = bearing(u, goal);
    const diff = ((want - u.hdg + 540) % 360) - 180;
    const maxTurn = mode.turn * dtS;
    u.hdg = (u.hdg + Math.max(-maxTurn, Math.min(maxTurn, diff)) + 360) % 360;
    if (!u.cruise) u.cruise = span(...mode.speed);
    /* Slow for a sharp turn, as anyone does. */
    u.spd = u.cruise * (Math.abs(diff) > 60 ? 0.4 : 1);
    let p = project(u, u.hdg, Math.min(left, u.spd * dtS));
    if (onFoot(u)) p = blockStep(sim.walls, u, p);
    u.lat = p.lat; u.lon = p.lon;
  }

  /** Move everyone on to `t`, in steps of at most a second. */
  sim.step = (t) => {
    while (sim.at < t) {
      /* Whole steps of the gap itself, never a fraction of it: adding back
         a gap divided and multiplied by a thousand can fall a hair short of
         t, and a clock that never quite arrives loops for ever. */
      const dt = Math.min(1000, t - sim.at);
      const dtS = dt / 1000;
      sim.at = dt < 1000 ? t : sim.at + 1000;
      for (const u of units) {
        move(u, dtS, sim.at);
        const silent = u.quiet && sim.at >= u.quiet.from && sim.at < u.quiet.to;
        if (!silent && sim.at >= u.nextReport) {
          const w = project(u, r() * 360, r() * SIM_WOBBLE_M);
          u.report = { uid: u.uid, lat: w.lat, lon: w.lon, hdg: u.spd > 0.5 ? u.hdg : (u.report?.hdg ?? u.hdg),
                       spd: u.spd, acc: Math.round(span(4, 12)), at: sim.at };
          u.nextReport = sim.at + SIM_REPORT_MS;
        }
      }
    }
    return sim;
  };

  /** Send a unit to a point, where it waits (a perimeter post, a trail). */
  sim.goTo = (uid, point) => {
    const u = units.find(x => x.uid === uid);
    if (u) { u.goal = point ? { lat: point.lat, lon: point.lon } : null; u.path = null; u.rail = null; u.via = null; u.best = null; u.pauseUntil = 0; }
  };
  /** Put a unit on rails: along `pts` at `mps` metres a second, from the
      pretend moment `from`, holding at the end. `slow` ({ a, b, mps }) is a
      stretch of the line, by point index, walked slower (a dog casting). */
  sim.rail = (uid, pts, { mps = 1.4, from = 0, slow = null } = {}) => {
    const u = units.find(x => x.uid === uid);
    if (!u || !pts?.length) return;
    u.goal = null; u.path = null; u.target = null; u.via = null; u.pauseUntil = 0;
    u.rail = { ...railOf(pts.map(p => ({ lat: p.lat, lon: p.lon }))), mps, from, slow };
  };
  /** The same rails with a new line ahead: the part already walked is the
      same, so the unit carries on from where it is. */
  sim.reroute = (uid, pts) => {
    const u = units.find(x => x.uid === uid);
    if (!u?.rail || !pts?.length) return;
    u.rail = { ...u.rail, ...railOf(pts.map(p => ({ lat: p.lat, lon: p.lon })), u.rail.d) };
  };
  /** How far along its rails a unit is: the index of the last point it has
      passed (the last one once it is there), or -1 off rails. */
  sim.railAt = (uid) => {
    const R = units.find(x => x.uid === uid)?.rail;
    if (!R) return -1;
    return R.d >= R.len ? R.pts.length - 1 : R.i;
  };
  /** Whether a unit on rails has reached the end of them. */
  sim.railDone = (uid) => { const R = units.find(x => x.uid === uid)?.rail; return !!R && R.d >= R.len; };
  /** Send a unit by vehicle at `mps`: a K9 van driving round to a rally
      point. Like the pretend cars it is not kept out of buildings, and its
      speed on the map says it is driving, not walking. */
  sim.drive = (uid, point, mps) => {
    const u = units.find(x => x.uid === uid);
    if (!u || !point) return;
    u.mode = 'car'; u.cruise = mps;
    sim.goTo(uid, point);
  };
  /** The buildings, once the map has them (they arrive after the squad
      starts). A walker already inside one, where the map put no building
      before, is moved to the nearest open ground. */
  sim.setWalls = (W) => {
    sim.walls = W || null;
    if (!sim.walls) return;
    for (const u of units) {
      if (u.mode !== 'foot') continue;
      const p = outside(sim.walls, u);
      if (p !== u) { u.lat = p.lat; u.lon = p.lon; }
      u.via = null;
    }
  };
  /** Put a unit somewhere at once, no walk: a pretend K9 team already near
      the last known point, so the demo does not wait while it walks there. */
  sim.place = (uid, point) => {
    const u = units.find(x => x.uid === uid);
    if (!u || !point) return;
    u.lat = point.lat; u.lon = point.lon;
    u.goal = null; u.path = null; u.target = null; u.rail = null;
    u.nextReport = sim.at;
  };
  /** Send a unit along a path, point by point, at its own pace, holding at
      the end: a K9 team working a trail. */
  sim.follow = (uid, pts) => {
    const u = units.find(x => x.uid === uid);
    if (u && pts?.length) { u.path = pts.map(p => ({ lat: p.lat, lon: p.lon })); u.pathAt = 0; u.goal = u.path[0]; u.rail = null; u.pauseUntil = 0; }
  };
  /** How far along its path a unit is: the index of the point it is making for. */
  sim.pathAt = (uid) => units.find(x => x.uid === uid)?.pathAt ?? 0;
  sim.unit = (uid) => units.find(x => x.uid === uid) ?? null;
  /** The members, as cleanMember would hand them over. */
  sim.members = () => new Map(units.map(u => [u.uid, cleanMember(u, u.uid)]));
  /** What each pretend phone last reported, as cleanPosition would. */
  sim.positions = () => new Map(units.filter(u => u.report).map(u => [u.uid, cleanPosition(u.report, u.uid)]));

  sim.step(now);
  return sim;
}
