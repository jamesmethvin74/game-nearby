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
const PERSISTENT_LOGO_FETCH_OVERRIDES = new Map([
  ["df-6blldr", "https://content.energage.com/company-images/74999/logo.png"],
  ["aaa-ptzw9n", "https://upload.wikimedia.org/wikipedia/commons/f/f0/St._Paul_High_School_in_St._Paul%2C_Arkansas.jpg"],
  ["asu-mid-south", "https://pbs.twimg.com/profile_images/1935045051224080384/8pfQBpjq.jpg"],
  ["asu-mountain-home", "https://static.visionamp.co/rubix/20190724/two-color-trailblazer-mascot-67253.png"],
  ["asu-newport", "https://cdn.myportfolio.com/65823678412a233843d41599a6a3284e/1e06e1e2-20cb-449b-95c5-fb30fa90c545_rw_1200.png?h=589f1b4f20dec9c3741e832e5e8521f4"],
  ["cbc", "https://static.wixstatic.com/media/c13f88_4bfbbeb6499d408e86dfae8d386843fd~mv2.png/v1/fill/w_1844%2Ch_1391%2Cal_c/CBC%20MustangHeadRGB.png"],
  ["champion-christian", "https://www.mascotdb.com/sites/default/files/logos/champion_0.png"],
  ["philander-smith", "https://media.hbcuac.org/wp-content/uploads/2024/06/Philander-Smith-Panthers-version-1.png"],
  ["shorter", "https://static.hudl.com/users/prod/20931878_73506e113f79441383faba859b82bf3a.jpg"],
  ["south-arkansas", "https://cmsv2-assets.apptegy.net/uploads/23722/file/3435779/76f7a4f1-df62-40f1-a758-343783110b51.png"],
  ["sau-tech", "https://lirp.cdn-website.com/98cd28ae/dms3rep/multi/opt/rocket-logo-1a-1920w.png"],
  ["uark", "https://content.sportslogos.net/logos/30/606/full/arkansas_razorbacks_logo_primary_20147998.png"],
  ["ua-cossatot", "https://s3-us-west-2.amazonaws.com/scorestream-team-profile-pictures/311510/20230327203154_510_mascot720Near.png"]
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
    const sourceUrl = clean(school.logo_url);
    if (!sourceUrl || !PERSISTENT_LOGO_RELAY_SCHOOL_IDS.has(clean(school.id))) return school;
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
      "cache-control": "public, max-age=86400, stale-while-revalidate=604800",
      "access-control-allow-origin": "*",
      "x-content-type-options": "nosniff",
      "x-localbleachers-logo-relay": "1"
    }
  });
}

function uniqueLogoFetchCandidates(schoolId, originalSource) {
  const override = validHttpsUrl(PERSISTENT_LOGO_FETCH_OVERRIDES.get(schoolId))?.toString() || null;
  const candidates = [override, originalSource];
  for (const source of [override, originalSource]) {
    const proxy = source ? resilientLogoSourceUrl(source) : null;
    if (proxy) candidates.push(proxy);
  }
  return [...new Set(candidates.filter(Boolean))];
}

async function fetchRelayImage(fetchFn, candidate) {
  const source = validHttpsUrl(candidate);
  if (!source) return null;
  try {
    const upstream = await fetchFn(source.toString(), {
      method: "GET",
      redirect: "follow",
      headers: {
        accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        referer: `${source.origin}/`,
        "user-agent": "Mozilla/5.0 (compatible; LocalBleachersAR/1.0; +https://github.com/jamesmethvin74/game-nearby)"
      }
    });
    if (!upstream.ok) return null;
    const finalUrl = validHttpsUrl(upstream.url || source.toString());
    if (!finalUrl) return null;
    const declaredLength = Number(upstream.headers.get("content-length") || 0);
    if (declaredLength > LOGO_RELAY_MAX_BYTES) return null;
    const buffer = await upstream.arrayBuffer();
    if (!buffer.byteLength || buffer.byteLength > LOGO_RELAY_MAX_BYTES) return null;
    const contentType = sniffImageContentType(buffer, finalUrl.toString(), upstream.headers.get("content-type"));
    return contentType ? { buffer, contentType } : null;
  } catch {
    return null;
  }
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

  let image = null;
  for (const candidate of uniqueLogoFetchCandidates(schoolId, normalizedSource)) {
    image = await fetchRelayImage(fetchFn, candidate);
    if (image) break;
  }
  if (!image) return new Response("Logo unavailable", { status: 502 });
  const response = relayImageResponse(image.buffer, image.contentType);
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
  PERSISTENT_LOGO_FETCH_OVERRIDES,
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
