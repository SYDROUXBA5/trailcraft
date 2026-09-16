/* A trail report as a PDF file, written here by hand.

   Why not print the page: window.print() does nothing in an iPhone Home
   Screen app, which is where this app lives. A real file goes through the
   share sheet instead — to Files, Mail, AirDrop, WhatsApp — and prints from
   any of them. The file uses the fonts every PDF reader carries (Helvetica),
   so no font is embedded: the satellite picture is nearly all of the file.

   What comes in is already words and numbers: the headline, a map as an
   optional JPEG plus lines and dots in 0–1 box coordinates, and sections of
   [label, value] rows. Nothing here knows what a trail is. */

const PAGE = { w: 595, h: 842 };            // A4, in points
const M = 48;                               // margin
const COL = PAGE.w - 2 * M;                 // 499 pt of content
const INK = [0.09, 0.125, 0.102];           // #17201A
const MUTED = [0.43, 0.455, 0.41];          // #6E7468
const RULE = [0.867, 0.835, 0.776];         // #DDD5C6
const PAPER = [0.957, 0.937, 0.902];        // #F4EFE6

/* ── Text: WinAnsi bytes and Helvetica widths ──────────────────────── */

/* Widths per 1000 em for codes 32–126, from the AFM files Adobe ships. */
const W_REG = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015,
  667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611,
  278, 278, 278, 469, 556, 333,
  556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500,
  334, 260, 334, 584];
const W_BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975,
  722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611,
  333, 278, 333, 584, 556, 333,
  556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500,
  389, 280, 389, 584];
/* The few typographic characters this app writes, as WinAnsi codes. */
const WIN = { 0x2014: 0x97, 0x2013: 0x96, 0x2019: 0x92, 0x2018: 0x91, 0x201C: 0x93, 0x201D: 0x94,
  0x2026: 0x85, 0x2022: 0x95, 0x20AC: 0x80, 0x2122: 0x99 };
const W_EXTRA = { 0xB0: 400, 0xB7: 278, 0xA0: 278, 0x97: 1000, 0x96: 556, 0x92: 222, 0x91: 222,
  0x93: 333, 0x94: 333, 0x85: 1000, 0x95: 350, 0x80: 556, 0x99: 1000, 0xD7: 584, 0xB1: 584 };

/** A string as WinAnsi byte codes. Accented letters are in the encoding;
    anything else falls back to its base letter, then to '?'. */
function toWin(s) {
  const out = [];
  for (const ch of String(s ?? '').replace(/[\x00-\x1F]/g, ' ')) {
    const c = ch.codePointAt(0);
    if (c < 0x80 || (c >= 0xA0 && c <= 0xFF)) out.push(c);
    else if (WIN[c]) out.push(WIN[c]);
    else {
      const base = ch.normalize('NFD').codePointAt(0);
      out.push(base < 0x80 ? base : 0x3F);
    }
  }
  return out;
}

const widthOf = (code, bold) => {
  if (code >= 32 && code <= 126) return (bold ? W_BOLD : W_REG)[code - 32];
  if (W_EXTRA[code] != null) return code === 0x92 && bold ? 278 : W_EXTRA[code];
  if (code >= 0xC0 && code <= 0xFF) {
    const base = String.fromCharCode(code).normalize('NFD').charCodeAt(0);
    return base >= 32 && base <= 126 ? (bold ? W_BOLD : W_REG)[base - 32] : 556;
  }
  return 556;
};

/** Width in points of `s` set in Helvetica (or Bold) at `size`. */
export function textWidth(s, size, bold = false, spacing = 0) {
  const codes = toWin(s);
  return codes.reduce((w, c) => w + widthOf(c, bold), 0) / 1000 * size + spacing * codes.length;
}

/** Greedy word wrap to `maxW` points; a single over-long word is cut. */
export function wrap(s, size, bold, maxW) {
  const lines = [];
  for (const para of String(s ?? '').split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const trial = line ? `${line} ${word}` : word;
      if (textWidth(trial, size, bold) <= maxW) { line = trial; continue; }
      if (line) lines.push(line);
      line = word;
      while (textWidth(line, size, bold) > maxW && line.length > 1) {
        let cut = line.length - 1;
        while (cut > 1 && textWidth(line.slice(0, cut), size, bold) > maxW) cut--;
        lines.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    lines.push(line);
  }
  return lines;
}

/* A PDF literal string: WinAnsi bytes with the three characters that need a
   backslash escaped, as a binary string (one char per byte). */
const lit = (s) => '(' + toWin(s).map(c => {
  if (c === 0x28 || c === 0x29 || c === 0x5C) return '\\' + String.fromCharCode(c);
  return String.fromCharCode(c);
}).join('') + ')';

const n = (x) => String(Math.round(x * 100) / 100);
const rgb = (c, op) => `${n(c[0])} ${n(c[1])} ${n(c[2])} ${op}`;

/* ── Drawing ─────────────────────────────────────────────────────── */

const FONT = { reg: 'F1', bold: 'F2', italic: 'F3' };

function textOp(x, y, s, { size = 10, font = 'reg', color = INK, spacing = 0 } = {}) {
  return `BT /${FONT[font]} ${n(size)} Tf ${rgb(color, 'rg')} ${n(spacing)} Tc ${n(x)} ${n(y)} Td ${lit(s)} Tj ET`;
}

/* A rounded rectangle path, corners as Béziers (k is the circle constant). */
function roundRect(x, y, w, h, r) {
  const k = 0.5523 * r;
  return [
    `${n(x + r)} ${n(y)} m`,
    `${n(x + w - r)} ${n(y)} l`,
    `${n(x + w - r + k)} ${n(y)} ${n(x + w)} ${n(y + r - k)} ${n(x + w)} ${n(y + r)} c`,
    `${n(x + w)} ${n(y + h - r)} l`,
    `${n(x + w)} ${n(y + h - r + k)} ${n(x + w - r + k)} ${n(y + h)} ${n(x + w - r)} ${n(y + h)} c`,
    `${n(x + r)} ${n(y + h)} l`,
    `${n(x + r - k)} ${n(y + h)} ${n(x)} ${n(y + h - r + k)} ${n(x)} ${n(y + h - r)} c`,
    `${n(x)} ${n(y + r)} l`,
    `${n(x)} ${n(y + r - k)} ${n(x + r - k)} ${n(y)} ${n(x + r)} ${n(y)} c`,
    'h',
  ].join(' ');
}

function circle(cx, cy, r) {
  const k = 0.5523 * r;
  return `${n(cx + r)} ${n(cy)} m `
    + `${n(cx + r)} ${n(cy + k)} ${n(cx + k)} ${n(cy + r)} ${n(cx)} ${n(cy + r)} c `
    + `${n(cx - k)} ${n(cy + r)} ${n(cx - r)} ${n(cy + k)} ${n(cx - r)} ${n(cy)} c `
    + `${n(cx - r)} ${n(cy - k)} ${n(cx - k)} ${n(cy - r)} ${n(cx)} ${n(cy - r)} c `
    + `${n(cx + k)} ${n(cy - r)} ${n(cx + r)} ${n(cy - k)} ${n(cx + r)} ${n(cy)} c h`;
}

/** The map box: picture (or paper), then every line and dot, clipped to
    rounded corners. Lines and dots come in 0–1 coordinates, y downward. */
function mapOps(map, x, y, w, h, hasImage) {
  const px = (p) => `${n(x + p[0] * w)} ${n(y + h - p[1] * h)}`;
  const ops = ['q', roundRect(x, y, w, h, 10), 'W n'];
  if (hasImage) ops.push(`q ${n(w)} 0 0 ${n(h)} ${n(x)} ${n(y)} cm /Im1 Do Q`);
  else ops.push(`${rgb(PAPER, 'rg')} ${n(x)} ${n(y)} ${n(w)} ${n(h)} re f`);
  ops.push('1 J 1 j');
  for (const path of map.paths ?? []) {
    if (!path.pts || path.pts.length < 2) continue;
    const d = path.pts.map((p, i) => `${px(p)} ${i ? 'l' : 'm'}`).join(' ');
    if (path.casing) ops.push(`q ${rgb(path.casing, 'RG')} ${n(path.width + 2.4)} w [] 0 d ${d} S Q`);
    ops.push(`q ${rgb(path.stroke, 'RG')} ${n(path.width)} w ${path.dash ? `[${path.dash.map(n).join(' ')}] 0 d` : '[] 0 d'} ${d} S Q`);
  }
  for (const dot of map.dots ?? []) {
    const [cx, cy] = px([dot.x, dot.y]).split(' ').map(Number);
    ops.push(`q ${rgb(dot.fill, 'rg')} ${rgb(dot.rim ?? [1, 1, 1], 'RG')} 1.2 w ${circle(cx, cy, dot.r ?? 4)} B Q`);
  }
  ops.push('Q');
  ops.push(`q ${rgb(RULE, 'RG')} 0.8 w ${roundRect(x, y, w, h, 10)} S Q`);
  return ops.join('\n');
}

/* ── Layout ──────────────────────────────────────────────────────── */

/** Lays the report out and returns the PDF as bytes.
    doc = { title, eyebrow, headline, meta, map, sections, notes, footer } */
export function buildPdf(doc) {
  const pages = [];
  let ops = null, y = 0;
  const newPage = () => { ops = []; pages.push(ops); y = PAGE.h - M; };
  const need = (h) => { if (y - h < M + 22) newPage(); };
  newPage();

  // Eyebrow
  ops.push(textOp(M, y - 8, (doc.eyebrow || 'Trailcraft').toUpperCase(),
    { size: 8.5, font: 'bold', color: MUTED, spacing: 1.1 }));
  y -= 30;

  // Headline: the one sentence, wrapped
  for (const line of wrap(doc.headline || '', 20, true, COL)) {
    need(24);
    ops.push(textOp(M, y - 16, line, { size: 20, font: 'bold' }));
    y -= 24;
  }
  if (doc.meta) {
    need(18);
    ops.push(textOp(M, y - 10, doc.meta, { size: 10.5, color: MUTED }));
    y -= 20;
  }

  // Map
  const hasImage = !!doc.map?.jpeg;
  if (doc.map) {
    const h = Math.round(COL / (doc.map.aspect || (600 / 340)));
    need(h + 12);
    y -= 8;
    ops.push(mapOps(doc.map, M, y - h, COL, h, hasImage));
    y -= h + 6;
  }

  // Sections
  for (const sec of doc.sections ?? []) {
    if (!sec.rows?.length) continue;
    need(46);
    y -= 14;
    ops.push(textOp(M, y - 8, String(sec.title || '').toUpperCase(), { size: 8.5, font: 'bold', color: MUTED, spacing: 1.1 }));
    y -= 18;
    sec.rows.forEach(([label, value], i) => {
      const lw = textWidth(label, 10);
      const avail = Math.max(120, COL - lw - 14);
      const lines = wrap(value, 10.5, true, avail);
      const rowH = 17 + (lines.length - 1) * 14;
      need(rowH + 4);
      ops.push(textOp(M, y - 12, label, { size: 10, color: MUTED }));
      lines.forEach((ln, j) => {
        ops.push(textOp(PAGE.w - M - textWidth(ln, 10.5, true), y - 12 - j * 14, ln, { size: 10.5, font: 'bold' }));
      });
      y -= rowH;
      if (i < sec.rows.length - 1) {
        ops.push(`q ${rgb(RULE, 'RG')} 0.4 w ${n(M)} ${n(y - 1)} m ${n(PAGE.w - M)} ${n(y - 1)} l S Q`);
      }
    });
    if (sec.note) {
      need(14);
      ops.push(textOp(M, y - 10, sec.note, { size: 8.5, font: 'italic', color: MUTED }));
      y -= 14;
    }
  }

  // Notes
  if (doc.notes?.length) {
    y -= 14;
    for (const note of doc.notes) {
      for (const line of wrap(note, 9, false, COL)) {
        need(13);
        ops.push(textOp(M, y - 9, line, { size: 9, font: 'italic', color: MUTED }));
        y -= 12;
      }
      y -= 3;
    }
  }

  // Footer, once every page is known
  pages.forEach((p, i) => {
    const right = `Page ${i + 1} of ${pages.length}`;
    p.push(textOp(M, M - 18, doc.footer || 'Trailcraft', { size: 7.5, color: MUTED }));
    p.push(textOp(PAGE.w - M - textWidth(right, 7.5), M - 18, right, { size: 7.5, color: MUTED }));
  });

  return assemble(pages, doc, hasImage ? doc.map : null);
}

/* ── The file ────────────────────────────────────────────────────── */

const latin1 = (s) => Uint8Array.from(s, c => c.charCodeAt(0) & 0xFF);
const pdfDate = (d = new Date()) => 'D:' + d.toISOString().replace(/[-:T]/g, '').slice(0, 14);

function assemble(pages, doc, image) {
  /* Objects: 1 catalog, 2 pages, 3–5 fonts, 6 info, 7 image (if any), then a
     page and a content stream per page. Each object is bytes; offsets are
     byte counts, which is why everything is latin-1 from here on. */
  const objs = [];
  const add = (body) => { objs.push(body); return objs.length; };   // returns the object number
  const font = (name) => `<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding >>`;

  add(null);   // 1 catalog, filled below
  add(null);   // 2 pages
  add(font('Helvetica'));         // 3
  add(font('Helvetica-Bold'));    // 4
  add(font('Helvetica-Oblique')); // 5
  add(`<< /Title ${lit(doc.title || 'Trail report')} /Producer (Trailcraft) /Creator (Trailcraft) /CreationDate (${pdfDate(doc.date ? new Date(doc.date) : new Date())}) >>`);  // 6
  let imgNo = 0;
  if (image) {
    imgNo = add({ dict: `<< /Type /XObject /Subtype /Image /Width ${image.jpegW} /Height ${image.jpegH} `
      + `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.jpeg.length} >>`, stream: image.jpeg });
  }
  const kids = [];
  for (const ops of pages) {
    const content = latin1(ops.join('\n'));
    const cNo = add({ dict: `<< /Length ${content.length} >>`, stream: content });
    const res = `<< /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >>${imgNo ? ` /XObject << /Im1 ${imgNo} 0 R >>` : ''} >>`;
    kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.w} ${PAGE.h}] /Resources ${res} /Contents ${cNo} 0 R >>`));
  }
  objs[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[1] = `<< /Type /Pages /Kids [${kids.map(k => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;

  const parts = [latin1('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')];
  let offset = parts[0].length;
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(offset);
    const head = latin1(`${i + 1} 0 obj\n`);
    const body = typeof o === 'string' ? [latin1(`${o}\nendobj\n`)]
      : [latin1(`${o.dict}\nstream\n`), o.stream, latin1('\nendstream\nendobj\n')];
    for (const b of [head, ...body]) { parts.push(b); offset += b.length; }
  });
  const xref = offset;
  parts.push(latin1(`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
    + offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')
    + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`));

  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/** Width and height from a JPEG's own header (the SOF marker), so a picture
    fetched from a map server goes into the file as it came, untouched. Null
    if the bytes are not a baseline or progressive JPEG. */
export function jpegSize(bytes) {
  if (!bytes || bytes.length < 4 || bytes[0] !== 0xFF || bytes[1] !== 0xD8) return null;
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xFF) { i++; continue; }
    const marker = bytes[i + 1];
    if (marker === 0xFF) { i++; continue; }                 // padding
    if (marker === 0xD8 || (marker >= 0xD0 && marker <= 0xD7) || marker === 0x01) { i += 2; continue; }
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    const sof = marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC;
    if (sof) return { h: (bytes[i + 5] << 8) | bytes[i + 6], w: (bytes[i + 7] << 8) | bytes[i + 8] };
    if (marker === 0xDA || marker === 0xD9) return null;     // scan data or end: no frame header seen
    i += 2 + len;
  }
  return null;
}
