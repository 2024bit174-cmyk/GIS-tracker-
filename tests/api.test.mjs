/* =========================================================
   API integration tests
   ---------------------------------------------------------
   Spawns the real server on an isolated port and exercises the
   /api/devices contract end to end. No mocks of our own code.

   Run:  npm test
   ========================================================= */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8799;
const BASE = `http://127.0.0.1:${PORT}`;

let passed = 0;
let failed = 0;

function check(name, condition, detail = '') {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? '  ->  ' + detail : ''}`);
  }
}

async function json(url, options) {
  const res = await fetch(url, options);
  let body = null;
  try { body = await res.json(); } catch { /* not json */ }
  return { status: res.status, body };
}

const wait = ms => new Promise(r => setTimeout(r, ms));

async function waitForServer(tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(BASE + '/api/devices');
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await wait(250);
  }
  return false;
}

const server = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: 'ignore',
});

let exitCode = 0;

try {
  console.log('\n=== GeoTrack API tests ===\n');

  const up = await waitForServer();
  check('server starts and responds', up);
  if (!up) throw new Error('server did not start');

  /* ---------- static hosting ---------- */
  const index = await fetch(BASE + '/');
  check('GET / returns 200', index.status === 200, `got ${index.status}`);
  const html = await index.text();
  check('index.html contains the app shell', html.includes('GeoTrack'), 'marker text missing');

  const missing = await fetch(BASE + '/definitely-not-here.js');
  check('missing file returns 404', missing.status === 404, `got ${missing.status}`);

  /* ---------- empty registry ---------- */
  const empty = await json(BASE + '/api/devices');
  check('GET /api/devices starts empty', empty.status === 200 && Array.isArray(empty.body.devices) && empty.body.devices.length === 0,
    JSON.stringify(empty.body));

  /* ---------- publish a device ---------- */
  const dev = { id: 'TEST-DEV-1', lat: 0.332635, lng: 32.5686, accuracy: 12, method: 'gps', label: 'Phone A' };
  const posted = await json(BASE + '/api/devices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(dev),
  });
  check('POST /api/devices accepts a valid device', posted.status === 200 && posted.body.ok === true,
    JSON.stringify(posted.body));
  check('server stamps its own timestamp', typeof posted.body.device?.timestamp === 'number',
    'timestamp missing or not a number');

  /* ---------- device is visible ---------- */
  const afterPost = await json(BASE + '/api/devices');
  const found = afterPost.body.devices.find(d => d.id === 'TEST-DEV-1');
  check('device appears in GET /api/devices', !!found);
  check('coordinates round-trip correctly',
    found && Math.abs(found.lat - 0.332635) < 1e-9 && Math.abs(found.lng - 32.5686) < 1e-9,
    JSON.stringify(found));

  /* ---------- a second device ---------- */
  await json(BASE + '/api/devices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'TEST-DEV-2', lat: -1.29, lng: 36.82, accuracy: 8, method: 'gps', label: 'Phone B' }),
  });
  const two = await json(BASE + '/api/devices');
  check('two devices are tracked independently', two.body.devices.length === 2,
    `got ${two.body.devices.length}`);

  /* ---------- upsert, not duplicate ---------- */
  await json(BASE + '/api/devices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'TEST-DEV-1', lat: 0.34, lng: 32.58, accuracy: 9, method: 'gps', label: 'Phone A' }),
  });
  const afterUpdate = await json(BASE + '/api/devices');
  check('re-posting the same id updates instead of duplicating', afterUpdate.body.devices.length === 2,
    `got ${afterUpdate.body.devices.length}`);
  const moved = afterUpdate.body.devices.find(d => d.id === 'TEST-DEV-1');
  check('updated position is stored', moved && Math.abs(moved.lat - 0.34) < 1e-9, JSON.stringify(moved));

  /* ---------- validation ---------- */
  const badLat = await json(BASE + '/api/devices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'BAD', lat: 999, lng: 32, accuracy: 5, method: 'gps' }),
  });
  check('out-of-range latitude is rejected', badLat.status === 400, `got ${badLat.status}`);

  const noId = await json(BASE + '/api/devices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lat: 0.3, lng: 32.5 }),
  });
  check('missing id is rejected', noId.status === 400, `got ${noId.status}`);

  const garbage = await json(BASE + '/api/devices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'not-json-at-all',
  });
  check('malformed JSON is rejected', garbage.status === 400, `got ${garbage.status}`);

  const nan = await json(BASE + '/api/devices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'NAN', lat: 'abc', lng: 32 }),
  });
  check('non-numeric coordinates are rejected', nan.status === 400, `got ${nan.status}`);

  /* ---------- method whitelist ---------- */
  const weird = await json(BASE + '/api/devices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'WHITELIST', lat: 0.3, lng: 32.5, method: '<script>alert(1)</script>' }),
  });
  check('unknown method is normalised, not stored raw',
    weird.status === 200 && weird.body.device.method === 'gps',
    JSON.stringify(weird.body.device));

  /* ---------- leave ---------- */
  const del = await json(BASE + '/api/devices?id=TEST-DEV-1', { method: 'DELETE' });
  check('DELETE removes a device', del.status === 200 && del.body.ok === true, JSON.stringify(del.body));

  const afterDelete = await json(BASE + '/api/devices');
  check('deleted device is gone', !afterDelete.body.devices.some(d => d.id === 'TEST-DEV-1'));

  const delNoId = await json(BASE + '/api/devices', { method: 'DELETE' });
  check('DELETE without id is rejected', delNoId.status === 400, `got ${delNoId.status}`);

  /* ---------- method guard ---------- */
  const put = await json(BASE + '/api/devices', { method: 'PUT', body: '{}' });
  check('unsupported HTTP method returns 405', put.status === 405, `got ${put.status}`);

  /* ---------- IP geolocation proxy ---------- */
  const ip = await json(BASE + '/api/ip-locate');
  check('GET /api/ip-locate returns JSON', ip.status === 200 && typeof ip.body === 'object',
    `got ${ip.status}`);
  if (ip.body && ip.body.error) {
    console.log('        (network unavailable: ' + ip.body.error + ' — endpoint itself responded correctly)');
    check('ip-locate handled upstream failure gracefully', ip.status === 200 || ip.status === 503);
  } else {
    check('ip-locate returns coordinates',
      typeof ip.body.lat === 'number' && typeof ip.body.lon === 'number',
      JSON.stringify(ip.body).slice(0, 120));
  }

  /* ---------- SSE stream still alive ---------- */
  const controller = new AbortController();
  const streamRes = await fetch(BASE + '/api/stream', { signal: controller.signal }).catch(() => null);
  check('GET /api/stream opens an event stream',
    streamRes && streamRes.headers.get('content-type')?.includes('text/event-stream'),
    streamRes ? streamRes.headers.get('content-type') : 'no response');
  controller.abort();

} catch (e) {
  console.log('\n  FATAL: ' + e.message);
  failed++;
  exitCode = 1;
} finally {
  server.kill();
  await wait(300);
}

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : exitCode);
