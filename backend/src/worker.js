import core from "./index.js";
import { syncDragonFlyVarsityVolleyballCatalog } from "./dragonfly-discovery.js";
import { runDragonFlyStatewideCollection } from "./dragonfly-statewide.js";
import { syncArkansasSchoolLocations } from "./arkansas-school-locations.js";
import { ensureStatewideSchema } from "./schema-bootstrap.js";
import { ensureInitialStatewideData } from "./statewide-initializer.js";
import { applySchoolDisplayNames, dedupeScheduleRows } from "./schedule-response-normalizer.js";
import { rebuildStatewideRecords } from "./record-rebuild.js";
import { enrichMaxPrepsSchoolMascots, getSchoolBrandingReport, syncMaxPrepsSchoolBranding } from "./school-branding.js";

let liveConfigReady = false;

async function ensureLiveConfig(env) {
  if (liveConfigReady) return;

  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO schools(id,name,city,state,level,mascot,latitude,longitude,updated_at)
      VALUES('greenbrier','Greenbrier High School','Greenbrier','AR','high-school','Panthers',35.2334,-92.3870,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,city=excluded.city,state=excluded.state,level=excluded.level,mascot=excluded.mascot,latitude=excluded.latitude,longitude=excluded.longitude,updated_at=excluded.updated_at
    `).bind(now),
    env.DB.prepare(`
      INSERT INTO schools(id,name,city,state,level,mascot,latitude,longitude,updated_at)
      VALUES('vilonia','Vilonia High School','Vilonia','AR','high-school','Eagles',35.0839,-92.2029,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,city=excluded.city,state=excluded.state,level=excluded.level,mascot=excluded.mascot,latitude=excluded.latitude,longitude=excluded.longitude,updated_at=excluded.updated_at
    `).bind(now),
    env.DB.prepare(`
      INSERT INTO conferences(id,name,classification,standings_method,coverage_complete,source_url,updated_at)
      VALUES('6a-central-volleyball','6A Central','6A Volleyball','calculated',0,'https://www.ahsaa.org/volleyball',?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,classification=excluded.classification,source_url=excluded.source_url,updated_at=excluded.updated_at
    `).bind(now),
    env.DB.prepare(`
      INSERT INTO conferences(id,name,classification,standings_method,coverage_complete,source_url,updated_at)
      VALUES('5a-central-volleyball','5A Central','5A Volleyball','calculated',0,'https://www.ahsaa.org/volleyball',?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,classification=excluded.classification,source_url=excluded.source_url,updated_at=excluded.updated_at
    `).bind(now),
    env.DB.prepare(`
      INSERT INTO teams(id,school_id,sport,gender,season,conference_id,active,updated_at)
      VALUES('uca-volleyball-2026','uca','volleyball','women','2026','uac',1,?)
      ON CONFLICT(id) DO UPDATE SET conference_id='uac',active=1,updated_at=excluded.updated_at
    `).bind(now),
    env.DB.prepare(`
      INSERT INTO teams(id,school_id,sport,gender,season,conference_id,active,updated_at)
      VALUES('conway-volleyball-2026','conway','volleyball','girls','2026','6a-central-volleyball',1,?)
      ON CONFLICT(id) DO UPDATE SET conference_id='6a-central-volleyball',active=1,updated_at=excluded.updated_at
    `).bind(now),
    env.DB.prepare(`
      INSERT INTO teams(id,school_id,sport,gender,season,conference_id,active,updated_at)
      VALUES('greenbrier-volleyball-2026','greenbrier','volleyball','girls','2026','5a-central-volleyball',1,?)
      ON CONFLICT(id) DO UPDATE SET conference_id='5a-central-volleyball',active=1,updated_at=excluded.updated_at
    `).bind(now),
    env.DB.prepare(`
      INSERT INTO teams(id,school_id,sport,gender,season,conference_id,active,updated_at)
      VALUES('vilonia-volleyball-2026','vilonia','volleyball','girls','2026','5a-central-volleyball',1,?)
      ON CONFLICT(id) DO UPDATE SET conference_id='5a-central-volleyball',active=1,updated_at=excluded.updated_at
    `).bind(now),
    env.DB.prepare(`
      INSERT INTO sources(id,team_id,source_url,source_type,source_priority,parser_type,parser_version,timezone,expected_min_games,refresh_minutes,active_result_minutes,home_venue,home_latitude,home_longitude,enabled,updated_at)
      VALUES('uca-volleyball-official','uca-volleyball-2026','https://ucasports.com/sports/womens-volleyball/schedule/2026','official-athletics',1,'sidearm','1','America/Chicago',20,360,60,'Prince Center',35.0817,-92.4576,1,?)
      ON CONFLICT(id) DO UPDATE SET team_id=excluded.team_id,source_url=excluded.source_url,source_type=excluded.source_type,source_priority=excluded.source_priority,parser_type=excluded.parser_type,parser_version=excluded.parser_version,timezone=excluded.timezone,expected_min_games=excluded.expected_min_games,refresh_minutes=excluded.refresh_minutes,active_result_minutes=excluded.active_result_minutes,home_venue=excluded.home_venue,home_latitude=excluded.home_latitude,home_longitude=excluded.home_longitude,enabled=1,updated_at=excluded.updated_at
    `).bind(now),
    env.DB.prepare(`
      INSERT INTO sources(id,team_id,source_url,source_type,source_priority,parser_type,parser_version,timezone,expected_min_games,refresh_minutes,active_result_minutes,home_venue,home_latitude,home_longitude,enabled,updated_at)
      VALUES('conway-volleyball-official','conway-volleyball-2026','https://www.conwaywampuscats.com/sport/volleyball/girls/?tab=schedule','official-school',1,'mascot-media','1','America/Chicago',8,360,60,'Buzz Bolding Arena',35.0887,-92.4421,1,?)
      ON CONFLICT(id) DO UPDATE SET team_id=excluded.team_id,source_url=excluded.source_url,source_type=excluded.source_type,source_priority=excluded.source_priority,parser_type=excluded.parser_type,parser_version=excluded.parser_version,timezone=excluded.timezone,expected_min_games=excluded.expected_min_games,refresh_minutes=excluded.refresh_minutes,active_result_minutes=excluded.active_result_minutes,home_venue=excluded.home_venue,home_latitude=excluded.home_latitude,home_longitude=excluded.home_longitude,enabled=1,updated_at=excluded.updated_at
    `).bind(now),
    env.DB.prepare(`
      INSERT INTO sources(id,team_id,source_url,source_type,source_priority,parser_type,parser_version,timezone,expected_min_games,refresh_minutes,active_result_minutes,home_venue,home_latitude,home_longitude,enabled,updated_at)
      VALUES('greenbrier-volleyball-official','greenbrier-volleyball-2026','https://www.greenbrierathletics.com/sport/volleyball/girls/?tab=schedule','official-school',1,'mascot-media','1','America/Chicago',15,180,60,'Greenbrier High School',35.2334,-92.3870,1,?)
      ON CONFLICT(id) DO UPDATE SET team_id=excluded.team_id,source_url=excluded.source_url,source_type=excluded.source_type,source_priority=excluded.source_priority,parser_type=excluded.parser_type,parser_version=excluded.parser_version,timezone=excluded.timezone,expected_min_games=excluded.expected_min_games,refresh_minutes=excluded.refresh_minutes,active_result_minutes=excluded.active_result_minutes,home_venue=excluded.home_venue,home_latitude=excluded.home_latitude,home_longitude=excluded.home_longitude,enabled=1,updated_at=excluded.updated_at
    `).bind(now),
    env.DB.prepare(`
      INSERT INTO sources(id,team_id,source_url,source_type,source_priority,parser_type,parser_version,timezone,expected_min_games,refresh_minutes,active_result_minutes,home_venue,home_latitude,home_longitude,enabled,updated_at)
      VALUES('vilonia-volleyball-official','vilonia-volleyball-2026','https://www.viloniaathletics.com/sport/volleyball/girls/?tab=schedule','official-school',1,'mascot-media','1','America/Chicago',15,180,60,'Vilonia High School',35.0839,-92.2029,1,?)
      ON CONFLICT(id) DO UPDATE SET team_id=excluded.team_id,source_url=excluded.source_url,source_type=excluded.source_type,source_priority=excluded.source_priority,parser_type=excluded.parser_type,parser_version=excluded.parser_version,timezone=excluded.timezone,expected_min_games=excluded.expected_min_games,refresh_minutes=excluded.refresh_minutes,active_result_minutes=excluded.active_result_minutes,home_venue=excluded.home_venue,home_latitude=excluded.home_latitude,home_longitude=excluded.home_longitude,enabled=1,updated_at=excluded.updated_at
    `).bind(now)
  ]);

  await rebuildStatewideRecords(env,now);
  liveConfigReady = true;
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
    await ensureStatewideSchema(env);
    await ensureLiveConfig(env);
    const path=new URL(request.url).pathname;

    if (request.method==="GET" && path==="/api/v1/branding/report") {
      try {
        await syncMaxPrepsSchoolBranding(env);
        ctx.waitUntil(enrichMaxPrepsSchoolMascots(env,{limit:12}).catch(error=>console.error("school mascot enrichment failed",error)));
        return publicJson(request,await getSchoolBrandingReport(env));
      } catch (error) {
        return publicJson(request,{error:"branding_report_failed",message:String(error?.message||error)},500);
      }
    }

    if (request.method==="GET" && (path==="/api/v1/schools" || path==="/api/v1/games")) {
      try {
        await ensureInitialStatewideData(env);
        ctx.waitUntil(enrichMaxPrepsSchoolMascots(env,{limit:12}).catch(error=>console.error("school mascot enrichment failed",error)));
      } catch (error) {
        console.error("statewide volleyball initial production bootstrap failed",error);
      }
    }
    const response=await core.fetch(request, env, ctx);
    return publicCatalogResponse(request,response,env);
  },
  async scheduled(controller, env, ctx) {
    await ensureStatewideSchema(env);
    await ensureLiveConfig(env);
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