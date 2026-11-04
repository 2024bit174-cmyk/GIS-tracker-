/* =========================================================
   /api/ip-locate  —  server-side IP geolocation proxy
   ---------------------------------------------------------
   WHY THIS EXISTS
   ip-api.com's free tier is HTTP only. A page served from
   Netlify is HTTPS, so a direct browser call to
   http://ip-api.com would be blocked as mixed content.
   Calling it from the server (which may use HTTP freely)
   removes that problem and also hides the visitor's IP from
   any third party the browser would otherwise contact.

   Falls back to ipwho.is (HTTPS) if ip-api is unreachable.
   ========================================================= */

const FIELDS = 'status,message,country,regionName,city,lat,lon,isp,org,query';

function reply(body, status = 200, cache = 'public, max-age=60') {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': cache,
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function normaliseIpApi(j) {
  return {
    status: 'success',
    country: j.country,
    regionName: j.regionName,
    city: j.city,
    lat: j.lat,
    lon: j.lon,
    isp: j.isp,
    org: j.org,
    query: j.query,
  };
}

function normaliseIpWhoIs(j) {
  return {
    status: 'success',
    country: j.country,
    regionName: j.region,
    city: j.city,
    lat: j.latitude,
    lon: j.longitude,
    isp: j.connection && j.connection.isp,
    org: j.connection && j.connection.org,
    query: j.ip,
  };
}

export default async function handler() {
  /* ---- primary: ip-api.com (HTTP, server side) ---- */
  try {
    const res = await fetch('http://ip-api.com/json/?' + new URLSearchParams({ fields: FIELDS }), {
      signal: AbortSignal.timeout(8000),
    });
    const j = await res.json();
    if (j.status === 'success') return reply(normaliseIpApi(j));
  } catch {
    /* fall through to the backup provider */
  }

  /* ---- backup: ipwho.is (HTTPS) ---- */
  try {
    const res = await fetch('https://ipwho.is/', { signal: AbortSignal.timeout(8000) });
    const j = await res.json();
    if (j.success) return reply(normaliseIpWhoIs(j));
  } catch {
    /* fall through to the error reply */
  }

  return reply({ error: 'IP geolocation service unavailable' }, 503, 'no-store');
}
