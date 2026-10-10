Trailcraft code facts for a team level system (read-only; no project code changed)

**1. What each run records that a level could check automatically**

Sessions are `{id, handlerId, dogId, layerId, targetId, startedAt, summary, data}` (store.js:69, 528).

- **Person trail or hide search.** `targetById(s.targetId).kind` is `'person'` or `'hide'` (store.js:21-31). A hide search is graded by `searchResult` (app.js:5598) and gives `toFirst` (time to the first Indication) and `catchM` (distance from the Indication to the nearest hide).
- **Laid trail.** `data.trail` holds the points with `t`. `layerId` names who laid it; null means the handler laid it.
- **Trail length.** `pathLenOf(data.trail)` (store.js), `pathLen` (geo.js).
- **Age at the start.** `result.ageMin = (trackStarted - s.startedAt)/60000` (app.js:5450). Read it through `runAgeMin(s)` (store.js:841), which returns null for an unwalked plan or drawn card (`unwalkedPlan`, debrief.js:187). Bands come from `ageBand` / `AGE_BANDS`: hot under 30 min, warm under 120 min, cold beyond (store.js:822). `countAge` (store.js:916) sorts age-less runs into `noLine`, `unwalked`, `drawnCards`, `untimedLines` and `unknownAge`. A level system should treat all of these as "does not count".
- **Turns.** There is no turn count. `routeCorners(s)` (store.js:306) returns simplified corners with a turns flag, at most 40 (`ROUTE_MAX_CORNERS`), using tolerances of 5, 8 and 12 m. A turn count could be derived from it with `bearing()`, but that needs new code.
- **Surfaces.** `fillSurfaces` (app.js:1799) writes `data.surf` (letters), `data.surfM` (metres per surface), `surfA` and `surfAt` from `surfaceAlong`. It only works online and with a map key, so the data can be missing.
- **Contamination.** `data.contamination = [{who, order:'before'|'after', laidAt, points}]` (app.js:4313). The count, and whether it was laid after the trail, are both checkable.
- **Weather.** `data.weather` (laid time) and `data.runWeather` cover temp, humidity, dew point, wind speed/direction/gusts, soil temperature, rain and pressure (app.js:1151). The result also stores `wind`, `windExact`, `stability` and `regimeKey`. `data.windFelt` comes from `feltOf` and `windTrusted` (field.js:256, 316).
- **Night or day.** Not stored. It can be computed from `trackStarted` plus `track[0]` with `solarPosition(date, lat, lon)` (field.js:633): elevation of 0 or below means night.
- **Found and timing.** `data.found` (app.js:5363). The run debrief `outcome` is found / missed / false / blank / aborted (debrief.js:30). Time to find is `track[last].t - trackStarted`; trail runs have no dedicated field for it.
- **Marks after the run.** `data.trackWaypoints` kinds are Indication, Lost it, Re-found, Article and Reward (marks.js:17). Counting Lost it / Re-found gives a "recovered a loss" requirement.
- **Grade.** `data.result` holds `mean`, `medAbs`, `shares`, `side`, `agree`, `sideAgreement`, `ageMin` and `mv` (app.js:5579).
- **Blind status.** `ranBlind(data)` is true when `!coach.assisted && !trailShown && !handlerKnew` (debrief.js:219). Its inputs are `trailShown` (`revealedAt > 0`, line 203), Show trail, and `debrief.blind` = open / handler / double. `resultSeenAt` is stamped when the answer is seen (app.js:3259).
- **Debrief extras.** `help` is none / line / verbal / led and `response` is clear / late / interest / prompted. `target` is real / control / decoy, so blanks and decoys are already checkable.
- **Coach.** `data.coach = {assisted, tolM, scent, calls, shadow}` (app.js:6443).
- **Blind trail and plans.** `data.lineLater`, `noLineYet` (debrief.js:197), `data.plan`, `data.drawn`, `data.walked`.

**2. What a level would need that is not recorded today**

- **Start type.** Whether the dog watched the runaway, was removed while the person left, or got only a scent article. Ask at run start (scrRun) as one chip row, or in the debrief.
- **Scent article.** Only exists as the hide target `'article'` or as an `Article` mark. There is no "started from article" flag.
- **Intended difficulty.** The Home "Trail age" chip (`S.level`, `kv.lastLevel`) is never saved on the session; it only drives the chip (app.js:1538).
- **Hidden turns** (turns out of the handler's sight). Can be partly approximated with `ranBlind` plus a corner count. True sight-line data needs a lay-screen toggle.
- **Turn count, night, and time to find on a trail.** These can be derived and need no prompt.

The least intrusive place to ask is the debrief (scrDebrief), which already has sticky one-tap fields (`stickyDebrief`, debrief.js:229). A `sticky: true` field there adds no taps on repeat runs.

**3. Handler/dog model and how a "team" fits**

- **Model.** `handlers [{id,name,photo}]` and `dogs [{id,handlerId,name,photo,level,lineM}]`. A dog has exactly one `handlerId` (store.js:69, app.js:1396), so a dog cannot be run by several handlers today.
- **"Team" already exists as a word.** `snapshot()` calls the selected handler's dogs `team` (store.js:600). `dogsOf(dogs, handlerId)` is at store.js:380.
- **Attribution.** At run save, `handlerId: S.handler.id` and `dogId: S.dog.id` are written from the Home chips (app.js:5373, 5394). Every run session is therefore already a (handlerId, dogId) pair, and the pair could be the team key with no new table.
- **Level fields that exist.** `dog.level` is the Hot/Warm/Cold onboarding default (app.js:1315). `LEVELS` (store.js:813) is the age target for the day.
- **public/team.js is dead code.** No file in `public/` imports it; only `test/team.test.mjs` does. Its `dogStats`, `handlerStats` and `LEVELS` are older duplicates of the store.js versions, and its `CLASS_BOUNDS` (30 min / 3 h) disagree with `AGE_BANDS` (30 min / 2 h). `klass` and `klassManual` survive only in migrateV1 (store.js:784).

**4. Sync and storage**

- **Local storage.** Keys are `tc.handlers`, `tc.dogs`, `tc.layers`, `tc.sessions2` and `tc.kv` (store.js:75).
- **Cloud sync.** `TABLES = ['handlers','dogs','layers','sessions']` plus `calibration` (sync.js:20).
- **Rules.** firestore.rules:16 whitelists `table in ['handlers','dogs','layers','sessions','calibration']`. Field contents under `/users/{uid}` are not validated, so new fields on dogs or sessions need no rules change.
- **A new `teams` table** would need changes in five places: the rules whitelist, sync.js `TABLES`, the store.js `K` keys, `BACKUP_TABLES` (backup.js:21), and account deletion (sync.js:393).
- **Live share.** Payloads are strictly `hasOnly`-validated (rules:72-100). Showing a level on a live share would need a rules change.

**5. Where the UI could live**

- **Home (index.html:224).** The Handler chips (`rowHandlers`) then Dog chips (`rowDogs`) already select a pair. A team chip row, or a level badge on the dog chip, fits here. A second tap already opens a card (`dogOpensHint`).
- **Dog card `scrDog` (index.html:566).** It already has "Trail age at the start" (`dogBands`). A team board slots in naturally above "Every trail". `scrHandler` (602) lists the handler's dogs as `hDogs`, a natural entry point for the team list.
- **Tokens (app.css:7-39).** `--paper`, `--card`, `--ink`, `--moss` (navy #14284B), `--ember` (gold #B8861B), `--rim`, `--muted` and `--r: 20px`, with dark overrides at :1160 and :1173. Font is Roboto (`--display`/`--body`), easing is `--ease-out`, and the scale unit is `--px`. Level colours already exist: `.lvl-hot` #BE3F2E, `.lvl-warm` #D0821F, `.lvl-cold` #3B8BD6 (app.css:1016-1041). Reusable components are `.grid2` and `.card`.
- **Motion.** Existing `prefers-reduced-motion` blocks (app.css:492, 576, 688, 721, 823, 991) turn animation off. There is no `?motion=on` override in this app, so on Rémi's Mac (Reduce Motion on) any guarded pixel-dog animation would be invisible unless one is added.