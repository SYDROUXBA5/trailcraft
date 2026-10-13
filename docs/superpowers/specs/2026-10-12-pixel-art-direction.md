# Pixel art direction: the team, the four lands, the moments and the cards

Date: 2026-10-12. Follows `2026-10-09-team-levels-design.md`. Rémi saw the team
board and the level-up on his iPhone and asked for better graphics: the dog and
handler, the landscapes, the animations and the cards, in "richer pixel art".
This is the brief three artists work from without talking to each other:
**characters**, **landscapes**, **UI**. Section 11 says who owns which file.

The bar is a polished 16-bit game on a phone: Minish Cap and Link to the Past
overworlds, Pokémon Emerald, Stardew's seasons, Eastward's light. Readable
silhouettes first, clusters not noise, one light, colour that turns as it
darkens, and something always quietly moving.

## 1. What falls short today (from the `before-*` shots)

Characters
- One near-black rim (`#1c1411`) round everything eats about a third of each
  sprite's pixels and makes the dog a dark lump on every land.
- Every breed is the same torso with another head and palette. No real ear
  set, muzzle, stop, tuck-up or tail carriage; a Malinois, a shepherd and a
  Labrador differ by colour only.
- Legs are drawn as lines by code: straight sticks, no elbow, hock or paw. Nose
  down, the hound's head melts into its forelegs.
- Two flat tones per colour, no hue shift, no belly or far-leg shadow, no eye
  light. The harness reads as a red-and-white dashed strip, not a harness.
- The handler is a 16 × 26 block: no hands, two dot eyes, trousers as two bars.
- On the board the team is small: the hero of the screen is 34 art pixels wide.
- Two pixel sizes on one screen: the board is 2 CSS px, the close-up over it 3.

Landscapes
- The ground is one flat colour with random speckle: no meadows, banks, worn
  patches or tonal areas, so nothing has depth.
- Trees are one lollipop at three sizes, black-rimmed, with a line for a shadow.
- The trail is a ribbon of one width with a hard edge: no verge, ruts or wear.
- The town is the same house stamped on a flat navy sheet: no streets, yards,
  window glow or lamp pools worth the name; night has no light in it.
- The climb is white with pebbles: no drifts, blue shadows, tracks or wind.
- No cast shadows, no light direction, no weather; water is one pond and one
  strip. Lands change with a hard cut. The close-up is three flat bands.

Animation
- Trot and walk are six poses with rigid parts: ears, tail and line move with
  the body, not after it. Idle is nearly still. Nothing on the board moves.
- The level-up is a paw stamp, a short trot and a few sparks: over before it
  feels like a win. The boss is better but its ending is a plain card.

Cards and text
- The cards are the app's stock pills and sit on the art like a web form on a
  game: no shared edge, colour or rhythm. Land signs float over scenery.
- The next-level card takes about 45% of the screen; the board, which is the
  point, is a letterbox. The header has no level badge.
- The level-up overlay is a plain modal; the name change barely registers.

## 2. The grid

**One art pixel is 2 CSS pixels on every team screen**: board, stones,
plaques, ring, stamp, sweep, the level-up's board, the close-up and the look
preview on the team form (the last two are 3 today and become 2). That is 4
device pixels at 2x and 6 at 3x, always whole. We stay at 2 and spend the
detail on bigger sprites rather than a finer grid: at 1 CSS px the retro look
Rémi liked disappears on a 460 ppi phone, and every sprite and tile costs four
times the pixels to author and to hold.

- Board art width is `ceil(cssWidth / 2)`: 375 → 188, 390 → 195, 393 → 197,
  402 → 201, 414 → 207, 428 → 214, 430 → 215; never more than 240 (480 CSS).
- Canvases are sized in art pixels and shown at exactly 2x with smoothing off.
  Every DOM offset on the board is an even number of CSS pixels. No fractional
  transforms, no CSS scale on pixel layers, no rotation: turn a sprite by
  drawing another frame.
- Motion is in whole art pixels. "Sub-pixel" feel comes from frame design
  (a highlight that travels, a shape that changes by one pixel), never from a
  half-pixel offset.
- Tiles stay 256 rows; no canvas edge over 4096 px; a board is at most 240
  art pixels wide.

## 3. Sprite boxes and anchors

All sprites face right and are mirrored to face left. Boxes are in art pixels.

| thing | box (w × h) | ground row | anchor | notes |
|---|---|---|---|---|
| handler | 24 × 40 | 38 | feet centre (12, 38) | stands 34 tall (rows 4 to 38); 4 rows above for a hat or a raised fist |
| person at the find | 24 × 40 | 38 | feet centre (12, 38) | same rig; crouches behind the bush |
| dog | 48 × 34 | 32 | under the withers (28, 32) | paws on row 32, row 33 is contact shadow only |
| team | 136 × 60 | 54 | `ANCHOR = [16, 54]`, the handler's feet | `HX = 4`, `DX = 44`, `LINE_LEN = 40` |
| close-up | 168 × 96 | 84 | | 336 × 192 CSS at 2x |
| stone | 20 × 12 top face, 3 rows of side | | centre of the top face | button stays 48 CSS px |
| plaque | digits 3 × 5 on a 9-row plate | | | unchanged size, new colours |
| bush 24 × 18, bowl 9 × 4, rucksack 10 × 10, heart 7 × 6, "?" 5 × 7, spark 7 × 7 and 3 × 3 | | | bottom centre | |

`REACH` (pixel/states.js) becomes `{ body: [4, 92], tall: 40, ahead: [26, 78],
nose: 78, gate: 96 }`. The layout, board.js and the showcase read it; nobody
else carries these numbers. The dog's ahead-reach is 78 where it was 71, so the
team still fits facing one way or the other on a 188-pixel board.

The handler's line hand is at (19, 22) standing. The harness ring is the rear
end of the back plate, 2 rows above the back: about (25, 11) in the dog's box
for a hound; each build states its own. Stone spacing on the board goes from 40
rows to 52 (layout.js `spacing`) so a 34-row handler does not stand in the next
stone; the ladder becomes about 5,400 rows, 22 tiles.

## 4. Light, shadow, outline

- **Light**: the sun or moon is upper left on every land. Scenery is lit from
  the upper left and casts down-right. **Characters are lit from above** (top
  planes light, undersides and far limbs shaded), so a mirrored sprite is
  still lit correctly.
- **Cast shadows** under everything that stands on the ground: a flat ellipse,
  for a character about two thirds its width and 2 to 3 rows deep, 1 pixel
  right of centre. Scenery shadows fall down-right at the land's length:
  meadow 0.5 of the height, wood 1.2 (dusk), town 0.4 from the moon plus a
  ring away from each lamp, climb 0.8 and blue. Shadows are the land's
  `CAST` colour at its strength (ramps.js), never black, with one row of
  ordered dither at the edge.
- **Outline**: selective. The contour is the `ink` tone of the fill it
  borders, not one black. On the top edge facing the light the contour drops
  to `shade`. Inside a sprite there are no lines: planes part by tone. Pure
  near-black (`#0c0a0e`) is for pupils and nostrils only. Ground decals
  (flowers, tufts, prints, leaves) have no outline; scenery is outlined on
  its shadow side and bottom only.
- **Readability**: every character must read on all four grounds. The `ink`
  contour gives that on grass and litter; on the night lands add a 1-pixel
  `glint` rim along the top-left edges (moonlight), which separates dark
  coats from navy.
- **Dither** only for: sky bands, light pools, shadow edges, the trail's
  corridor of light and the edge of a moonbeam. Never to shade a sprite.
- **Clusters**: no single stray pixels except eye lights, stars, sparks and
  ticking on a springer. A tone change is at least 2 pixels.

## 5. Colour

Every material is a ramp of five tones, dark to light:
**ink, shade, base, light, glint**. Shade turns 10° towards blue-violet, ink
22°; light turns 8° towards warm yellow, glint 14° and loses colour. Black
coats take a cool sheen instead. Night lands light towards the moon (cyan);
only lamps, windows and lanterns are warm. The ramps are code:
`import { RAMPS, TONE, CAST } from './ramps.js'`, e.g.
`RAMPS.fur.red[TONE.shade]`. **Do not edit ramps.js**; a tone it lacks is
defined in the module that needs it. Sprite strings keep the convention of a
letter per slot; extend it to tones, not to more hand-mixed hexes
(`darker()`/`lighter()` are how the flat look happened).

**people**

| ramp | ink | shade | base | light | glint |
|---|---|---|---|---|---|
| skin | `#6a3838` | `#b87660` | `#e0aa82` | `#f0c8a0` | `#fbe4c8` |
| skinFind | `#5a2e30` | `#a26248` | `#c98d68` | `#e0ae88` | `#f2d2b0` |
| hair | `#221314` | `#351e1a` | `#4a3024` | `#6b4e36` | `#8c7252` |
| hairFind | `#441e18` | `#864625` | `#b8742f` | `#d4ac66` | `#ded1aa` |
| trousers | `#1b1a22` | `#2f3141` | `#3f4658` | `#6e7e95` | `#aab4bd` |
| boots | `#281616` | `#4e2d24` | `#6a4630` | `#af8456` | `#c9b99f` |

**jackets**

| ramp | ink | shade | base | light | glint |
|---|---|---|---|---|---|
| navy | `#14152e` | `#212d5b` | `#2b4a7c` | `#5089be` | `#9dbdd1` |
| red | `#441723` | `#872329` | `#b93a2c` | `#d67e63` | `#dfbba9` |
| forest | `#1a2a1f` | `#2d5131` | `#3f6e3c` | `#74a967` | `#b1c7a8` |
| orange | `#541a15` | `#a7431b` | `#e07a26` | `#e6b36a` | `#e8d6ae` |
| hivis | `#593c18` | `#b18d1f` | `#e0d23a` | `#e6d078` | `#e9dfb5` |
| sky | `#1c244b` | `#2c5293` | `#3a86c8` | `#78b7d6` | `#b4d6e0` |
| slate | `#292930` | `#4a4d5a` | `#646c7a` | `#919aa4` | `#bec3c7` |
| plum | `#29223d` | `#493b75` | `#6e4ea0` | `#a181bf` | `#cab7d5` |
| findYellow | `#5f3b15` | `#be8e19` | `#e9d33a` | `#edd578` | `#ede2b5` |

**hats**

| ramp | ink | shade | base | light | glint |
|---|---|---|---|---|---|
| cap | `#4a2819` | `#925c24` | `#c9962e` | `#dac46c` | `#e2d7ae` |
| beanie | `#431723` | `#842229` | `#b5382b` | `#d57b60` | `#dfb9a7` |
| bush | `#362923` | `#67533e` | `#8c7a52` | `#b3a981` | `#cecab7` |

**fur**

| ramp | ink | shade | base | light | glint |
|---|---|---|---|---|---|
| red | `#481b1b` | `#8d3e2a` | `#c26a36` | `#d4a472` | `#dfcdb1` |
| redDeep | `#3a1416` | `#72291e` | `#9c4a26` | `#d08950` | `#dbbf9e` |
| redPale | `#61201c` | `#c04f28` | `#e0935a` | `#e7c08e` | `#ebddc1` |
| black | `#161212` | `#211a1a` | `#2e2624` | `#4a403b` | `#6a6058` |
| tan | `#45201c` | `#87462d` | `#b9733a` | `#d0a973` | `#ddcfb1` |
| tanPale | `#58291f` | `#ad5e2f` | `#d49a56` | `#dfc38b` | `#e6ddbf` |
| liver | `#221114` | `#421f1d` | `#5a3226` | `#a86d4a` | `#c7ad96` |
| fawn | `#512a22` | `#9e5d35` | `#c99455` | `#d7be8a` | `#e2dabe` |
| fawnDeep | `#3f221e` | `#7b4a31` | `#a87440` | `#c7a974` | `#d8ceb1` |
| fawnPale | `#6b3525` | `#cd7b3d` | `#e2bd86` | `#e9d9ac` | `#eee8d1` |
| mask | `#140e0e` | `#1f1614` | `#2c211b` | `#4b3d2f` | `#6c5e4b` |
| yellow | `#6a3521` | `#d07d32` | `#e3bd7a` | `#eadaa4` | `#eee7cd` |
| yellowDeep | `#512c22` | `#9f6236` | `#c99a58` | `#d7c28c` | `#e2dbbf` |
| jet | `#161519` | `#211f25` | `#2c2b34` | `#43434f` | `#62636d` |
| choc | `#261213` | `#49251e` | `#643b27` | `#b17949` | `#cbb497` |
| chocDeep | `#221010` | `#361a15` | `#4c2c1c` | `#6f4b2c` | `#927147` |
| chocPale | `#2f1819` | `#5b3229` | `#7c4e36` | `#b6895f` | `#cebca5` |
| springerLiver | `#291116` | `#501c1c` | `#6e3024` | `#bd6742` | `#d0ac96` |
| cream | `#7a5a4a` | `#d2b088` | `#f3dcae` | `#faecc8` | `#fff8e4` |
| white | `#6a6478` | `#b9b4c4` | `#f1ece3` | `#fbf8f0` | `#ffffff` |
| ticking | `#4a2a2a` | `#8a5a4c` | `#b79a8c` | `#d8c4b8` | `#f1ece3` |
| nose | `#0c0a0e` | `#1a1418` | `#2a2024` | `#4a3a40` | `#8a7a80` |
| noseLiver | `#1c0e0c` | `#2e1812` | `#4a2018` | `#6e3a2c` | `#a87060` |
| tongue | `#7a2a3a` | `#b84a56` | `#e87a80` | `#f8a8a4` | `#ffd0c8` |

**kit**

| ramp | ink | shade | base | light | glint |
|---|---|---|---|---|---|
| harnessHot | `#4a1924` | `#922529` | `#c8432f` | `#d9896d` | `#e1c1ae` |
| harnessWarm | `#4f2014` | `#9e501a` | `#d98a1f` | `#e5bf62` | `#e7dba9` |
| harnessCold | `#1a2353` | `#2652a4` | `#3b8bd6` | `#79bbe0` | `#b5d9e6` |
| webbing | `#12121a` | `#1e2028` | `#2c2e3a` | `#444858` | `#6a7084` |
| reflective | `#6a7488` | `#a8b2c0` | `#dfe6ea` | `#f6fafa` | `#ffffff` |
| metal | `#3a4050` | `#6a7484` | `#a2acb8` | `#d2dae0` | `#ffffff` |
| line | `#8a3d14` | `#c8641c` | `#f08a2c` | `#ffb04e` | `#ffd88a` |

**meadow**

| ramp | ink | shade | base | light | glint |
|---|---|---|---|---|---|
| sky | `#5fa8e0` | `#8cc6ee` | `#bfe2f2` | `#e6f3ea` | `#fff3b8` |
| grass | `#2f5a36` | `#4f8a3e` | `#7fb84a` | `#a4d05a` | `#d3e87c` |
| path | `#7a5236` | `#b08552` | `#d6b074` | `#ecd096` | `#f8e8bc` |
| foliage | `#1f4634` | `#2f6a3a` | `#4c9040` | `#7ab648` | `#b4d85c` |
| hedge | `#1c3c34` | `#2a5a38` | `#3f7a3a` | `#5e9a40` | `#8cba4c` |
| trunk | `#3a2620` | `#5c3d2a` | `#80583a` | `#a67c4e` | `#caa26a` |
| water | `#1f4c7a` | `#2f74b0` | `#4c9fd8` | `#8ccdee` | `#e4f6ff` |
| stone | `#4a4a5c` | `#777b8a` | `#a3a8b0` | `#c9cdcf` | `#eceee8` |
| poppy | `#6a1c22` | `#a82c26` | `#d9412b` | `#f27a5c` | `#ffb49a` |
| buttercup | `#8a6a1c` | `#c89a2a` | `#f3d34a` | `#fff0a0` | `#ffffff` |

**wood**

| ramp | ink | shade | base | light | glint |
|---|---|---|---|---|---|
| sky | `#3a2a52` | `#7a3e58` | `#c8643a` | `#f0a848` | `#ffd37a` |
| litter | `#4a2430` | `#7e4428` | `#b06e30` | `#d6953c` | `#f4c45c` |
| path | `#5e3c2c` | `#9a6c44` | `#c89a62` | `#e6c084` | `#f8dea6` |
| amber | `#5a2420` | `#9a3c1c` | `#d06c1e` | `#f09c30` | `#ffd060` |
| russet | `#4a1c22` | `#7e2a1e` | `#b04a22` | `#d8742c` | `#f4a444` |
| pine | `#14262c` | `#1f3c34` | `#2f5a3a` | `#4c7c40` | `#d89a3a` |
| trunk | `#2a1a22` | `#46292a` | `#6a4030` | `#96623a` | `#c88e4a` |
| water | `#2a2850` | `#4a4a86` | `#7a6ea8` | `#e09a6a` | `#ffe0a0` |
| stone | `#3e3040` | `#6a5a62` | `#94847e` | `#c2ae96` | `#eed8ae` |
| mushroom | `#5a1820` | `#96241e` | `#c8302a` | `#ee6a4a` | `#fff4e0` |

**town**

| ramp | ink | shade | base | light | glint |
|---|---|---|---|---|---|
| sky | `#060a1e` | `#0b1430` | `#132244` | `#1c3258` | `#eef0dc` |
| lawn | `#0e1830` | `#182a4c` | `#24406a` | `#32568a` | `#4a74a8` |
| cobble | `#1a2140` | `#3a4670` | `#5d6c98` | `#8e9cc0` | `#c4d0e8` |
| foliage | `#0c1c2c` | `#16344a` | `#235a68` | `#368088` | `#5aaaa0` |
| trunk | `#120e1e` | `#221a30` | `#382a40` | `#524058` | `#74607a` |
| plaster | `#1e1838` | `#3a2e5c` | `#5a4a7a` | `#7c6c9c` | `#a898c0` |
| brick | `#2a1630` | `#4a2a44` | `#6e4458` | `#946270` | `#bc8a90` |
| roof | `#10142a` | `#1c2240` | `#2e3760` | `#46528a` | `#6a7ab4` |
| lamp | `#7a3e1c` | `#c8742a` | `#ffd36a` | `#fff4c2` | `#ffffff` |
| water | `#0a1430` | `#16305e` | `#2a5a9a` | `#5a9ad8` | `#c8ecff` |
| stone | `#1c2038` | `#3c4464` | `#68708e` | `#98a0b8` | `#ccd2e0` |

**climb**

| ramp | ink | shade | base | light | glint |
|---|---|---|---|---|---|
| sky | `#060a24` | `#0c1440` | `#16205a` | `#24306e` | `#fff3c4` |
| track | `#4a5a90` | `#8094c4` | `#b4c4e4` | `#d6e2f4` | `#f0f6ff` |
| rock | `#1c2240` | `#38426a` | `#5a688e` | `#8492b4` | `#b8c4dc` |
| pine | `#0e2228` | `#183a3c` | `#285a50` | `#3e7c66` | `#c8f4e0` |
| trunk | `#1a1420` | `#2e2430` | `#4a3a40` | `#6a5654` | `#8e7a70` |
| ice | `#16305e` | `#2a5c9a` | `#5a9ad0` | `#a8dcf0` | `#f0fcff` |
| lantern | `#7a3e1c` | `#c8742a` | `#ffd36a` | `#fff4c2` | `#ffffff` |

**cast shadows** (`CAST`): meadow `#1c3440` at 0.30, wood `#30142c` at 0.36, town `#06081e` at 0.46, climb `#3c5496` at 0.30.

Stage to land: Hot (levels 1 to 15) is the meadow, Warm (16 to 45) the wood,
Cold is the town (46 to 75) then the climb (76 to 100). The harness is
`kit.harnessHot / harnessWarm / harnessCold` with `kit.reflective` piping and
a `kit.metal` ring. The line is `kit.line`.

### Coats: which fur goes where

| coat id | build | body | saddle or mask | points (muzzle, chest, feet) | ears | nose |
|---|---|---|---|---|---|---|
| bloodhound-red | hound | red | redDeep wash along the back | redPale | redDeep | nose |
| bloodhound-bt | hound | tan | black saddle from withers to tail root, down to mid flank | tanPale | black with tan inner edge | nose |
| bloodhound-liver | hound | tan | liver saddle, same map | tanPale | liver | noseLiver |
| malinois | malinois | fawn | fawnDeep overlay on back and shoulders; mask on muzzle to the eyes | fawnPale belly, breeches, inside legs | mask | nose |
| shepherd | shepherd | tan | black saddle, black muzzle and ear backs | tanPale legs and chest | black, tan inside | nose |
| lab-yellow | lab | yellow | yellowDeep along the back and ears | cream belly, cheeks | yellowDeep | nose |
| lab-black | lab | jet | none; the sheen is the light tones | jet | jet | nose |
| lab-chocolate | lab | choc | chocDeep back and ears | chocPale | chocDeep | noseLiver |
| beagle | beagle | tan head, shoulders, thighs | black blanket over the back | white muzzle blaze, chest, legs, belly, tail tip | tan | nose |
| springer | springer | white with ticking on the legs | springerLiver head (white blaze), ears, two body patches | white | springerLiver | noseLiver |

Eyes: a 2-pixel dark eye with one `glint` pixel top left; hounds get a `shade`
pixel under the eye for the droop. Tongue (panting, resting) is `fur.tongue`.

Handler: skin `people.skin`, hair `people.hair`, trousers, boots, the eight
jackets, three hats. Jacket detail: collar, a zip line in `shade`, a cuff, one
pocket; hi-vis gets two `kit.reflective` bands. The person at the find is
`skinFind`, `hairFind`, `jackets.findYellow` with a reflective band.

## 6. Breed shapes

Numbers are art pixels in the 48 × 34 box, standing. "Withers" is the height
of the top of the shoulder above the ground row. Shapes must be told apart in
silhouette alone, filled black.

| build | withers | body length | topline | head | muzzle | ears | tail |
|---|---|---|---|---|---|---|---|
| hound | 19 | 24 | level, deep chest to 9 above ground, slight tuck | 13 × 12, square, heavy | 7 long, 5 deep, flews hang 2 below the jaw, dewlap fold at the throat | `long`: set low at eye level, 5 × 11, hang below the jaw, swing | `saber`: 12 long, thick root, carried up in a curve |
| shepherd | 19 | 25 | falls 4 from withers to croup; hock set back 3 | 12 × 10 wedge | 6 long, tapering | `prick`: 4 × 6, upright, tipped forward | `brush`: bushy, 13 long, hangs in a curve to the hock |
| malinois | 19 | 22 | level and square; belly rises 4 (strong tuck); finer legs (3 wide) | 11 × 9 wedge | 6 long, fine | `prick`: 4 × 6, more triangular | `brush`: thinner, 11 long, level with a hook at the tip |
| lab | 18 | 23 | level; barrel chest, tuck of 2; thick neck; legs 4 wide | 12 × 11 broad, clear stop | 5 long, 5 deep, blunt | `drop`: 5 × 6 triangle lying close, to the jaw line | `otter`: 4 thick at the root tapering, 11 long, level |
| beagle | 13 | 17 | level; short legs (8) | 10 × 9 broad, domed | 4 long, square | `mid`: 4 × 7 rounded, to the jaw | `saber`: 9 long, upright, white tip of 2 |
| springer | 16 | 20 | level, slight tuck | 11 × 10, clear stop | 5 long | `feather`: 5 × 9 with a wavy fringe | `stub`: 4 long with a feather plume; wags fast |

- Legs are sprites, not lines. Foreleg: shoulder, elbow, straight forearm,
  pastern, a paw 4 × 2 with a toe pixel. Hind leg: thigh, stifle, hock bent
  back, paw. Near legs in `base`, far legs in `shade` and starting a row
  higher. Springer: a 2-pixel feather fringe behind the forelegs, under the
  belly and on the breeches.
- Loose skin on hounds: one `shade` fold at the shoulder, one at the flank,
  a wrinkle row over the eye; folds shift a pixel in the trot.
- Head poses for every build: `fwd`, `down` (nose on the ground), `up`
  (air-scenting), plus `back` (looking round at the handler) and a mouth-open
  pant. Sit and lie are per build, not one shared torso.
- Harness: a Y-front trailing harness. A chest strap from the breastbone up
  to a back plate (7 × 3) over the withers, a girth strap behind the elbows,
  1 pixel of reflective piping, the handle and the D-ring at the plate's rear.
- Keep the rig contract: `drawDog(c, P, coat, stage)`, `dogRing`, `dogNose`,
  `dogHeadTop`, `dogLineIn`, the pose fields states.js sets (`body`, `head`,
  `hdx/hdy`, `ear`, `tail`, `legs.phase`, `bob`, `jx`) and the coat ids. Add
  fields; do not rename them. `COATS[].id`, `JACKETS[].id`, `HATS[].id` are
  saved on users' teams and tested (teams.test.mjs): never change an id.

Handler (24 × 40): about 3.6 heads tall. Head 9 × 9 with hair, an eye of 2
pixels with a light, a nose pixel, an ear. Shoulders 10 wide, a waist, arms
with elbows and 2 × 2 hands, legs with knees, boots with a heel and a sole
line. Leans back 1 to 2 pixels into a taut line. Hats sit on rows 1 to 6.

## 7. Animation

The clock is 30 fps at most; a pose is held for a whole number of ticks
(33.3 ms). States stay pure functions of time (`frame(state, t)`).

| cycle | frames | per frame | notes |
|---|---|---|---|
| dog walk | 8 | 100 ms | four-beat; head nods 1 px on beats 1 and 5 |
| dog trot (trailing) | 8 | 67 ms | diagonal pairs; body rises 1 px on the two flight frames; nose stays on the ground |
| sniff on the spot | 6 | 133 ms | nose 2 px side to side, nostril pixel flickers, scent puffs every other loop |
| cast, head swing (lost) | 8 | 133 ms | head sweeps low left, up, low right; a held beat at each end |
| sit down | 4, once | 67 ms | dip 1 px first (anticipation), rump down, settle 1 px past, back |
| indicate at the find | 6 | 100 ms | sit, look at the person, look back at the handler, paw lift, hold 2 |
| shake-off | 8 | 50 ms | head leads, the twist runs to the tail a frame behind; ears fly wide; droplets on frames 3 to 6 |
| lie down | 5, once | 83 ms | front down first, then the hips roll over |
| tail wag | 6 | 67 ms (133 when waiting) | root swings 3 poses each way, the tip a frame behind |
| pant, breathe | 4 | 250 ms | chest 1 px, tongue in and out |
| handler walk | 8 | 100 ms | contact, down, pass, up for each leg; the free arm swings opposite; head bobs 1 px on the down frames |
| handler idle | 4 | 500 ms | breathing 1 px at the shoulders; a 100 ms blink about every 3.2 s; weight shifts every other loop |
| fist-pump | 7, once | 67 ms | crouch 2 px for 2 frames, fist up over 2, hold 1 with a spark, settle over 2 |
| pat, praise | 6 | 100 ms | bend, hand to the dog's shoulder, two strokes, back |

Overlap, the rule that makes it look alive: **nothing arrives at the same
time**. Ears follow the head one frame late and overshoot by a pixel when it
stops. The tail follows the rump one frame late, its tip one more. Hound
flews and dewlap follow the jaw one frame late. The hat and hair follow the
handler's head one frame late on a stop. The line's low point follows both
ends two frames late, and a jerk at the dog's end travels down it as a
one-pixel wave over three frames. Every start has a frame of anticipation
the other way; every stop has a one-pixel settle.

With motion off (the setting, or Reduce Motion on Auto) each state shows its
`STILL_AT` pose, moments show their last frame, and screen changes are soft
fades in CSS. Nothing ambient runs.

### The moments

Keep the cue names in `MOMENTS` (board.js, app.js and the tests hang on
them); times may move and cues may be added.

- **Level-up, about 5.2 s.** Tick on the stone; the paw stamp lands with a
  2-frame squash and a ring of 8 sparks; the dog's head comes up, ears late;
  the handler's fist-pump; the name pops; the path to the next stone lights
  stone by stone ahead of the trot; the team trots there with a wagging tail;
  on arrival a burst of 16 confetti pieces in the stage colour and gold,
  falling for 900 ms on the board, a 1-frame white flash of the new ring, the
  buzz; the dog sits and looks back, the handler pats. Then hold.
- **Boss, about 8.5 s.** As now (arrive, the article, the sweep, the gate
  opening with its overshoot, through it), plus: the land beyond wipes from
  locked to lit in an ordered dither moving up the board, its ambient life
  starting as the wipe passes; a banner in the next land's colours unrolls;
  gold confetti; the title lands with a 2-frame scale pop made of whole
  pixels.

### As built (pixel/moments.js, pixel/fx.js, board.js)

Cue times in ms; the names the page listens for (`name`, `title`, `buzz`)
are unchanged.

- **Level-up, 4.9 s**: tick 150, paw 650 (2-frame squash, white flash, ring
  of 8 sparks), cheer 800 (the fist-pump), name 1150 (ribbon pops in whole
  frames: 0.6, 1.16, 1.06, 0.96, 1), trot 1500 (one frame of gathering at
  1433; the trail lights ahead of the run), arrive 3000 (confetti, the new
  ring flashes, the find: person up, sit, indicate, fist), buzz 3080, hide
  4200, hold to 4900.
- **Boss, 8.8 s**: arrive 1700, toss 2700, sweep 3100 (1.3 s), gate 4400
  (sparks one step later), aside 5000, through 5300, title 7100 (gold
  confetti, twice), buzz 7180, hold to 8800.
- **Heart of the wood, 8.8 s** (`MOMENTS.heart`; the last boss; the board
  picks it, the page still calls it a boss): as a level-up to the great
  tree (trot 1700, arrive 3700), then banner 4100 (it turns gold, sparks),
  moon 4700 (the glade lights, the beam comes down, the fireflies come to
  the tree; the dog sings, the fist stays up), title 6400 (gold confetti),
  buzz 6480, hold to 8800. See section 13.
- **No sliding feet**: `SPEED` (pixel/states.js) is the ground speed each
  gait's stride implies (trail about 18 px/s, run about 39). The close-up
  scrolls at it; the board moves the team along the trail by distance and
  passes `env.stride` (way length over time, over `SPEED.run`) so the run's
  steps are cut to the ground really covered.
- **Not built**: the "Counts" footstep for a counted run that passed
  nothing (the board has no moment for it, and a test says so), and the
  boss's unrolling banner.

### After the critics (what changed, and why)

- **Dog**: the harness's handle and ring stay behind a head that has turned
  round (they were drawn across its face). Labradors are their own build:
  longer legs under a shallower chest, a blunt muzzle whose nose is its
  front-most pixel, a drop ear a tone darker than the skull, an otter tail
  carried level. The black coat is modelled by its sheen (a wider jet ramp,
  light planes on skull, muzzle and back, an amber iris). Every strap has a
  line of the harness's own ink each side and piping down the chest strap;
  the Hot harness is crimson so it parts from red fur. On the ground a tail
  tapers and turns up at its end; sat, the plate is seen from behind.
- **Night**: on the town and the climb, and by torchlight, the contour's top
  edge is the fill's glint (`contour(B, rim)`), and the torch lifts what its
  beam falls on instead of veiling it.
- **Handler**: legs a little longer and the head a little smaller; the
  fist-pump is drawn longer than the arm so the fist clears the hat; the
  hider's hair is a tone down its ramp and they stand four rows lower
  behind the bush.
- **Stones**: cut from each land's rock, 19 by 11 with three rows of side
  and a cast shadow; icons rimmed in the rock's ink; tags in each land's
  wood or slate; the next ring is two tones of gold with a broken glow, the
  ring on a stone being read is white.
- **Scale**: houses 38 to 52 wide in three roof kinds with window light on
  the ground, lamps 26 tall with a three-ring pool, cars 30 long, deer,
  tent and boulders drawn to stand beside a 48-pixel dog. Gates are
  five-bar and 18 wide. (The town wall's gatehouse and clock tower, the
  cairn, the snowman and the whole snowy climb went with the Deep Wood:
  section 13.)
- **Ambient**: grass leans in waves, butterflies with real wings, a dozen
  tumbling leaves, every lit window, smoke in columns, light in clusters on
  the water. (Per land, since the Deep Wood: section 13.)
- **Moments**: the team pulls up to one side when the find would not fit
  the board (`endShift`), confetti is outlined paper in colours each land
  is not, the lit trail is a solid line with a star at its head, signs step
  aside while a moment plays and while the team stands at a gate, and the
  board says no name of its own inside the overlay (the card says it).
- **Not done**: the "Counts" footstep, the boss's unrolling banner, a
  slack line that hangs from the ring, a bigger shake-off, a celebration
  pose for the Animations Off still, the lift of the selected stone's own
  art, a dithered change of ground between town and climb.

## 8. The lands

**Superseded on 2026-10-12 by the Deep Wood (section 13):** the four lands
below, the town at night, the snowy climb, the summit and their ambient
table are no longer in the app. What still holds from this section is the
method: big quiet shapes first, then what stands on them, then decals; the
trail's crown, ruts and verge; and the ambient layer's budget.

Each land has a far, a middle and a near: big quiet tonal shapes first
(40 to 120 pixels across), then the things standing on them, then decals.
The trail is 9 to 11 wide with a `shade` rut each side, a `light` crown, a
ragged verge of the ground's `light`, and wear round each stone. Between
lands the ground changes over 24 rows of ordered dither on both sides of the
boss's landmark, never in one row.

- **Hot, the meadow by day.** Mown and long grass in broad patches, clover,
  poppies and buttercups in drifts (not sprinkled), oaks and hawthorn with
  three canopy tones and dappled shadow, dry-stone walls, a five-bar gate, a
  pond with reeds and a stream with stepping stones, sheep, a hay bale or
  two. Cloud shadows drift across slowly. Boss: the stile in a real hedge.
- **Warm, the wood at dusk.** Leaf litter in amber and russet bands, long
  plum shadows to the right of every trunk, pines dark with a sun-struck rim
  on their left, bracken, fallen logs with moss, mushrooms in rings, low sun
  shafts between trunks as dithered amber bars, a stream that reflects the
  sky. Boss: the footbridge.
- **Cold I, the town at night.** A plan, not stamps: a cobbled street the
  trail follows and crosses, kerbs, terraces of three house types with
  different roofs, chimneys and doors, garden walls and gates, a square with
  the fountain, a churchyard, parked cars, a bus stop. Light is the subject:
  moon-blue on roofs' left slopes, warm pools under lamps (three dithered
  rings), window light spilling onto the ground below each lit window.
  Boss: the gate in the town wall.
- **Cold II, the climb.** Moonlit rock below, snow from half way: drifts
  with blue `shade` lee sides, wind-scoured rock ribs, snow-laden pines, the
  packed track with boot and paw prints behind the team, marker poles, a
  tent with a lantern, a frozen tarn, then the summit under the aurora
  (three curtains, ordered dither, `climb.aurora`), its green on the snow's
  highlights. Boss: the cairn and the flag.
- **The close-up** uses the same four palettes at 168 × 96: a sky in
  dithered bands, two parallax layers of far land (hills, treeline, roofs,
  peaks), a near ground with the land's decals, and one foreground frond or
  post at an edge for depth. Trailing scrolls the layers at 1, 2 and 4.

### Ambient life

One overlay canvas over the visible board, the viewport's size at most
(240 × about 430 art pixels), redrawn at 10 fps, only while on screen, the
page visible and motion on. No more than 24 moving things in view, each at
most 16 × 16, drawn from baked frames; no `getImageData` in the loop; the
tiles underneath are never repainted for it. Target under 1.5 ms a frame on
an iPhone XR. Motion off: nothing, the baked tile is the picture.

| land | always | sometimes |
|---|---|---|
| meadow | grass tufts sway (2 frames), pond and stream shimmer (3) | a butterfly, a cloud shadow, a sheep's head down and up, a bird crossing |
| wood | 6 to 8 falling leaves, stream shimmer | sun shafts breathe, a squirrel on a log, fireflies after level 35 |
| town | window flicker (one in five), lamp glow pulse, chimney smoke | a cat on a wall, a car's headlamps passing a cross street, fountain spray |
| climb | snowfall (two layers, slower and faster), aurora drift | spindrift off a ridge, the lantern flicker, the flag, a shooting star |

## 9. The cards and text

They are not pixel art and must not pretend to be: keep Roboto, the navy and
gold tokens (`--ink`, `--moss`, `--ember`, `--rim`, `--card`, `--paper`) and
`--px` sizing. What changes is that they share an edge and a rhythm with the
art.

- **A pixel frame, used three times only**: the team's level badge, the
  next-level card's top edge and the level-up card. A 2 CSS px stepped corner
  (four steps) and a 2 px inner line in `--rim`, drawn with `box-shadow` or a
  small baked border image from code, on the same 2 px grid as the art.
  Everything else keeps the app's soft radius.
- **Header**: a level badge at the left (a stone-shaped tile in the stage
  colour with the number, 44 px), the pair's name, the earned title in
  `--ember`, and the stage bar grown to 6 px with a tick at each boss.
- **Next-level card**: shorter. A drag handle, kicker and stage on one line,
  the level's name at 22 px, the "New:" line, the chips in one scrolling
  row. The tries and the placement note fold away by default so the board
  has at least 55% of the screen at 390 × 844. Chips: square-ish (8 px
  radius), a pixel tick baked from code for done, outline for not yet, gold
  outline for what is new at this level.
- **Buttons**: the primary one solid `--moss` (gold text in dark) with a
  2 px darker bottom edge that closes on press; 48 px tall; one primary a
  screen.
- **Land signs** become small wooden signposts in the art's own palette,
  anchored beside the trail where a land starts, not pills floating on it.
- **Stones** keep real buttons of at least 44 px (48 now) with their spoken
  labels; the selected stone gets the gold ring and a 2 px lift.
- **Level-up overlay**: the board fills the card's top two thirds with a
  dithered vignette at its edges; kicker, then the name at 28 px that swaps
  with a whole-pixel pop, the title in gold for a boss; one button. The
  backdrop is `--moss-deep` at 88%, no blur (Reduce Transparency is on on
  Rémi's phone). Confetti is drawn in the board's canvas, not DOM.
- **Type scale** on these screens: 12 kicker (caps, 0.14em), 14 small,
  16 body, 22 card title, 28 moment title; weights 500 and 800 only.
- Light and dark both; the board keeps its own daylight or night whatever
  the theme, so give it a 2 px `--border` edge and no shadow.
- Motion in CSS: 160 to 220 ms, `--ease-out`, opacity and transform only;
  under Reduce Motion or Animations Off, fades of 120 ms and no movement.

## 10. Hard rules (all three)

Art in code only (pixel strings, ramps, baked once to small canvases); no
image files, no network. iOS 15: no `Array.prototype.at`, `findLast`,
`structuredClone`, no `OffscreenCanvas`. No `console.log`, `TEMP PROBE` or
`window.__` in `public/`. At most 30 fps; loops only while visible. No
commits; do not touch `BUILD`, `build.txt` or the version in `sw.js`. A new
module goes in `sw.js` SHELL, `scripts/build-single.mjs` MODULES (after
everything it imports) and, if the app needs its names, one line in
`public/pixel-team.js`; `npm test` and `npm run build` stay green. British
spelling; comments say why.

## 11. Who owns what

`public/pixel-team.js` is the door: board.js, app.js and team-preview.html
import only from it. Behind it:

| module | what | owner |
|---|---|---|
| `pixel/core.js` | colour maths, noise, canvases, `bake`, `blit`, `stamp`, `outlined`, shapes, `shadow`, `bayer` | shared: **add** exports at the end, never change what is there |
| `pixel/ramps.js` | `RAMPS`, `TONE` (the lands' own ramps and shadows are in `pixel/lands.js`) | nobody: read only |
| `pixel/dog.js` | coats, builds, heads, ears, tail, harness, the dog's rig | characters |
| `pixel/human.js` | jackets, hats, handler rig, the person at the find | characters |
| `pixel/props.js` | bowl, rucksack, bush, heart, "?", sparks | characters |
| `pixel/rope.js` | the line | characters |
| `pixel/states.js` | `TEAM`, `ANCHOR`, `REACH`, gaits, the looping states | characters |
| `pixel/moments.js` | `MOMENTS`, `STILL_AT`, level-up and boss frames | characters |
| `pixel/team.js` | `drawTeam`, effects, `frame` | characters |
| `pixel/player.js` | `createTeam` and the close-up's composition | characters |
| `pixel/layout.js` | `boardLayout`, `trailPoint`, tiles, `gateX` (geometry) | landscapes |
| `pixel/scenery.js` | `BOARD_LANDS`, trees, houses, lamps, landmarks | landscapes |
| `pixel/scene.js` | what is placed where | landscapes |
| `pixel/ground.js` | ground, stream, sky, the trail | landscapes |
| `pixel/landmarks.js` | stile, bridge, hamlet gate, the great tree's banner, `drawBarrier` | landscapes |
| `pixel/stones.js` | stones, icons, digits, plaques, the ring | landscapes |
| `pixel/board-art.js` | `drawBoard`, the locked land, `duskify`, `crispURL` | landscapes |
| `pixel/close.js` | `CLOSE`, the close-up's sky, far land and ground | landscapes |
| `public/board.js` | the board's DOM, stones' buttons, moments' DOM | UI |
| `public/app.css` (team, `tb-`, `lu-`, `tn-` rules), `public/index.html` (`scrTeam`, `scrTeamNew`, `levelUp`), `public/team-preview.html` chrome, the team screens' painting in `public/app.js` | | UI |

Seams, so nobody waits for anybody:
- Characters set `TEAM`, `DOG_BOX`, `HUMAN_BOX`, `REACH` to section 3;
  layout.js and board.js already read them. Landscapes set `spacing` to 52
  and `CLOSE` to 168 × 96 with ground 84; player.js must take the close-up's
  size from `CLOSE` and the team's from `TEAM`, with no literals.
- UI sets the close-up and the form preview to scale 2
  (team-preview.html, app.js `createTeam(... scale: 3 ...)`).
- The ambient overlay is landscapes' art (a new `pixel/ambient.js` exporting
  `drawAmbient(ctx, layout, view, t)`), mounted by UI in board.js as one
  more `tb-layer` canvas under the team. Until both sides land, board.js
  must work without it.
- Confetti and sparks for the moments are characters' (team.js effects, on
  the team canvas or a canvas board.js already owns: `tb-sweep`).
- Tests: characters keep teams.test.mjs green, landscapes the layout checks
  in board.test.mjs, UI its DOM checks and wiring.test.mjs's id checks.

## 12. Looking at it

Scratch files, not shipped, in the session scratchpad (`$S`):

```
S=/private/tmp/claude-501/-Users-remidroux-Desktop/30110340-b26f-44f4-a711-17b6a81df253/scratchpad
python3 -m http.server 8817 --bind 127.0.0.1 -d $S/www     # in the background; www/app links to public/
$S/shot.sh NAME URL [W H]      # headless Chrome at 2x -> $S/art/NAME.png   (VT=ms, GL=1 for the real app)
$S/sheet.sh OUT w:h:x:y A B C  # the same crop from several shots, side by side (SCALE=3 to zoom, nearest)
```

- The real board for any level, at phone width, clock frozen:
  `http://127.0.0.1:8817/board.html?level=60&t=300` plus `&theme=dark`,
  `&off=<rows to scroll up>`, `&coat= &jacket= &hat=`, `&state=`,
  `&moment=levelup|boss&t=<ms>` (boss at 15, 45, 75, 100), `&w=375`.
  `&root=orig` runs the code as it was before this work, for a before shot.
- The showcase at 390 wide (it is blank in a 500 px window on its own):
  `http://127.0.0.1:8817/phone.html?w=390&h=844&u=<url-encoded app/team-preview.html?scene=close&state=find&t=1400&coat=malinois&theme=light>`.
- The real app on the team screen with a seeded team:
  `GL=1 VT=8000 $S/shot.sh x "http://127.0.0.1:8817/app.html?preset=experienced"`
  (`&go=new` for the team form, `&theme=light`). It needs `GL=1`: without
  WebGL the map throws and the app never starts.
- Always pass `t=`: an unfrozen shot differs from run to run. Read the PNG to
  see it; crop and zoom small sprites with `sheet.sh`. Run at most six
  Chromes at once (twelve hung one). Before shots: `$S/art/before-*.png`.

## 13. Deep Wood (2026-10-12)

Rémi chose it from three drafts: **difficulty is depth.** One wood, entered
from an open field and walked into until it is nearly black. The stages keep
their colours (harness, bar, chips); the lands are named in plain words.

| land | levels | stage | what it is |
|---|---|---|---|
| Open field | 1–10 | Hot | sun, grass, an open gate, a wide straight path, nothing else |
| The wood's edge | 11–15 | Hot | young trees, a brook, the first boot prints (12) |
| The forest | 16–45 | Warm | tree walls, dappled light, ferns, side paths |
| The old forest | 46–75 | Cold | giant mossy trunks, mist, roots, camp and litter; 66–75 gravel road, car park, tarmac lane, hamlet |
| The ancient wood | 76–100 | Cold | near black: snags, pale fungi, moon shafts, eyes, strays; a lane with headlamps at 88–89 |

- **Where it lives.** `pixel/lands.js` holds every land's ramps, its
  shadow, `landOfLevel`, and the curves for the trail (`trailHalf`,
  `trailRough`, `surfaceOf`). `pixel/tracks.js` is contamination. Nothing
  reads `RAMPS.wood / town / climb` or `CAST` any more: they are deleted.
- **Bosses.** 15 the field gate and stile in the hedge; 45 the footbridge
  past a fork of paths; 75 the gateway in the hamlet's wall; 100 the great
  tree in its glade (no gate: `MOMENTS.heart`, cues `banner` and `moon`).
- **Contamination is art, not noise.** Each maker has one mark and one hue
  (boot: a 4 by 7 sole and heel, tan; paw: a 7 by 6 pad under four toes,
  rust; deer: a 5 by 4 split slot, sage; horse: a 5 by 5 open shoe, plum;
  bike: one line; cart: two ruts; herd: a 4-wide trampled band; footpath:
  3 of worn earth). Prints are drawn in eight headings, left foot then
  right at an uneven stride with one in ten missing, on a scuffed line
  (trodden pale in grass): a ruled row of small marks is stitching.
  - **How much:** none before 12 (boots) and 14 (a dog); 0.5 a level rising
    to 1.3 through the forest, 1.5 to 2.3 through the old forest, 2.6 to 3.5
    in the ancient wood. "Cross-tracks" (61–65) is five whole lines from
    edge to edge that cross each other, not a crowd of short ones.
  - **The trail wins:** every tint is darker than the body of that land's
    trail; nothing at all is printed on the trail (prints, tyres and ruts
    stop at its edge and go on beyond; worn paths stop short of it); no
    track lies within 40 degrees of the trail's own line where they meet;
    and the trail is never under 7 wide (`trailHalf`).
  - **Cost:** a track is drawn once into a list of pixels and copied into
    each tile from there (`paintTracks`), never as canvas calls.
- **Dark lands** (`LANDS[x].dark`): the trail lies in a dithered paler
  corridor, plates are slate with a pale edge, the team is rimmed with
  light, and the dark theme leaves them as they are (it gives the forest
  only half the dusk the field gets, `DUSK`, so the forest stays lighter
  than the old forest behind it). Where the next stone is straight above
  the waiting team its plate goes beside the stone, not on the handler's
  head (`plates()` in board.js).
- **Depth inside the dark lands.** A thin shade over ground and trees
  deepens every few rows from 46 to 99 (`shadeAt`), and through 66–75 the
  old forest's floor goes over to the ancient wood's in growing patches.
  A locked dark land sinks to its own blue-black under grey mist, not to
  the violet dusk the forest gets (`lockPixels`, `deep`).
- **The close-up** (`pixel/close.js`) has the same five lands by the same
  names (`CLOSE_KINDS`): sky or the light between far trunks, a far rank
  (0.2), a rank on the horizon (0.45), the ground in five bands, a rank of
  trunks standing on the ground (0.76; none in the field), and a near layer
  (2). The dark woods' trunks are painted there (`bole`), not borrowed from
  the board. Tracks are drawn each frame, a row at a time at that row's
  speed, so a line of prints leans as it passes. `drawGate` is the three
  gates from the side (stile, footbridge over the stream, the hamlet's
  stone posts and lantern); `heartTree` is the finale's tree, pool and beam.
  Night is the day land's own strips gone to navy; the dark woods have none.
- **The finale** on the board: banner gold with a ring of sparks, the tiles
  repainted with the glade lit, `moonbeam` (a thread of white for two
  frames, then three bands of thin light one inside the other, only the
  outer edge dithered, opening to 46 wide on the glade between team and
  tree, with a pool at its foot) and `gather`
  (22 fireflies winding in to ring the trunk), then the title under gold.
- **Ambient, per land** (same budget as section 8):

| land | always | sometimes |
|---|---|---|
| field, edge | grass leaning in waves, water | butterflies, a cloud's shadow (field only), a leaf or two at the edge; fireflies in the dark theme |
| forest | falling leaves, water | dust in the sun shafts, fireflies from 35 |
| old forest | fireflies, mist sliding along its own wisps | the campfire, the hamlet's lanterns, windows and smoke |
| ancient wood | motes rising, moon shafts breathing | eyes that blink, a car through the lane every nine seconds |

- **The lane's car** is in the tile only when nothing moves (`traffic`);
  with Animations on the ambient layer drives it, from a sprite baked once.
- **Animations Off / Reduce Motion**: no ambient, no effects layer, moments
  shown at their last frame (the glade lit, the banner gold), the close-up
  a still with its mist and tracks in place.
- **Not done**: the "Counts" footstep (a run that counts but passes nothing
  still has no moment: it would need its own "played once" record on the
  run), the boss's unrolling banner, cottages before the gate on a 320 px
  board.

