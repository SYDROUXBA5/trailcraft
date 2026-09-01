# Trailcraft

A scent-work training record. Dual-track GPS, 3D terrain, real conditions,
and a terrain-aware scent and wind simulation you can replay minute by minute.

Built as a phase-1 prototype: it runs in a phone browser so it can be
field-tested immediately, with no App Store review and no developer account.

## Run

Double-click **Trailcraft.command** on the Desktop, or:

```bash
cd ~/Projects/trailcraft && npm run dev
```

Then open https://localhost:2777

## On your phone (this is the point)

Both devices must be on the same wifi.

1. `npm run cert` — already done; re-run if your LAN IP changes
2. `npm run dev` and note the `https://192.168.x.x:2777` address it prints
3. Open that on your phone and install the certificate — see below. GPS only
   works on an origin the phone fully trusts, so this step is not optional.
4. Share → **Add to Home Screen** to run it fullscreen like an app.

## Trusting the certificate

iOS grants Geolocation only on an origin it fully trusts. Clicking through the
warning gets you the page but **not** GPS, which is the whole point of carrying
this into a field.

`npm run cert` issues two things: a local authority (`certs/ca.pem`) and a
server certificate signed by it. You install the authority on the phone **once**
— it lasts ten years, so later address changes need nothing on the phone.

On the iPhone, with the server running:

1. Open **`https://<your-lan-ip>:2777/ca.crt`** — accept the warning this once.
2. Safari says a profile was downloaded. Go to
   **Settings → General → VPN & Device Management → Trailcraft Local CA → Install**
   (enter your passcode, then Install again).
3. **This step is the one everyone misses:** go to
   **Settings → General → About → Certificate Trust Settings** and switch
   **Trailcraft Local CA** on.
4. Reopen `https://<your-lan-ip>:2777`. No warning, and Location will now ask
   properly instead of refusing.

If the phone had already refused location for this address, clear it first:
tap **aA** in Safari's address bar → **Website Settings → Location → Ask**.

On the Mac you can do the same by double-clicking `certs/ca.pem` and setting it
to *Always Trust* in Keychain — optional, it only saves clicking through Chrome's
warning.

## How to use it

1. **Runner** mode → Start → walk the trail → Stop. Weather at that exact
   place and minute is attached automatically.
2. Later, **Dog** mode → pick the trail you laid → Start → work it.
3. Open the session: both lines overlay, with mean offset, trail age, and
   the drift ribbon.

Waypoints (Indication / Lost it / Re-found / Article / Reward / Mark) drop at
your current position with one tap — sized for cold hands on a long line.

## What is real and what is not

- **GPS filtering is real.** Two filters run: fixes worse than your accuracy
  cap are rejected, and movement under the stillness threshold is ignored.
  That second one is what stops a track scribbling while you stand and read
  the dog. Both are tunable in Settings; the HUD shows how many fixes were
  rejected so you can see it working.
- **Weather is real.** Open-Meteo, queried at the trail's coordinates and the
  hour it was laid — including `soil_temperature_0cm`, which no other public
  weather API returns and which matters more than air temperature for scent.
- **Scent drift is illustrative.** Public weather models report wind at 10 m
  over open ground. Under canopy at nose height the real airflow is a fraction
  of that and can reverse. The overlay is a teaching aid for explaining the
  dog's line after the fact — never a prediction of where scent is.

## Replay

Open any session and press **Replay with scent & wind**. One clock drives
everything, so nothing on screen can disagree with anything else:

- The **plume is not drawn.** It is the density of scent particles emitted from
  the trail at the moment each step was walked, riding the flow field and fading
  at a rate the conditions decide. It has holes and streaks because the air does.
- **Wind particles sample the same field**, so they visibly bend over a ridge,
  go slack in a hollow, and run downhill under an inversion.
- **Conditions change during the replay.** Weather is pulled at 15-minute
  resolution, so a trail laid at 08:00 and worked at 09:30 is worked in the air
  it was actually worked in, not in one hourly snapshot.
- The **verdict** grades the model against the dog: what was predicted, what the
  dog held, and by how much the model was wrong.

### Layers

Only things that genuinely vary across a field get painted. Air temperature,
humidity and pressure are one number over 400 m, so they stay as numbers — a
smooth gradient there would imply detail the data does not have.

| Layer | What it shows |
|---|---|
| Pooling | Where cold air drains and scent collects |
| Sun & shade | Which ground is being heated, and therefore lifting scent |
| Shelter | Where the wind dies — leeward ground and hollows |
| Slope | Steepness, straight from the elevation grid |

A layer that isn't a factor today greys itself out and says so rather than
inventing structure. That is what makes the others believable.

## The model

`field.js` and `sim.js` are pure: no DOM, no map, no globals. That is why the
maths is checked in Node (`npm test`, 52 assertions) instead of being eyeballed
on a phone in a wet field.

Three forces act on the air:

1. **Deflection** — air cannot drive into a hillside, so it follows the contour.
2. **Drainage** — cold dense air slides downhill, but only under an inversion.
3. **Shelter** — ridges accelerate the flow, hollows go slack.

The wind data is a 28 km cell; the terrain under it is 10 m data. Bending a
coarse wind field around real ground is standard meteorological downscaling, and
it is the whole argument for doing this at all.

**Stability is the master switch.** `soil_temperature_0cm − temperature_2m`
decides how fast the plume widens, whether drainage runs, and how long scent
survives. Ground warmer than air lifts scent off the ground and breaks it into
pockets; ground cooler than air puts a lid on it, and scent runs downhill like
water.

**Every constant is a literature guess** until real trails correct it. The
predicted offset is anchored to `geo.js`'s `DRIFT_PER_MS`, the only figure here
with any field history behind it.

## Stack

No build step, no dependencies, no bundler.

- Mapbox GL JS 3.14.0 — Standard Satellite and Outdoors
- Mapbox Terrain DEM v1 for 3D terrain and for the flow field's elevation grid
- Open-Meteo for weather at 15-minute resolution (free; $29/mo once commercial)
- Data lives in `localStorage` on the device. Export JSON from Settings to back up.

A Mapbox token ships in Settings. Restrict it to your own URLs — public tokens
ship inside the page.

## Honest limits

- Weather models report wind at **10 m over open ground**. Under canopy at nose
  height the real airflow is a fraction of that and can reverse.
- There is no trail-scale wind data anywhere, at any price. The terrain is what
  adds resolution, not the forecast.
- The dog's position comes from the handler's phone, so it carries the length of
  the long line as error.
- The model is **explanatory, not predictive**.

## Drawing a trail

Most trails are laid by somebody with no phone running, and an instructor
setting one for a student wants to plan it before walking it. **Draw a trail
instead** on the record sheet: tap the corners, say when it was laid and how
fast it was walked.

A drawn line is missing the two things a walked track carries for free, so the
app supplies both — `densify()` fills the corners in to a point every 5 m, and
`timestamps()` paces a clock along it. The clock is the part that matters:
scent age is what the whole model runs on, and a pool at the start of a
40-minute trail is 40 minutes older than one at the end.

Weather is then fetched for that place and that historical time, so a drawn
trail replays against the conditions it was actually laid in. Drawn trails are
badged **drawn** wherever they appear — the shape is only as good as the taps.

## Not built yet

Offline region pre-download, canopy from landuse tiles, live two-device view,
Apple Watch, account sync, and instructor accounts. Watch and sync both need
the native app.
