/* The Deep Wood: difficulty is depth. The trail leaves an open sunlit field,
   passes the wood's edge, and goes on into forest, old forest and the
   ancient wood, each darker and closer than the last.

   Here are the five lands' colours and the few curves that say how the trail
   itself changes with the level (how wide it is worn, how ragged, what it is
   made of). Nothing here draws, and nothing here knows a layout. */

import { RAMPS } from './ramps.js';

/* Bottom to top. The Hot stage is the field and the wood's edge, Warm the
   forest, Cold the old forest and the ancient wood. */
export const LAND_ORDER = ['field', 'edge', 'forest', 'old', 'ancient'];

const M = RAMPS.meadow;

/* Every ramp is ink, shade, base, light, glint. `floor` is the ground, `path`
   the trail worn into it, `rock` the stepping stones, `tag` the number plate
   under each (ink, shade, base, light) and `tagInk` the dim plate's tint.
   `sign` is the timber of the land's signposts, `cast` the land's shadow
   colour and strength and `castLen` how far a tree throws it. `dark` lands
   are lit by what little comes through the canopy: the team is rimmed with
   light there, the trail lies in a paler corridor, and the dark theme
   leaves them alone (they are dusk already). */
export const LANDS = {
  field: {
    key: 'field', name: 'Open field', stage: 'hot', dark: false,
    floor: M.grass, path: M.path, water: M.water, rock: M.stone,
    tag: ['#3d2616', '#5a3c22', '#77522f', '#9a7445'], tagInk: '#6a6a66',
    g: '#9cc35a', print: '#a9844f', cast: ['#1c3440', 0.30], castLen: 0.5,
    tree: '#4c8236', treeHi: '#6aa246', treeLo: '#35602a', trunk: '#6b4a2e',
    haw: '#6a9a40', hawHi: '#88b656', hawLo: '#4a7430', berry: '#c8302a',
    pine: '#2f5a3a', pineHi: '#4c7c40', pineRim: '#a4d05a',
    fern: ['#2f6a3a', '#4c9040', '#7ab648'], sign: ['#3a2620', '#5c3d2a', '#80583a', '#a67c4e', '#caa26a'],
  },
  /* The wood's edge is the field's own grass under young trees. */
  edge: {
    key: 'edge', name: 'The wood’s edge', stage: 'hot', dark: false,
    floor: M.grass, path: M.path, water: M.water, rock: M.stone,
    tag: ['#3d2616', '#5a3c22', '#77522f', '#9a7445'], tagInk: '#6a6a66',
    g: '#8cb850', print: '#a9844f', cast: ['#1c3440', 0.32], castLen: 0.55,
    tree: '#46803a', treeHi: '#66a044', treeLo: '#2f5c2c', trunk: '#66482e',
    haw: '#629640', hawHi: '#84b452', hawLo: '#447030', berry: '#c8302a',
    pine: '#2a5236', pineHi: '#44763c', pineRim: '#9cc850',
    fern: ['#2f6a3a', '#4c9040', '#7ab648'], sign: ['#3a2620', '#5c3d2a', '#80583a', '#a67c4e', '#caa26a'],
  },
  forest: {
    key: 'forest', name: 'The forest', stage: 'warm', dark: false,
    floor: ['#1c3a2a', '#2e5a34', '#4a7c3c', '#7aa844', '#bcd45c'],
    path: ['#4e3626', '#86623e', '#b48e5c', '#d2b47e', '#ecd8a4'],
    water: ['#12344a', '#1f5a78', '#3a86a8', '#7cc0d0', '#d8f4f0'],
    rock: ['#2c3430', '#56625a', '#869288', '#b4bfae', '#e2e8d4'],
    tag: ['#2a1a10', '#463020', '#64462c', '#8a663e'], tagInk: '#5a6258',
    g: '#4a7c3c', print: '#86623e', cast: ['#10242c', 0.42], castLen: 0.6,
    tree: '#3c7a34', treeHi: '#62a440', treeLo: '#255228', trunk: '#5a4230',
    haw: '#5a9238', hawHi: '#8cc04c', hawLo: '#386a2c', berry: '#e8d24a',
    pine: '#22482e', pineHi: '#38683a', pineRim: '#8cb84c',
    fern: ['#2c6a34', '#58a844', '#9cd45c'],
    leaf: ['#9cbc4a', '#6a8e3a', '#d0c85a', '#84a844', '#c0a040'],
    sign: ['#2a1c14', '#46301e', '#6a4a2e', '#96703e', '#c8a060'],
  },
  old: {
    key: 'old', name: 'The old forest', stage: 'cold', dark: true,
    floor: ['#102a2c', '#1a403a', '#28583f', '#3e7648', '#74a456'],
    path: ['#3a2e24', '#6a5638', '#9a845c', '#bca476', '#e0cc9c'],
    water: ['#0c2434', '#184660', '#2c6e8c', '#62a8bc', '#c8ece8'],
    rock: ['#1c2a2e', '#445a5a', '#748c88', '#a8bcb2', '#dcece0'],
    /* Slate with a pale edge: a brown tag is lost on a dark floor. */
    tag: ['#8fa298', '#1c2a30', '#2e424a', '#b4c6ba'], tagInk: '#2a3a3c',
    g: '#1a403a', print: '#544634', cast: ['#06141a', 0.5], castLen: 0.4,
    tree: '#1f4e3c', treeHi: '#34704c', treeLo: '#123230', trunk: '#3a2e26',
    haw: '#27584a', hawHi: '#3e7c58', hawLo: '#163a34', berry: '#74a456',
    pine: '#143632', pineHi: '#205248', pineRim: '#4c8c68',
    moss: '#62a848', mossLo: '#3a7a3c',
    fern: ['#1e5440', '#3c8454', '#6cb468'],
    root: ['#1a1410', '#3a2c22', '#6a5640'],
    sign: ['#141a1c', '#3e3128', '#62503c', '#8e7654', '#c4aa78'],
  },
  ancient: {
    key: 'ancient', name: 'The ancient wood', stage: 'cold', dark: true,
    floor: ['#0a1420', '#122430', '#1a343c', '#26484a', '#447060'],
    path: ['#2a2420', '#5e5240', '#94845f', '#b8a87e', '#e0d4a8'],
    water: ['#081826', '#123448', '#22566c', '#4c8ea0', '#b4dcdc'],
    rock: ['#1a2230', '#4a5870', '#8090a8', '#b8c6d8', '#eef4fc'],
    tag: ['#9aa8c0', '#161c2c', '#262e44', '#c0cce0'], tagInk: '#222a3a',
    g: '#122430', print: '#3c3a3c', cast: ['#04060e', 0.5], castLen: 0.3,
    tree: '#10282e', treeHi: '#1a3e3e', treeLo: '#081820', trunk: '#2a2428',
    haw: '#122c30', hawHi: '#1e4442', hawLo: '#0a1a22', berry: '#7ae6d2',
    pine: '#0c2226', pineHi: '#143636', pineRim: '#2c5a54',
    moss: '#3a7a5c', mossLo: '#1e4a40',
    fern: ['#143a3a', '#245a50', '#3c8068'],
    root: ['#0c0a10', '#241e22', '#4a4244'],
    fungus: ['#2a8a86', '#7ae6d2', '#d8fff4'],
    sign: ['#0c1016', '#322c30', '#584e4a', '#847464', '#bcac8c'],
    /* The moon in the glade at the heart of the wood. */
    moon: ['#2c5a5a', '#4c8a7c', '#8cc4a8', '#d4f0d0'],
  },
};

/** Which land a level is in. The field gives way to the wood's edge half way
    between stones 10 and 11; the others change on their boss. */
export const landOfLevel = (lv) => (lv < 10.5 ? 'field' : lv <= 15 ? 'edge' : lv <= 45 ? 'forest' : lv <= 75 ? 'old' : 'ancient');

/** A land's shadow as a CSS colour. */
export function castOf(land, k = 1) {
  const [hex, a] = (LANDS[land] || LANDS.field).cast;
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.round(a * k * 100) / 100})`;
}

/* ── How the trail changes with depth ── */

/** How wide the trail is worn (half its width, in art pixels): a broad easy
    path across the field, a thread through the roots of the ancient wood.
    Never under seven pixels across, though: a footpath is three and a herd's
    way four (tracks.js), and the trail must stay the widest line there is. */
export const trailHalf = (lv) => (lv < 8 ? 5.7 : lv < 16 ? 5.7 - (lv - 8) * 0.12 : lv < 46 ? 4.7 - (lv - 16) * 0.027 : lv < 76 ? 3.9 - (lv - 46) * 0.007 : 3.69 - (lv - 76) * 0.006);

/** How ragged its edges are: 0 in the field, more than 1 at the top. */
export const trailRough = (lv) => (lv < 12 ? 0 : Math.min(1.2, (lv - 12) / 60));

/* Hard ground, where the ladder's waves work on it: the forestry road the
   trail joins for the "Ground" wave (66 to 70), and the lane on to the
   foresters' hamlet (to the boss at 75). Anything else is earth. */
export const ROAD = { gravel: [65.55, 70.55], tarmac: [70.55, 75.3], half: 6.3 };
export const surfaceOf = (lv) => (lv >= ROAD.gravel[0] && lv < ROAD.gravel[1] ? 'gravel' : lv >= ROAD.tarmac[0] && lv < ROAD.tarmac[1] ? 'tarmac' : 'earth');

/* Road stone and tarmac, pale enough to stay the lightest line in a dark wood. */
export const GRAVEL = ['#4a463e', '#7e786a', '#a8a290', '#c4beaa', '#e2dcc8'];
export const TARMAC = ['#252a34', '#444b58', '#646d7a', '#858e9a', '#d6dce2'];
