/* A Mapbox vector tile, read by hand.

   The map library reads these all day and shares none of it, and the app has
   no bundler to bring a decoder in. The format is small: a protobuf of
   layers, each a list of features whose geometry is a run of pen commands
   on a square `extent` units wide. This reads only what the ground needs —
   the layers asked for, the properties asked for, and the geometry turned
   into longitude and latitude. No DOM, no map: it runs in Node under test. */

function varint(r) {
  // Multiplication, not shifts: a 64-bit varint overflows JavaScript's 32-bit
  // bitwise arithmetic, and sint64 property values do turn up.
  let x = 0, scale = 1, byte;
  do {
    if (r.p >= r.end) throw new Error('mvt: ran off the end');
    byte = r.b[r.p++];
    x += (byte & 0x7f) * scale;
    scale *= 128;
  } while (byte & 0x80);
  return x;
}

const zigzag = (n) => (n % 2 ? -(n + 1) / 2 : n / 2);

function skip(r, wire) {
  if (wire === 0) varint(r);
  else if (wire === 1) r.p += 8;
  else if (wire === 2) { const len = varint(r); r.p += len; }   // not `r.p += varint(r)`: that reads r.p before the varint moves it
  else if (wire === 5) r.p += 4;
  else throw new Error(`mvt: wire type ${wire}`);
}

/** Walk a message's fields. `fn` reads the ones it wants; the rest are skipped. */
function fields(r, fn) {
  while (r.p < r.end) {
    const key = varint(r), tag = Math.floor(key / 8), wire = key % 8;
    const before = r.p;
    fn(tag, wire);
    if (r.p === before) skip(r, wire);
  }
}

/** A length-delimited field as its own reader, and step past it. */
function sub(r) {
  const len = varint(r);
  const s = { b: r.b, p: r.p, end: r.p + len, view: r.view };
  r.p += len;
  return s;
}

const utf8 = new TextDecoder();
const text = (r) => { const s = sub(r); return utf8.decode(r.b.subarray(s.p, s.end)); };

function packed(r) {
  const s = sub(r), out = [];
  while (s.p < s.end) out.push(varint(s));
  return out;
}

function value(r) {
  let v = null;
  fields(r, (tag, wire) => {
    if (tag === 1 && wire === 2) v = text(r);
    else if (tag === 2 && wire === 5) { v = r.view.getFloat32(r.p, true); r.p += 4; }
    else if (tag === 3 && wire === 1) { v = r.view.getFloat64(r.p, true); r.p += 8; }
    else if ((tag === 4 || tag === 5) && wire === 0) v = varint(r);
    else if (tag === 6 && wire === 0) v = zigzag(varint(r));
    else if (tag === 7 && wire === 0) v = varint(r) !== 0;
  });
  return v;
}

/** Pen commands → lines or rings, still in tile units. */
function geometry(cmds) {
  const out = [];
  let x = 0, y = 0, cur = null;
  for (let i = 0; i < cmds.length;) {
    const c = cmds[i++], cmd = c & 7, n = c >> 3;
    if (cmd === 1 || cmd === 2) {
      for (let k = 0; k < n && i + 1 < cmds.length; k++) {
        x += zigzag(cmds[i++]); y += zigzag(cmds[i++]);
        if (cmd === 1) { cur = [[x, y]]; out.push(cur); }
        else if (cur) cur.push([x, y]);
      }
    } else if (cmd === 7) {
      if (cur && cur.length) cur.push([cur[0][0], cur[0][1]]);
    } else {
      break;                      // an unknown command: keep what was read
    }
  }
  return out;
}

/**
 * @param {Uint8Array} bytes  the tile, already un-gzipped
 * @param {object} want       { layerName: [propertyName, …] } — other layers are skipped whole
 * @returns {{ [layer: string]: Array<{ type: 1|2|3, props: object, geom: number[][][] }> }}
 *          geom is lines or rings of [lon, lat]; type 1 point, 2 line, 3 polygon
 */
export function decodeTile(bytes, z, x, y, want) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out = {};
  const root = { b, p: 0, end: b.length, view };
  fields(root, (tag, wire) => {
    if (tag !== 3 || wire !== 2) return;
    const layer = sub(root);
    const probe = { ...layer };
    let name = '';
    fields(probe, (t, w) => { if (t === 1 && w === 2) name = text(probe); });
    if (!want[name]) return;

    const keys = [], values = [], feats = [];
    let extent = 4096;
    fields(layer, (t, w) => {
      if (t === 2 && w === 2) feats.push(sub(layer));
      else if (t === 3 && w === 2) keys.push(text(layer));
      else if (t === 4 && w === 2) values.push(value(sub(layer)));
      else if (t === 5 && w === 0) extent = varint(layer);
    });

    const size = extent * 2 ** z, x0 = extent * x, y0 = extent * y;
    const lonLat = ([px, py]) => {
      const n = Math.PI - (2 * Math.PI * (py + y0)) / size;
      return [((px + x0) / size) * 360 - 180, (180 / Math.PI) * Math.atan(Math.sinh(n))];
    };
    const wanted = new Set(want[name]);
    const list = out[name] || (out[name] = []);
    for (const f of feats) {
      let type = 0, tags = [], cmds = [];
      fields(f, (t, w) => {
        if (t === 2 && w === 2) tags = packed(f);
        else if (t === 3 && w === 0) type = varint(f);
        else if (t === 4 && w === 2) cmds = packed(f);
      });
      const props = {};
      for (let i = 0; i + 1 < tags.length; i += 2) {
        const k = keys[tags[i]];
        if (wanted.has(k)) props[k] = values[tags[i + 1]];
      }
      list.push({ type, props, geom: geometry(cmds).map(line => line.map(lonLat)) });
    }
  });
  return out;
}

/** The tile a point falls in. */
export function tileOf(lat, lon, z) {
  const n = 2 ** z, r = (lat * Math.PI) / 180;
  return {
    z,
    x: Math.min(n - 1, Math.max(0, Math.floor(((lon + 180) / 360) * n))),
    y: Math.min(n - 1, Math.max(0, Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n))),
  };
}

/** The ground a tile covers, as [west, south, east, north]. */
export function tileBox(z, x, y) {
  const n = 2 ** z;
  const lat = (row) => (180 / Math.PI) * Math.atan(Math.sinh(Math.PI * (1 - (2 * row) / n)));
  return [(x / n) * 360 - 180, lat(y + 1), ((x + 1) / n) * 360 - 180, lat(y)];
}
