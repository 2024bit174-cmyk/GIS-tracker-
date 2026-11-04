/* =========================================================
   Shared device store
   ---------------------------------------------------------
   Production (Netlify): Netlify Blobs — a serverless key/value
   store that needs no account, no API key and no third party.

   Everywhere else (local `node server.js`, `netlify dev`, tests):
   an in-process Map, so the exact same function code can be
   exercised without a cloud connection.
   ========================================================= */

import { getStore } from '@netlify/blobs';

/** A device that has not reported for this long is considered gone. */
export const STALE_MS = 2 * 60 * 1000;   // 2 minutes

/* ---------- in-memory fallback ---------- */
const memory = new Map();

function memoryBackend() {
  return {
    kind: 'memory',
    async list() {
      return { blobs: [...memory.keys()].map(key => ({ key })) };
    },
    async getJSON(key) {
      return memory.has(key) ? memory.get(key) : null;
    },
    async setJSON(key, value) {
      memory.set(key, value);
    },
    async delete(key) {
      memory.delete(key);
    },
  };
}

/* ---------- thin adapter over @netlify/blobs ---------- */
function blobsBackend(store) {
  return {
    kind: 'blobs',
    async list() {
      return store.list();
    },
    async getJSON(key) {
      return store.get(key, { type: 'json' });
    },
    async setJSON(key, value) {
      await store.setJSON(key, value);
    },
    async delete(key) {
      await store.delete(key);
    },
  };
}

let backend = null;

/**
 * Resolve the storage backend once per cold start.
 * `strong` consistency guarantees a device that just posted its
 * position is immediately visible to every other polling device.
 */
export async function db() {
  if (backend) return backend;

  try {
    const store = getStore({ name: 'geotrack-devices', consistency: 'strong' });
    await store.list();          // probe: throws outside a Netlify runtime
    backend = blobsBackend(store);
  } catch {
    backend = memoryBackend();
  }

  return backend;
}
