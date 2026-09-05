import app from "./coverage-report-worker.js";

const RELEASE = "public-read-resilient-v3";
const CORS_MARKER = "public-get-v3";
const SCHOOL_CATALOG_CACHE_VERSION = "logo-render-v7-browser-pinned";
const DIRECT_LOGO_OVERRIDES = new Map([
  ["df-6blldr", "https://friendshipaspire.org/wp-content/uploads/2023/06/Mask-group-5.png"],
  ["aaa-ptzw9n", "https://upload.wikimedia.org/wikipedia/commons/f/f0/St._Paul_High_School_in_St._Paul%2C_Arkansas.jpg"],
  ["asu-mid-south", "https://pbs.twimg.com/profile_images/1935045051224080384/8pfQBpjq.jpg"],
  ["asu-mountain-home", "https://static.visionamp.co/rubix/20190724/orig_69bdfc3ccd60f02e75760a7b0d8f1b2ea54cf8b9.png"],
  ["asu-newport", "https://cdn.myportfolio.com/65823678412a233843d41599a6a3284e/1e06e1e2-20cb-449b-95c5-fb30fa90c545_rw_1200.png?h=589f1b4f20dec9c3741e832e5e8521f4"],
  ["cbc", "https://static.wixstatic.com/media/c13f88_4bfbbeb6499d408e86dfae8d386843fd~mv2.png/v1/fill/w_1844%2Ch_1391%2Cal_c/CBC%20MustangHeadRGB.png"],
  ["champion-christian", "https://thenccaa.org/common/controls/image_handler.aspx?image_path=%2Fimages%2F2018%2F6%2F21%2FOfficial_Tiger.png&thumb_id=0"],
  ["philander-smith", "https://media.hbcuac.org/wp-content/uploads/2024/06/Philander-Smith-Panthers-version-1.png"],
  ["shorter", "https://static.hudl.com/users/prod/20931878_73506e113f79441383faba859b82bf3a.jpg"],
  ["south-arkansas", "https://www.goeldorado.com/wp-content/uploads/2024/09/stars-basketball-two-tone26.png"],
  ["sau-tech", "https://nyc3.digitaloceanspaces.com/m1.pb365/skybox.playbook365.com/images/colleges/63a4d91a7d693-63a4d91a7da7a.png"],
  ["uark", "https://content.sportslogos.net/logos/30/606/full/arkansas_razorbacks_logo_primary_20147998.png"],
  ["ua-cossatot", "https://s3-us-west-2.amazonaws.com/scorestream-team-profile-pictures/311510/20230327203154_510_mascot720Near.png"]
]);

function applyPublicReadCors(request, response) {
  const requestedMethod = String(request.headers.get("access-control-request-method") || "").toUpperCase();
  const publicRead = request.method === "GET" || (request.method === "OPTIONS" && requestedMethod === "GET");
  if (!publicRead) return response;
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", "*");
  headers.set("x-localbleachers-api-cors", CORS_MARKER);
  headers.set("x-localbleachers-api-release", RELEASE);
  headers.delete("vary");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function rewriteSchoolCatalogLogos(request, response) {
  if (request.method !== "GET" || !response.ok || new URL(request.url).pathname !== "/api/v1/schools") return response;
  let body;
  try { body = await response.clone().json(); } catch { return response; }
  if (!Array.isArray(body?.schools)) return response;
  let changed = 0;
  body.schools = body.schools.map(school => {
    const direct = DIRECT_LOGO_OVERRIDES.get(String(school?.id || ""));
    if (!direct) return school;
    changed += 1;
    return { ...school, logo_url: direct };
  });
  if (!changed) return response;
  const headers = new Headers(response.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("x-localbleachers-logo-delivery", "direct-v3-browser-pinned");
  return new Response(JSON.stringify(body), { status: response.status, statusText: response.statusText, headers });
}

function edgeCache() {
  try { return typeof caches !== "undefined" ? caches.default : null; } catch { return null; }
}

function rounded(value, digits = 3) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits) : "na";
}

function dateBucket(value) {
  const raw = String(value || "").trim();
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : "na";
}

function descriptor(origin, basePath, freshTtl, staleTtl, legacyBasePath = basePath) {
  return {
    freshKey: new Request(`${origin}/__localbleachers_cache__/fresh${basePath}`),
    staleKey: new Request(`${origin}/__localbleachers_cache__/last-good${basePath}`),
    legacyKey: new Request(`${origin}/__localbleachers_cache__${legacyBasePath}`),
    freshTtl,
    staleTtl
  };
}

function cacheDescriptor(request) {
  if (request.method !== "GET") return null;
  if (request.headers.has("x-localbleachers-debug") || request.headers.has("x-localbleachers-diagnostic")) return null;
  const url = new URL(request.url);
  const path = url.pathname;
  const origin = url.origin;
  if (path === "/api/v1/schools") {
    const key = `/schools/${SCHOOL_CATALOG_CACHE_VERSION}`;
    return descriptor(origin, key, 5 * 60, 6 * 60 * 60, key);
  }
  if (path === "/api/v1/coverage-report") return descriptor(origin, "/coverage-report", 6 * 60 * 60, 48 * 60 * 60);
  if (path === "/api/v1/games") {
    const lat = rounded(url.searchParams.get("lat"));
    const lon = rounded(url.searchParams.get("lon"));
    const radius = rounded(url.searchParams.get("radius"), 1);
    const since = dateBucket(url.searchParams.get("since"));
    const until = dateBucket(url.searchParams.get("until"));
    const query = `lat=${lat}&lon=${lon}&radius=${radius}&since=${since}&until=${until}`;
    const legacyQuery = `lat=${lat}&lon=${lon}&radius=${radius}`;
    return descriptor(origin, `/games?${query}`, 5 * 60, 12 * 60 * 60, `/games?${legacyQuery}`);
  }
  const teamMatch = path.match(/^\/api\/v1\/teams\/[^/]+(?:\/(schedule|record))?$/);
  if (teamMatch) {
    const kind = teamMatch[1] || "team";
    const freshTtl = kind === "record" ? 5 * 60 : kind === "schedule" ? 15 * 60 : 60 * 60;
    return descriptor(origin, path, freshTtl, 24 * 60 * 60);
  }
  // The standings data route is intentionally not edge-cached. A canonical FINAL
  // can change records and ranking during the same Friday-night collection cycle.
  // Conference/sport options are static enough to keep their existing cache.
  if (path === "/api/v1/standings/options") {
    const sport = encodeURIComponent(String(url.searchParams.get("sport") || ""));
    const conference = encodeURIComponent(String(url.searchParams.get("conference") || ""));
    return descriptor(origin, `${path}?sport=${sport}&conference=${conference}`, 15 * 60, 12 * 60 * 60);
  }
  return null;
}

function cachedResponse(request, cached, { stale = false, source = null } = {}) {
  const headers = new Headers(cached.headers);
  headers.set("cache-control", "no-store");
  headers.set("x-localbleachers-cache-source", source || (stale ? "last-good" : "edge-fresh"));
  if (stale) headers.set("x-localbleachers-api-stale", "1"); else headers.delete("x-localbleachers-api-stale");
  return applyPublicReadCors(request, new Response(cached.body, { status: 200, statusText: "OK", headers }));
}

async function readCached(cache, key, request, options = {}) {
  const cached = await cache.match(key);
  return cached ? cachedResponse(request, cached, options) : null;
}

async function staleRead(cache, descriptor, request) {
  const current = await readCached(cache, descriptor.staleKey, request, { stale: true });
  if (current) return current;
  return readCached(cache, descriptor.legacyKey, request, { stale: true, source: "legacy-last-good" });
}

async function putCached(cache, key, response, ttl, source) {
  const copy = response.clone();
  const headers = new Headers(copy.headers);
  headers.set("cache-control", `public, max-age=${ttl}`);
  headers.set("x-localbleachers-cache-source", source);
  headers.delete("x-localbleachers-api-stale");
  headers.delete("set-cookie");
  headers.delete("vary");
  await cache.put(key, new Response(copy.body, { status: copy.status, statusText: copy.statusText, headers }));
}

async function rememberSuccessfulRead(cache, descriptor, response) {
  await Promise.all([
    putCached(cache, descriptor.freshKey, response, descriptor.freshTtl, "live"),
    putCached(cache, descriptor.staleKey, response, descriptor.staleTtl, "last-good")
  ]);
}

export default {
  async fetch(request, env, ctx) {
    const descriptor = cacheDescriptor(request);
    const cache = descriptor ? edgeCache() : null;
    if (descriptor && cache) {
      try {
        const fresh = await readCached(cache, descriptor.freshKey, request);
        if (fresh) return fresh;
      } catch (error) { console.warn("public fresh cache read failed", error); }
    }
    const upstream = await app.fetch(request, env, ctx);
    const rewritten = await rewriteSchoolCatalogLogos(request, upstream);
    const response = applyPublicReadCors(request, rewritten);
    if (descriptor && cache && response.ok) {
      const write = rememberSuccessfulRead(cache, descriptor, response).catch(error => console.warn("public read cache write failed", error));
      if (typeof ctx?.waitUntil === "function") ctx.waitUntil(write); else await write;
      return response;
    }
    if (descriptor && cache && response.status >= 500) {
      try {
        const stale = await staleRead(cache, descriptor, request);
        if (stale) return stale;
      } catch (error) { console.warn("public last-good cache fallback failed", error); }
    }
    return response;
  },
  async scheduled(controller, env, ctx) { return app.scheduled(controller, env, ctx); }
};

export { DIRECT_LOGO_OVERRIDES, SCHOOL_CATALOG_CACHE_VERSION, cacheDescriptor, rewriteSchoolCatalogLogos };
