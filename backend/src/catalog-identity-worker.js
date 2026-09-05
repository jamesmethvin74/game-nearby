import app from "./worker.js";
import { isSchoolCatalogVisible } from "./high-school-catalog-identity.js";

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

function visibleSchoolFromGame(game = {}) {
  return isSchoolCatalogVisible({
    id: game.school_id,
    name: game.school_name,
    level: game.level
  });
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
    const visible = body.schools.filter(isSchoolCatalogVisible);
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

export { applyCatalogIdentityPolicy, applyVerifiedBrandAssets, visibleSchoolFromGame };
