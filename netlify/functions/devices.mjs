/* =========================================================
   /api/devices  —  shared real-time location registry
   ---------------------------------------------------------
   GET     /api/devices              -> every live device
   POST    /api/devices              -> upsert this device's position
   DELETE  /api/devices?id=DEVICE_ID -> stop sharing / leave the map

   Called by the browser every few seconds. Only devices that
   explicitly opted in ever reach this endpoint.
   ========================================================= */

import { db, STALE_MS } from './_store.mjs';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function reply(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...CORS,
    },
  });
}

/**
 * Never trust the client. Reject anything that is not a real
 * coordinate pair, clamp the accuracy, and whitelist the method.
 * The server stamps the time itself so a device cannot claim to
 * be fresher than it is.
 */
function sanitise(raw) {
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
    timestamp: Date.now(),
  };
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  const url = new URL(req.url);
  const store = await db();

  try {
    /* ---------------- READ ---------------- */
    if (req.method === 'GET') {
      const { blobs } = await store.list();
      const now = Date.now();
      const devices = [];

      for (const blob of blobs) {
        const d = await store.getJSON(blob.key);
        if (!d) continue;
        if (now - (d.timestamp || 0) > STALE_MS) continue;   // expired
        devices.push(d);
      }

      return reply({ devices, serverTime: now, staleAfterMs: STALE_MS });
    }

    /* ---------------- WRITE ---------------- */
    if (req.method === 'POST') {
      const body = await req.json().catch(() => null);
      const device = sanitise(body);
      if (!device) return reply({ error: 'invalid device payload' }, 400);

      await store.setJSON(device.id, device);
      return reply({ ok: true, device });
    }

    /* ---------------- LEAVE ---------------- */
    if (req.method === 'DELETE') {
      const id = String(url.searchParams.get('id') || '').trim().slice(0, 32);
      if (!id) return reply({ error: 'id query parameter is required' }, 400);

      await store.delete(id);
      return reply({ ok: true });
    }

    return reply({ error: 'method not allowed' }, 405);
  } catch (e) {
    return reply({ error: e.message || 'storage error' }, 500);
  }
}
