# Team levels: design

Status: approved by Rémi on 2026-10-09. Source of truth for the level ladder (LADDER v1).

## What it is

A game layer on top of the training record. A **team** is one handler with one dog. Each team climbs 100 levels of person-trail work in three stages: **Hot (1–15)**, **Warm (16–45)** and **Cold (46–100)**. The team has a board, shaped like a trail, that shows where it stands, what the next level asks for and why its recent runs did or didn't count. A pixel handler, dog, harness and line animate it.

## Decisions (Rémi, 2026-10-09)

1. **Blind work only in Cold.** The handler stops knowing the route at L46, and nobody knows it from L51.
2. **One good run passes a level.**
3. **The app decides everything.** No instructor sign-off. Every level passed gives the team a new name.
4. **A dog can be in more than one team** (trainer during board-and-train, then the owner), each with its own level.

## The team

- A team is a handler + dog pair. Sessions already record `handlerId` and `dogId`, so a team's history is already there.
- **Presets** set the starting level:

  | Preset | Starts at |
  |---|---|
  | New dog | L1 |
  | Loves runaways | L6 |
  | Article starter | L11 |
  | Trails out of sight | L16 |
  | Passed MTG 1 | L26 |
  | Passed MTG 2 | L41 |
  | Experienced | L46 |

- **Placement check:** a team placed above L1 must pass at its placed level within its first 2 counted tries. Otherwise the board suggests starting 5 levels lower. It is a suggestion; nothing is lost.
- **Look:** the dog's coat (by breed), the handler's jacket and the harness colour, chosen when the team is made.

## The ladder (LADDER v1)

**How it gets harder.** It climbs in waves of 5 levels. Each wave turns up one thing, and the first level of a wave eases the others back. Every level is harder than the one before, and none is a cliff. Levels 15, 45, 75 and 100 are **bosses** that close a stage.

**Rules that stay on once they start:**
- the dog watches the person leave: L1–15 only
- coach off, with no help beyond the line: from L16
- a clear indication at the find: from L26
- handler-blind: from L46
- nobody knows the route: from L51

**Time limit from L16:** 20 min + 1 min per 40 m of trail, at most 60 min. Hot has no limit.

**Dog's age, if a birth date is entered:** Cold from 15 months, L61+ from 18 months, L91+ from 24 months.

In the table, values separated by "/" are the wave's five levels in order. "h" is hours.

| Lv | Wave | Length m | Age | Turns | Also |
|---|---|---|---|---|---|
| **HOT** | *the dog watches the person leave · open* | | | | |
| 1–5 | Runaway | 20/40/60/90/120 | 0 | 0 | Person hides at the end from L3 |
| 6–10 | Delayed release | 60/90/120/150/200 | 1/2/3/4/5 min | 0 | Dog watches, then is held |
| 11–15 | Article start | 120/160/200/250/300 | 5/5/8/10/10 min | 0 | Watched + scent article. **L15 BOSS "First Trail"**: the dog shows the find |
| **WARM** | *the dog is taken away · article start* | | | | |
| 16–20 | Out of sight | 150/200/250/300/300 | 10/15/20/25/30 min | 0 | |
| 21–25 | Turns | 250/300/300/350/350 | 30 min | 1/1/2/2/3 | Legs ≥ 50 m |
| 26–30 | Indication | 300/350/350/400/450 | 30 min | 2 | |
| 31–35 | Age | 400 | 45/60/75/90/105 min | 2 | |
| 36–40 | Surfaces | 400/450/500/550/600 | 45/45/60/60/60 min | 2/2/3/3/3 | A second surface |
| 41–45 | Split + decoy | 400/500/600/600/600 | 60/60/60/90/105 min | 2/2/3/3/3 | A decoy walks along, then peels off. **L45 BOSS "The Fork"** |
| **COLD** | *trail 2 h or more* | | | | |
| 46–50 | Handler blind | 400/400/450/450/500 | 2 h | 3 | |
| 51–55 | Nobody knows | 400/450/500/550/600 | 2 h | 3 | |
| 56–60 | Age | 500 | 2.5/3/4/6/8 h | 3 | |
| 61–65 | Cross-tracks | 500/500/550/600/600 | 3 h | 3 | 1/1/2/2/2 crossings laid after the trail. At L65 someone also walks 50 m along it |
| 66–70 | Ground | 500/550/600/650/700 | 3 h | 3/3/4/4/4 | 2/2/3/3/3 surfaces. A turn on hard ground from L68. L70 is semi-urban |
| 71–75 | Find the direction | 500/550/600/700/800 | 3/3/3.5/4/4 h | 3/3/3/4/4 | Told 2 options (71–72), 3 options (73–74), last known point only (75). **L75 BOSS "The Town"**: semi-urban, last known point, 2 cross-tracks |
| 76–80 | Empty trails | 600 | 3/3/3.5/4/4 h | 3/3/3/4/4 | See the empty-trail rule below |
| 81–85 | Distance | 800/1000/1200/1400/1600 | 4 h | 5/5/6/6/7 | |
| 86–90 | Town + traffic | 800/800/900/900/1000 | 4 h | 4/5/5/6/6 | Junctions count as turns. A road crossing from L86, moving traffic from L89 |
| 91–95 | Very old | 800/800/1000/1000/1000 | 12/18/24/36/48 h | 5 | Other dogs cross the trail at L95 |
| 96–100 | Operational | 1000/1200/1000/1200/1600 | 24 h+ | 6/8/6/8/10 | A new place (96), a stranger lays the trail (97), night (98), "was the person ever here?" (99). **L100 BOSS "Mission Ready"**: new place, stranger, distractors |

**Empty-trail rule (L76–80, L99).** One trail can't show the dog can say "nobody here". For these levels the good "run" is a pair laid on the same day without telling the handler which is which: one empty trail called correctly and one real trail found.
- L76–77: any order.
- L78–80: the empty one comes second.

## Passing a level

**A run counts towards a level when all of these hold:**
- It is a person trail, run by this team's handler with this team's dog.
- **No peeking:** Show trail was not used, and the answer (the result screen, or a replay with the trail) was not seen before Found or Done. Fields: `revealedAt`, `resultSeenAt`.
- From L16: the coach was off, and the debrief's `help` is none or line only.
- **It meets the level:**
  - at least 90% of the length (Hot: within max(10%, 15 m), because short trails sit inside GPS noise);
  - at least the age, turns, cross-tracks and surfaces;
  - the right start type and setting.
- The dog found the person within the time limit. From L26 there is also an Indication mark within 30 m of the trail's end.
- **Quiet honesty checks:**
  - the trail was laid on foot: average under 8 km/h (not checked in Hot);
  - the dog's track covers at least 70% of the trail;
  - the times run in order.

**One good run passes.** A run passes the team's current level, plus every later level in the same wave that it also meets. It never skips into the next wave, because each wave introduces a skill that must be shown on its own.

**Not counted vs. missed.**
- A run that doesn't meet the level (laid too short, too fresh) is "not counted", never a miss.
- A run that meets the level and isn't solved is a miss.
- A run stopped for the dog's sake (`aborted`) is never a miss.

**Welfare:**
- A level is never taken away.
- After 2 misses in a row, the board says "Ease off" and suggests a run from the start of the wave, so the day ends on a find.
- At most 3 counted runs a day (5 in Hot).
- Above 25 °C (from `runWeather`) the board warns, and boss levels wait for a cooler run.
- After 30 days without a counted run the team is **Rusty**. One pass at the start of its wave clears it.

## Names

Every wave has a rank, and its five levels count I–V, so each level passed gives a new name, e.g. *"Rémi & Rex · Blind Faith III"*. Passing a boss gives a title shown on the team card and on its certificate. Names live in the ladder table so Rémi can edit them.

| Stage | Waves (in order) | Boss title |
|---|---|---|
| Hot | Puppy Nose · Line Puller · Scent Reader | **Trail Hound** (L15) |
| Warm | Seeker · Turn Finder · True Indicator · Patient Nose · Ground Reader · Decoy Breaker | **Warm Trailer** (L45) |
| Cold, to L75 | Blind Faith · Double Blind · Cold Nose · Through the Crowd · Tarmac Hound · Direction Finder | **Town Hound** (L75) |
| Cold, to L100 | Honest Nose · Long Hauler · Street Trailer · Ghost Trailer · Mission Ready | **Master Trailer** (L100) |

Each boss also gives a free certificate (PDF, Elite Canine branded), made by the app.

## What the app checks, and what it asks

**Checked from what is already recorded:**
- length, trail age, time to find, found, peeks, coach, help;
- the blind setting (`open` / `handler` / `double`);
- empty trails (`target:'control'` + `outcome:'blank'`) and decoys;
- contamination lines, marks, surfaces (when the map was online), heat.

**Worked out by new code, without asking:**
- **turns:** changes over 60° with a minimum leg length, from `routeCorners` + `bearing`; to be tuned on real tracks;
- **night:** the sun's elevation ≤ 0 at the start;
- **new place:** no earlier start by this team within 300 m;
- **stranger:** a layer this team has never run;
- **split:** a "before" contamination line starting within 10 m of the trail;
- **cross-tracks:** "after" contamination lines.

**Asked, as two sticky tap rows in the debrief** (they remember the last answer):
- **Start:** Watched · Watched + article · Article only · Told directions · Last point only
- **Setting** (shown from L66): Rural · Semi-urban · Town · Town + traffic

Plus an optional **birth date** on the dog.

**Hot runs without a laid line** (a runaway nobody recorded) are run as a Blind trail. The length comes from the dog's track, and the age from an optional "person left _ min ago" set at the start.

## The board

- **The trail board.** A game map scrolled upwards, one winding trail climbing three landscapes: a sunny red meadow (Hot), amber woodland at dusk (Warm), and a blue town at night then a snowy summit (Cold).
- **Stones and landmarks.** Levels are stepping stones, each with an icon for its hard part (ruler, clock, bent arrow, crossed-out eye, crossed paths, cobbles, moon, compass). Bosses are landmarks: a stile (15), a footbridge (45), the town (75), the summit cairn (100). Passed stones carry a gold paw, and stones ahead are dimmed.
- **The team on the board.** The pixel team stands on its stone. Footprints lead to the next stone.
- **The card pinned at the bottom** shows:
  - the next level and its name, with what's new in gold;
  - a checklist (✓ 300 m ✓ 30 min ○ 2 turns ○ found within 28 min);
  - the last 3 tries, with why each did or didn't count;
  - a **Plan this level** button (later phase).
- **Accessibility.** Stones are real buttons, at least 44 px, readable by a screen reader.

## The pixel team

- **Drawn by the app, with no image files.** Sprites are pixel strings with palettes, scaled up crisp (`image-rendering: pixelated`) and recoloured for the team's look.
- **The cast:**
  - the handler, with jacket and hat choices;
  - the dog in a harness in the stage colour, with coats for bloodhound (three colours), Malinois, shepherd, Lab (three colours), beagle and springer;
  - the line, drawn live as a rope: taut when the dog pulls, sagging when it comes back.
- **States:**
  - Waiting: sniffing, tail wag.
  - Trailing: nose down, line taut, scent dots.
  - Lost it: head up and swinging, handler stops, line slack.
  - Find: the person pops up with a toy, the dog indicates, the handler fist-pumps.
  - Missed: the dog shakes off and gets a pat.
  - Resting: by a water bowl.
  - Night: a head torch.
- **After every counted run** the team trots one step forward on the board.
- **Level up (about 4 s, tap to skip):**
  1. The checklist ticks gold.
  2. The stone gets its paw.
  3. The new name flips in.
  4. The team trots to the next stone.
  5. The dog indicates on the person, and the phone buzzes.
- **Boss (about 8 s):** the landscape sweeps into the next stage's colours, the gate opens, the title card appears, and a share picture and the certificate are offered.
- **Motion setting.** A new **Animations: Auto / On / Off** setting, plus `?motion=on`, because Rémi's own devices have Reduce Motion on. With motion reduced: still poses and soft fades.
- **Performance.** One small canvas (about 343 × 200) for the sprites, 30 fps at most, running only while the board is visible. About 25 KB of code.

## Build notes

- **Data.** Teams are stored on the dog: `dog.teams = [{id, handlerId, preset, startLevel, placedAt, look:{coat, jacket, harness}, best:{v, level, at}}]`. No new table. Firestore doesn't validate fields under `/users/{uid}`, so firestore.rules needs no change.
- **The level is derived, never typed in.**
  - A pure `teamLevel(sessions, team, LADDER_V1)` lives in a new `public/levels.js`, recomputed on save and debrief edit, and cached per team.
  - `best` is a high-water mark, so a later ladder version can never lower a level that was earned.
  - The ladder table is frozen and versioned.
  - Don't name it `LEVELS`: store.js already exports one.
- **Each try is stamped.** `data.levelTry = {v:1, level}` is saved at the run start, so a properly laid, unsolved trail is a miss at that level.
- **Teams list.** `dogsOf()` and the Home dog row also list dogs whose `teams` include the handler.
- **Retire the old code.** `public/team.js` and `test/team.test.mjs` go (nothing imports them). Keep `AGE_BANDS` at 30 min / 2 h: the ladder fits it.
- **Haptics.** `@capacitor/haptics` in the iOS app.
- **Live share** carries no level in v1, because its payload is key-whitelisted in the rules.

## Phases

1. **Sample:** the pixel team and a slice of the board as a standalone page (`public/team-preview.html`), for Rémi to react to before anything else.
2. **Engine:** `levels.js` with the ladder, the counting rules and names, with tests.
3. **Teams:** making and picking teams, presets, the look, the new debrief rows, the birth date.
4. **Board:** the trail board, the card and checklist, level-up and boss moments, the motion setting.
5. **Later:** Plan this level, certificates, a school view of all client teams, watch tie-ins, a ladder for hide searches.

## Out of scope for v1

Instructor sign-off, a hide-search ladder, leaderboards, and levels shown to live-share viewers.
