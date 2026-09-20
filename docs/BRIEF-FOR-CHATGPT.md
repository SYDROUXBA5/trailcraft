# Trailcraft — full brief, third edition (19 September 2026, evening)

**To the reader (ChatGPT):** this is a complete, current description of a scent-work dog-training app that exists and is in use by its founder, Rémi, a Highland Canine Master Trainer in Somerset, UK. It is built with Claude. Rémi is a professional dog trainer, not a developer.

You reviewed the first edition of this brief on 16–17 September and we debated it over two rounds. Section 0 says what we did with your advice and everything built since — including, today, the ground under the trail and a change to how scent is drawn over hard surfaces, which you have not seen. The rest of the document is the app **as it stands today**, written so that it can be read cold. The last section is a new list of questions. Please read everything first, then answer the questions one by one. Where you need information we have not given, ask Rémi rather than guessing. Be specific, quantify where you can, and always give the trade-off. We want an argument, not agreement.

---

## 0. What changed since you last saw it

**Your advice that is now built**

1. **Honest results.** The result card no longer says "the dog was on the scent". It now has two layers, in this order: what was **recorded**, then what is **modelled**. Details in §4.9.
2. **Coach off by default.** A run is blind unless the handler chooses "Assisted". Assisted runs are flagged on the record for ever, so a coached run can never pass as a blind one.
3. **Silent model log.** On *every* trail run, two silent coaches run in the background — one with a plain corridor, one with the scent-widened corridor — and their calls are saved. Nobody hears them. The point is to find out later, from real runs, whether the scent corridor is any better than a plain one.
4. **Calibration frozen.** The per-dog drift figure is still collected and shown on the dog's card as "observed track patterns", but it is **no longer fed back into the model**. A model tuned on the track it is asked to explain would only learn to agree with it.
5. **Save safety, phase 1.** A full phone used to lose a run silently at Stop. Now a failed save is caught, the record stays in memory, and a banner that does not go away offers: try again, send as a link, save as GPX. Settings shows how much room the records use.

**Your advice that is agreed but not built yet**

- Save safety phase 2: move sessions from localStorage to IndexedDB, with migration and export/restore.
- Bring back the replay, and add a structured debrief (outcome · assistance · observation · next exercise).
- Stability from cloud and sun (Pasquill-style) alongside soil-minus-air; use the 15-minute weather series over the trail's whole life rather than one snapshot; make scent-creep an experimental toggle.
- Commercial plumbing: move hosting off GitHub Pages before charging anyone, pay for Open-Meteo once the app is commercial.

**New since then (none of this was in the first brief)**

- **A native iPhone app.** The same code now also runs inside a native shell (Capacitor) with **background GPS** and **haptics**, installed on Rémi's iPhone. Details in §2.
- **The map screens were redesigned:** weather box top-left, message pill centred, compass top-right, map-style and find-me buttons bottom-right. Dark "liquid glass" controls over the map.
- **Three map styles:** satellite, terrain, streets.
- **The trail is drawn as footprints** that light up one after another along the trail, so it reads as *walked, and in this direction*. The handler can choose a plain line or stripes instead. The dog's track can be a line, stripes, or paw prints. Colours of the plume, the footprints, the dog's track and the wind are all adjustable.
- **The ground under the trail.** The app now reads what the trail crosses — woods, scrub, grass, crop, hard surface, water — and reports the metres on each. Details in §4.6.
- **Scent is drawn half as wide over hard surface.** Rémi's decision as a trainer, against Claude's advice to record first and leave the model alone. It is the newest assumption in the app and the least tested. Details in §5.6.
- **Wind wisps:** the forecast wind is drawn as soft moving streaks with fading tails on every map screen.
- **Flow arrows:** the model's streamlines off the trail are now brushed, tapered arrows with a light that runs along them at a pace set by the wind.
- **A compass that works on its own.** In the iPhone app the heading now comes from the phone's compass chip through a small native plugin — the first native code written for this app. The dial is in the style of the phone's own compass, with the heading in degrees in the middle and a marker for where the wind is carrying the air.
- **A first-time tutorial for the 3D map gestures** (move, zoom, tilt, turn), replayable from Settings.
- **A "lay-only" profile:** someone who only lays trails for other people's dogs enters a name and nothing else.
- **A handler card:** trails run, a ring of cold / warm / hot, total metres, hours, dogs, and the full log.
- **Detection odours:** Narcotics and Explosives now ask *which* odour; "Other" is typed.
- **Plan drawing in two steps:** the first tap is a green "Start", the corners after it are numbered 1, 2, 3, and only after "Save plan" does the app ask when the dog starts.
- A new **white / navy / gold** look, back arrows everywhere, a refined Coach page, optional fields on the dog form with a metric/imperial switch.
- The home screen's chips were stripped to their titles.
- Tests went from 182 to **208**.

---

## 1. What the app is, and who it is for

Trailcraft records and reviews scent-work training sessions on a phone: **mantrailing / tracking** (a dog follows a person's trail) and **detection searches** (a dog finds a hidden article, cadaver source, narcotics, explosives, firearms, or a sport odour).

The unusual part is that it **models the scent**. Using the weather when the trail was laid, the terrain, and how long the trail has aged, it estimates which side of the line the scent has drifted to and how wide the workable band is. It then sets the dog's run beside that estimate. Every claim about scent is labelled as a model, never a measurement.

**Positioning:** the wider *scent work* market, not mantrailing alone. Mantrailing Global lists only about 120 accredited instructors worldwide; a 2025 survey of 566 trainers found 60 % offer scent work against about 10 % mantrailing; AKC Scent Work grew 13 % in 2025. Mantrailing is the hardest technical case and the demo. Scent work is where the customers are.

**Business model (planned — there are still no payments):** after our last debate the working numbers are handler **£29.99 a year**, instructor pilot **£19 a month rising to £39 a month** with client seats, and **five paying instructors before any advertising**. The instructor tier is the business. Two competitors were studied: *The Mantrailing App* (about $8 a year, sole trader) and *DogTracks* (about $35 a year, Swedish company). Both lose reviews to the same two failures: tracks that scribble when the handler stands still, and recordings that die mid-trail.

---

## 2. Platform and hard constraints

- **One codebase, three shapes.** Plain JavaScript, no framework, no build step.
  1. A **web app (PWA)** on GitHub Pages, installable on any phone's home screen.
  2. A **native iPhone app**: the same files inside a Capacitor shell, with **background location** (the recording carries on with the screen off or the phone in a pocket), **haptics**, and the app's own small **heading plugin** (the phone's compass through Core Location: true north, no permission prompt). It is installed on Rémi's iPhone from his Mac as a development build. The free signing it uses expires every 7 days; he is joining the Apple Developer Programme so testers can get it through TestFlight. It has **not yet been proven in a wood** — that field test is still to come.
  3. A **single HTML file** for the desktop.
- **Offline-first.** A service worker caches every module; the app opens with no signal. When a new version arrives, an idle phone reloads itself (a second phone stuck on an old cached version caused real confusion in the field).
- **Storage:** the phone's localStorage — roughly 5 MB in a browser. Nothing needs an account. Moving to IndexedDB is agreed and not done.
- **Maps:** Mapbox GL with satellite imagery and 3D terrain, plus terrain and street styles. The app also reads Mapbox's vector map tiles directly, with a decoder written by hand, to learn what the ground is (§4.6) — a few small tiles per trail, held in memory only. **Map tiles still cannot be saved for offline use** — Mapbox allows that only in its native map SDKs, which this app does not use even inside the native shell.
- **Weather:** Open-Meteo. Wind at 10 m over open ground, air temperature, humidity, dew point, gusts, rain, pressure and **soil temperature at 0 cm**, in 15-minute steps. For the UK it uses the Met Office's ~2 km model, not the coarse global one we first assumed. The free tier is for **non-commercial use only**; a paid plan (about €29 a month) is needed once the app charges.
- **GPS:** the phone's own, 3–5 m under open sky, worse under trees. In a browser there is no GPS in the background, so the screen must stay on. In the native app there is.
- **Hosting:** GitHub Pages must not host a paid service. The plan is Cloudflare Pages before the first payment.
- **Testing:** 208 automated tests in 15 suites run in Node against the very modules the phone runs (geometry, scent model, particle simulation, QR codec, sharing, PDF, coach, storage, sync, colours, the map-tile reader and the ground rules). Guard tests fail the build if a button's id disappears, if a module is missing from the offline cache, if the build stamp drifts, if any script fails to parse, or if a debugging hook is left in.

---

## 3. The people and things in the app

- **Handler** — the person running the dog. Several handlers can live on one phone. Each now has a **handler card**: trails run, trails laid, total metres, hours on the line, longest trail, first and last dates, a ring showing cold / warm / hot, blind against assisted runs, the typical distance from the line, their dogs, and the full log of trails.
- **Dog** — name, photo, breed, sex, date of birth (optional), weight (optional), **line length** (how far ahead of the handler the dog works, used to correct the GPS track), and a usual trail level: Hot (10 min), Warm (45 min), Cold (180 min). A metric / imperial switch sits at the top of the form. The microchip field was removed.
- **Layer** — the person who lays the trail or sets the hide. For a person trail the handler *cannot* be the layer, so "just me" is not offered.
- **Lay-only person** — new. Someone who is only there to lay trails enters a name at first launch and skips the dog. Their home screen offers "Lay a trail" and "Scan a trail card" and nothing about running.
- **Target** — *A person* (a trail), or a hide: Article, Cadaver, Narcotics, Explosives, Firearms, Sport odour, Other.
  - **Narcotics** opens a second row: Marijuana, Hashish, Cocaine, Crack cocaine, Heroin, Methamphetamine, MDMA, Amphetamine, Fentanyl, Opium, Ketamine, Psilocybin, Synthetic cannabinoids, Pseudo training aid, or a typed name.
  - **Explosives** opens a second row: Black powder, Smokeless powder, Pyrodex, Dynamite, TNT, RDX, C-4, PETN, Det cord, Semtex, Ammonium nitrate, ANFO, Emulsion / water gel, TATP, HMTD, Chlorates, Nitromethane, Urea nitrate, Cast booster, Safety fuse, or a typed name.
  - **Other** opens the keyboard to type what the dog is looking for.
  - These are labels on the record ("Narcotics · Cocaine"). The engine treats every hide the same way.
- **Surface** — new. What the trail crosses, one of: Woods, Scrub, Grass, Crop & field, Hard surface (roads, pavements, car parks, buildings, town), Water, Not mapped. Read from the map, saved with the trail.
- **Trail age** (person trails only): Cold / Warm / Hot chips, chosen before laying. For statistics a run is banded by its real age at the start: Hot under 30 min, Warm 30 min–2 h, Cold over 2 h.
- **Session** — one laid trail or set hide, with everything that happened to it: the line, the weather snapshot, the dog's run, the marks, the result, contamination trails, relay data, and whether it was coached.

---

## 4. The flows, step by step

### 4.1 First launch
Create a handler — or choose "I only lay trails" and give a name — then add a dog (skipped for a lay-only person), a five-card tutorial, then home. A sign-in offer appears first if the cloud is configured; at present it is not.

### 4.2 Home
Chips for handler, dog, what the dog is looking for, the odour where there is one, trail age (person trails only) and who lays it. The target and trail-age chips carry a title and nothing else. Two verbs, worded by the target: **Lay a trail / Run a trail**, or **Set a hide / Search**, plus **Scan a trail card**. A list of recent sessions. Tapping the dog that is already selected opens the dog's record; tapping the selected handler opens the handler card.

### 4.3 The map screens (new layout, shared by every map in the app)
- **Top left:** a weather box — wind speed, the direction it comes from, temperature, and a line reading "10 m forecast" with its time. It is there from the first frame and says "Getting the forecast…" or "No forecast — tap to retry" rather than hiding. Humidity is fetched and used by the model but not shown.
- **Top centre:** a message pill ("Ready", "4 corners · 551 m", GPS quality).
- **Top right:** a compass in the style of the phone's own: a dark dial that turns under a fixed mark, north in red, and **the heading written in the middle** ("247° WSW") — which is also how anyone can see it is working. A blue marker rides the dial: where the wind is carrying the air. In the iPhone app it starts by itself with the first map, from the phone's compass chip. In a browser an iPhone must be asked inside a tap, so the first tap on any map screen asks, and the dial says TAP until then. It runs only while a map is showing.
- **Bottom right:** a button for the map style (satellite / terrain / streets) and, under it, a find-me button.
- **Wind wisps:** about sixty soft streaks with fading tails drift across the map in the forecast wind's direction, faster in stronger wind. They show the forecast, not the air in that field, and the code says so.
- **First visit:** an animated tutorial shows the four finger gestures of a 3D map — move, zoom, tilt, turn. It can be replayed from Settings.

### 4.4 Laying a trail (one phone)
The phone records GPS at high accuracy. Fixes worse than the accuracy cap (default ±25 m, adjustable 8–60) are dropped and the screen says *why*. Movement under 2.5 m is not noise: **standing still is folded into "dwell seconds" on the last point**, because a stationary person is the strongest scent source on the trail, and the model emits more scent there. Weather is fetched at the first fix. While laying, the modelled plume drifts off the line on the map. Stop → confirm → the **share card**: a satellite mini-map, start and end coordinates, the ground the trail crossed (§4.6), and a QR code.

### 4.5 Drawing a plan, and the two-phone relay
The handler taps the trail onto the map: the first tap is a green **Start**, the corners after it are numbered 1, 2, 3… and joined by footprints. **Save plan** then asks one question over the finished line — *dog starts after: now / 5 min / 10 min / custom* — and **Confirm** produces a QR code.

The layer scans it; it is a link, so the iPhone camera works. The layer's phone **guides them along the drawn line**: heading arrow, a route ribbon with the walked part dimmed, distance to the end, and a banner when they stray. The **ageing clock starts the moment the layer leaves the start** (armed within 25 m, fires beyond 40 m, fallback after 60 m walked, so a GPS wobble cannot start it) and runs on both phones. The layer's phone records the *real* walked track and shows it as a second QR. After the find the handler scans that: the drawn line is replaced by the walked one and the run is re-graded. Until then a run graded against a plan is marked **provisional**.

**Trail cards** (the QR contents): the trail simplified to at most 120 points, coordinates rounded to about 1 m, times to seconds, delta-encoded, compressed. The card travels in the link's `#fragment`, which browsers never send to a server — so no server ever sees where anyone trained.

### 4.6 The ground under the trail (new today)
Every trail — laid, drawn, or walked — is read against the map: **Woods, Scrub, Grass, Crop & field, Hard surface, Water**, or *Not mapped*. The trail card and the result card show a coloured bar and one line per surface with the distance in the handler's units and its share. Example from a plan drawn across the centre of Wells: *Hard surface 276 m (82 %) · Grass 62 m (18 %)*, of 338 m.

How it is read: the trail is sampled every 2 m (finer than the GPS fixes, so a six-metre road crossed between two fixes still counts) against Mapbox's own vector data. In order: sealed road centre-lines, given a half-width by class that covers the carriageway, the pavement and some GPS slack (tunnels ignored; an earth path through a wood is the wood) → paved squares → water → buildings → vegetation the map has drawn (wood, scrub, grass, park, pitch, cemetery, farmland) → broad built-up areas → a coarse satellite-derived land cover for open country → and ground that is blank on *both* maps is taken as built-up. One stray sample between two that agree is smoothed away as GPS.

It is a reading of a map, not of the ground, and the card says so. A concrete farm track nobody drew is a field. A pavement beside a verge is whichever the GPS favoured. Worked out once per trail and saved with it; with no signal it fills in the next time the trail is opened. When a walked track replaces a drawn plan, the ground is read again for the real line.

**Deliberately not built** (Rémi's scope): a button for the layer to correct the surface while walking, and the dog's result split by surface.

### 4.7 Hides and searches
Single-phone for now; hides are not yet in the QR format. The handler places one or more hides on the map, then searches. The record shows time to the first *Indication* mark, distance from the nearest hide at that moment, and the approach relative to the wind (into / across / with). The odour chosen on the home screen is saved with it.

### 4.8 Running a trail
**Blind by default:** only the start dot shows. *Reveal* shows the trail and the plume, and hides them again. Mark buttons: Indication, Lost it, Re-found, Article, Reward. The map stays north-up during a run, because the result speaks of "right of the line".

### 4.9 The result card — rewritten after your review
**Recorded, first:** the median distance from the line; the share of time spent left of it, on it (within 3 m), and right of it; the trail's age at the start; run time and distance; and the ground the trail crossed, in metres per surface. The dog's track is first corrected by the line length.

**Modelled, second, in plain words:** "The forecast wind suggests drift to the right. The track sits on that side." — or "on the other side", or "the model predicts no side" when the wind runs along the trail. If the GPS accuracy during the run was worse than the distance being described, the card says the side cannot be read from this run.

Older records made under the previous wording are re-worded when they are shown. The per-dog drift figure is still banked from each run, but it no longer changes the model (see §0).

### 4.10 Show on map
The only place the modelled **scent band** is drawn, with the particle plume ageing in real time, the laid trail, the dog's track, the marks, and any contamination trails. Over hard surface the plume and the band are visibly narrower (§5.6). A few **flow arrows** leave the trail along the model's own streamlines, so they bend with the ground rather than repeating the forecast's one direction: brushed shapes, a hair at the trail widening to a swept head, with a light that travels tail to head faster in a stronger wind. Over hard surface they are half as long; in still air they are not drawn.

### 4.11 How the trail and track are drawn (new)
- **The layer's trail:** footprints (default), a plain line, or stripes. Footprints sit every 2 m, left and right feet on their own sides, turned to the direction of travel and thinned as you zoom out. A soft glow walks along them from the start, so direction is obvious without an arrow.
- **The dog's track:** a line (default), stripes, or paw prints.
- **Colours:** plume (default gold), footprints (default dark navy), dog's track (default white), wind (default pale blue). In Settings each shows only its current colour with a "Custom" button that opens the choices. Footprints and plume used to be the same gold and could not be told apart; that is why they now differ by default.

### 4.12 Records
The **dog record**: photo, details, runs, total metres, cold / warm / hot counts, first trail, observed track patterns, and the full log. The **handler card**: see §3.

### 4.13 Sharing
- **Send a link** — the whole trail travels *inside* the link, about 4.5 KB for a typical run. Opens on any phone, no app, no account, nothing stored anywhere.
- **GPX 1.1** — laid trail and dog run as two tracks; start, end, hides and marks as waypoints.
- **PDF report** — written by a hand-made PDF writer: satellite picture with the lines over it, every detail in the reader's units.
- **Share live** — the run published minute by minute; anyone with the link watches it happen. Needs the cloud, which is not switched on.

### 4.14 Settings
Account; handlers, dogs and layers; units; appearance (device / light / dark); **On the map** (colours and the two drawing styles); **Coach**; help (the tutorial, the map-gestures tutorial, a GPS self-check that tells "not https" from "permission denied" from "accuracy worse than the cap"); storage used; advanced (plume on/off, GPS accuracy cap, stillness cap, map token). Every paper screen has a back arrow, and the phone's own back gesture does the same thing.

### 4.15 Backup and sync (built, dormant)
The phone stays the source of truth and Firestore mirrors it: newest wins by timestamp, deletes are kept as tombstones for 90 days, tracks are packed to fit Firestore's document limit, and it works offline and catches up. It needs a Firebase project that Rémi has not created yet. In the native app, Google sign-in will also need a native plugin.

---

## 5. The scent model — one change since the first brief (§5.6), and still the part most worth attacking

### 5.1 Stability, from soil minus air temperature
ΔT = soil (0 cm) − air (2 m):
- ΔT > 3 → *strongly convective*: scent lifts fast and breaks into pockets.
- 1 < ΔT ≤ 3 → *convective*: rises, disperses, the band widens quickly.
- −1 ≤ ΔT ≤ 1 → *neutral*: the textbook downwind cone.
- −3 ≤ ΔT < −1 → *stable*: a lid on the air; scent stays low and holds its line.
- ΔT < −3 → *strong inversion*.

Each class sets three multipliers: **mix** (band width, 0.40–1.9), **drain** (cold-air drainage, 0–1), **life** (how long scent stays workable, 0.34–2.6).

### 5.2 The flow field
Start from the single forecast wind vector. If elevation data exists (a 44 × 44 grid sampled from the map's terrain around the trail — coarse, tens of metres), bend it:
1. **Deflection** — air cannot drive into a hillside; it follows the contour. Deliberately gentle.
2. **Drainage** — under stable air, cold dense air runs downhill whatever the forecast wind says.
3. **Scent-creep** — a handler's rule, hard-coded: the ground-hugging scent film slides a little downhill on any slope in nearly any air. You asked for this to become an experimental toggle; it has not been done.
4. **Shelter** — ridges speed the flow up, hollows go slack.

### 5.3 The workable line (geometry, used for the result)
- **Offset** of the scent from the trail: min(60 m, U × k × (1 − e^(−age / 900 s))). U is wind speed in m/s; k is **2.0 m per m/s**, a guess. It saturates in about 15 minutes because the ground keeps emitting.
- **Half-width** (uncertainty): min(50 m, 2 + 0.06 × √age × (1 + U / 6)).
- The wind is split against the direction of travel into along and cross parts (crosswind / headwind / tailwind).
- Stability scales the drift, clamped ×0.6–×1.6.

### 5.4 The particle simulation (what is drawn, never what is graded)
Continuous emission from the ground; each parcel lives **52 s** at nose height, so displacement saturates at the scale dogs work at. **Only 28 % of the forecast 10 m wind is assumed to reach nose height** — a guess. Standing spots pool up to 700 parcels. Drawn as coloured speckle, strong near the line and fading downwind.

### 5.5 Contamination
Other people's trails crossing the area can be recorded (who, when) and are drawn dashed on the reveal.

### 5.6 Hard ground (new today, and unvalidated)
Every trail point on **hard surface** carries a spread factor of **0.5**; every other surface is 1. It acts in three places:
- **the particles** — a parcel from hard ground is carried for half the time, so it travels about half as far, and is drawn half as strong, so a stretch of tarmac reads as a thinner band rather than the same scent packed tighter. The pools where someone stood are half as wide too;
- **the scent band** — both its offset from the trail and its half-width are halved at those points;
- so, downstream, **the Coach's experimental scent corridor** and the silent scent-corridor log are narrower on hard ground as well.

It does **not** touch the recorded numbers, and the side the wind predicts does not depend on it.

Where it came from: Rémi's experience that scent holds and spreads on vegetation and does neither on pavement or concrete — "by 50 % for now". Claude's advice had been to record the surface first and leave the model alone until runs could say how big the effect is; Rémi decided the picture should already show what every handler knows. It is one number in one place. It is also a guess stacked on a guess: the surface itself is read from a map.

---

## 6. The Coach

During an **Assisted** run it watches the dog against the laid trail and says, hands-free — a tone, then a voice — "Off the trail, 25 metres to the right", "Back on the trail", "Still off, 40 metres to the left". At most one call every 10 seconds; "still off" twice, then silence until the position changes.

- The dog, not the phone, is judged: the position is projected a line-length ahead along the handler's heading.
- GPS noise never sounds it: a fix must be outside by more than its own stated accuracy, twice running or for 6 seconds.
- "Follow the scent" widens the corridor on the downwind side by the modelled band, capped at 1.5 × the chosen tolerance. It is off by default and labelled *experimental*. Since today that band is narrower over hard surface (§5.6).
- A drawn plan gets 10 m more.

The Coach page in Settings was redesigned: two large cards, **Blind run** and **Assisted**, then — dimmed while blind — the corridor width (10 / 20 / 30 / 50 m), tiles for voice, sound and vibration, "show the distance on screen", and the experimental scent corridor. Vibration works in the native app; it is impossible in an iPhone web app.

Every trail run, coached or not, also saves the two silent coaches' logs described in §0.

---

## 7. Design language

White, navy and gold. Light mode: near-white paper, white cards, navy ink and primary buttons, one gold accent. Dark mode: deep navy. Over the map every control is dark translucent "liquid glass" so the satellite picture stays the subject. Roboto throughout. 56 px touch targets for gloves and rain. Selected chips and primary buttons carry a soft lit edge. Cold / warm / hot stay sky blue / orange / red everywhere, including the rings on the dog and handler cards. Surfaces have their own small palette (two greens, olive, wheat, grey, blue). The compass borrows the look of the phone's own, because a familiar instrument is a trusted one. Copy is plain and specific: buttons say what will happen ("Run it on this phone", "Back to the map").

A new logo exists as an image and has not been put into the app yet.

---

## 8. Known limitations and honest doubts

- The wind is a **forecast for open ground at 10 m**, not the air at the dog's nose. Under canopy the real flow is a fraction of it and can reverse. The 0.28 nose-height factor and the 2.0 drift constant are guesses.
- The **wind wisps and the compass marker show that same forecast**, now more vividly than before. A handler may read them as "the wind here". Is that a risk?
- The terrain grid is coarse; hedges, walls and sunken lanes that dominate scent locally are invisible to it.
- **The ground is read from a map, not from the ground**, and nobody can correct it yet. The 0.5 for hard surface is a trainer's figure with no measurement behind it, it ignores whether the tarmac is hot, cold, wet or dry, and it shrinks the scent rather than moving it to the kerb or the verge where handlers say it collects.
- GPS is 3–5 m at best, and the model's claims are of the same order.
- **The model has still never been validated in the field.** The silent coach logs are collecting evidence, but no analysis of them exists yet.
- The native app's background recording is built and **not yet proven on a long trail in woodland** — the very failure the competitors are punished for. The native compass compiled and installed today and has not been confirmed in the hand at the time of writing.
- Records still live in about 5 MB of localStorage. A failed save is now caught and explained, but the move to a roomier store is not done.
- Hides are single-phone; there is no hide relay, and a detection record holds only the odour's name — no quantity, container, height, soak time, blank searches or false alerts.
- No offline map areas. No replay. No structured debrief. No cloud yet (so no backup, no sign-in, no live sharing).
- The instructor tier — the actual business — does not exist: no client seats, no assignments, no class view, no payments.
- The map now carries four moving things at once — the plume, the wind wisps, the flow arrows and the walking footprints. The app has grown a great deal of surface in three days: styles, colours, a compass, wisps, arrows, tutorials, cards. Some of it may be decoration.
- The weather box still does not show humidity, which Rémi asked for.

---

## 9. Questions for you — please answer each, and argue

**A. Proving the model (or killing it)**
1. We now save two silent coach logs on every run: plain corridor and scent-widened corridor. Design the analysis. What should be compared, how many runs in what conditions are needed before the comparison means anything, and what result would justify **removing** the scent corridor altogether?
2. What is the cheapest field protocol a single trainer with one dog and one helper could run in a fortnight to test whether the model predicts the correct **side**? Give the number of trails, the wind conditions to wait for, what to write down, and what counts as a pass.
3. The result card now reports the median distance and the time share left / on / right before any model sentence. Is that the right recorded layer? What would a mantrailing instructor or a judge want added — casting, loss and re-find loops, time stopped, speed changes at corners?
4. Of the three model improvements you suggested (stability from cloud and sun, the 15-minute weather series over the trail's life, scent-creep as a toggle), which one changes the answer most for a UK trainer, and which can wait?

**A2. Hard ground — today's assumption**
4a. Scent over hard surface is now drawn at half the spread and half the strength. Is halving defensible? What do the literature and experienced urban trailers say about asphalt and concrete against grass — retention, how fast it is lost, the effect of a hot surface in sun against a cool shaded one, wet against dry?
4b. Is "shrink it" even the right shape? Handlers say scent on hard surface is blown to the kerb, the wall foot and the nearest vegetation and collects there. Should the model move scent to the nearest edge rather than thin it — and is that buildable from map data that knows where the verge is?
4c. Which surfaces matter that the app cannot see — gravel, sand, stubble, leaf litter, bare soil, puddles — and is a one-tap correction by the person walking the trail worth more than any cleverness with map data?
4d. Rémi chose not to split the dog's result by surface yet. Would "typical distance from the line on grass / on hard surface / in woods" and "where the losses fell" be the single most useful thing this data could say? What else?
4e. Claude advised recording surfaces first and changing the model only once runs showed the size of the effect; Rémi chose to draw it now. Who is right, and how should the app keep the two honest — for example, by saving with each run which assumptions were in force?

**B. Detection work — still the thinnest part**
5. A detection record currently holds the odour's name and where the hides were. What should a *professional* detection training log capture? Consider quantity, container and permeability, hide height, set time and soak time, blank (negative) searches, distractors, false alerts, the final response shown, handler knowledge (known / blind / double-blind). Rank by value to a working handler and say which are needed for certification records.
6. Are the two odour lists right? What is missing, what is never trained as a separate odour, and what is named differently in the UK against the US? Should Cadaver, Firearms and Sport odour get lists of their own?
7. Trail and hide share one screen design. Should detection searches have their own flow entirely — search areas, vehicles, buildings, line-ups — rather than hides on an outdoor map?
8. Does modelling scent mean anything for a hide indoors or in a vehicle, or should the app say plainly that the model is for outdoor trails only?

**C. The map, as the handler meets it**
9. Footprints instead of a line: clearer, or a gimmick? When would a line be better, and should the default differ between the layer's guided walk, the blind run and the review?
10. The wind wisps, the flow arrows and the compass marker make the forecast wind look like a measurement of this field. Should they be labelled, faded under trees, removed during a blind run, or kept as they are? What would you show instead if the aim is to teach a handler to read the wind themselves?
11. The compass turns with the phone and shows the heading in degrees, but the map stays north-up during a run. Is that consistent enough, or confusing? What is the convention in serious outdoor navigation apps, and should we follow it? Now that a true heading is available natively, is there anything worth *recording* from it — the handler's facing at each mark, for instance?
12. There are now four colour choices and two style choices in Settings. Useful for accessibility and visibility on different map styles, or clutter? What would you keep?

**D. People and the relay**
13. The lay-only profile exists so a helper can join in thirty seconds. What is still in their way? Would a link that opens straight into "walk this line", with no profile at all, be better?
14. "Dog starts after" is now asked after the line is drawn. Instructors count trail age from different moments. Should the app ask *when the layer finished* rather than *how long to wait*, and should that be recorded rather than chosen?
15. The handler card counts trails, metres, hours, bands, blind against assisted. What would make it a tool for an instructor rather than a scoreboard — progression over time, a level the team is ready for, a weak spot to train next?

**E. Platform and the next three months**
16. We now have a web app and a native iPhone shell from one codebase, and today the first native code of our own (the compass). With TestFlight coming, should the pilot go native-only, or keep both? What breaks first with two?
17. Put in order, with reasons: (a) field-prove background recording in woodland, (b) move records to a roomier store with export and restore, (c) replay plus structured debrief, (d) switch the cloud on for backup and sign-in, (e) the instructor tier, (f) an Apple Watch companion, (g) Android.
18. An Apple Watch companion is being considered. What is the *one* job it should do — marks from the wrist, a glanceable blind-run screen, haptic coach calls, recording without the phone? What should it never try to do?
19. Offline maps are still impossible under the current map licence. Is that a deal-breaker for a woodland product? What are the realistic routes — a different map provider, a native map SDK, pre-cached areas — and their costs?

**F. Business**
20. Given everything above, is "five paying instructors before advertising" still the right first goal? What must exist in the instructor tier on day one for a pilot instructor to pay £19 a month, and what can be faked by hand behind the scenes?
21. Detection handlers (police, prison, security, customs) are a different buyer from pet scent-work instructors. Is it worth serving both, or does listing narcotics and explosives odours pull the product towards a market with procurement, vetting and data-security demands we cannot meet?

**G. Cutting**
22. If you had to remove five things from this app to make it clearer, what would they be and why?
23. What is the single weakest assumption in this brief now, and what would you do this week to test it?
24. Finally: rank the **top five improvements** you would make next, each with the reason, the rough effort, and what could go wrong.

Please number your answers to match (4a–4e included). Where you disagree with a design decision, say so plainly and propose the alternative. Where you would need field data, say what data and how to collect it with a phone and a dog.
