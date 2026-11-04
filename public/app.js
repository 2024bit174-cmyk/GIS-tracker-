/* =========================================================
   GeoTrack Pro — client-side application
   app.js

   Preserves ALL original functionality:
     - IP geolocation (via /api/ip-locate on local server)
     - GPS tracking (watchPosition)
     - Cell tower simulation
     - Geofence detection
     - Fleet SSE stream (simulated vehicles)
     - Accuracy comparison chart
     - Event log

   New in this version:
     - Firebase Realtime Database multi-device sharing
     - Unique device ID per browser session
     - Real-time connected-devices panel
     - Improved UI feedback (toasts, status pills, device card)
     - Mobile hamburger menu
     - Live clock & session timer
     - Map layer switcher
   ========================================================= */

'use strict';

/* ---------------------------------------------------------
   1. UNIQUE DEVICE IDENTITY
   Each browser gets a persistent random ID stored in
   localStorage so it keeps the same identity on page reload.
   --------------------------------------------------------- */
const DEVICE_ID = (() => {
  const key = 'geotrack_device_id';
  let id = localStorage.getItem(key);
  if (!id) {
    id = 'dev-' + Math.random().toString(36).slice(2, 9).toUpperCase();
    localStorage.setItem(key, id);
  }
  return id;
})();

/* Show device ID in sidebar card */
const myIdEl = document.getElementById('my-device-id');
if (myIdEl) myIdEl.textContent = 'ID: ' + DEVICE_ID;

/* ---------------------------------------------------------
   2. MAP SETUP
   --------------------------------------------------------- */
const HOME = [0.33341, 32.57781];  // Kampala, Uganda — fleet route centre

const map = L.map('map', { zoomControl: false }).setView(HOME, 13);

const TILE_SOURCES = {
  osm:       { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',       attr: '&copy; OpenStreetMap contributors', maxZoom: 19 },
  satellite: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attr: 'Tiles &copy; Esri', maxZoom: 18 },
  topo:      { url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',    attr: '&copy; OpenTopoMap', maxZoom: 17 }
};

let currentTile = null;
function setLayer(name) {
  if (currentTile) map.removeLayer(currentTile);
  const s = TILE_SOURCES[name];
  currentTile = L.tileLayer(s.url, { attribution: s.attr, maxZoom: s.maxZoom }).addTo(map);
  document.querySelectorAll('[id^="layer-"]').forEach(b => {
    b.classList.toggle('active', b.id === 'layer-' + name);
    b.setAttribute('aria-pressed', b.id === 'layer-' + name);
  });
}
setLayer('osm');

/* Coordinate readout on mousemove */
map.on('mousemove', e => {
  const t = document.getElementById('cursor-text');
  if (t) t.textContent = e.latlng.lat.toFixed(5) + '°, ' + e.latlng.lng.toFixed(5) + '°';
});
map.on('mouseout', () => {
  const t = document.getElementById('cursor-text');
  if (t) t.textContent = 'Move cursor over map…';
});

/* ---------------------------------------------------------
   3. COLOUR PALETTE & TARGET STATE
   --------------------------------------------------------- */
const COLORS = {
  ip:     '#f4a261',
  gps:    '#2a9d8f',
  cell:   '#e76f51',
  van:    '#4cc9f0',
  ranger: '#9b5de5'
};

const REMOTE_COLORS = ['#9b5de5','#ff4d8b','#ffd60a','#ff6b35','#38e57a','#4cc9f0'];

const state = {
  method:      null,
  timers:      {},
  watchId:     null,
  coarse:      false,
  towers:      3,
  fenceRadius: 2500,
  fenceCenter: HOME.slice(),
  targets:     new Map(),
  acc:         {},
  fixes:       0,
  startedAt:   null,
  sharing:     false,
  sessionStart: Date.now()
};

const CELL_ACCURACY = { 1: 1500, 2: 400, 3: 120 };

/* ---------------------------------------------------------
   4. TINY HELPERS
   --------------------------------------------------------- */
function esc(s) {
  return String(s).replace(/[&<>"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function fmtDist(m) {
  if (m == null || isNaN(m)) return '—';
  return m >= 1000 ? (m / 1000).toFixed(1) + ' km' : Math.round(m) + ' m';
}

function fmtTime(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h) return String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0') + ':' + String(sec).padStart(2,'0');
  return String(m).padStart(2,'0') + ':' + String(sec).padStart(2,'0');
}

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 10)  return 'just now';
  if (s < 60)  return s + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  return Math.floor(s / 3600) + 'h ago';
}

/* ---------------------------------------------------------
   5. LOG
   --------------------------------------------------------- */
function log(msg, kind) {
  const box = document.getElementById('log');
  if (!box) return;
  const p = document.createElement('p');
  const ts = new Date().toLocaleTimeString([], { hour12: false });
  p.innerHTML = '<span class="ts">' + ts + '</span> <span class="' + (kind || '') + '">' + esc(msg) + '</span>';
  box.prepend(p);
  while (box.children.length > 80) box.lastChild.remove();
}

/* ---------------------------------------------------------
   6. TOAST NOTIFICATIONS
   --------------------------------------------------------- */
let toastN = 0;
function toast(msg, type = 'info') {
  const stack = document.getElementById('toast-stack');
  if (!stack) return;
  const id = 'toast-' + toastN++;
  const icons = { success: 'fa-circle-check', error: 'fa-circle-xmark', warning: 'fa-triangle-exclamation', info: 'fa-circle-info' };
  const colors = { success: 'var(--green)', error: 'var(--danger)', warning: 'var(--yellow)', info: 'var(--cyan)' };
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.id = id;
  el.style.borderLeftColor = colors[type] || colors.info;
  el.innerHTML = `<i class="fas ${icons[type]||icons.info}" style="color:${colors[type]||colors.info};font-size:15px;flex-shrink:0;"></i><span>${esc(msg)}</span>`;
  stack.appendChild(el);
  setTimeout(() => { el.classList.add('hiding'); setTimeout(() => el.remove(), 350); }, 4000);
}

/* ---------------------------------------------------------
   7. STATUS PILLS
   --------------------------------------------------------- */
function setPill(id, state) { // state: 'active'|'loading'|'error'|''
  const el = document.getElementById(id);
  if (!el) return;
  el.className = 'status-pill' + (state ? ' state-' + state : '');
}

/* ---------------------------------------------------------
   8. CLOCK & SESSION TIMER
   --------------------------------------------------------- */
function initClock() {
  function tick() {
    const now = new Date();
    const cl = document.getElementById('live-clock');
    const cd = document.getElementById('live-date');
    if (cl) cl.textContent = now.toLocaleTimeString('en-US', { hour12: false });
    if (cd) cd.textContent = now.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' });

    // Session timer
    if (state.startedAt) {
      const ft = document.getElementById('footer-time');
      if (ft) ft.textContent = fmtTime(Date.now() - state.startedAt);
    }
  }
  tick();
  setInterval(tick, 1000);
}
initClock();

/* ---------------------------------------------------------
   9. MAP MARKER CREATION
   --------------------------------------------------------- */
function makeIcon(color, isSelf) {
  const cls = isSelf ? 'pin-self' : 'pin';
  return L.divIcon({
    className: '',
    html: '<div class="' + cls + '" style="background:' + color + ';color:' + color + '"></div>',
    iconSize:   isSelf ? [20, 20] : [15, 15],
    iconAnchor: isSelf ? [10, 10] : [7, 7]
  });
}

/* ---------------------------------------------------------
   10. GEOFENCE
   --------------------------------------------------------- */
let fenceLayer = L.circle(HOME, {
  radius: 2500, color: '#e63946', weight: 2, dashArray: '7 7', fill: false
}).addTo(map);

function drawFence() {
  fenceLayer.setLatLng(state.fenceCenter).setRadius(state.fenceRadius);
}

const fitted = new Set();
function ensureVisible(latlng) {
  const p = L.latLng(latlng);
  if (map.getBounds().contains(p)) return;
  map.fitBounds(L.latLngBounds(map.getCenter(), p).pad(0.25));
}

/* ---------------------------------------------------------
   11. PLACE / UPDATE A TARGET ON MAP
   --------------------------------------------------------- */
function place(id, p) {
  let t = state.targets.get(id);

  if (!t) {
    t = {
      id, name: p.name || id,
      method: p.method || 'gps',
      color: p.color || COLORS.van,
      reliable: !!p.reliable,
      self: !!p.self,
      detail: p.detail || '',
      trail: [], distance: 0, accuracy: null,
      inside: true, raw: [p.lat, p.lng],
      lat: p.lat, lng: p.lng
    };
    t.marker = L.marker([p.lat, p.lng], { icon: makeIcon(t.color, t.self), zIndexOffset: t.self ? 1000 : 600 }).addTo(map);
    t.circle = L.circle([p.lat, p.lng], {
      radius: p.accuracy || 50, color: t.color, weight: 1.2,
      fillColor: t.color, fillOpacity: 0.08
    }).addTo(map);
    t.poly = L.polyline([], { color: t.color, weight: 2.5, opacity: 0.8 }).addTo(map);

    t.marker.bindPopup(() => buildPopup(t));
    state.targets.set(id, t);
    log('+ New target "' + t.name + '" acquired', 'ok');

    if (t.self && !fitted.has(id)) { fitted.add(id); ensureVisible([p.lat, p.lng]); }
  }

  if (p.detail) t.detail = p.detail;
  t.raw = [p.lat, p.lng];

  /* Coarse privacy mode */
  let lat = p.lat, lng = p.lng, acc = p.accuracy || 50;
  if (state.coarse && t.self) {
    lat = Math.round(lat * 1000) / 1000;
    lng = Math.round(lng * 1000) / 1000;
    acc = Math.max(acc, 100);
  }

  /* Distance (noise-filtered) */
  if (t.last) {
    const step = haversine(t.last[0], t.last[1], lat, lng);
    if (step > (t.reliable ? 0 : 2 * acc)) t.distance += step;
  }
  t.lat = lat; t.lng = lng; t.accuracy = acc; t.last = [lat, lng];

  /* Draw */
  t.marker.setLatLng([lat, lng]);
  t.circle.setLatLng([lat, lng]).setRadius(acc);
  t.trail.push([lat, lng]);
  if (t.trail.length > 400) t.trail.shift();
  t.poly.setLatLngs(t.trail);

  /* Geofence check */
  const d = haversine(state.fenceCenter[0], state.fenceCenter[1], lat, lng);
  const nowInside = d <= state.fenceRadius;
  if (!nowInside && t.inside)  { t.inside = false; log('! ' + t.name + ' LEFT geofence (' + Math.round(d) + ' m away)', 'wn'); }
  if (nowInside  && !t.inside) { t.inside = true;  log('* ' + t.name + ' re-entered geofence', 'ok'); }

  /* Accuracy chart */
  if (t.self) state.acc[t.method] = acc;
  state.fixes++;

  /* Update "my device" sidebar card if this is the user's GPS fix */
  if (id === 'self-gps') updateMyDeviceCard(lat, lng, acc);
}

function buildPopup(t) {
  return '<div class="pop-title">' + esc(t.name) + '</div>' +
    '<div class="pop-row">Method: <span>' + t.method.toUpperCase() + '</span></div>' +
    '<div class="pop-row">Lat: <span>' + t.lat.toFixed(5) + '°</span></div>' +
    '<div class="pop-row">Lon: <span>' + t.lng.toFixed(5) + '°</span></div>' +
    '<div class="pop-row">Accuracy: <span>±' + fmtDist(t.accuracy) + '</span></div>' +
    '<div class="pop-row">Travelled: <span>' + fmtDist(t.distance) + '</span></div>' +
    (t.detail ? '<div class="pop-row">Info: <span>' + esc(t.detail) + '</span></div>' : '');
}

/* ---------------------------------------------------------
   12. MY DEVICE SIDEBAR CARD
   --------------------------------------------------------- */
function updateMyDeviceCard(lat, lng, acc) {
  const badge = document.getElementById('my-status-badge');
  const latEl = document.getElementById('my-lat');
  const lonEl = document.getElementById('my-lon');
  const accEl = document.getElementById('my-acc');
  const updEl = document.getElementById('my-updated');
  if (badge) { badge.textContent = 'live'; badge.classList.add('active'); }
  if (latEl)  latEl.textContent  = lat.toFixed(6) + '°';
  if (lonEl)  lonEl.textContent  = lng.toFixed(6) + '°';
  if (accEl)  accEl.textContent  = '±' + Math.round(acc) + ' m';
  if (updEl)  updEl.textContent  = new Date().toLocaleTimeString([], { hour12: false });
}

/* ---------------------------------------------------------
   13. RENDER UI: ROWS, STATS, CHART
   --------------------------------------------------------- */
function renderRows() {
  const box = document.getElementById('rows');
  if (!box) return;
  const list = Array.from(state.targets.values());
  if (!list.length) {
    box.innerHTML = '<tr><td colspan="4" class="empty-cell">Waiting for the live stream…</td></tr>';
    return;
  }
  box.innerHTML = list.map(t =>
    '<tr>' +
      '<td><div class="t-name"><span class="dot" style="background:' + t.color + '"></span>' + esc(t.name) + '</div>' +
           '<div class="t-sub">' + t.lat.toFixed(5) + ', ' + t.lng.toFixed(5) + '</div>' +
           (!t.inside ? '<div class="t-out">outside geofence</div>' : '') + '</td>' +
      '<td><span class="t-method">' + t.method.toUpperCase() + '</span></td>' +
      '<td>±' + fmtDist(t.accuracy) + '</td>' +
      '<td>' + fmtDist(t.distance) + '</td>' +
    '</tr>'
  ).join('');
}

function renderStats() {
  const list = Array.from(state.targets.values());
  const totalDist = list.reduce((s, t) => s + t.distance, 0);
  const outside   = list.filter(t => !t.inside).length;

  const el = id => document.getElementById(id);
  if (el('statPoints'))   el('statPoints').textContent   = state.fixes;
  if (el('statDistance')) el('statDistance').textContent = fmtDist(totalDist);
  if (el('statElapsed'))  el('statElapsed').textContent  = state.startedAt ? fmtTime(Date.now() - state.startedAt) : '00:00';
  if (el('statOutside'))  el('statOutside').textContent  = outside;
  if (el('footer-dist'))  el('footer-dist').textContent  = fmtDist(totalDist);
  if (el('footer-fixes')) el('footer-fixes').textContent = state.fixes;
}

function renderChart() {
  const box = document.getElementById('chart');
  if (!box) return;
  const rows = [
    { label: 'IP address', v: state.acc.ip,   colour: COLORS.ip },
    { label: 'GPS',        v: state.acc.gps,  colour: COLORS.gps },
    { label: 'Cell tower', v: state.acc.cell, colour: COLORS.cell }
  ].filter(r => typeof r.v === 'number');

  if (!rows.length) {
    box.innerHTML = '<div style="color:var(--text-600);font-size:11px;text-align:center;padding:10px">Start a method to compare accuracy</div>';
    return;
  }
  const max = Math.max(...rows.map(r => r.v), 1);
  box.innerHTML = rows.map(r => {
    const pct = Math.max(5, (Math.log10(r.v + 1) / Math.log10(max + 1)) * 100);
    return '<div class="bar-row">' +
      '<div class="bar-lab"><span>' + r.label + '</span><span>±' + fmtDist(r.v) + '</span></div>' +
      '<div class="bar-track"><div class="bar-fill" style="width:' + pct + '%;background:' + r.colour + '"></div></div>' +
    '</div>';
  }).join('');
}

function renderAll() { renderRows(); renderStats(); renderChart(); }

/* ---------------------------------------------------------
   14. THREE TRACKING MODES
   --------------------------------------------------------- */

/* -- Mode A: IP Address -- */
async function startIP() {
  const once = async () => {
    try {
      log('? Querying /api/ip-locate…');
      /* Always go through our own endpoint.
           Local  : server.js handles it.
           Netlify: netlify/functions/ip-locate.mjs handles it.
         This keeps the call same-origin over HTTPS, avoids mixed-content
         blocking (ip-api's free tier is HTTP-only) and means the browser
         never contacts a third-party geolocation service directly. */
      const res = await fetch('/api/ip-locate', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const j = await res.json();
      if (j.error) throw new Error(j.error);
      if (j.status && j.status !== 'success') throw new Error(j.message || 'lookup failed');

      const acc = 10000;
      place('self-ip', {
        lat: j.lat, lng: j.lon || j.lng, accuracy: acc,
        name: 'This device (IP)', method: 'ip', color: COLORS.ip,
        reliable: false, self: true,
        detail: (j.city || '') + ', ' + (j.country || '')
      });
      log('IP → ' + j.city + ', ' + j.country + ' (ISP: ' + j.isp + ') ±10 km', 'ok');
      log('Note: IP geolocation is STATIC — it finds the city, not movement.', 'wn');
    } catch (e) {
      log('IP lookup failed: ' + e.message, 'er');
    }
  };
  await once();
  state.timers.ip = setInterval(once, 30000); // refresh every 30 s
}

/* -- Mode B: GPS -- */
function startGPS() {
  if (!navigator.geolocation) { log('Geolocation API not available in this browser.', 'er'); return; }
  let lastLog = 0;

  setPill('pill-gps', 'loading');
  log('Requesting GPS permission…', 'wn');

  state.watchId = navigator.geolocation.watchPosition(
    pos => {
      const c = pos.coords;
      setPill('pill-gps', 'active');
      place('self-gps', {
        lat: c.latitude, lng: c.longitude, accuracy: c.accuracy || 30,
        name: 'This device (GPS)', method: 'gps', color: COLORS.gps,
        reliable: true, self: true,
        detail: c.speed != null ? Math.round(c.speed * 3.6) + ' km/h' : ''
      });

      /* Publish to Firebase if sharing is enabled */
      if (state.sharing) publishLocation(c.latitude, c.longitude, c.accuracy || 30, 'gps');

      if (Date.now() - lastLog > 2500) {
        lastLog = Date.now();
        log('GPS ±' + Math.round(c.accuracy) + ' m at ' + c.latitude.toFixed(5) + ', ' + c.longitude.toFixed(5), 'ok');
      }
    },
    err => {
      setPill('pill-gps', 'error');
      const why = err.code === 1 ? 'permission denied'
                : err.code === 2 ? 'position unavailable'
                : 'timed out';
      log('GPS error: ' + why, 'er');
      toast('GPS ' + why + '. Try IP or Cell mode.', 'error');
      if (err.code === 1 || err.code === 2) stopTracking(true);
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
  log('Watching GPS…', 'ok');
}

/* -- Mode C: Cell Tower Simulation -- */
function startCell() {
  const tick = () => {
    const acc = CELL_ACCURACY[state.towers];
    const g = state.targets.get('self-gps');
    const i = state.targets.get('self-ip');
    let base = g ? g.raw : i ? i.raw : [map.getCenter().lat, map.getCenter().lng];
    const r = acc * Math.sqrt(Math.random()), th = Math.random() * Math.PI * 2;
    const dLat = (r * Math.cos(th)) / 111320;
    const dLng = (r * Math.sin(th)) / (111320 * Math.cos(base[0] * Math.PI / 180));
    place('self-cell', {
      lat: base[0] + dLat, lng: base[1] + dLng, accuracy: acc,
      name: 'This device (Cell)', method: 'cell', color: COLORS.cell,
      reliable: false, self: true,
      detail: state.towers + ' tower(s)'
    });
    log(state.towers + ' tower(s) → ±' + acc + ' m' + (state.towers < 3 ? ' (no triangulation)' : ''),
        state.towers < 3 ? 'wn' : 'ok');
  };
  tick();
  state.timers.cell = setInterval(tick, 3000);
}

function evaluateAll() {
  for (const t of state.targets.values()) {
    const d = haversine(state.fenceCenter[0], state.fenceCenter[1], t.lat, t.lng);
    t.inside = d <= state.fenceRadius;
  }
  renderAll();
}

/* ---------------------------------------------------------
   15. CONTROL WIRING
   --------------------------------------------------------- */
document.querySelectorAll('.method-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.method-btn').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-pressed','false'); });
    btn.classList.add('active');
    btn.setAttribute('aria-pressed', 'true');
    state.method = btn.dataset.mode;
    const words = {
      ip:   'IP address tracking — city-level, no GPS permission needed.',
      gps:  'GPS tracking — highest accuracy, needs location permission.',
      cell: 'Cell triangulation — simulated, works indoors.'
    };
    log(words[state.method]);
  });
});

document.getElementById('start').addEventListener('click', () => {
  if (!state.method) { log('Pick a tracking method first (Step 1).', 'wn'); toast('Select a tracking method first.', 'warning'); return; }
  if (!state.startedAt) state.startedAt = Date.now();
  document.getElementById('start').disabled = true;
  document.getElementById('stop').disabled  = false;
  log('>>> Tracking STARTED — method: ' + state.method.toUpperCase(), 'ok');
  toast('Tracking started (' + state.method.toUpperCase() + ')', 'success');
  if (state.method === 'ip')   startIP();
  if (state.method === 'gps')  startGPS();
  if (state.method === 'cell') startCell();
});

function stopTracking(silent) {
  Object.values(state.timers).forEach(clearInterval);
  state.timers = {};
  if (state.watchId != null) {
    navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null;
  }
  document.getElementById('start').disabled = false;
  document.getElementById('stop').disabled  = true;
  setPill('pill-gps', '');

  /* Remove from Firebase when tracking stops */
  if (state.sharing) stopSharing();

  if (!silent) {
    log('Tracking STOPPED. Fixes already drawn remain on the map.', 'wn');
    toast('Tracking stopped.', 'warning');
  }

  /* Reset device card */
  const badge = document.getElementById('my-status-badge');
  if (badge) { badge.textContent = 'offline'; badge.classList.remove('active'); }
}

document.getElementById('stop').addEventListener('click', () => stopTracking(false));

/* Tower slider */
const towersEl = document.getElementById('towers');
const TOWER_TEXT = {
  1: '1 tower = cell ID only. Accuracy ~±1.5 km.',
  2: '2 towers = bearing line. Accuracy ~±400 m.',
  3: '3+ towers = triangulation. Accuracy ~±120 m.'
};
function syncTowers() {
  state.towers = Number(towersEl.value);
  document.getElementById('towerVal').textContent = state.towers;
  document.getElementById('towerHint').textContent = TOWER_TEXT[state.towers];
}
towersEl.addEventListener('input', syncTowers);
syncTowers();

/* Fence slider */
const fenceEl = document.getElementById('fence');
function syncFence() {
  state.fenceRadius = Number(fenceEl.value);
  document.getElementById('fenceVal').textContent = state.fenceRadius;
  drawFence(); evaluateAll();
}
fenceEl.addEventListener('input', syncFence);
syncFence();

/* Coarse mode toggle */
document.getElementById('coarse').addEventListener('change', function () {
  state.coarse = this.checked;
  log(state.coarse ? 'Coarse mode ON — coordinates rounded to ~100 m.' : 'Coarse mode OFF.', 'ok');
  renderAll();
});

/* Clear data */
document.getElementById('clear').addEventListener('click', () => {
  for (const t of state.targets.values()) {
    map.removeLayer(t.marker); map.removeLayer(t.circle); map.removeLayer(t.poly);
  }
  state.targets.clear(); state.acc = {}; state.fixes = 0; fitted.clear();
  renderAll();
  log('All tracking data cleared from this browser.', 'wn');
  toast('Tracking data cleared.', 'warning');
  const badge = document.getElementById('my-status-badge');
  if (badge) { badge.textContent = 'offline'; badge.classList.remove('active'); }
});

/* Share toggle */
const shareToggle = document.getElementById('share-toggle');
shareToggle.addEventListener('change', function () {
  state.sharing = this.checked;

  if (state.sharing) {
    log('Location sharing ENABLED — this device is visible on the network map.', 'ok');
    toast('Location sharing enabled.', 'success');

    if (!REALTIME.ready) {
      log('Waiting for the location network — position publishes as soon as it connects.', 'wn');
    }
  } else {
    stopSharing();
    log('Location sharing DISABLED — this device left the network map.', 'wn');
    toast('Location sharing disabled.', 'warning');
  }
});

/* Map layer buttons */
document.getElementById('layer-osm').addEventListener('click',       () => setLayer('osm'));
document.getElementById('layer-satellite').addEventListener('click', () => setLayer('satellite'));
document.getElementById('layer-topo').addEventListener('click',      () => setLayer('topo'));

/* Map toolbar: Locate me */
document.getElementById('btn-locate').addEventListener('click', () => {
  const gps = state.targets.get('self-gps') || state.targets.get('self-ip');
  if (gps) { map.setView([gps.lat, gps.lng], 16); }
  else { toast('Start tracking first to locate your device.', 'warning'); }
});

/* Fit all */
document.getElementById('btn-fit').addEventListener('click', () => {
  const pts = Array.from(state.targets.values()).map(t => [t.lat, t.lng]);
  if (!pts.length) { toast('No markers to fit.', 'warning'); return; }
  map.fitBounds(L.latLngBounds(pts).pad(0.2));
});

/* Fullscreen */
let fsActive = false;
document.getElementById('btn-fs').addEventListener('click', () => {
  if (!fsActive) { document.documentElement.requestFullscreen?.(); fsActive = true; }
  else           { document.exitFullscreen?.(); fsActive = false; }
  setTimeout(() => map.invalidateSize(), 300);
});

/* Mobile drawers — left controls and right data are mutually exclusive */
const hamburgerBtn = document.getElementById('hamburger');
const dataPanelBtn = document.getElementById('btn-panel-right');
const leftSide     = document.getElementById('sidebar-left');
const rightSide    = document.getElementById('sidebar-right');

function setDrawer(which) {
  const openLeft  = which === 'left'  && !leftSide.classList.contains('open');
  const openRight = which === 'right' && !rightSide.classList.contains('open');

  leftSide.classList.toggle('open', openLeft);
  rightSide.classList.toggle('open', openRight);
  document.body.classList.toggle('drawer-open', openLeft || openRight);

  hamburgerBtn.setAttribute('aria-expanded', String(openLeft));
  dataPanelBtn.setAttribute('aria-expanded', String(openRight));
}

hamburgerBtn.addEventListener('click', () => setDrawer('left'));
dataPanelBtn.addEventListener('click', () => setDrawer('right'));

/* Firebase modal dismiss */
document.getElementById('modal-dismiss').addEventListener('click', () => {
  document.getElementById('firebase-modal').style.display = 'none';
});

/* "How to connect another phone" help */
const connectHelpBtn = document.getElementById('btn-connect-help');
if (connectHelpBtn) {
  connectHelpBtn.addEventListener('click', () => {
    document.getElementById('firebase-modal').style.display = 'flex';
  });
}

/* ---------------------------------------------------------
   16. SERVER-SENT EVENTS (Fleet Stream)
   Only connect when running on local server (not Netlify).
   --------------------------------------------------------- */
const isLocal = window.location.hostname === 'localhost' ||
                window.location.hostname === '127.0.0.1';

if (isLocal) {
  const stream = new EventSource('/api/stream');

  stream.addEventListener('open', () => {
    setPill('pill-stream', 'active');
    log('Connected to server — receiving live fleet data.', 'ok');
  });
  stream.addEventListener('error', () => {
    setPill('pill-stream', 'error');
    log('Fleet stream interrupted — browser will retry…', 'wn');
  });
  stream.addEventListener('fleet', ev => {
    const data = JSON.parse(ev.data);
    data.targets.forEach(p => {
      place(p.id, {
        lat: p.lat, lng: p.lng, accuracy: p.accuracy,
        name: p.name, method: p.method,
        color: p.id === 'van' ? COLORS.van : COLORS.ranger,
        reliable: true, self: false,
        detail: Math.round(p.heading) + '° / ' + p.speed + ' m/s'
      });
    });
    renderAll();
  });
} else {
  /* On Netlify: no fleet stream — show a note */
  log('Running on Netlify — fleet stream not available (requires local server).', 'wn');
  setPill('pill-stream', '');
}

/* Render loop */
setInterval(renderAll, 2000);

/* ---------------------------------------------------------
   17. REAL-TIME BACKEND — MULTI-DEVICE LOCATION SHARING
   ---------------------------------------------------------
   One interface, two interchangeable implementations:

     'api'      -> /api/devices
                   Netlify Functions + Blobs in production,
                   in-memory registry on the local Node server.
                   Works with ZERO third-party accounts.

     'firebase' -> Firebase Realtime Database, used only if
                   public/firebase-config.js contains real keys.

   The rest of the app only ever calls publishLocation(),
   stopSharing() and placeRemote(); it never needs to know
   which transport is underneath.
   --------------------------------------------------------- */
const REALTIME = {
  kind: window.FIREBASE_READY ? 'firebase' : 'api',
  ready: false,
  timer: null,
  pollMs: 3000
};

let fbApp = null, fbDb = null;

const remoteColors = {};
let remoteColorIdx = 0;
const knownRemote = new Set();

/* ---- remove one target from the map entirely ---- */
function removeTarget(id) {
  const t = state.targets.get(id);
  if (!t) return;
  map.removeLayer(t.marker);
  map.removeLayer(t.circle);
  map.removeLayer(t.poly);
  state.targets.delete(id);
}

/* ---- shared helper: device record -> map marker ---- */
function placeRemote(d) {
  if (!d || d.id === DEVICE_ID) return;

  if (!remoteColors[d.id]) {
    remoteColors[d.id] = REMOTE_COLORS[remoteColorIdx % REMOTE_COLORS.length];
    remoteColorIdx++;
  }

  place(d.id, {
    lat: d.lat, lng: d.lng,
    accuracy: d.accuracy || 30,
    name: d.label || ('Device ' + d.id),
    method: d.method || 'gps',
    color: remoteColors[d.id],
    reliable: true, self: false,
    detail: 'Remote device'
  });

  knownRemote.add(d.id);
}

/* ---- drop markers for devices that stopped sharing ---- */
function pruneRemotes(seenIds) {
  for (const id of [...knownRemote]) {
    if (!seenIds.has(id)) {
      removeTarget(id);
      knownRemote.delete(id);
    }
  }
}

/* =========== BACKEND A: /api/devices =========== */

async function probeApi() {
  try {
    const res = await fetch('/api/devices', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);

    const j = await res.json();
    REALTIME.ready = true;
    setPill('pill-firebase', 'active');
    log('Location network ready — ' + (j.devices ? j.devices.length : 0) + ' device(s) online.', 'ok');
    startPolling();
  } catch (e) {
    setPill('pill-firebase', 'error');
    log('Location network unavailable: ' + e.message, 'er');
    log('Multi-device sharing needs /api/devices — run the Node server or deploy to Netlify.', 'wn');
  }
}

function startPolling() {
  if (REALTIME.timer) clearInterval(REALTIME.timer);

  const tick = async () => {
    try {
      const res = await fetch('/api/devices', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);

      const j = await res.json();
      const list = j.devices || [];
      const seen = new Set();

      for (const d of list) {
        if (d.id === DEVICE_ID) continue;
        seen.add(d.id);
        placeRemote(d);
      }
      pruneRemotes(seen);

      updateDevicePanel(
        list.filter(d => d.id !== DEVICE_ID)
            .map(d => ({ ...d, color: remoteColors[d.id], devId: d.id }))
      );
      updateDeviceCount(seen.size);

      if (!REALTIME.ready) {
        REALTIME.ready = true;
        setPill('pill-firebase', 'active');
      }
    } catch {
      setPill('pill-firebase', 'error');
    }
  };

  tick();
  REALTIME.timer = setInterval(tick, REALTIME.pollMs);
}

/* =========== BACKEND B: Firebase (optional) =========== */

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector('script[src="' + src + '"]')) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function initFirebase() {
  if (!window.FIREBASE_READY || fbApp) return;

  try {
    await loadScript('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
    await loadScript('https://www.gstatic.com/firebasejs/9.23.0/firebase-database-compat.js');

    fbApp = firebase.initializeApp(window.FIREBASE_CONFIG);
    fbDb  = firebase.database();

    REALTIME.ready = true;
    setPill('pill-firebase', 'active');
    log('Firebase connected. Multi-device tracking is live.', 'ok');
    toast('Connected to real-time network.', 'success');

    fbDb.ref('devices').on('value', snapshot => {
      const all = snapshot.val() || {};
      const now = Date.now();
      const seen = new Set();
      const list = [];

      for (const [devId, d] of Object.entries(all)) {
        if (devId === DEVICE_ID) continue;
        if (now - (d.timestamp || 0) > 120000) continue;

        seen.add(devId);
        placeRemote({ ...d, id: devId });
        list.push({ ...d, id: devId, color: remoteColors[devId], devId });
      }

      pruneRemotes(seen);
      updateDevicePanel(list);
      updateDeviceCount(seen.size);
    });
  } catch (e) {
    setPill('pill-firebase', 'error');
    log('Firebase init failed: ' + e.message, 'er');
  }
}

/* =========== PUBLIC INTERFACE =========== */

async function publishLocation(lat, lng, acc, method) {
  if (!state.sharing) return;

  const payload = {
    id: DEVICE_ID,
    lat: lat,
    lng: lng,
    accuracy: acc,
    method: method,
    label: 'Device ' + DEVICE_ID
  };

  if (REALTIME.kind === 'firebase') {
    if (!fbDb) return;
    fbDb.ref('devices/' + DEVICE_ID)
      .set({ ...payload, timestamp: Date.now() })
      .catch(e => log('Firebase write error: ' + e.message, 'er'));
    return;
  }

  try {
    await fetch('/api/devices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch {
    /* offline — the next fix will retry */
  }
}

function stopSharing() {
  if (REALTIME.kind === 'firebase') {
    if (fbDb) fbDb.ref('devices/' + DEVICE_ID).remove().catch(() => {});
    return;
  }

  /* keepalive lets this finish even while the tab is closing */
  fetch('/api/devices?id=' + encodeURIComponent(DEVICE_ID), {
    method: 'DELETE',
    keepalive: true
  }).catch(() => {});
}

/* Leave the map when the tab closes */
window.addEventListener('beforeunload', () => {
  if (state.sharing) stopSharing();
});

/* ---------------------------------------------------------
   18. CONNECTED DEVICES PANEL
   --------------------------------------------------------- */
function updateDevicePanel(remoteList) {
  const list = document.getElementById('device-list');
  if (!list) return;

  if (!remoteList.length) {
    list.innerHTML =
      '<div class="empty-state">' +
      '<i class="fas fa-satellite"></i>' +
      '<p>No other devices sharing location.</p>' +
      '<p class="hint-text">Open this page on another phone, enable sharing and start GPS.</p>' +
      '</div>';
    return;
  }

  list.innerHTML = remoteList.map(d =>
    '<div class="device-entry" id="de-' + esc(d.devId) + '">' +
      '<span class="de-dot" style="background:' + d.color + ';color:' + d.color + '"></span>' +
      '<div class="de-info">' +
        '<div class="de-name">' + esc(d.label || ('Device ' + d.devId)) + '</div>' +
        '<div class="de-coords">' + Number(d.lat).toFixed(5) + ', ' + Number(d.lng).toFixed(5) + '</div>' +
        '<div class="de-meta">±' + Math.round(d.accuracy || 0) + ' m · ' + timeAgo(d.timestamp) + '</div>' +
      '</div>' +
      '<button class="de-locate" onclick="locateDevice(' + d.lat + ',' + d.lng + ')" title="Go to device">' +
        '<i class="fas fa-location-dot"></i>' +
      '</button>' +
    '</div>'
  ).join('');
}

function updateDeviceCount(n) {
  const el = document.getElementById('device-count');
  if (el) el.textContent = n;
}

window.locateDevice = function (lat, lng) {
  map.setView([lat, lng], 16);
};

/* ---------------------------------------------------------
   19. BOOT THE REALTIME BACKEND
   --------------------------------------------------------- */
setPill('pill-firebase', 'loading');
if (REALTIME.kind === 'firebase') {
  initFirebase();
} else {
  probeApi();
}

/* ---------------------------------------------------------
   20. WELCOME LOG
   --------------------------------------------------------- */
log('GeoTrack Pro ready.');
log('Two simulated fleet vehicles are active on the map (local mode).');
log('Select a tracking method and press Start.');
renderAll();
