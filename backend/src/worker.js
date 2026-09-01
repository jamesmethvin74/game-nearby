import core from "./index.js";
import { syncDragonFlyVarsityVolleyballCatalog } from "./dragonfly-discovery.js";
import { runDragonFlyStatewideCollection } from "./dragonfly-statewide.js";
import { syncArkansasSchoolLocations } from "./arkansas-school-locations.js";
import { ensureStatewideSchema } from "./schema-bootstrap.js";
import { applySchoolDisplayNames, dedupeScheduleRows } from "./schedule-response-normalizer.js";
import { enrichMaxPrepsSchoolMascots, getSchoolBrandingReport, syncMaxPrepsSchoolBranding } from "./school-branding.js";

function defer(ctx, promise) {
  if (typeof ctx?.waitUntil === "function") ctx.waitUntil(promise);
  else promise.catch(error => console.error("background task failed", error));
}

async function displayNamesForGames(env, games, extraSchoolIds = []) {
  const ids = new Set(extraSchoolIds.filter(Boolean));
  for (const game of games || []) {
    for (const id of [game.school_id, game.canonical_home_school_id, game.canonical_away_school_id]) if (id) ids.add(id);
  }
  if (!ids.size) return new Map();
  const { results } = await env.DB.prepare(`
    SELECT id, COALESCE(NULLIF(location_matched_name,''),name) AS display_name
    FROM schools WHERE id IN (SELECT value FROM json_each(?))
  `).bind(JSON.stringify([...ids])).all();
  return new Map(results.map(row => [row.id, row.display_name]));
}

async function normalizePublicGames(env, games, { reportingSchoolId = null } = {}) {
  const displayNames = await displayNamesForGames(env, games, reportingSchoolId ? [reportingSchoolId] : []);
  const cleaned = games.map(game => applySchoolDisplayNames(game, displayNames, { reportingSchoolId }));
  return dedupeScheduleRows(cleaned, { reportingSchoolId });
}

async function publicCatalogResponse(request,response,env){
  if (request.method!=="GET" || !response.ok) return response;
  const path=new URL(request.url).pathname;
  const body=await response.json();

  if (path==="/api/v1/schools" && Array.isArray(body.schools)) {
    body.schools=body.schools.filter(school=>school.catalog_scope==="local" && Number(school.team_count||0)>0);
  } else if (path==="/api/v1/games" && Array.isArray(body.games)) {
    const {results}=await env.DB.prepare(`
      SELECT DISTINCT t.school_id
      FROM teams t JOIN schools s ON s.id=t.school_id
      WHERE t.active=1 AND s.catalog_scope='local'`).all();
    const activeSchools=new Set(results.map(row=>row.school_id));
    const visibleGames=body.games.filter(game=>activeSchools.has(game.school_id));
    body.games=await normalizePublicGames(env,visibleGames);
  } else {
    const teamMatch=path.match(/^\/api\/v1\/teams\/([^/]+)(?:\/(?:schedule|record))?$/);
    if (teamMatch) {
      const teamId=decodeURIComponent(teamMatch[1]);
      const visible=await env.DB.prepare(`
        SELECT t.school_id FROM teams t JOIN schools s ON s.id=t.school_id
        WHERE t.id=? AND t.active=1 AND s.catalog_scope='local'`).bind(teamId).first();
      if (!visible) return new Response(JSON.stringify({error:"team_not_found"}),{status:404,headers:response.headers});
      if (path.endsWith("/schedule") && Array.isArray(body.games)) {
        body.games=await normalizePublicGames(env,body.games,{reportingSchoolId:visible.school_id});
      }
    }
  }
  return new Response(JSON.stringify(body),{status:response.status,headers:response.headers});
}

function publicJson(request,body,status=200){
  const origin=request.headers.get("origin");
  const allowed=!origin || origin==="https://jamesmethvin74.github.io" || origin.startsWith("http://localhost:") ? (origin||"*") : "null";
  return new Response(JSON.stringify(body),{status,headers:{
    "content-type":"application/json; charset=utf-8",
    "cache-control":"no-store",
    "access-control-allow-origin":allowed,
    "vary":"Origin"
  }});
}

export default {
  async fetch(request, env, ctx) {
    const path=new URL(request.url).pathname;

    if (request.method==="GET" && path==="/api/v1/branding/report") {
      try {
        await syncMaxPrepsSchoolBranding(env);
        defer(ctx,enrichMaxPrepsSchoolMascots(env,{limit:12}).catch(error=>console.error("school mascot enrichment failed",error)));
        return publicJson(request,await getSchoolBrandingReport(env));
      } catch (error) {
        return publicJson(request,{error:"branding_report_failed",message:String(error?.message||error)},500);
      }
    }

    const response=await core.fetch(request, env, ctx);
    return publicCatalogResponse(request,response,env);
  },
  async scheduled(controller, env, ctx) {
    await ensureStatewideSchema(env);
    let catalogPayload=null;
    try {
      const catalog=await syncDragonFlyVarsityVolleyballCatalog(env);
      catalogPayload=catalog.payload||null;
      const {payload,...summary}=catalog;
      console.log("statewide volleyball catalog",summary);
    } catch (error) {
      console.error("statewide volleyball catalog sync failed",error);
    }

    try {
      const locations=await syncArkansasSchoolLocations(env);
      console.log("statewide volleyball locations",{
        status:locations.status,
        targetSchools:locations.targetSchools,
        matchedSchools:locations.matchedSchools,
        unresolvedSchools:locations.unresolvedSchools,
        ambiguousSchools:locations.ambiguousSchools,
        matchRatio:locations.matchRatio
      });
    } catch (error) {
      console.error("statewide volleyball location sync failed",error);
    }

    try {
      const branding=await syncMaxPrepsSchoolBranding(env);
      const mascots=await enrichMaxPrepsSchoolMascots(env,{limit:20});
      console.log("statewide school branding",{branding,mascots});
    } catch (error) {
      console.error("statewide school branding sync failed",error);
    }

    try {
      const statewide=await runDragonFlyStatewideCollection(env,{payload:catalogPayload});
      console.log("statewide volleyball collection",statewide);
    } catch (error) {
      console.error("statewide volleyball collection failed",error);
    } finally {
      await env.DB.prepare("UPDATE sources SET enabled=0 WHERE collection_mode='statewide'").run();
    }

    return core.scheduled(controller, env, ctx);
  }
};
