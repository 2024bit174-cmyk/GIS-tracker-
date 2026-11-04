# GeoTrack Pro — Real-Time GIS Tracking Platform

A single-page web application that tracks the location of **people and objects in real time**.
It implements three positioning methods — IP geolocation, GPS, and cell-tower triangulation —
plus **live multi-device sharing**, so several phones can appear on one shared map.

Built for the MUST GIS Tracking App assignment and deployed as a static site with serverless
functions, so it runs on **Netlify with no third-party account required**.

---

## 1. What it does

| Capability | How it works |
|---|---|
| **Track a laptop by IP** | Server-side lookup (`/api/ip-locate`) returns city-level coordinates. Accuracy is fixed at ±10 km and labelled as such. |
| **Track a person by GPS** | `navigator.geolocation.watchPosition()` with `enableHighAccuracy`. The accuracy radius comes from the device itself. |
| **Track by cell triangulation** | Simulated model: 1 tower ≈ ±1 500 m, 2 towers ≈ ±400 m, 3+ towers ≈ ±120 m. |
| **Live multi-device map** | Every phone that opts in publishes its position to `/api/devices`; all clients poll it every 3 s and render each device as its own coloured marker. |
| **Geofence** | Circular buffer with adjustable radius (200–6 000 m). Alerts fire on the *crossing*, not on every fix. |
| **Geospatial analysis** | Haversine great-circle distance, bearing, error-gated distance accumulation. |
| **Data visualisation** | Live target table, session statistics, log-scale accuracy comparison chart, timestamped event log. |
| **Privacy safeguards** | Consent gate, coarse mode, no server-side history, one-click erase, full audit log. |

### Why the position *and* its error are always shown together

A coordinate without its uncertainty is not a measurement. Every fix is drawn as a marker
**plus** a circle whose radius is the reported accuracy, so ±10 km and ±9 m are never
visually confused.

---

## 2. Technologies

| Layer | Choice | Why |
|---|---|---|
| Front end | Plain HTML, CSS, vanilla JS | One page does not justify a framework; what you read is what runs. |
| Mapping | Leaflet 1.9.4 + OpenStreetMap tiles | Free, no API key, no billing account. |
| Local server | Node.js `http` module (zero dependencies) | Nothing to install; the whole server is ~300 lines. |
| Production API | Netlify Functions (ESM) | Serverless, same URL contract as local. |
| Device storage | `@netlify/blobs` | Serverless key/value store included with Netlify — **no account, no key**. |
| Optional realtime | Firebase Realtime Database | Only used if you fill in `public/firebase-config.js`. Not required. |

---

## 3. Project structure

```
GIS-Tracking-App/
├── public/                     # the entire front end (published to Netlify)
│   ├── index.html              # the single page / single UI activity
│   ├── style.css               # design system + responsive layout
│   ├── app.js                  # map, tracking modes, realtime, charts
│   └── firebase-config.js      # OPTIONAL — leave as REPLACE_ME
├── netlify/
│   └── functions/
│       ├── _store.mjs          # Blobs adapter + in-memory fallback
│       ├── devices.mjs         # GET/POST/DELETE /api/devices
│       └── ip-locate.mjs       # IP geolocation proxy (HTTPS-safe)
├── tests/
│   ├── api.test.mjs            # 24 end-to-end HTTP tests
│   └── functions.test.mjs      # 15 serverless handler tests
├── server.js                   # local dev server (static + API + SSE fleet)
├── start.bat                   # double-click launcher (Windows)
├── netlify.toml                # build, redirects, headers
├── package.json
├── .env.example
├── .gitignore
└── README.md
```

---

## 4. Run it locally

```bash
npm install        # only needed once, for @netlify/blobs
npm start          # or: node server.js
```

Then open **http://localhost:8790**.

On Windows you can also just double-click **`start.bat`**.

No build step is required. The server serves `public/` directly.

---

## 5. Test device location tracking

1. Open the site.
2. Click **GPS / Device** (step 1).
3. Turn on **Share location on network map**.
4. Press **Start** and allow the location prompt.

The browser will only ask for permission after you press Start — the app never requests
location on page load.

### If GPS is denied

The app logs the reason, releases the Start button and suggests IP or Cell mode.
It does not pretend to have a fix.

---

## 6. Connect multiple phones

1. Deploy the site (or run it and reach it over your LAN).
2. Open the **same URL** on each phone.
3. On each phone: choose **GPS / Device** → enable **Share location** → **Start** → allow.
4. Each device appears with its own colour in **Connected Devices** and on the map.

Devices that stop sharing (or close the tab) disappear automatically after **2 minutes**.
Your own device is never drawn twice.

> **Geolocation requires HTTPS** except on `localhost`. Netlify provides HTTPS automatically.
> On a plain-HTTP LAN address, mobile browsers will refuse the location prompt.

---

## 7. Environment variables

**None are required.** The default deployment needs no configuration at all.

`.env.example` documents the *optional* Firebase upgrade. To use it:

1. Create a Firebase project → Realtime Database → test mode.
2. Paste your values into `public/firebase-config.js`.
3. The app detects the change and uses Firebase instead of `/api/devices`.

Never commit a real `.env` file — it is already listed in `.gitignore`.

---

## 8. Deploy to Netlify

### Option A — Git (recommended)

1. Push this repository to GitHub.
2. Netlify → **Add new site** → **Import an existing project** → GitHub.
3. Settings are read from `netlify.toml`:

   | Setting | Value |
   |---|---|
   | Build command | `npm install` |
   | Publish directory | `public` |
   | Functions directory | `netlify/functions` |

4. Deploy. Netlify Blobs is available automatically — nothing to enable.

### Option B — Drag and drop

Drag the folder onto <https://app.netlify.com/drop>. Note: this uploads only static files,
so `/api/*` will not exist and multi-device sharing will be unavailable.

### Verify after deploying

```
https://YOUR-SITE.netlify.app/api/devices      -> {"devices":[],...}
https://YOUR-SITE.netlify.app/api/ip-locate    -> {"status":"success",...}
```

---

## 9. Run the tests

```bash
npm test                          # 24 API integration tests
node tests/functions.test.mjs     # 15 serverless handler tests
```

Both suites spin up real code — no mocked business logic.

---

## 10. Security and privacy

- **No secrets in the front end.** Nothing to leak.
- **Server-stamped timestamps.** A device cannot claim to be fresher than it is.
- **Input validation.** Coordinates are range-checked, ids truncated, methods whitelisted.
- **Size limits.** Request bodies are capped at 4 KB.
- **Path-traversal guard.** The static handler refuses any path escaping `public/`.
- **Consent first.** No location call exists until the user presses Start.
- **Minimisation.** The server stores only id, coordinates, accuracy, method and time.
  No names, no accounts, no history.
- **Erasure.** "Clear All Tracking Data" removes everything; closing the tab removes
  the device from the shared map.
- **Expiry.** Records older than 2 minutes are ignored and pruned.

### Known limitations

- Cell triangulation is a **simulation**, clearly labelled as such in the UI. It is not
  reading real tower data (browsers do not expose that).
- IP geolocation is city-level and **cannot detect movement** — the app says so in its log.
- `/api/devices` is intentionally open (no auth) because the assignment is a public demo.
  For production, add Netlify Identity or signed tokens before the endpoint.

---

## 11. Assignment notes

| Requirement | Where |
|---|---|
| 1 page / 1 UI activity | `public/index.html` — everything on one screen |
| Tracking is the functional requirement | three modes + live multi-device map |
| IP location research & accuracy | `public/app.js` (`startIP`) + report §4.1 |
| GPS vs cell pros/cons | UI hints + report §4.2–4.4 |
| Creative uses / enabling tech | report §6 |
| Interactive maps, geospatial analysis, visualisation | Leaflet, Haversine/bearing/geofence, table+stats+chart+log |
| Design approach & tech choices | report §2–3 |
| Privacy concerns & safeguards | UI panel + report §7 |

---

**Author:** MUKUNZI ISMAIL
**Course:** Geographical Information Systems — MUST
**Year:** 2026
