import app from "./worker.js";
import { isSchoolCatalogVisible } from "./high-school-catalog-identity.js";

const EXCLUDED_COLLEGE_SCHOOL_IDS = new Set(["asu-three-rivers"]);
const PERSISTENT_LOGO_RELAY_SCHOOL_IDS = new Set([
  "df-6blldr",
  "aaa-ptzw9n",
  "asu-mid-south",
  "asu-mountain-home",
  "asu-newport",
  "cbc",
  "champion-christian",
  "philander-smith",
  "shorter",
  "south-arkansas",
  "sau-tech",
  "uark",
  "ua-cossatot"
]);
const LOGO_RELAY_PREFIX = "/api/v1/logo-relay/";
const LOGO_RELAY_MAX_BYTES = 5 * 1024 * 1024;
const LOGO_IMAGE_CACHE_ORIGIN = "https://images.weserv.nl/";
const encoder = new TextEncoder();

function rewrittenJson(response, body) {
  const headers = new Headers(response.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function clean(value) {
  return String(value ?? "").trim();
}

function isPublicCatalogSchool(school = {}) {
  if (EXCLUDED_COLLEGE_SCHOOL_IDS.has(clean(school.id))) return false;
  return isSchoolCatalogVisible(school);
}

function visibleSchoolFromGame(game = {}) {
  return isPublicCatalogSchool({
    id: game.school_id,
    name: game.school_name,
    level: game.level
  });
}

function logoRelaySecret(env) {
  return clean(env?.LOGO_RELAY_SECRET || env?.REFRESH_TOKEN);
}

function validHttpsUrl(value) {
  try {
    const url = new URL(clean(value));
    return url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function resilientLogoSourceUrl(sourceUrl) {
  const source = validHttpsUrl(sourceUrl);
  if (!source) return null;
  if (source.origin === new URL(LOGO_IMAGE_CACHE_ORIGIN).origin) return source.toString();
  const proxy = new URL(LOGO_IMAGE_CACHE_ORIGIN);
  proxy.searchParams.set("url", source.toString());
  proxy.searchParams.set("w", "512");
  proxy.searchParams.set("h", "512");
  proxy.searchParams.set("fit", "contain");
  proxy.searchParams.set("we", "1");
  proxy.searchParams.set("output", "png");
  proxy.searchParams.set("n", "-1");
  return proxy.toString();
}

function bytesToHex(bytes) {
  return [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function signLogoRelay(secret, schoolId, sourceUrl) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${schoolId}\n${sourceUrl}`)
  );
  return bytesToHex(new Uint8Array(signature)).slice(0, 32);
}

function constantTimeEqual(left, right) {
  const a = clean(left);
  const b = clean(right);
  if (a.length !== b.length || !a.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

async function logoRelayUrl(request, env, schoolId, sourceUrl) {
  if (!PERSISTENT_LOGO_RELAY_SCHOOL_IDS.has(clean(schoolId))) return null;
  const source = validHttpsUrl(sourceUrl);
  const secret = logoRelaySecret(env);
  if (!source || !secret) return null;
  const normalizedSource = source.toString();
  const signature = await signLogoRelay(secret, clean(schoolId), normalizedSource);
  const url = new URL(request.url);
  url.pathname = `${LOGO_RELAY_PREFIX}${encodeURIComponent(clean(schoolId))}`;
  url.search = "";
  url.searchParams.set("src", normalizedSource);
  url.searchParams.set("sig", signature);
  return url.toString();
}

async function applyLogoRelays(request, env, schools = []) {
  return Promise.all(schools.map(async school => {
    const originalSourceUrl = clean(school.logo_url);
    if (!originalSourceUrl || !PERSISTENT_LOGO_RELAY_SCHOOL_IDS.has(clean(school.id))) return school;
    const sourceUrl = resilientLogoSourceUrl(originalSourceUrl) || originalSourceUrl;
    const relayUrl = await logoRelayUrl(request, env, school.id, sourceUrl);
    return relayUrl ? { ...school, logo_url: relayUrl } : school;
  }));
}

function relayCache() {
  try {
    return typeof caches !== "undefined" ? caches.default : null;
  } catch {
    return null;
  }
}

function sniffImageContentType(buffer, sourceUrl, suppliedType) {
  const supplied = clean(suppliedType).toLowerCase().split(";", 1)[0];
  if (supplied.startsWith("image/")) return supplied;
  const bytes = new Uint8Array(buffer);
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 6) {
    const gif = String.fromCharCode(...bytes.slice(0, 6));
    if (gif === "GIF87a" || gif === "GIF89a") return "image/gif";
  }
  if (bytes.length >= 12) {
    const riff = String.fromCharCode(...bytes.slice(0, 4));
    const webp = String.fromCharCode(...bytes.slice(8, 12));
    if (riff === "RIFF" && webp === "WEBP") return "image/webp";
  }
  const sample = new TextDecoder().decode(bytes.slice(0, Math.min(bytes.length, 1024))).trimStart();
  if (/^(?:<\?xml[^>]*>\s*)?<svg\b/i.test(sample)) return "image/svg+xml";
  const pathname = validHttpsUrl(sourceUrl)?.pathname.toLowerCase() || "";
  if (supplied === "application/octet-stream") {
    if (pathname.endsWith(".png")) return "image/png";
    if (/\.jpe?g$/.test(pathname)) return "image/jpeg";
    if (pathname.endsWith(".gif")) return "image/gif";
    if (pathname.endsWith(".webp")) return "image/webp";
    if (pathname.endsWith(".svg")) return "image/svg+xml";
  }
  return null;
}

function relayImageResponse(buffer, contentType) {
  return new Response(buffer, {
    status: 200,
    headers: {
      "content-type": contentType,
      "cache-control": "public, max-age=2592000, stale-while-revalidate=2592000",
      "access-control-allow-origin": "*",
      "x-content-type-options": "nosniff",
      "x-localbleachers-logo-relay": "1"
    }
  });
}

async function handleLogoRelay(request, env, ctx, fetchFn = fetch) {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const url = new URL(request.url);
  if (!url.pathname.startsWith(LOGO_RELAY_PREFIX)) return null;
  const schoolId = decodeURIComponent(url.pathname.slice(LOGO_RELAY_PREFIX.length));
  const source = validHttpsUrl(url.searchParams.get("src"));
  const suppliedSignature = clean(url.searchParams.get("sig"));
  const secret = logoRelaySecret(env);
  if (!PERSISTENT_LOGO_RELAY_SCHOOL_IDS.has(schoolId) || !source || !secret || !suppliedSignature) {
    return new Response("Not found", { status: 404 });
  }
  const normalizedSource = source.toString();
  const expectedSignature = await signLogoRelay(secret, schoolId, normalizedSource);
  if (!constantTimeEqual(expectedSignature, suppliedSignature)) return new Response("Not found", { status: 404 });

  const cache = relayCache();
  const cacheKey = new Request(url.toString(), { method: "GET" });
  if (cache) {
    try {
      const cached = await cache.match(cacheKey);
      if (cached) return request.method === "HEAD" ? new Response(null, { status: 200, headers: cached.headers }) : cached;
    } catch (error) {
      console.warn("logo relay cache read failed", error);
    }
  }

  let upstream;
  try {
    upstream = await fetchFn(normalizedSource, {
      method: "GET",
      redirect: "follow",
      headers: {
        accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        referer: `${source.origin}/`,
        "user-agent": "Mozilla/5.0 (compatible; LocalBleachersAR/1.0; +https://github.com/jamesmethvin74/game-nearby)"
      }
    });
  } catch (error) {
    console.warn("logo relay upstream fetch failed", schoolId, error);
    return new Response("Logo unavailable", { status: 502 });
  }
  if (!upstream.ok) return new Response("Logo unavailable", { status: 502 });
  const finalUrl = validHttpsUrl(upstream.url || normalizedSource);
  if (!finalUrl) return new Response("Logo unavailable", { status: 502 });
  const declaredLength = Number(upstream.headers.get("content-length") || 0);
  if (declaredLength > LOGO_RELAY_MAX_BYTES) return new Response("Logo too large", { status: 502 });
  const buffer = await upstream.arrayBuffer();
  if (!buffer.byteLength || buffer.byteLength > LOGO_RELAY_MAX_BYTES) return new Response("Logo unavailable", { status: 502 });
  const contentType = sniffImageContentType(buffer, finalUrl.toString(), upstream.headers.get("content-type"));
  if (!contentType) return new Response("Logo unavailable", { status: 502 });
  const response = relayImageResponse(buffer, contentType);
  if (cache) {
    const write = cache.put(cacheKey, response.clone()).catch(error => console.warn("logo relay cache write failed", error));
    if (typeof ctx?.waitUntil === "function") ctx.waitUntil(write);
    else await write;
  }
  return request.method === "HEAD" ? new Response(null, { status: 200, headers: response.headers }) : response;
}

async function applyVerifiedBrandAssets(env, schools = []) {
  const ids = schools.map(school => clean(school?.id)).filter(Boolean);
  if (!ids.length || !env?.DB) return schools;

  const { results = [] } = await env.DB.prepare(`
    SELECT school_id,logo_url,mascot,status
    FROM school_brand_assets
    WHERE school_id IN (SELECT value FROM json_each(?))
      AND status IN ('matched','curated')
      AND NULLIF(TRIM(logo_url),'') IS NOT NULL
  `).bind(JSON.stringify(ids)).all();
  const assets = new Map(results.map(row => [row.school_id, row]));

  return schools.map(school => {
    const asset = assets.get(school.id);
    if (!asset) return school;
    const brandLogo = clean(asset.logo_url);
    return {
      ...school,
      logo_url: brandLogo || school.logo_url || null,
      mascot: clean(asset.mascot) || school.mascot || null
    };
  });
}

async function applyCatalogIdentityPolicy(request, response, env) {
  if (request.method !== "GET" || !response.ok) return response;
  const path = new URL(request.url).pathname;
  if (path !== "/api/v1/schools" && path !== "/api/v1/games") return response;

  const body = await response.json();
  if (path === "/api/v1/schools" && Array.isArray(body.schools)) {
    const visible = body.schools.filter(isPublicCatalogSchool);
    const branded = await applyVerifiedBrandAssets(env, visible);
    body.schools = await applyLogoRelays(request, env, branded);
    return rewrittenJson(response, body);
  }
  if (path === "/api/v1/games" && Array.isArray(body.games)) {
    body.games = body.games.filter(visibleSchoolFromGame);
    return rewrittenJson(response, body);
  }
  return rewrittenJson(response, body);
}

export default {
  async fetch(request, env, ctx) {
    const relay = await handleLogoRelay(request, env, ctx);
    if (relay) return relay;
    return applyCatalogIdentityPolicy(request, await app.fetch(request, env, ctx), env);
  },
  async scheduled(controller, env, ctx) {
    return app.scheduled(controller, env, ctx);
  }
};

export {
  EXCLUDED_COLLEGE_SCHOOL_IDS,
  LOGO_IMAGE_CACHE_ORIGIN,
  LOGO_RELAY_PREFIX,
  PERSISTENT_LOGO_RELAY_SCHOOL_IDS,
  applyCatalogIdentityPolicy,
  applyLogoRelays,
  applyVerifiedBrandAssets,
  constantTimeEqual,
  handleLogoRelay,
  isPublicCatalogSchool,
  logoRelayUrl,
  resilientLogoSourceUrl,
  signLogoRelay,
  sniffImageContentType,
  visibleSchoolFromGame
};
