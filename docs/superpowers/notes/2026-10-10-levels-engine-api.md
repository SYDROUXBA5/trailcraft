# Levels engine: API and notes (from the build and fix reports, 2026-10-10)

ENGINE BUILT. `npm test` exits 0 (783 checks, 56 of them new in `test/levels.test.mjs`). 2,000 sessions: 53 ms cold, 7 ms warm.

**Files**
- New: `/Users/remidroux/Projects/trailcraft/public/levels.js` (pure; imports only `geo.js`, `store.js`, `debrief.js`, `field.js`, `ground.js`).
- New: `/Users/remidroux/Projects/trailcraft/test/levels.test.mjs`.
- Edited: `/Users/remidroux/Projects/trailcraft/package.json` (test added to the `npm test` chain after `team.test.mjs`).
- Untouched: `app.js`, `index.html`, `public/team.js`, `sw.js`, BUILD, `build.txt`. No commits.

**Exported API**
- `LADDER_V1` — frozen `{ v:1, levels[100], waves[20], stages[3], bosses[4] }`. Each level carries: `level, v, stage, wave, waveKey, waveName, rank, step, roman, name, lengthM, ageMin, turns, start, watched, coachOff, indication, blind, timeLimitMin, minDogMonths, surfaces, hardTurn, setting, crossTracks, walkAlongM, split, decoy, directions, pair ('any'|'emptySecond'|null), night, newPlace, stranger, distractors, boss, bossName, title, also[]`.
- `RULES` — frozen tunables (turn 60° / 50 m leg, 90% length, Hot slack, 30 m indication, 10 m split, 8 km/h, 70% coverage, 300 m, 25 °C, caps 3/5, 30 days, placement 2 tries / 5 lower).
- `STARTS`, `SETTINGS` (ids + labels for the two new debrief rows), `SETTING_FROM = 66`.
- `levelSpec(n, ladder?)`, `stageOf(n)`, `waveStart(n)`, `levelName(n)` → "Blind Faith III".
- `teamName(handlerName, dogName, n)` → "Rémi & Rex · Blind Faith III".
- `bossTitle(passed, ladder?, from?)` → `{level, name, title} | null`.
- `timeLimitMin(lengthM)`, `timeLimitFor(level, lengthM?)`, `whatsNew(n)` → checklist keys new at that level.
- `PRESETS`, `presetById(id)`, `teamKey(handlerId, dogId)`, `newTeam({handlerId, dogId, preset, now, look})`, `teamsOf(dog)`, `teamOf(dog, handlerId)`, `dogsInTeams(dogs, handlerId)`.
- `dayKey(t)`, `isLevelRun(session)`.
- `runFacts(session, { sessions?, dog? })` → frozen facts: `id, at, endAt, day, handlerId, dogId, layerId, person, ran, noLine, unwalked, lengthM, lengthFrom, ageMin, turns, turnList, hardTurns, surfaces, surfaceIds, crossTracks, alongM, split, outcome, found, findMs, findMin, indication, indicationM, blind, peeked, peekKind, peekMs, coach, help, start, setting, target, empty, emptyCalled, decoy, aborted, night, sunElevation, tempC, layKmh, onFoot, coverage, timesOk, startPt, levelTry, newPlace, stranger, dogMonths`.
- `judge(levelOrNumber, facts|null, { partner? })` → `{ level, verdict, why, pending, checklist:[{key,label,text,need,got,ok}] }`. `facts` null gives the blank checklist. `pending` is `'empty'|'real'` for a good half of a pair.
- `teamLevel(sessions, team, { now, ladder?, dog?, since? })` → `{ v, handlerId, dogId, level, done, passed, earned, name, rank, roman, stage, wave, waveName, boss, title, titleLevel, next:{level, spec, whatsNew, checklist, bestTryId}|null, tries[≤3 newest first: id, at, level, verdict, why, passed[], again, pairWith, hot, checklist], counted:{today,max,left}, placement:{state:'none'|'pending'|'passed'|'suggest', startLevel, triesLeft, suggest}, easeOff:{misses,suggest}|null, rusty:{since,days,suggest}|null, heat:{tempC,bossWaits}|null, gate:{level,months,needMonths}|null, best:{v,level,at}, bestChanged, events[] }`.
- Events: `{type:'levelUp', at, sessionId, from, to, done, passed[], fromName, toName, fromStage, toStage, stageChanged}` and `{type:'boss', at, sessionId, level, bossName, title, stage}`. `at` is the run's end.

**Session fields relied on, and where confirmed**
- `handlerId, dogId, layerId, targetId, startedAt, deleted` — store.js:64-72, 166; app.js:5393-5394.
- `targetById(...).kind`, `data.hides` — store.js:21-32, 298-299.
- `data.trail[{lat,lon,t}]`, `data.track[{lat,lon,t}]` (epoch ms), `data.trackStarted`, `data.trackWaypoints[{kind:'Indication',lat,lon,t}]` — app.js:5364, 5397; marks.js:17, 33-58.
- `data.revealedAt` (also stamped by the coach) — app.js:5220, 5365, 6727; debrief.js:203.
- `data.resultSeenAt` — app.js:3257-3260, 5392.
- `data.found` — app.js:5363. `data.coach.assisted` — app.js:6443-6446.
- `data.result.ageMin` via `runAgeMin` — store.js:841; app.js:5450.
- `data.plan / drawn / walked / lineLater / lineAdded` via `unwalkedPlan`, `noLineYet` — debrief.js:187, 197; store.js:246.
- `data.debrief.{outcome,target,blind,help}` — debrief.js:23-83. `data.imported.at` via `ownRun` — debrief.js:166.
- `data.contamination[{order,points}]` — app.js:4310-4313.
- `data.runWeather.temp` — app.js:1157, 1193-1195, 5385.
- `data.surf` (letter string), `data.surfSig`, `data.surfFix` via `readingFits`, `applyFixes`, `stretchMetres` — ground.js:297, 376, 390; app.js:1788-1792.
- `dog.dob` (ms) via `dogAge` — app.js:1399; store.js:1056.
- Reused: `routeCorners` (store.js:306), `bearing`/`simplify`/`densify`/`progressAlong` (geo.js), `solarPosition` (field.js:633).
- New, to be written by the UI step: `data.debrief.start`, `data.debrief.setting`, `data.leftAgoMin`, `data.levelTry = {v, level}`, `dog.teams`.

**Decisions where the spec was silent**
1. A team's name is the name of the level it stands on (L1 is "Puppy Nose I"), matching `team-preview.html`; after L100 it stays "Mission Ready V".
2. A title is only for a boss the team ran itself; a boss a preset stepped over gives none.
3. Start and setting are ordered by difficulty and a level asks for "at least". L16-70 and L76-100 need Article only; L71-74 Told directions; L75 Last point only. Two versus three directions cannot be told apart from the debrief, so it is label text only.
4. The coach stamps `revealedAt` like Show trail. In Hot, where the coach is allowed, a "shown" stamp on a coached run is not a peek; Show trail alone still is.
5. L15 ("the dog shows the find") requires the Indication mark, as from L26.
6. Found but no Indication mark, or found past the limit, is a miss. Everything about the lay, the rules and the honesty checks is "not counted".
7. Coverage (70%) is only checked on a run that claims a find, so a dog that lost the trail half-way gets a miss, not a thrown-out run.
8. The time limit uses the level's length, or the trail's own when laid longer.
9. Turns use a 50 m leg on both sides at every level; turns closer than 50 m to an end or each other do not count.
10. Unanswered debrief rows stop a run counting, with a why that says so: `start` always, `help` from L16, `blind` from L46, `setting` where asked. No debrief and not ended on Found counts as unsolved.
11. Surfaces unknown (map offline, no handler correction) is "not counted" at surface levels; a handler's surface correction counts. A surface needs 20 m.
12. L65 "walks 50 m along it" is checked: an "after" line within 15 m of the trail for 50 m.
13. Not checkable, so text in `also[]` only: person hides at the end, dog held, junctions, road crossing, other dogs at L95, distractors at L100.
14. A `target:'decoy'` run and an unwalked or untimed drawn line never count, even at L1-5.
15. L99's pair takes any order. A pair is two counted runs and passes later pair levels in its wave when the order allows. The empty half must be double-blind, coach off, help none or line.
16. Ease-off suggests the wave start, or the level before when already on the wave start. A found run at the suggested level, the rusty wave start, or a lower stamped level is a counted pass "again" that moves nothing.
17. Rusty is also cleared by passing the current level. A team with no counted run is never rusty.
18. Runs before `placedAt` are history for new place and stranger, not tries. Placement "suggest" clears once the placed level is passed.
19. `best.level` is the highest level passed (0 if none) and acts as a floor from `best.at`.
20. Because of the 90% rule, some neighbours fall together (L46+L47 always; a 405 m trail takes L46-49). That is the spec's multi-level pass, capped by the wave.
21. "Same day" is the phone's local day.

**What the UI step must know**
- When `app.js` imports `levels.js`, `test/wiring.test.mjs` will require `'levels.js'` in the `sw.js` SHELL and `'levels'` in `scripts/build-single.mjs` MODULES (after geo, ground, debrief, field, store). Not wired now; no guard fails today.
- `test/deploy.test.mjs` refuses a deploy while `public/levels.js` is uncommitted.
- Add the two sticky debrief rows using the `STARTS` / `SETTINGS` ids, saved as `debrief.start` and `debrief.setting`.
- Stamp `data.levelTry = { v: LADDER_V1.v, level }` at run start, and `data.leftAgoMin` on a Blind-trail Hot run.
- Call `teamLevel(sessions, {...team, dogId}, { now: Date.now(), dog, since })` and save `best` back to `dog.teams[]` when `bestChanged`.
- Filter `events` by `since` or by `sessionId` to play the level-up after a run.
- All words are metric English strings; `checklist[].text` is the chip wording ("300 m", "found within 28 min").
- Facts are cached per session object and refreshed by a signature, so in-place debrief edits are picked up.
## After review (fixes)

ALL 12 FIXED. `npm test` exits 0 (786 checks; `levels: 59 checks passed`), and `node --check public/levels.js` is clean. The new tests were also run against the original engine: each fix's test fails there and passes now. The level tests also pass under `TZ=Pacific/Auckland` and `TZ=America/New_York`.

Files changed: `/Users/remidroux/Projects/trailcraft/public/levels.js`, `/Users/remidroux/Projects/trailcraft/test/levels.test.mjs`. Nothing else touched, no commits, no wiring needed (no guard fails).

## Per finding

| id | status | one line |
|---|---|---|
| spec-1 | fixed | `soloVerdict`: an unsolved, not-aborted run is a miss even with Show trail or help given; the why reads "Missed: not found within 28 min, trail shown at 20:00". A find with a peek or help, aborted, coach on, help unanswered and all lay gates stay "not counted". |
| spec-2 | fixed | `easeLevel` at a wave start now gives the previous wave's start (L16→11, L26→21, L46→41, L76→71). Tested for every level 2-100: never a boss, always a wave start, never longer or older, and equal to `placement.suggest` at wave starts and for every preset. |
| spec-3 | fixed | A miss stamped above the team's current level becomes "Not counted: it was a try at L26, before the team moved down", and touches no streak, placement try or cap. A found run stamped higher still passes. |
| spec-4 | fixed | The team is named after the last level passed: `name`/`rank`/`roman` are null before the first pass. Level-up events carry `fromName` = name before (null from L1) and `toName` = name of the highest level passed; L100 reads "Mission Ready IV" → "Mission Ready V". |
| spec-5 | fixed | A pair refused by the cap says "Not counted: 2 runs already counted today and a pair is two more, the limit is 3", on both halves. The single-run wording is unchanged. |
| spec-11 | fixed | L89-90 `also` = Junctions count as turns, A road crossing, Moving traffic. |
| data-1 | fixed | `tempC` comes from `forecastAt(session, trackStarted)` when its series covers the run, else `runWeather.temp`; never the laid-time single figure. The signature now includes the weather fields, so late-landing weather is picked up. |
| data-2 | fixed | `turnsOf` measures each 50 m leg over the ground from the corner, not along the line, and merges candidates by ground distance. 20 seeded dwell knots (mid-trail, at the end, on a corner of a 3-turn trail) read 0 / 0 / 3. |
| data-3 | fixed | A no-line run's length is `reachLen(track)`: the thinned path out to the furthest point from the start. A 20 m runaway with 90 s at the person reads 15-35 m and never passes L3. |
| data-4 | fixed | `dayKey(t, offMin = 0)` is UTC-based. Each run's day uses `data.tzMin`, else its start longitude (an hour per 15°). "Today" uses `opts.tzMin`, else the newest run's offset. The TZ pin is removed from the test file; a new test asserts identical output under four zones. |
| data-5 | fixed | `layerKeyOf`: `layerId`, else `card:<name>` from `imported.from` or `lineAdded.from` ("another phone" names nobody). Exposed as `facts.layerKey` and used for stranger in `runFacts` and `teamLevel`. |
| data-7 | fixed | Show trail is a peek whenever `revealedAt` is stamped, with no comparison against the last fix. `resultSeenAt` is still compared with the end. |

## Where I departed from the suggested fix

- **spec-4:** `waveName` stays with the level being worked on (alongside `stage`, `wave`, `boss`), not the last level passed. Only `name`, `rank` and `roman` describe the earned name; this keeps `wave` and `waveName` consistent with each other.
- **data-5:** the no-layer reason reads "no layer is named on the trail, so the app cannot tell that a stranger laid it", because the suggested "laid on this phone" is false for an unnamed card.
- **data-3:** the test asserts "never L3" rather than "L1 only". Wander at the find can still push a 20 m run over L2's line (40 m less the spec's 15 m Hot slack = 25 m).
- **spec-3:** the "before the team moved down" wording also shows when the stamp is above the replayed level for another reason, such as deleted sessions. That case is rare and harmless.

## Final exported API

Unchanged: `RULES`, `STARTS`, `SETTINGS`, `SETTING_FROM`, `LADDER_V1`, `PRESETS`.

- `timeLimitMin(lengthM)`, `timeLimitFor(level, lengthM = null)`
- `levelSpec(n, ladder?)`, `stageOf(n, ladder?)`, `waveStart(n, ladder?)`, `levelName(n, ladder?)`
- `teamName(handlerName, dogName, n, ladder?)` — `n` is the last level passed (`teamLevel().passed`); `n = 0` gives "Rémi & Rex".
- `bossTitle(passed, ladder?, from = 1)`, `whatsNew(n, ladder?)`
- `presetById(id)`, `teamKey(handlerId, dogId)`, `newTeam({ handlerId, dogId, preset = 'new', now, look = null })`, `teamsOf(dog)`, `teamOf(dog, handlerId)`, `dogsInTeams(dogs, handlerId)`
- `dayKey(t, offMin = 0)` — changed: minutes ahead of UTC, no local zone.
- `isLevelRun(session)`
- `runFacts(session, { sessions?, dog? })` — facts as before, plus `tzMin` and `layerKey`.
- `judge(levelOrNumber, facts | null, { partner?, ladder? })` → `{ level, verdict, why, pending, checklist: [{ key, label, text, need, got, ok }] }`
- `teamLevel(sessions, team, { now, ladder?, dog?, since?, tzMin? })` — same shape as before; `tzMin` is new.

## What the UI step must do beyond the builder's notes

- Stamp `data.tzMin = -new Date().getTimezoneOffset()` at run start, and pass `tzMin` (same expression) to `teamLevel`.
- When the handler accepts the placement suggestion, set `placedAt = now` as `newTeam` does.
- Show `team.name` as the earned name (null for a team that has passed nothing) and `next.spec.name` as the name to be earned.
- Round `heat.tempC` and `tries[].hot` for display; they can now be fractional.
- A card's sender name is the layer for the stranger check, so a Trail Card should carry the layer's name.

## Tail of `npm test`

```
  ok  an empty split is refused before it can become a delete refspec
  ok  a split without any one of the four files is refused, and names it
  ok  a git hook pointing git at another repository never steers the checks or the test there

8 passed total
```

Exit 0. 2,000 sessions with weather series: 124 ms cold, 18 ms warm.