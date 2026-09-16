# Trailcraft — a full brief, and an invitation to argue with it

**To the reader (ChatGPT):** this is a complete description of a scent-work dog-training app that exists and is in daily use by its founder, Rémi, a Highland Canine Master Trainer in Somerset, UK. It was built with Claude over several weeks. Rémi is a professional dog trainer, not a developer. He is sharing this so you can act as a **second, critical designer**: find what is weak, what is wrong, what is missing, and what should be removed. The last section is a list of direct questions. Please read the whole brief first, then answer the questions one by one — and where you need information we have not given you, ask Rémi rather than guessing. Be specific, quantify where you can, and always give the trade-off. A healthy debate is the goal, not agreement.

---

## 1. What the app is, and who it is for

Trailcraft records and grades scent-work training sessions on a phone: **mantrailing / tracking** (a dog follows a person's trail) and **detection searches** (a dog finds a hidden article, cadaver source, narcotics, explosives, firearms, or sport odour).

The unusual part is that it **models the scent**: using the weather at the time the trail was laid, the terrain, and how long the trail has aged, it estimates which side of the line the scent has drifted to and how wide the workable band is. It then grades the dog's run *against that*, not just against the line. Every claim about scent is deliberately labelled as a model, never a measurement.

**Positioning decision:** the wider *scent work* market, not mantrailing alone. Mantrailing Global lists only ~120 accredited instructors worldwide; a 2025 survey of 566 trainers found 60 % offer scent work versus ~10 % mantrailing; AKC Scent Work grew 13 % in 2025. Mantrailing is the hardest technical case and the demo; scent work is where the customers are.

**Business model (planned, not built — there are no payments yet):** handler £49/year; **instructor £39/month with 15 client seats**. The instructor tier is the business: one instructor is worth ~9.5 handlers and brings ~30 students. Two direct competitors were studied: *The Mantrailing App* (≈$8/yr, sole trader) and *DogTracks* (≈$35/yr, Swedish company). Both lose reviews to the same two failures — tracks that scribble when the handler stands still, and recordings that die mid-trail. Nobody has solved "record reliably in a wood."

---

## 2. Platform and hard constraints

- **A web app (PWA), not a native app.** Plain JavaScript, no framework, no build step. Hosted free on GitHub Pages. Installed on the iPhone Home Screen. Also produced as a single HTML file for desktop.
- **Offline-first shell.** A service worker caches every module; the app opens with no signal. Records live in the phone's localStorage. Nothing requires an account.
- **Maps:** Mapbox GL (satellite imagery + 3D terrain) when a token is present; a plain OpenStreetMap map otherwise. **Map tiles cannot be downloaded for offline use** — Mapbox permits offline only in its native mobile SDKs, and OpenStreetMap forbids it outright. Recently viewed tiles stay cached for a while; that is all.
- **Weather:** Open-Meteo, free. It gives the **10 m wind over open ground from a global model** (≈28 km grid), air temperature, humidity, dew point, gusts, precipitation, pressure, and **soil temperature at 0 cm**, in 15-minute steps. There is no trail-scale wind data at any price.
- **GPS:** the phone's own. 3–5 m under open sky, worse under trees. A web app gets **no GPS in the background** — the screen must stay on (the app takes a wake lock). External RTK receivers are the only route to near-perfect accuracy.
- **iPhone web-app limits:** no vibration API; `prompt()` dialogs are blocked; audio and speech only work after a first touch; sign-in popups never return (redirects are used instead).
- **Testing:** 182 automated tests run in Node against the very same modules the phone runs (geometry, scent model, particle sim, codec, sharing, PDF, coach, store, sync). Guard tests fail the build if a button's id disappears, if a module is missing from the offline cache, or if the build stamp drifts.

---

## 3. The people and things in the app

- **Handler** — the person running the dog (Rémi). Several handlers can live on one phone.
- **Dog** — name, photo, breed, sex, date of birth (age is computed), weight (stored in kg), microchip, **line length** (how far ahead of the handler the dog works, used to correct the GPS track), and a **usual trail level**: Hot (10 min), Warm (45 min), Cold (180 min).
- **Layer** — the person who lays the trail or sets the hide. For a person trail the handler *cannot* be the layer (you can't search for yourself), so "just me" is not offered.
- **Target** — *A person* (trail), or a hide: Article, Cadaver, Narcotics, Explosives, Firearms, Sport odour, Other.
- **Trail age** (person trails only), chosen before laying: Cold / Warm / Hot chips, colour-coded blue / orange / red, ordered cold → hot. For statistics, a run is banded by the actual age at the start: Hot < 30 min, Warm 30 min–2 h, Cold > 2 h.
- **Session** — one laid trail or set hide, with everything that happened to it: the line, weather snapshot, the dog's run, marks, the result, contamination trails, and relay data.

---

## 4. The flows, step by step

### 4.1 First launch
Sign-in offer (if the cloud is configured — currently it is not) → create a handler → add a dog → a five-card tutorial → home.

### 4.2 Home
Chips to choose handler, dog, target, trail age (person trails only) and layer. Two verbs, worded by target: **Lay a trail / Run a trail** or **Set a hide / Search**, plus **Scan a trail card** (for a trail laid on another phone). A "Recent" list of sessions. Tapping the already-selected dog chip opens the dog's record.

### 4.3 Laying a trail (one phone)
Start → the phone records GPS with high accuracy. Fixes worse than the accuracy cap (default ±25 m, adjustable 8–60) are dropped and the screen says *why* ("GPS says ±40 m — worse than the 25 m cap, so nothing is kept"). Movement under 2.5 m is not noise: **standing still is folded into "dwell seconds" on the last point**, because a stationary person is the strongest scent source on the trail, and the model emits more scent there. Weather is fetched at the first fix. While laying, the modelled plume drifts live off the line on the map. Stop → confirm → the **share card**: a satellite mini-map with the line, start/end coordinates (tap to copy), and a QR code.

### 4.4 Drawing a plan and the two-phone relay
The handler can instead **draw the trail with a finger** on the map, choose when the dog starts (Now / +5 / +10 / custom minutes), and show a QR code. The layer scans it (the QR is a link, so the iPhone Camera app works). The layer's phone then **guides them along the drawn line**: heading arrow, route ribbon (walked part dimmed), distance to the end, and an ember banner when off the line. The **ageing clock starts the moment the layer leaves the start** (a small state machine: armed within 25 m, fires beyond 40 m, fallback after 60 m walked — a GPS wobble at the start can't start the clock) and runs on both phones. The layer's phone records the *real* walked track and shows it as a second QR. After the find, the handler scans that: the drawn line is replaced by the walked one and the run is re-graded. Until then a plan-graded run is marked **provisional** and banks nothing to the dog's calibration.

**Trail Cards** (the QR contents): the trail simplified to ≤120 points (Douglas–Peucker with a stated metre tolerance), coordinates quantised to ~1 m, times to seconds, delta-encoded, deflated, base64url. The card rides in the link's `#fragment`, which browsers never send to a server — so no server ever sees where anyone trained.

### 4.5 Hides and searches
Single-phone for now (hides are not yet in the QR codec). The handler places one or more hides on the map, then searches. Grading: time to the first *Indication* mark, distance from the nearest hide at that moment, and the approach direction relative to the wind (into / across / with).

### 4.6 Running a trail
The run is **blind by default**: only the start dot shows. A *Reveal* button shows the line and the plume (and hides it again). Mark buttons: Indication, Lost it, Re-found, Article, Reward. A HUD shows dog, elapsed time and the trail's age. A glass panel top-left shows wind speed, the direction it comes from, temperature, and the forecast time. Faint white particles show the modelled air moving over the map. The map stays north-up during a run (the verdict speaks of "right of the line", which a rotating map would confuse); it is course-up only on the guided walk.

**The Coach** (new): see §6.

### 4.7 The result card
One sentence first, numbers second. The dog's track is first **corrected by the line length** (the dog is ahead of the phone). Then the **signed offset** of every track point from the nearest trail segment (+ right, − left of the direction of travel), and its mean. The model predicts a side by majority vote of its drift bearing along the trail (with a 15 % margin for "no side"). Sentence rules: mean under 3 m → "held the line"; otherwise "worked about X m to the right/left"; then "The wind pushed scent right/left"; if ≥60 % of decisive fixes sit on the predicted side → "The dog was on the scent"; if <40 % → "worked the other side — worth a second look"; wind along the trail → "the model predicts no side". The grid shows mean offset, side agreement ✓/✗, trail age at start, wind regime (crosswind / headwind / tailwind) and air stability. Fixed footer: *"The model explains what the dog did. It does not predict where scent is."*

**Calibration:** each graded run banks a drift constant k = |mean offset| / (wind speed × settle factor) when wind > 0.5 m/s and |mean| > 1 m. After five runs the dog's **median k** (clamped 0.5–6) replaces the default in the model — the model learns each dog.

### 4.8 Show on map
The only place the modelled **scent band** (a polygon) is drawn, with the live particle plume ageing in real time, the laid line, the dog's track, marks, and any contamination trails (dashed).

### 4.9 Dog record
Photo, breed, sex, age, weight, chip, line length, level; runs, total metres, cold/warm/hot counts, first trail, what the model has learned (the calibration line), and the full log of every trail.

### 4.10 Sharing (new)
- **Send a link** — the whole trail (points, marks, weather, result, dog details) travels *inside* the link's fragment; ~4.5 KB for a typical run. Opens on any phone, no app, no account; nothing stored anywhere; can't be recalled once sent. Long runs are thinned by up to 4 m to fit — never the dwell points or marks.
- **GPX 1.1** — laid trail and dog run as two tracks, start/end/hides/marks as waypoints.
- **PDF report** — written by a hand-made PDF writer (no library): satellite picture with the lines drawn over it, every detail in the reader's units, page numbers. A real file because `print()` is dead in a Home Screen app.
- **Share live** — the run published minute by minute to Firestore; anyone with the link watches the dog's track *and* the laid trail as it happens, for 24 h after the run. Needs the cloud switched on (not yet).

### 4.11 Settings
Account (Google sign-in; Apple later); handlers/dogs/layers; units (distance & wind: metric/imperial; temperature °C/°F; coordinates decimal/DMS — each option shows a live example); appearance (device/light/dark); **Coach**; help (tutorial, a GPS self-check that distinguishes "not https / permission denied / accuracy worse than the cap"); advanced (plume on/off, GPS accuracy cap, stillness cap, Mapbox token).

### 4.12 Backup & sync (built, dormant until a Firebase project exists)
The phone stays the source of truth; Firestore mirrors it. Newest-wins by timestamp; deletes are tombstones (kept 90 days); calibration merges as a union; tracks are packed into column arrays (Firestore's 1 MB document limit); works offline and catches up.

---

## 5. The scent model — the part most worth attacking

### 5.1 Stability, from soil vs air temperature
ΔT = soil (0 cm) − air (2 m):
- ΔT > 3 → *strongly convective*: scent lifts fast, breaks into pockets — expect high-head work.
- 1 < ΔT ≤ 3 → *convective*: rises, disperses, band widens quickly.
- −1 ≤ ΔT ≤ 1 → *neutral*: textbook downwind cone.
- −3 ≤ ΔT < −1 → *stable*: a lid on the air; scent stays low and holds its line.
- ΔT < −3 → *strong inversion*.
Each class sets multipliers: **mix** (band width, 0.40–1.9), **drain** (cold-air drainage strength, 0–1), **life** (how long scent stays workable, 0.34–2.6).

### 5.2 The flow field (pure function, tested)
Start from the single synoptic wind vector. If elevation data exists (a 44×44 grid sampled from Mapbox's terrain DEM around the trail — coarse, tens of metres), bend it:
1. **Deflection** — air can't drive into a hillside; it follows the contour. Gentle on purpose (k = 0.52 × min(1, slope × 1.7)); turned up, the field spins into vortices that look impressive and are less true.
2. **Drainage** — under stable air / inversion, cold dense air runs downhill regardless of the reported wind.
3. **Scent-creep** — a handler's rule the pure meteorology misses: the ground-hugging scent film slides a little downhill on *any* slope in nearly any air; strongest in stable air, mostly lifted away once the sun has the ground cooking.
4. **Shelter** — ridges accelerate the flow, hollows go slack.
Without a DEM the field is flat: "with no elevation data we know nothing the forecast didn't already tell us."

### 5.3 The workable line (geometry, used for grading)
- **Offset** of the scent from the trail: min(60 m, U × k × (1 − e^(−age/900 s))) — U is wind speed (m/s), k defaults to **2.0 m per m/s** (per-dog calibration replaces it). It **saturates** in ~15 min: the ground keeps emitting, so the plume sits in rough equilibrium beside the trail rather than blowing away.
- **Half-width** (uncertainty): min(50 m, 2 + 0.06 × √age × (1 + U/6)).
- The wind is decomposed against the direction of travel into **along** and **cross** components (crosswind / headwind / tailwind regimes), so the offset is placed across-track and along-track.
- Stability scales the drift: stable air lets scent drift further sideways before it stops mattering; convection lifts it out (clamped ×0.6–×1.6).

### 5.4 The particle simulation (what is drawn)
Continuous emission from the ground: each parcel has a *phase* through its airborne life (**52 s** at nose height), so displacement saturates at the scale dogs actually work — a puff released once and blown downwind for 80 minutes would put "scent" 4 km away, which is correct advection and wrong scent. **Only 28 % of the reported 10 m wind is assumed to reach nose height** under vegetation — "a guess until calibration corrects it". Standing spots (dwell) pool up to 700 parcels, growing with waiting time. Each parcel has its own exponential residence time, so the plume's far edge is ragged, not a straight line. Drawn as gold speckle: strong near the line, fading downwind. **Grading never uses the particles** — it uses the deterministic geometry above, so the number is reproducible.

### 5.5 Contamination
Other people's trails crossing the area can be recorded (who, when) and are drawn dashed on the reveal.

---

## 6. The Coach (train alone) — the newest feature

Watches the dog against the laid trail during a run and says, hands-free — a tone, then a voice — *"Off the trail, 25 metres to the right"*, *"Back on the trail"*, *"Still off, 40 metres to the left"*. At most one call every 10 s; "still off" after 30 s; a soft tick when drifting near the edge (once per excursion).

What it does that a plain corridor-with-a-buzzer doesn't:
1. **The corridor follows the scent.** Downwind, the corridor is the tolerance *or* the modelled scent band, whichever is wider — a dog working the plume is not off. Upwind it is the tolerance alone.
2. **The dog, not the phone, is judged**: the position is projected a line-length ahead along the handler's heading.
3. **GPS noise never sounds it**: a fix must be outside by more than its own stated accuracy, twice running (or for 6 s), unless it is out by a whole corridor.
4. **A drawn plan gets 10 m more**; past the end / before the start are said as such.

Settings: on/off (on by default), corridor 10/20/30/50 m (or 30/60/100/150 ft), follow the scent, voice, sound, vibrate (hidden on iPhone — impossible in a web app), show the distance on screen (off by default so the run stays blind). Sounds are WAV tones through an `<audio>` element because on iPhone that plays through the ring/silent switch.

---

## 7. Design language

Warm paper background, cream cards, moss green for the primary action, one ember accent for alerts and the dog's track, gold for the laid trail, Roboto throughout, "liquid-glass" chips, 56 px touch targets for gloves and rain, full dark mode (the QR plate stays white so cameras can read it). Copy is plain and specific: buttons say what happens ("Run it on this phone", "She's off — start the countdown").

---

## 8. Known limitations and honest doubts (please pile on)

- The wind is a **forecast for open ground at 10 m**, not the air at the dog's nose. Under canopy the real flow is a fraction of it and can reverse. The 0.28 nose-height factor and the 2.0 m/(m/s) drift constant are **guesses** awaiting real data.
- The terrain grid is coarse; small features (hedges, walls, a sunken lane) that dominate scent locally are invisible to it.
- GPS is 3–5 m at best; the model's claims are of the same order. A 4 m "mean offset" is close to noise.
- Calibration needs five graded runs in real wind before it changes anything, and it learns a single scalar.
- Searches (hides) are single-phone; there is no hide relay yet.
- No offline map areas (licensing). No background recording (web app). No vibration on iPhone. Sign-in and live sharing depend on a cloud project not yet created.
- The instructor tier — the actual business — does not exist yet: no client seats, no assignments, no comparing dogs across a class, no payments.
- Dropped along the way (code kept, UI removed): a replay scrubber, ground-cover layers, an engine demo mode.
- The model has **never been validated in the field**. The agreed next step was ten phone calls to instructors and one real trail laid in a crosswind to test whether it predicts the correct side.

---

## 9. Questions for you — please answer each, and argue

**A. The physics**
1. Is the saturating offset model (U × k × (1 − e^(−t/900)), capped at 60 m) defensible for a re-emitting ground source? What functional form, and what constants, would you use instead — and what would change the answer most: wind, age, stability, or vegetation?
2. The stability classes come from soil-minus-air temperature alone. What does that miss (cloud, time of day, wind shear, humidity)? Would you compute a Pasquill-style class instead, and could Open-Meteo's fields support it?
3. Scent-creep downhill "on any slope in nearly any air" is a handler's rule we hard-coded. Is there literature (or physics) that supports or refutes it? How big is it relative to a 2 m/s wind?
4. Only 28 % of the 10 m wind is assumed at nose height under vegetation. What is a better default, and should it depend on a land-cover layer (wood vs field) rather than one constant?
5. The plume width is treated as *uncertainty* and never narrowed. Is "a band" the right representation for grading, or should the dog be scored against a probability field with the terrain and dwell points weighting it?

**B. The grading**
6. The verdict is one sentence: side, magnitude, whether the dog was on the predicted side. Is "worked the other side — worth a second look" a fair message when the model itself is uncertain? How would you phrase confidence without burying the handler in numbers?
7. Mean signed offset as the headline number: is it the right statistic? What about casting behaviour, loss/re-find loops, time stopped, distance from the end when the dog "indicated"? What would a mantrailing judge actually want to see?
8. Calibration learns one scalar k per dog after five runs. Better: learn per condition (wind band, stability), per surface, or not at all? How do we avoid fitting GPS noise?
9. The age bands are Hot < 30 min, Warm 30 min–2 h, Cold > 2 h. Do these match how trainers talk, and should a trail's *difficulty* also count wind and stability, not just age?

**C. The Coach**
10. Hysteresis is "outside by more than the GPS accuracy, twice, or for six seconds; back inside → one chime". Too slow, too fast? Should tolerance scale with age and wind automatically rather than being a fixed 20 m?
11. Is a voice the right feedback for a handler with a dog on a 10 m line, or does it risk cueing the dog / the handler steering? Should the coach default to *off* for blind runs and *on* only for training the handler's own reading of the dog?
12. What should the coach say — and not say — from a dog-training standpoint? (E.g. should it ever say "left/right", or only "off/on"? Should it praise?)

**D. The two-phone relay and blind runs**
13. The ageing clock starts when the layer leaves the start. Is that the right moment, or should it be the *end* of the lay (the dog starts on the freshest scent at the start)? What do instructors count from?
14. Grading against a finger-drawn plan is marked provisional. Should it be allowed at all, or should the app refuse to grade until the walked track arrives?
15. What would make the relay simpler? (Currently: QR link → guided walk → walked-track QR back.) Is a shared code or a cloud handoff better than two QR scans?

**E. Product and business**
16. The instructor tier (£39/mo, 15 seats) is the plan. What exactly must it contain for an instructor to pay: assignments, a class view, comparing dogs, homework, video? Rank by value and by build cost.
17. Should this remain a web app (free hosting, instant updates, no app store) or go native (offline maps, background GPS, haptics, push)? At what point does the web choice start losing customers?
18. Privacy is a pillar (no server sees a trail unless you sign in). Is that a selling point handlers care about, or an engineering vanity? How would you say it in one line on the website?
19. What do The Mantrailing App and DogTracks do better than this, from what you know, and which of their features are worth copying versus deliberately not?

**F. Cutting**
20. If you had to remove three things from this app to make it clearer, what would they be and why?
21. What is the single weakest assumption in the whole brief — the one that, if wrong, makes the rest pointless — and what is the cheapest field experiment a trainer could run this week to test it?
22. Finally: rank the **top five improvements** you would make next, each with the reason, the rough effort, and what could go wrong.

Please number your answers to match. Where you disagree with a design decision, say so plainly and propose the alternative. Where you'd need field data, say what data and how to collect it with a phone and a dog.
