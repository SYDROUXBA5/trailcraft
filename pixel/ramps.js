/* The art bible's colours, tone by tone (docs/superpowers/specs/2026-10-12-pixel-art-direction.md).
   Every ramp is five tones, dark to light: [ink, shade, base, light, glint].
   ink is the outline and the deepest fold, shade the side away from the
   light, base the thing's own colour, light the planes the light lands on,
   glint a few pixels at most. Shadows lean blue-violet and lights lean warm,
   which is what makes flat colours read as lit; at night the lights lean
   to the moon instead, and only lamplight is warm.

   Three artists draw from this one table so that a red jacket is the same
   red beside any dog on any land. It is not to be edited to suit one sprite:
   a tone that is missing belongs in the module that needs it. */

/** The five tones by name: RAMPS.fur.red[TONE.shade]. */
export const TONE = Object.freeze({ ink: 0, shade: 1, base: 2, light: 3, glint: 4 });

export const RAMPS = Object.freeze({
  people: Object.freeze({
    skin: Object.freeze(['#6a3838', '#b87660', '#e0aa82', '#f0c8a0', '#fbe4c8']),
    skinFind: Object.freeze(['#5a2e30', '#a26248', '#c98d68', '#e0ae88', '#f2d2b0']),
    hair: Object.freeze(['#221314', '#351e1a', '#4a3024', '#6b4e36', '#8c7252']),
    hairFind: Object.freeze(['#441e18', '#864625', '#b8742f', '#d4ac66', '#ded1aa']),
    trousers: Object.freeze(['#1b1a22', '#2f3141', '#3f4658', '#6e7e95', '#aab4bd']),
    boots: Object.freeze(['#281616', '#4e2d24', '#6a4630', '#af8456', '#c9b99f']),
  }),
  jackets: Object.freeze({
    navy: Object.freeze(['#14152e', '#212d5b', '#2b4a7c', '#5089be', '#9dbdd1']),
    red: Object.freeze(['#441723', '#872329', '#b93a2c', '#d67e63', '#dfbba9']),
    forest: Object.freeze(['#1a2a1f', '#2d5131', '#3f6e3c', '#74a967', '#b1c7a8']),
    orange: Object.freeze(['#541a15', '#a7431b', '#e07a26', '#e6b36a', '#e8d6ae']),
    hivis: Object.freeze(['#593c18', '#b18d1f', '#e0d23a', '#e6d078', '#e9dfb5']),
    sky: Object.freeze(['#1c244b', '#2c5293', '#3a86c8', '#78b7d6', '#b4d6e0']),
    slate: Object.freeze(['#292930', '#4a4d5a', '#646c7a', '#919aa4', '#bec3c7']),
    plum: Object.freeze(['#29223d', '#493b75', '#6e4ea0', '#a181bf', '#cab7d5']),
    findYellow: Object.freeze(['#5f3b15', '#be8e19', '#e9d33a', '#edd578', '#ede2b5']),
  }),
  hats: Object.freeze({
    cap: Object.freeze(['#4a2819', '#925c24', '#c9962e', '#dac46c', '#e2d7ae']),
    beanie: Object.freeze(['#431723', '#842229', '#b5382b', '#d57b60', '#dfb9a7']),
    bush: Object.freeze(['#362923', '#67533e', '#8c7a52', '#b3a981', '#cecab7']),
  }),
  fur: Object.freeze({
    red: Object.freeze(['#481b1b', '#8d3e2a', '#c26a36', '#d4a472', '#dfcdb1']),
    redDeep: Object.freeze(['#3a1416', '#72291e', '#9c4a26', '#d08950', '#dbbf9e']),
    redPale: Object.freeze(['#61201c', '#c04f28', '#e0935a', '#e7c08e', '#ebddc1']),
    black: Object.freeze(['#161212', '#211a1a', '#2e2624', '#4a403b', '#6a6058']),
    tan: Object.freeze(['#45201c', '#87462d', '#b9733a', '#d0a973', '#ddcfb1']),
    tanPale: Object.freeze(['#58291f', '#ad5e2f', '#d49a56', '#dfc38b', '#e6ddbf']),
    liver: Object.freeze(['#221114', '#421f1d', '#5a3226', '#a86d4a', '#c7ad96']),
    fawn: Object.freeze(['#512a22', '#9e5d35', '#c99455', '#d7be8a', '#e2dabe']),
    fawnDeep: Object.freeze(['#3f221e', '#7b4a31', '#a87440', '#c7a974', '#d8ceb1']),
    fawnPale: Object.freeze(['#6b3525', '#cd7b3d', '#e2bd86', '#e9d9ac', '#eee8d1']),
    mask: Object.freeze(['#140e0e', '#1f1614', '#2c211b', '#4b3d2f', '#6c5e4b']),
    yellow: Object.freeze(['#6a3521', '#c48a45', '#e3bd7a', '#eadaa4', '#eee7cd']),
    yellowDeep: Object.freeze(['#512c22', '#9f6236', '#c99a58', '#d7c28c', '#e2dbbf']),
    jet: Object.freeze(['#121116', '#1c1b22', '#2d2c37', '#4c4c5e', '#7c7e96']),
    choc: Object.freeze(['#261213', '#49251e', '#643b27', '#b17949', '#cbb497']),
    chocDeep: Object.freeze(['#221010', '#361a15', '#4c2c1c', '#6f4b2c', '#927147']),
    chocPale: Object.freeze(['#2f1819', '#5b3229', '#7c4e36', '#b6895f', '#cebca5']),
    springerLiver: Object.freeze(['#291116', '#501c1c', '#6e3024', '#bd6742', '#d0ac96']),
    cream: Object.freeze(['#7a5a4a', '#d2b088', '#f3dcae', '#faecc8', '#fff8e4']),
    white: Object.freeze(['#6a6478', '#b9b4c4', '#f1ece3', '#fbf8f0', '#ffffff']),
    /* A white dog's legs, a shade under its body, or they are lost against it. */
    whiteLeg: Object.freeze(['#6a6478', '#a19cad', '#d8d3d5', '#f7f3eb', '#ffffff']),
    ticking: Object.freeze(['#4a2a2a', '#8a5a4c', '#b79a8c', '#d8c4b8', '#f1ece3']),
    nose: Object.freeze(['#0c0a0e', '#1a1418', '#2a2024', '#4a3a40', '#8a7a80']),
    noseLiver: Object.freeze(['#1c0e0c', '#2e1812', '#4a2018', '#6e3a2c', '#a87060']),
    tongue: Object.freeze(['#7a2a3a', '#b84a56', '#e87a80', '#f8a8a4', '#ffd0c8']),
  }),
  kit: Object.freeze({
    harnessHot: Object.freeze(['#3a0f1e', '#7c1628', '#bd2430', '#e2594c', '#f6b9a8']),
    harnessWarm: Object.freeze(['#4f2014', '#9e501a', '#d98a1f', '#e5bf62', '#e7dba9']),
    harnessCold: Object.freeze(['#1a2353', '#2652a4', '#3b8bd6', '#79bbe0', '#b5d9e6']),
    webbing: Object.freeze(['#12121a', '#1e2028', '#2c2e3a', '#444858', '#6a7084']),
    reflective: Object.freeze(['#6a7488', '#a8b2c0', '#dfe6ea', '#f6fafa', '#ffffff']),
    metal: Object.freeze(['#3a4050', '#6a7484', '#a2acb8', '#d2dae0', '#ffffff']),
    line: Object.freeze(['#8a3d14', '#c8641c', '#f08a2c', '#ffb04e', '#ffd88a']),
  }),
  meadow: Object.freeze({
    sky: Object.freeze(['#5fa8e0', '#8cc6ee', '#bfe2f2', '#e6f3ea', '#fff3b8']),
    grass: Object.freeze(['#2f5a36', '#4f8a3e', '#7fb84a', '#a4d05a', '#d3e87c']),
    path: Object.freeze(['#7a5236', '#b08552', '#d6b074', '#ecd096', '#f8e8bc']),
    foliage: Object.freeze(['#1f4634', '#2f6a3a', '#4c9040', '#7ab648', '#b4d85c']),
    hedge: Object.freeze(['#1c3c34', '#2a5a38', '#3f7a3a', '#5e9a40', '#8cba4c']),
    trunk: Object.freeze(['#3a2620', '#5c3d2a', '#80583a', '#a67c4e', '#caa26a']),
    water: Object.freeze(['#1f4c7a', '#2f74b0', '#4c9fd8', '#8ccdee', '#e4f6ff']),
    stone: Object.freeze(['#4a4a5c', '#777b8a', '#a3a8b0', '#c9cdcf', '#eceee8']),
    poppy: Object.freeze(['#6a1c22', '#a82c26', '#d9412b', '#f27a5c', '#ffb49a']),
    buttercup: Object.freeze(['#8a6a1c', '#c89a2a', '#f3d34a', '#fff0a0', '#ffffff']),
  }),
  wood: Object.freeze({
    sky: Object.freeze(['#3a2a52', '#7a3e58', '#c8643a', '#f0a848', '#ffd37a']),
    litter: Object.freeze(['#4a2430', '#7e4428', '#b06e30', '#d6953c', '#f4c45c']),
    path: Object.freeze(['#5e3c2c', '#9a6c44', '#c89a62', '#e6c084', '#f8dea6']),
    amber: Object.freeze(['#5a2420', '#9a3c1c', '#d06c1e', '#f09c30', '#ffd060']),
    russet: Object.freeze(['#4a1c22', '#7e2a1e', '#b04a22', '#d8742c', '#f4a444']),
    pine: Object.freeze(['#14262c', '#1f3c34', '#2f5a3a', '#4c7c40', '#d89a3a']),
    trunk: Object.freeze(['#2a1a22', '#46292a', '#6a4030', '#96623a', '#c88e4a']),
    water: Object.freeze(['#2a2850', '#4a4a86', '#7a6ea8', '#e09a6a', '#ffe0a0']),
    stone: Object.freeze(['#3e3040', '#6a5a62', '#94847e', '#c2ae96', '#eed8ae']),
    mushroom: Object.freeze(['#5a1820', '#96241e', '#c8302a', '#ee6a4a', '#fff4e0']),
  }),
  town: Object.freeze({
    sky: Object.freeze(['#060a1e', '#0b1430', '#132244', '#1c3258', '#eef0dc']),
    lawn: Object.freeze(['#0e1830', '#182a4c', '#24406a', '#32568a', '#4a74a8']),
    cobble: Object.freeze(['#1a2140', '#3a4670', '#5d6c98', '#8e9cc0', '#c4d0e8']),
    foliage: Object.freeze(['#0c1c2c', '#16344a', '#235a68', '#368088', '#5aaaa0']),
    trunk: Object.freeze(['#120e1e', '#221a30', '#382a40', '#524058', '#74607a']),
    plaster: Object.freeze(['#1e1838', '#3a2e5c', '#5a4a7a', '#7c6c9c', '#a898c0']),
    brick: Object.freeze(['#2a1630', '#4a2a44', '#6e4458', '#946270', '#bc8a90']),
    roof: Object.freeze(['#10142a', '#1c2240', '#2e3760', '#46528a', '#6a7ab4']),
    lamp: Object.freeze(['#7a3e1c', '#c8742a', '#ffd36a', '#fff4c2', '#ffffff']),
    water: Object.freeze(['#0a1430', '#16305e', '#2a5a9a', '#5a9ad8', '#c8ecff']),
    stone: Object.freeze(['#1c2038', '#3c4464', '#68708e', '#98a0b8', '#ccd2e0']),
  }),
  climb: Object.freeze({
    sky: Object.freeze(['#060a24', '#0c1440', '#16205a', '#24306e', '#fff3c4']),
    aurora: Object.freeze(['#16405e', '#1f6a8a', '#2fa8a0', '#5fe0a8', '#b4f8c8']),
    snow: Object.freeze(['#5a6aa0', '#9fb2dc', '#dbe6f6', '#f4f8ff', '#ffffff']),
    track: Object.freeze(['#4a5a90', '#8094c4', '#b4c4e4', '#d6e2f4', '#f0f6ff']),
    rock: Object.freeze(['#1c2240', '#38426a', '#5a688e', '#8492b4', '#b8c4dc']),
    pine: Object.freeze(['#0e2228', '#183a3c', '#285a50', '#3e7c66', '#c8f4e0']),
    trunk: Object.freeze(['#1a1420', '#2e2430', '#4a3a40', '#6a5654', '#8e7a70']),
    ice: Object.freeze(['#16305e', '#2a5c9a', '#5a9ad0', '#a8dcf0', '#f0fcff']),
    lantern: Object.freeze(['#7a3e1c', '#c8742a', '#ffd36a', '#fff4c2', '#ffffff']),
  }),
});

/** What a cast shadow is made of on each land: never black. [colour, strength 0 to 1]. */
export const CAST = Object.freeze({
  meadow: Object.freeze(['#1c3440', 0.30]),
  wood: Object.freeze(['#30142c', 0.36]),
  town: Object.freeze(['#06081e', 0.46]),
  climb: Object.freeze(['#3c5496', 0.30]),
});
