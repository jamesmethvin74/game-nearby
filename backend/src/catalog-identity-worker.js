import app from "./worker.js";
import { isSchoolCatalogVisible } from "./high-school-catalog-identity.js";

const EXCLUDED_COLLEGE_SCHOOL_IDS = new Set(["asu-three-rivers"]);

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

async function applyVerifiedBrandAssets(env, schools = []) {
  const ids = [...new Set(schools.map(school => clean(school?.id)).filter(Boolean))];
  if (!env?.DB) return schools.filter(isPublicCatalogSchool);

  // The inner public catalog historically removes schools with team_count=0.
  // That is correct for discovered high-school rows, but it hides reviewed colleges
  // whose LocalBleachers-supported sport inventory is currently zero. Recover those
  // colleges here in the same set-based identity/logo lookup that already overlays
  // verified brand assets. This avoids a second D1 query and never scans sports data.
  const { results = [] } = await env.DB.prepare(`
    SELECT
      s.id,s.name,s.city,s.state,s.level,s.mascot,s.logo_url,
      s.latitude,s.longitude,s.location_matched_name,s.catalog_scope,
      b.logo_url AS brand_logo_url,
      b.mascot AS brand_mascot,
      b.status AS brand_status
    FROM schools s
    LEFT JOIN school_brand_assets b
      ON b.school_id=s.id
     AND b.status IN ('matched','curated')
     AND NULLIF(TRIM(b.logo_url),'') IS NOT NULL
    WHERE s.id IN (SELECT value FROM json_each(?))
       OR (s.catalog_scope='local' AND s.level='college' AND s.id <> 'asu-three-rivers')
    ORDER BY COALESCE(NULLIF(s.location_matched_name,''),s.name),s.id
  `).bind(JSON.stringify(ids)).all();

  const existingById = new Map(schools.map(school => [clean(school?.id), school]));
  const merged = [];
  const seen = new Set();

  for (const row of results) {
    const id = clean(row.id);
    if (!id || seen.has(id)) continue;
    const existing = existingById.get(id);
    const school = existing || {
      id,
      name: row.name,
      city: row.city,
      state: row.state,
      level: row.level,
      mascot: row.mascot,
      logo_url: row.logo_url,
      latitude: row.latitude,
      longitude: row.longitude,
      location_matched_name: row.location_matched_name,
      catalog_scope: row.catalog_scope,
      team_count: 0
    };
    if (!isPublicCatalogSchool(school)) continue;

    merged.push({
      ...school,
      logo_url: clean(row.brand_logo_url) || clean(row.logo_url) || school.logo_url || null,
      mascot: clean(row.brand_mascot) || clean(row.mascot) || school.mascot || null
    });
    seen.add(id);
  }

  // Fail open for already-approved API rows if a transient D1 lookup ever omits one.
  for (const school of schools) {
    const id = clean(school?.id);
    if (!id || seen.has(id) || !isPublicCatalogSchool(school)) continue;
    merged.push(school);
    seen.add(id);
  }

  return merged.sort((a, b) => clean(a.location_matched_name || a.name).localeCompare(clean(b.location_matched_name || b.name)) || clean(a.id).localeCompare(clean(b.id)));
}

async function applyCatalogIdentityPolicy(request, response, env) {
  if (request.method !== "GET" || !response.ok) return response;
  const path = new URL(request.url).pathname;
  if (path !== "/api/v1/schools" && path !== "/api/v1/games") return response;

  const body = await response.json();
  if (path === "/api/v1/schools" && Array.isArray(body.schools)) {
    const visible = body.schools.filter(isPublicCatalogSchool);
    body.schools = await applyVerifiedBrandAssets(env, visible);
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
    return applyCatalogIdentityPolicy(request, await app.fetch(request, env, ctx), env);
  },
  async scheduled(controller, env, ctx) {
    return app.scheduled(controller, env, ctx);
  }
};

export { EXCLUDED_COLLEGE_SCHOOL_IDS, applyCatalogIdentityPolicy, applyVerifiedBrandAssets, isPublicCatalogSchool, visibleSchoolFromGame };
