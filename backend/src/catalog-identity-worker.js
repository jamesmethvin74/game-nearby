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

function visibleSchoolFromGame(game = {}) {
  return isSchoolCatalogVisible({
    id: game.school_id,
    name: game.school_name,
    level: game.level
  });
}

async function applyCatalogIdentityPolicy(request, response) {
  if (request.method !== "GET" || !response.ok) return response;
  const path = new URL(request.url).pathname;
  if (path !== "/api/v1/schools" && path !== "/api/v1/games") return response;

  const body = await response.json();
  if (path === "/api/v1/schools" && Array.isArray(body.schools)) {
    body.schools = body.schools.filter(isSchoolCatalogVisible);
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
    return applyCatalogIdentityPolicy(request, await app.fetch(request, env, ctx));
  },
  async scheduled(controller, env, ctx) {
    return app.scheduled(controller, env, ctx);
  }
};

export { applyCatalogIdentityPolicy, visibleSchoolFromGame };
