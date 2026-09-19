/* Colours the handler can choose for the map: the scent the model draws and
   the layer's footprints. Plain arithmetic on hex colours, so the same
   palette comes out on every phone and in the tests. */

export const COLOUR_PRESETS = [
  { name: 'Gold', hex: '#F5D14A' },
  { name: 'Amber', hex: '#F28C28' },
  { name: 'White', hex: '#FFFFFF' },
  { name: 'Cyan', hex: '#4FD1FF' },
  { name: 'Green', hex: '#4CD964' },
  { name: 'Magenta', hex: '#E754C8' },
  { name: 'Coral', hex: '#FF6B57' },
  { name: 'Navy', hex: '#0B1630' },
];

export const isHex = (s) => /^#[0-9a-fA-F]{6}$/.test(String(s));

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const rgbToHex = (r, g, b) =>
  '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();

/** `t` of the way from colour a to colour b. */
export function mix(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return rgbToHex(...A.map((v, i) => v + (B[i] - v) * t));
}

/** Relative luminance, 0 for black to 1 for white (sRGB, as WCAG defines it). */
export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map(v => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The scent: a darker tone where it thins out at the edge, a lighter one
    where it is dense against the line, the base in between. */
export function plumePalette(base) {
  if (!isHex(base)) base = '#F5D14A';
  return { base, dark: mix(base, '#000000', 0.3), light: mix(base, '#FFFFFF', 0.55) };
}

/** The footprints: a dark edge on a light print and a light edge on a dark
    one, so they read on grass, tarmac and shadow alike. The lit step (the
    one walking the trail) is a paler tone with a gold or cream edge. */
export function stepPalette(base) {
  if (!isHex(base)) base = '#0B1630';
  const dark = luminance(base) < 0.3;
  return {
    base,
    lit: mix(base, '#FFFFFF', dark ? 0.5 : 0.55),
    halo: dark ? 'rgba(255, 255, 255, 0.9)' : '#0B1630',
    haloLit: dark ? '#F1D27A' : 'rgba(255, 244, 200, 0.85)',
    haloWidth: dark ? 1.7 : 1.4,
    haloLitWidth: 2.4,
  };
}

/** A hex colour with an alpha, as CSS. */
export function rgba(hex, a) {
  const [r, g, b] = hexToRgb(isHex(hex) ? hex : '#FFFFFF');
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** The wind: nothing at the tail of a wisp, full at its head, in the
    chosen colour. Pale and cool by default, so it reads as air. */
export function windPalette(base) {
  if (!isHex(base)) base = '#DCE9FF';
  return { base, tail: rgba(base, 0), mid: rgba(base, 0.55), head: rgba(base, 1) };
}

/** A track drawn as a line: its colour, and a casing that contrasts with it
    so it reads on any ground (dark under a light line, light under a dark). */
export function trackPalette(base, fallback = '#FFFFFF') {
  if (!isHex(base)) base = fallback;
  return { base, casing: luminance(base) < 0.3 ? '#FFFFFF' : '#0B1630' };
}
