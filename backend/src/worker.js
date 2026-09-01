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

function haversineMiles(lat1,lon1,lat2,lon2){
  if (![lat1,lon1,lat2,lon2].every(Number.isFinite)) return null;
  const r=3958.7613;
  const toRad=value=>value*Math.PI/180;
  const dLat=toRad(lat2-lat1), dLon=toRad(lon2-lon1);
  const a=Math.sin(dLat/2)**2+Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return 2*r*Math.asin(Math.sqrt(a));
}

function resolveNearbyGame(row){
  const latitude=row.canonical_latitude ?? row.latitude;
  const longitude=row.canonical_longitude ?? row.longitude;
  if (!row.canonical_event_id) return {
    ...row,
    latitude,
    longitude,
    data_trust:row.data_trust||"SINGLE_SOURCE_LIVE",
    conflict_count:Number(row.conflict_count||0)
  };

  const isHome=row.canonical_home_school_id===row.school_id;
  const isAway=row.canonical_away_school_id===row.school_id;
  const teamScore=isHome?row.canonical_home_score:isAway?row.canonical_away_score:row.team_score;
  const opponentScore=isHome?row.canonical_away_score:isAway?row.canonical_home_score:row.opponent_score;
  const status=row.canonical_status||row.status;
  const result=status==="FINAL" && teamScore!=null && opponentScore!=null
    ? (Number(teamScore)===Number(opponentScore)?"T":Number(teamScore)>Number(opponentScore)?"W":"L")
    : null;

  return {
    ...row,
    id:row.canonical_event_id,
    canonical_event_id:row.canonical_event_id,
    opponent:isHome?row.canonical_away_name:isAway?row.canonical_home_name:row.opponent,
    scheduled_at:row.canonical_scheduled_at||row.scheduled_at,
    scheduled_time_known:row.canonical_time_known??row.scheduled_time_known,
    venue:row.canonical_venue||row.venue,
    latitude,
    longitude,
    home_away:isHome?"home":isAway?"away":row.home_away,
    conference_game:row.canonical_conference_game??row.conference_game,
    status,
    team_score:teamScore,
    opponent_score:opponentScore,
    result,
    data_trust:row.data_trust||"SINGLE_SOURCE_LIVE",
    conflict_count:Number(row.conflict_count||0)
  };
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

async function listNearbyGamesBounded(request,env,url){
  const lat=Number(url.searchParams.get("lat"));
  const lon=Number(url.searchParams.get("lon"));
  const radius=Math.max(1,Number(url.searchParams.get("radius")||25));
  const since=url.searchParams.get("since")||new Date(Date.now()-6*60*60*1000).toISOString();
  const until=url.searchParams.get("until")||new Date(Date.now()+30*24*60*60*1000).toISOString();
  const hasGeo=[lat,lon,radius].every(Number.isFinite);

  let geoSql="";
  const binds=[since,until,since,until];
  if (hasGeo) {
    const latDelta=radius/69;
    const lonScale=Math.max(0.2,Math.cos(lat*Math.PI/180));
    const lonDelta=radius/(69*lonScale);
    geoSql=`
      AND COALESCE(ce.latitude,g.latitude) BETWEEN ? AND ?
      AND COALESCE(ce.longitude,g.longitude) BETWEEN ? AND ?`;
    binds.push(lat-latDelta,lat+latDelta,lon-lonDelta,lon+lonDelta);
  }

  const {results}=await env.DB.prepare(`
    SELECT g.*,t.sport,t.gender,t.season,t.conference_id,
      sch.id AS school_id,sch.name AS school_name,sch.level,sch.mascot,
      c.name AS conference_name,
      r.wins,r.losses,r.ties,r.conference_wins,r.conference_losses,r.conference_ties,r.calculated_at,
      st.rank,
      src.source_type,src.parser_type,src.authority_rank,src.source_priority,
      src.last_successful_fetch_at AS source_last_successful_fetch_at,
      ce.scheduled_at AS canonical_scheduled_at,ce.scheduled_time_known AS canonical_time_known,
      ce.venue AS canonical_venue,ce.latitude AS canonical_latitude,ce.longitude AS canonical_longitude,
      ce.conference_game AS canonical_conference_game,
      ce.status AS canonical_status,ce.home_score AS canonical_home_score,ce.away_score AS canonical_away_score,
      ce.home_school_id AS canonical_home_school_id,ce.away_school_id AS canonical_away_school_id,
      ce.trust_state AS data_trust,ce.conflict_count,
      hs.name AS canonical_home_name,aws.name AS canonical_away_name
    FROM games g
    JOIN teams t ON t.id=g.team_id AND t.active=1
    JOIN schools sch ON sch.id=t.school_id AND sch.catalog_scope='local'
    JOIN sources src ON src.id=g.source_id
    LEFT JOIN conferences c ON c.id=t.conference_id
    LEFT JOIN team_records r ON r.team_id=t.id
    LEFT JOIN standings st ON st.team_id=t.id AND st.conference_id=t.conference_id
    LEFT JOIN canonical_events ce ON ce.id=g.canonical_event_id
    LEFT JOIN schools hs ON hs.id=ce.home_school_id
    LEFT JOIN schools aws ON aws.id=ce.away_school_id
    WHERE ((ce.id IS NOT NULL AND ce.scheduled_at BETWEEN ? AND ?)
       OR (ce.id IS NULL AND g.scheduled_at BETWEEN ? AND ?))
      ${geoSql}
    ORDER BY COALESCE(ce.scheduled_at,g.scheduled_at),
      COALESCE(g.canonical_event_id,g.id),src.authority_rank,src.source_priority,src.id
  `).bind(...binds).all();

  const chosen=[];
  const seen=new Set();
  for (const raw of results) {
    const key=raw.canonical_event_id||raw.id;
    if (seen.has(key)) continue;
    seen.add(key);
    const game=resolveNearbyGame(raw);
    if (hasGeo) {
      const distance=haversineMiles(lat,lon,Number(game.latitude),Number(game.longitude));
      if (distance==null || distance>radius) continue;
      game.distance_miles=distance;
    }
    chosen.push(game);
  }

  return {games:await normalizePublicGames(env,chosen)};
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
    const url=new URL(request.url);
    const path=url.pathname;

    if (request.method==="GET" && path==="/api/v1/branding/report") {
      try {
        await syncMaxPrepsSchoolBranding(env);
        defer(ctx,enrichMaxPrepsSchoolMascots(env,{limit:12}).catch(error=>console.error("school mascot enrichment failed",error)));
        return publicJson(request,await getSchoolBrandingReport(env));
      } catch (error) {
        return publicJson(request,{error:"branding_report_failed",message:String(error?.message||error)},500);
      }
    }

    if (request.method==="GET" && path==="/api/v1/games") {
      try {
        return publicJson(request,await listNearbyGamesBounded(request,env,url));
      } catch (error) {
        console.error("bounded nearby games query failed",error);
        return publicJson(request,{error:"nearby_games_failed"},500);
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
