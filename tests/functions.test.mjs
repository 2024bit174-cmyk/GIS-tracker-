/* =========================================================
   Netlify Function tests
   ---------------------------------------------------------
   Calls the real handler with real Request objects.
   Outside a Netlify runtime the store falls back to memory,
   so this exercises the identical routing/validation logic
   that production runs.
   ========================================================= */

import handler from '../netlify/functions/devices.mjs';

let passed = 0, failed = 0;

function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}${detail ? '  ->  ' + detail : ''}`); }
}

const call = async (method, url, body) => {
  const req = new Request(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const res = await handler(req);
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json, headers: res.headers };
};

const BASE = 'https://geotrack.test/api/devices';

console.log('\n=== Netlify function: devices ===\n');

const empty = await call('GET', BASE);
check('GET returns 200', empty.status === 200);
check('starts empty', Array.isArray(empty.json.devices) && empty.json.devices.length === 0);

const post = await call('POST', BASE, {
  id: 'FN-DEV-1', lat: 0.332635, lng: 32.5686, accuracy: 11, method: 'gps', label: 'Phone A',
});
check('POST accepts valid device', post.status === 200 && post.json.ok === true);
check('timestamp is server-generated', typeof post.json.device.timestamp === 'number');

const list = await call('GET', BASE);
check('device is listed', list.json.devices.some(d => d.id === 'FN-DEV-1'));
check('staleAfterMs is advertised', typeof list.json.staleAfterMs === 'number');

const bad = await call('POST', BASE, { id: 'X', lat: 500, lng: 0 });
check('rejects impossible latitude', bad.status === 400);

const noId = await call('POST', BASE, { lat: 0.3, lng: 32.5 });
check('rejects missing id', noId.status === 400);

const evil = await call('POST', BASE, {
  id: 'EVIL', lat: 0.3, lng: 32.5, method: '<img src=x onerror=alert(1)>', label: 'x'.repeat(200),
});
check('sanitises unknown method', evil.json.device.method === 'gps');
check('truncates over-long label', evil.json.device.label.length <= 40);

const del = await call('DELETE', BASE + '?id=FN-DEV-1');
check('DELETE succeeds', del.status === 200 && del.json.ok === true);

const after = await call('GET', BASE);
check('device removed', !after.json.devices.some(d => d.id === 'FN-DEV-1'));

const noIdDel = await call('DELETE', BASE);
check('DELETE without id is rejected', noIdDel.status === 400);

const put = await call('PUT', BASE, {});
check('PUT returns 405', put.status === 405);

const opts = await handler(new Request(BASE, { method: 'OPTIONS' }));
check('OPTIONS preflight returns 204', opts.status === 204);

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
