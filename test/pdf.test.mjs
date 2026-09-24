/* The report file, checked the way a strict PDF reader checks it: every
   cross-reference offset must land exactly on its object, and the text must
   be in the file in the encoding the fonts are declared with. */

import assert from 'node:assert/strict';
import { buildPdf, textWidth, wrap, jpegSize } from '../public/pdf.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log(`  ok  ${name}`); };

const bin = (bytes) => Array.from(bytes, b => String.fromCharCode(b)).join('');
const find = (hay, needle, from = 0) => {
  outer: for (let i = from; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
};

/* A fake JPEG: the marker bytes a reader looks for, then noise. */
const jpeg = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, ...Array.from({ length: 300 }, (_, i) => (i * 37) & 0xFF), 0xFF, 0xD9]);

const doc = (extra = {}) => ({
  title: 'Trail report — Bo',
  eyebrow: 'Trailcraft · trail report',
  headline: 'Bo worked about 4 m to the right of the line. The wind pushed scent right. The dog was on the scent.',
  meta: 'Bo · Tue 16 Sep 2026, 14:25 · handler Rémi',
  map: {
    aspect: 600 / 340, jpeg, jpegW: 1200, jpegH: 680,
    paths: [{ pts: [[0.1, 0.2], [0.5, 0.5], [0.9, 0.3]], stroke: [0.96, 0.82, 0.29], casing: [0.09, 0.125, 0.102], width: 2.6, dash: [4, 3] }],
    dots: [{ x: 0.1, y: 0.2, fill: [0.18, 0.62, 0.27] }],
  },
  sections: [
    { title: 'Team', rows: [['Dog', 'Bo · Malinois · Male · 3 yr 4 mo · 29.4 kg'], ['Handler', 'Rémi (café)']] },
    { title: 'Weather', rows: [['Air', '14 °C'], ['Wind', '12 km/h from SW']], note: 'Forecast for open ground, wind at 10 m (Open-Meteo)' },
  ],
  notes: ['The model explains what the dog did. It does not predict where scent is.'],
  footer: 'Trailcraft · sydrouxba5.github.io/trailcraft',
  date: Date.parse('2026-09-16T14:25:00Z'),
  ...extra,
});

t('every cross-reference offset lands on its object', () => {
  const pdf = buildPdf(doc());
  const s = bin(pdf);
  assert.ok(s.startsWith('%PDF-1.4\n'));
  assert.ok(s.endsWith('%%EOF\n'));
  const start = Number(s.match(/startxref\n(\d+)\n%%EOF\n$/)[1]);
  assert.equal(s.slice(start, start + 4), 'xref');
  const size = Number(s.slice(start).match(/xref\n0 (\d+)\n/)[1]);
  const entries = s.slice(start).match(/\d{10} \d{5} [nf] \n/g);
  assert.equal(entries.length, size);
  entries.slice(1).forEach((e, i) => {
    const off = Number(e.slice(0, 10));
    assert.ok(s.startsWith(`${i + 1} 0 obj\n`, off), `object ${i + 1} is not at offset ${off}`);
  });
  assert.match(s, /\/Size \d+ \/Root 1 0 R \/Info 6 0 R/);
});

t('the picture goes in as a JPEG stream with its exact length', () => {
  const pdf = buildPdf(doc());
  const s = bin(pdf);
  const m = s.match(/\/Subtype \/Image \/Width 1200 \/Height 680 \/ColorSpace \/DeviceRGB \/BitsPerComponent 8 \/Filter \/DCTDecode \/Length (\d+) >>\nstream\n/);
  assert.ok(m, 'image object present');
  assert.equal(Number(m[1]), jpeg.length);
  const at = m.index + m[0].length;
  assert.equal(find(pdf, jpeg, at - 1), at, 'stream bytes follow the header untouched');
  assert.match(s, /\/Im1 Do/);
  assert.match(s, /\/XObject << \/Im1 7 0 R >>/);
});

t('without a picture the map is paper and no image object exists', () => {
  const s = bin(buildPdf(doc({ map: { ...doc().map, jpeg: null } })));
  assert.doesNotMatch(s, /DCTDecode|\/Im1/);
  assert.match(s, /0\.97 0\.97 0\.98 rg [\d. ]+ re f/);
  assert.match(s, /\[4 3\] 0 d/);
});

t('text is in the file in WinAnsi, with the PDF specials escaped', () => {
  const s = bin(buildPdf(doc()));
  const lines = wrap(doc().headline, 20, true, 499);
  assert.ok(lines.length >= 2, 'a long headline wraps');
  for (const ln of lines) assert.ok(s.includes(`(${ln})`), `headline line present: ${ln}`);
  assert.ok(s.includes('handler R\xE9mi)'), 'é as one byte');
  assert.ok(s.includes('(R\xE9mi \\(caf\xE9\\))'), 'parentheses escaped');
  assert.ok(s.includes('(14 \xB0C)'));
  assert.ok(s.includes('(TRAILCRAFT \xB7 TRAIL REPORT)'));
  assert.ok(s.includes('(Bo \xB7 Malinois'));
  assert.ok(s.includes('/CreationDate (D:20260916142500)'));
  assert.ok(s.includes('/Title (Trail report \x97 Bo)'), 'the em dash is code 0x97');
  assert.doesNotMatch(s, /[^\x00-\xFF]/);
  assert.ok(s.includes('/Encoding /WinAnsiEncoding'));
});

t('a long report runs on to a second page with numbered footers', () => {
  const rows = Array.from({ length: 70 }, (_, i) => [`Row ${i + 1}`, `Value ${i + 1}`]);
  const s = bin(buildPdf(doc({ sections: [{ title: 'Long', rows }] })));
  const pages = Number(s.match(/\/Count (\d+) >>/)[1]);
  assert.ok(pages >= 2, `70 rows need more than one page, got ${pages}`);
  for (let i = 1; i <= pages; i++) assert.ok(s.includes(`(Page ${i} of ${pages})`), `footer on page ${i}`);
  const one = bin(buildPdf(doc()));
  assert.match(one, /\/Count 1 >>/);
  assert.ok(one.includes('(Page 1 of 1)'));
});

t('a value too wide for its row wraps onto extra lines, right-aligned', () => {
  const long = 'Bo · Malinois · Male · 3 yr 4 mo · 29.4 kg · microchip 985 141 000 123 456 · works the line at 5 m ahead';
  const s = bin(buildPdf(doc({ sections: [{ title: 'Team', rows: [['Dog', long]] }] })));
  const lines = wrap(long, 10.5, true, 499 - textWidth('Dog', 10) - 14);
  assert.ok(lines.length >= 2);
  for (const ln of lines) assert.ok(s.includes(`(${ln.replace(/·/g, '\xB7')})`), `line present: ${ln}`);
});

t('widths: bold is wider, accents weigh like their letters, wrap respects the box', () => {
  assert.ok(textWidth('Trail', 10, true) > textWidth('Trail', 10));
  assert.equal(textWidth('é', 10), textWidth('e', 10));
  // 722+556+222+222+556+278+722+556+333+222+556 = 4945 per 1000 em, from the AFM
  assert.ok(Math.abs(textWidth('Hello world', 12) - 59.34) < 0.01, `Helvetica AFM says 59.34, got ${textWidth('Hello world', 12)}`);
  for (const ln of wrap('one two three four five six seven eight nine ten eleven twelve', 12, false, 100)) {
    assert.ok(textWidth(ln, 12) <= 100);
  }
  assert.deepEqual(wrap('', 10, false, 100), ['']);
});

t('a JPEG’s size is read from its own header, and non-JPEGs are refused', () => {
  // SOI, an APP0 segment, then an SOF0 frame header for 1200 × 680
  const sof = [0xFF, 0xC0, 0x00, 0x11, 0x08, 0x02, 0xA8, 0x04, 0xB0, 0x03];
  const app0 = [0xFF, 0xE0, 0x00, 0x04, 0x00, 0x00];
  assert.deepEqual(jpegSize(new Uint8Array([0xFF, 0xD8, ...app0, ...sof, 0, 0, 0])), { w: 1200, h: 680 });
  assert.deepEqual(jpegSize(new Uint8Array([0xFF, 0xD8, ...app0, 0xFF, 0xC2, 0x00, 0x11, 0x08, 0x01, 0x54, 0x02, 0x58, 0x03, 0, 0])), { w: 600, h: 340 }, 'progressive too');
  assert.equal(jpegSize(new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0])), null, 'a PNG');
  assert.equal(jpegSize(new Uint8Array([0xFF, 0xD8, 0xFF, 0xDA, 0, 2])), null, 'scan data before any frame header');
  assert.equal(jpegSize(null), null);
});

t('a date the calendar cannot hold still makes a report', () => {
  /* What a crafted link used to carry: laidAt 9e15 is past the last date a
     Date can hold, and toISOString threw on it, so Save PDF never delivered. */
  for (const date of [9e15, -9e15, NaN]) {
    const s = bin(buildPdf(doc({ date })));
    assert.match(s, /\/CreationDate \(D:\d{14}\)/);
  }
});

console.log(`\n${pass} passed total`);
