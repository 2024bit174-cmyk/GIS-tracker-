/* =====================================================================
   GeoTrack  --  real-time location tracking server
   Pure Node.js. No npm packages required.
   ===================================================================== */

// --- 1. Built-in modules we need -------------------------------------
const http = require('node:http');   // build the web server
const fs   = require('node:fs');     // read files off the disk
const path = require('node:path');   // build file paths safely

// --- 2. Configuration -------------------------------------------------
const PORT = Number(process.env.PORT) || 8790;        // http://localhost:8790
const PUBLIC_DIR = path.join(__dirname, 'public');   // folder served to browser

// What each file type should be called over HTTP
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css' : 'text/css; charset=utf-8',
  '.js'  : 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png' : 'image/png',
  '.svg' : 'image/svg+xml',
  '.ico' : 'image/x-icon'
};

/* =====================================================================
   PART A -- IP GEOLOCATION  (the "laptop tracked by IP address" feature)
   The browser cannot look up its own public IP position on its own, so
   the SERVER asks a free geolocation service and hands the answer back.
   ===================================================================== */

let ipCache = { at: 0, data: null };   // remember the answer for 60 s

function ipLocate(callback) {
  // Already have a fresh answer?  Use it instead of asking again.
  if (Date.now() - ipCache.at < 60000 && ipCache.data) {
    return callback(null, ipCache.data);
  }

  const url = 'http://ip-api.com/json/?fields=status,message,country,regionName,city,lat,lon,isp,org,query,as';

  const req = http.get(url, (res) => {
    let body = '';
    res.on('data',  chunk => body += chunk);   // gather the reply piece by piece
    res.on('end',   () => {
      try {
        const j = JSON.parse(body);
        if (j.status !== 'success') return callback(new Error(j.message || 'lookup failed'));
        ipCache = { at: Date.now(), data: j };  // remember it
        callback(null, j);
      } catch (e) { callback(e); }
    });
  });

  req.on('error',   callback);                  // no internet, bad DNS, etc.
  req.setTimeout(8000, () => req.destroy(new Error('IP lookup timed out')));
}

/* =====================================================================
   PART B -- SIMULATED FLEET
   A laptop sitting on a desk cannot move, so the SERVER drives two
   objects along real street routes and PUSHES their positions to every
   open browser once a second.  This is the "real-time" half of the app.
   ===================================================================== */

const fleet = [
  {
    id: 'van', name: 'Delivery Van', method: 'gps', accuracy: 6, speed: 9,   // 9 m/s ~ 32 km/h
    route: [ [0.3326,32.5686], [0.3400,32.5760], [0.3455,32.5870],
             [0.3375,32.5960], [0.3285,32.5895], [0.3245,32.5775] ],
    seg: 0, f: 0, lat: 0.3326, lng: 32.5686, heading: 0
  },
  {
    id: 'ranger', name: 'Field Officer', method: 'cell', accuracy: 45, speed: 1.6, // walking
    route: [ [0.3300,32.5640], [0.3345,32.5700], [0.3330,32.5760], [0.3280,32.5735] ],
    seg: 0, f: 0, lat: 0.3300, lng: 32.5640, heading: 0
  }
];

// Great-circle distance in METRES between two lat/lng points
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Compass direction in degrees (0 = north, 90 = east)
function bearing(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180;
  const y = Math.sin((lon2 - lon1) * rad) * Math.cos(lat2 * rad);
  const x = Math.cos(lat1 * rad) * Math.sin(lat2 * rad) -
            Math.sin(lat1 * rad) * Math.cos(lat2 * rad) * Math.cos((lon2 - lon1) * rad);
  return (Math.atan2(y, x) / rad + 360) % 360;
}

// Slide a target forward along its route by `speed * dt` metres
function advance(t, dt) {
  let budget = t.speed * dt;
  let guard  = 0;

  while (budget > 0 && guard++ < 1000) {
    const from = t.route[t.seg];
    const to   = t.route[(t.seg + 1) % t.route.length];
    const len  = haversine(from[0], from[1], to[0], to[1]);
    if (len <= 0) { t.seg = (t.seg + 1) % t.route.length; continue; }

    const remaining = len * (1 - t.f);
    if (budget < remaining) { t.f += budget / len; budget = 0; }
    else { budget -= remaining; t.f = 0; t.seg = (t.seg + 1) % t.route.length; }
  }

  const from = t.route[t.seg];
  const to   = t.route[(t.seg + 1) % t.route.length];
  t.lat = from[0] + (to[0] - from[0]) * t.f;
  t.lng = from[1] + (to[1] - from[1]) * t.f;
  t.heading = bearing(from[0], from[1], to[0], to[1]);
}

function fleetSnapshot() {
  return fleet.map(t => ({
    id: t.id, name: t.name, lat: t.lat, lng: t.lng,
    heading: t.heading, accuracy: t.accuracy, method: t.method,
    speed: t.speed
  }));
}

/* =====================================================================
   PART C -- SERVER-SENT EVENTS  (the live push channel)
   Each open browser keeps one connection open.  Every tick we write a
   small text message down that connection; the browser reacts instantly.
   ===================================================================== */

const clients = new Set();

function broadcast() {
  const payload = `event: fleet\ndata: ${JSON.stringify({ t: Date.now(), targets: fleetSnapshot() })}\n\n`;
  for (const res of clients) res.write(payload);
}

let lastTick = Date.now();

setInterval(() => {
  const now = Date.now();
  const dt  = (now - lastTick) / 1000;   // seconds since last tick
  lastTick  = now;
  for (const t of fleet) advance(t, dt);
  if (clients.size) broadcast();
}, 1000);

function openStream(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  res.write('retry: 3000\n\n');                       // browser retries after 3 s
  res.write(`event: fleet\ndata: ${JSON.stringify({ t: Date.now(), targets: fleetSnapshot() })}\n\n`);
  clients.add(res);
  req.on('close', () => clients.delete(res));         // clean up when tab closes
}

/* =====================================================================
   PART D -- STATIC FILES  (the front-end)
   ===================================================================== */

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';

  const filePath = path.join(PUBLIC_DIR, urlPath);

  // SECURITY: refuse anything that tries to climb out of the public folder
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); return res.end('Forbidden');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end('404 Not Found'); }
    const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    res.end(data);
  });
}

/* =====================================================================
   PART D2 -- SHARED DEVICE REGISTRY
   The local mirror of netlify/functions/devices.mjs, so the browser
   talks to exactly the same /api/devices contract in both places.
   ===================================================================== */

const devices = new Map();
const DEVICE_STALE_MS = 2 * 60 * 1000;   // 2 minutes

function sendJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(body));
}

// Read the request body with a hard size cap so one client cannot
// exhaust memory by sending a giant payload.
function readBody(req, limit, cb) {
  let body = '', tooBig = false;
  req.on('data', chunk => {
    if (tooBig) return;
    body += chunk;
    if (body.length > limit) tooBig = true;
  });
  req.on('end', () => cb(tooBig ? new Error('payload too large') : null, body));
}

function sanitiseDevice(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const lat = Number(raw.lat);
  const lng = Number(raw.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  const id = String(raw.id || '').trim().slice(0, 32);
  if (!id) return null;

  return {
    id,
    lat: Number(lat.toFixed(6)),
    lng: Number(lng.toFixed(6)),
    accuracy: Math.max(0, Math.min(100000, Number(raw.accuracy) || 0)),
    method: ['ip', 'gps', 'cell'].includes(raw.method) ? raw.method : 'gps',
    label: String(raw.label || '').slice(0, 40),
    timestamp: Date.now()          // server-stamped, never client-supplied
  };
}

function handleDevices(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  if (req.method === 'GET') {
    const now = Date.now();
    const live = [];
    for (const [id, d] of devices) {
      if (now - d.timestamp > DEVICE_STALE_MS) { devices.delete(id); continue; }
      live.push(d);
    }
    return sendJson(res, 200, { devices: live, serverTime: now, staleAfterMs: DEVICE_STALE_MS });
  }

  if (req.method === 'POST') {
    return readBody(req, 4096, (err, body) => {
      if (err) return sendJson(res, 413, { error: err.message });
      let parsed = null;
      try { parsed = JSON.parse(body); } catch { /* handled below */ }
      const device = sanitiseDevice(parsed);
      if (!device) return sendJson(res, 400, { error: 'invalid device payload' });
      devices.set(device.id, device);
      sendJson(res, 200, { ok: true, device });
    });
  }

  if (req.method === 'DELETE') {
    const id = (new URL(req.url, 'http://localhost').searchParams.get('id') || '').trim().slice(0, 32);
    if (!id) return sendJson(res, 400, { error: 'id query parameter is required' });
    devices.delete(id);
    return sendJson(res, 200, { ok: true });
  }

  sendJson(res, 405, { error: 'method not allowed' });
}

/* =====================================================================
   PART E -- ROUTER
   ===================================================================== */

const server = http.createServer((req, res) => {
  const route = req.url.split('?')[0];

  if (route === '/api/devices') { handleDevices(req, res); return; }

  if (route === '/api/ip-locate') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    ipLocate((err, data) => res.end(JSON.stringify(err ? { error: err.message } : data)));
    return;
  }

  if (route === '/api/stream') { openStream(req, res); return; }

  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log('----------------------------------------------------');
  console.log('  GeoTrack server is running');
  console.log('  Open in your browser:  http://localhost:' + PORT);
  console.log('  Fleet objects on duty: ' + fleet.map(f => f.name).join(', '));
  console.log('----------------------------------------------------');
});
