/* firestore.rules for squads and join codes, written out again in
   JavaScript for the fake cloud (fake-firebase.mjs), so that the tests can
   run several phones against them: a stranger, a member, Command, the
   creator. It is a copy, not Firebase's own rules engine, so it can only be
   as right as it is faithful: each function here is named, and laid out in
   the order of, its twin in firestore.rules, and squad.test.mjs checks the
   rules file still says each thing this copy relies on.

   allow(op, path, ctx) answers one request. op is get | list | create |
   update | delete. ctx: { uid, data (the document as it would be after the
   write, merged), resource (as it is now), before (path → data, the cloud
   before this request or batch), after (the same, after it), now }. */

const isTs = (v) => v && typeof v === 'object' && typeof v.toMillis === 'function';
const isStr = (v) => typeof v === 'string';
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const text = (v, n) => isStr(v) && v.length <= n;
const optText = (v, n) => v == null || text(v, n);
const optNum = (v) => v == null || isNum(v);
const hasOnly = (d, keys) => Object.keys(d).every(k => keys.includes(k));
const place = (lat, lon) => isNum(lat) && isNum(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
const ROLES = ['command', 'k9', 'officer'];
const expires = (d, hours, now) =>
  isNum(d.expiresAt) && d.expiresAt <= now + hours * 3600e3 && isTs(d.deleteAt) && d.deleteAt.toMillis() <= now + hours * 3600e3;
const affected = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])]
  .filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
const val = (d, k, dflt) => (d && k in d ? d[k] : dflt);
const recent = (at, now) => isNum(at) && at <= now + 300e3 && at >= now - 600e3;

export function allow(op, path, c) {
  const p = path.split('/');
  const get = (q) => c.before.get(q) ?? null;
  const getAfter = (q) => c.after.get(q) ?? null;
  const signedIn = !!c.uid;
  const d = c.data, r = c.resource;

  if (p[0] === 'joinCodes' && p.length === 2) {
    const code = p[1];
    const codeOk = (x) => hasOnly(x, ['squadId', 'name', 'by', 'createdAt'])
      && text(x.squadId, 40) && text(x.name, 60) && text(x.by, 24) && isNum(x.createdAt);
    if (op === 'get') return signedIn;
    if (op === 'list' || op === 'update') return false;
    if (op === 'create') {
      return signedIn && codeOk(d) && code.length === 8
        && getAfter(`squads/${d.squadId}`)?.code === code
        && getAfter(`squads/${d.squadId}/members/${c.uid}`)?.role === 'command';
    }
    if (op === 'delete') {
      return signedIn && (get(`squads/${r?.squadId}/members/${c.uid}`)?.role === 'command'
        || get(`squads/${r?.squadId}`)?.createdBy === c.uid);
    }
    return false;
  }

  if (p[0] !== 'squads' || p.length < 2) return false;
  const sid = p[1];
  const squadPath = `squads/${sid}`;
  const mePath = `squads/${sid}/members/${c.uid}`;
  const squadLive = !!get(squadPath) && val(get(squadPath), 'gone', false) !== true;
  const isMember = signedIn && !!get(mePath) && squadLive;
  const isCommand = isMember && get(mePath).role === 'command';
  const creator = get(squadPath)?.createdBy;

  if (p.length === 2) {
    const squadOk = (x) => hasOnly(x, ['name', 'code', 'createdBy', 'createdAt', 'v', 'demo'])
      && text(x.name, 60) && x.name.length > 0 && text(x.code, 8) && x.code.length === 8
      && isStr(x.createdBy) && isNum(x.createdAt) && isNum(x.v) && typeof x.demo === 'boolean';
    if (op === 'get') return isMember;
    if (op === 'list') return false;
    if (op === 'create') return signedIn && squadOk(d) && d.createdBy === c.uid && getAfter(mePath)?.role === 'command';
    const tombOk = (x) => hasOnly(x, ['gone', 'createdBy', 'expiresAt', 'deleteAt']) && x.gone === true
      && x.createdBy === r.createdBy && expires(x, 240, c.now) && x.expiresAt >= c.now + 192 * 3600e3;
    if (op === 'update') {
      return (isCommand && squadOk(d) && d.createdBy === r.createdBy
        && affected(d, r).every(k => ['name', 'code'].includes(k)))
        || (signedIn && r.createdBy === c.uid && val(r, 'gone', false) !== true && tombOk(d));
    }
    if (op === 'delete') return false;
    return false;
  }

  const sub = p[2];
  if (sub === 'members' && p.length === 4) {
    const uid = p[3];
    const memberOk = (x) => hasOnly(x, ['uid', 'role', 'callSign', 'name', 'dog', 'joinedAt', 'code'])
      && x.uid === uid && ROLES.includes(x.role) && text(x.callSign, 24) && x.callSign.length > 0
      && text(val(x, 'name', ''), 60) && optText(val(x, 'dog', null), 40)
      && isNum(x.joinedAt) && optText(val(x, 'code', null), 8);
    if (op === 'get' || op === 'list') return isMember;
    if (op === 'create') {
      return signedIn && uid === c.uid && memberOk(d)
        && ((['k9', 'officer'].includes(d.role) && d.code === get(squadPath)?.code)
          || (d.role === 'command' && getAfter(squadPath)?.createdBy === c.uid));
    }
    if (op === 'update') {
      return isMember && memberOk(d)
        && ((uid === c.uid
             && (d.role === r.role || (r.role !== 'command' && ['k9', 'officer'].includes(d.role)))
             && [val(r, 'code', null), get(squadPath)?.code].includes(val(d, 'code', null)))
          || (isCommand && uid !== c.uid && uid !== creator
             && affected(d, r).every(k => k === 'role')));
    }
    if (op === 'delete') {
      return signedIn && ((uid === c.uid && uid !== creator) || (isCommand && uid !== creator)
        || (creator === c.uid && val(getAfter(squadPath), 'gone', false) === true));
    }
    return false;
  }

  if (sub === 'positions' && p.length === 4) {
    const uid = p[3];
    const positionOk = (x) => hasOnly(x, ['uid', 'lat', 'lon', 'acc', 'hdg', 'spd', 'at', 'expiresAt', 'deleteAt'])
      && x.uid === uid && place(x.lat, x.lon) && recent(x.at, c.now)
      && optNum(val(x, 'acc', null)) && optNum(val(x, 'hdg', null)) && optNum(val(x, 'spd', null))
      && expires(x, 12, c.now);
    if (op === 'get' || op === 'list') return isMember;
    if (op === 'create' || op === 'update') return isMember && uid === c.uid && positionOk(d);
    if (op === 'delete') return signedIn && (uid === c.uid || isCommand || creator === c.uid);
    return false;
  }

  if (sub === 'incidents' && p.length >= 4) {
    const iid = p[3];
    const incidentPath = `squads/${sid}/incidents/${iid}`;
    if (p.length === 4) {
      const incidentOk = (x) => hasOnly(x, ['name', 'lkp', 'k9Uid', 'startedBy', 'startedAt', 'endedAt', 'status',
        'expiresAt', 'deleteAt', 'summary'])
        && text(x.name, 80) && x.name.length > 0
        && x.lkp && typeof x.lkp === 'object' && place(x.lkp.lat, x.lkp.lon)
        && optText(val(x, 'k9Uid', null), 128)
        && isStr(x.startedBy) && isNum(x.startedAt) && optNum(val(x, 'endedAt', null))
        && ['active', 'ended'].includes(x.status)
        && (val(x, 'summary', null) == null || typeof x.summary === 'object')
        && expires(x, 192, c.now);
      if (op === 'get' || op === 'list') return isMember;
      if (op === 'create') return isCommand && incidentOk(d) && d.startedBy === c.uid && d.status === 'active';
      if (op === 'update') return isCommand && incidentOk(d) && r.status === 'active' && d.startedBy === r.startedBy;
      if (op === 'delete') return signedIn && creator === c.uid;
      return false;
    }
    if (p[4] === 'marks' && p.length === 6) {
      const markOk = (x) => hasOnly(x, ['kind', 'by', 'at', 'lat', 'lon', 'pts', 'label', 'expiresAt', 'deleteAt'])
        && ['indication', 'lost', 'refound', 'article', 'sighting', 'roadblock', 'rally', 'perimeter'].includes(x.kind)
        && x.by === c.uid && isNum(x.at)
        && (val(x, 'lat', null) == null || place(x.lat, x.lon))
        && (val(x, 'pts', null) == null || (Array.isArray(x.pts) && x.pts.length <= 200))
        && optText(val(x, 'label', null), 60)
        && expires(x, 192, c.now);
      const k9Ok = (x) => !['indication', 'lost', 'refound'].includes(x.kind) || get(incidentPath)?.k9Uid === c.uid;
      if (op === 'get' || op === 'list') return isMember;
      if (op === 'create') {
        return isMember && markOk(d) && k9Ok(d) && new RegExp(`^${c.uid}_[0-9]{1,3}$`).test(p[5])
          && recent(d.at, c.now) && get(incidentPath)?.status === 'active';
      }
      if (op === 'update') return isMember && r.by === c.uid && markOk(d) && d.kind === r.kind && get(incidentPath)?.status === 'active';
      if (op === 'delete') {
        return (signedIn && creator === c.uid)
          || (isMember && (r?.by === c.uid || isCommand) && get(incidentPath)?.status === 'active');
      }
      return false;
    }
    if (p[4] === 'tracks' && p.length === 6) {
      const column = (v) => Array.isArray(v) && v.length <= 600;
      const trackOk = (x) => hasOnly(x, ['uid', 'n', 'lat', 'lon', 't', 'cs', 'role', 'expiresAt', 'deleteAt'])
        && x.uid === c.uid && Number.isInteger(x.n) && x.n >= 0 && x.n <= 2880
        && p[5] === `${c.uid}_${x.n}`
        && column(x.lat) && column(x.lon) && column(x.t)
        && optText(val(x, 'cs', null), 24) && (val(x, 'role', null) == null || ROLES.includes(x.role))
        && expires(x, 192, c.now);
      if (op === 'get' || op === 'list') return isMember;
      const inc = get(incidentPath);
      if (op === 'create' || op === 'update') {
        return isMember && trackOk(d) && !!inc
          && (inc.status === 'active' || c.now < inc.endedAt + 120e3)
          && d.n <= (c.now - inc.startedAt) / 60e3 + 1;
      }
      if (op === 'delete') return signedIn && creator === c.uid;
      return false;
    }
  }
  return false;
}

/** Whether the fake should hold a path to these rules at all. */
export const governed = (path) => /^(squads|joinCodes)\//.test(path);
