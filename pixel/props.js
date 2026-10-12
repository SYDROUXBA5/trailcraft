/* The small things a team has about it: the rucksack, the water bowl, the
   heart, the question mark and the sparks. One character is one pixel; each
   prop has its own few tones, dark to light, and no black line round it. */

export const PROPS = {
  rucksack: [
    '...ssss...',
    '..shhhhs..',
    '.shcccchs.',
    '.sccllccs.',
    'dscccccchd',
    'dsccddccsd',
    'dscdlldcsd',
    'dscdccdcsd',
    '.sccccccs.',
    '..dddddd..',
  ],
  bowl: ['.wwWwwww.', 'bhhhhhhhb', 'dbbbbbbbd', '.ddddddd.'],
  heart: ['.pp.pp.', 'pPppppp', 'ppppppp', '.ppppp.', '..ppd..', '...d...'],
  query: ['.www.', 'w...w', '...ww', '..ww.', '..w..', '.....', '..w..'],
  spark: ['...g...', '...g...', '..gwg..', 'ggwwwgg', '..gwg..', '...g...', '...g...'],
  sparkS: ['.g.', 'gwg', '.g.'],
};

export const PROP_PALS = {
  rucksack: { c: '#5e6b3a', h: '#8a9a52', l: '#b4c06a', s: '#3b4426', d: '#262c1c' },
  bowl: { w: '#8fd0f0', W: '#e4f6ff', h: '#c9cdcf', b: '#8c99a6', d: '#4a5466' },
  heart: { p: '#ef5a6f', P: '#ffb4bc', d: '#a82c46' },
  query: { w: '#ffffff' },
  spark: { g: '#f2c14e', w: '#fff8dc' },
};

/* Kept for whoever still asks for the old name. */
export const BUSH_PAL = { v: '#4c8236', y: '#6ea447', p: '#d9412b', V: '#35602a' };
