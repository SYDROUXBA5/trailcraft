/* The pixel team: a handler, a dog in a harness and the line between them,
   and the trail board they climb, drawn by code on one small pixel grid and
   scaled up crisp. No image files.

   The art itself lives in pixel/, a module to a subject, so that the dog, the
   landscapes and the player can each be worked on without the others:

     core       colour maths, seeded noise, the sprite baker, shapes
     ramps      the art bible's colours, five tones to a material
     dog        coats, builds, heads, ears, tail, harness and the dog's rig
     human      the handler (jackets, hats, rig) and the person at the find
     props      rucksack, water bowl, bush, heart, question mark, sparks
     rope       the line
     states     what the team does at a given time: the looping states
     moments    the level-up and the boss
     stones     stepping stones, their icons, number plaques, the ring
     layout     where the stones, path, lands and bosses are (no drawing)
     scenery    the lands' colours, trees, houses, lamps, landmarks
     landmarks  the bosses: stile, footbridge, town gate, cairn
     scene      which tree and house stands where on a board
     ground     grass, leaves, cobbles, snow, stream, sky and the trail
     board-art  the board as a picture, a band of rows at a time
     close      the close-up: each land's sky, far layers, ground and near layer
     fx         a moment's effects: the paw's sparks, confetti, the lit trail
     ambient    what moves on the board by itself: grass, water, smoke, snow
     team       handler, line and dog drawn together from a frame
     player     createTeam: one canvas, 30 fps at most, only while visible

   This file is the one door the app comes in by (board.js, app.js and
   team-preview.html import from here), so the modules behind it can be
   rearranged without the callers knowing. */

export { mix, OUTLINE, STAGES, stamp } from './pixel/core.js';
export { RAMPS, TONE, CAST } from './pixel/ramps.js';
export { COATS, coatById, DOG_BOX, drawDog, dogRing } from './pixel/dog.js';
export { JACKETS, jacketById, HATS, HUMAN_BOX, drawHuman } from './pixel/human.js';
export { ICONS, drawDigits, digitsWidth, plaqueSize, drawPlaque, ringArt } from './pixel/stones.js';
export { LINE, drawLine } from './pixel/rope.js';
export { STATES, TEAM, ANCHOR, REACH, SPEED } from './pixel/states.js';
export { MOMENTS, STILL_AT, gateOpen } from './pixel/moments.js';
export { frame } from './pixel/team.js';
export { CLOSE, CLOSE_KINDS } from './pixel/close.js';
export { GOLD, STAGE_GLOW, burst, confetti, flash, trailGlow, stampPaw, skyFlare, shootingStars } from './pixel/fx.js';
export { drawAmbient } from './pixel/ambient.js';
export { drawStile, drawBarrier, barrierBand, drawHedge, hedgeBand } from './pixel/landmarks.js';
export { BOARD_LANDS } from './pixel/scenery.js';
export { boardLayout, throughGate, teamRect, trailPoint, boardTiles, tilesNear, gateX } from './pixel/layout.js';
export { drawBoard, lockPixels, lockedWood, unlockWood, duskify, crispURL } from './pixel/board-art.js';
export { createTeam } from './pixel/player.js';

import { DOG_TORSO, DOG_HEADS, DOG_EARS } from './pixel/dog.js';
import { HUMAN_HEAD, HUMAN_TORSO, HATS_ART } from './pixel/human.js';
import { PROPS } from './pixel/props.js';
import { ICONS, DIGITS } from './pixel/stones.js';

/** Every sprite table, for a test or a sprite sheet. */
export const SPRITES = { DOG_TORSO, DOG_HEADS, DOG_EARS, HUMAN_HEAD, HUMAN_TORSO, HATS_ART, PROPS, ICONS, DIGITS };
