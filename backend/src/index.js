import { normalizeMascotRows, normalizeSidearmRows } from "./parser-core.js";

const API_PREFIX="/api/v1";
const USER_AGENT="LocalBleachersAR/1.0 (+https://github.com/jamesmethvin74/game-nearby)";

export default {
  async fetch(request, env, ctx) {
    try { return await route(request,env,ctx); }
    catch (error) {
      console.error("request failed", error);
      return json({error:"internal_error",message:"LocalBleachersAR sports API request failed."},500,request,env);
    }
  },
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runDueCollections(env,{reason:`cron:${controller.cron}`}));
  }
};

async function route(request,env,ctx){
  const url=new URL(request.url);
  if (request.method==="OPTIONS") return corsPreflight(request,env);
  if (request.method==="GET" && url.pathname===`${API_PREFIX}/health`) return health(request,env);
  if (request.method==="GET" && url.pathname===`${API_PREFIX}/schools`) return listSchools(request,env);
  if (request.method==="GET" && url.pathname===`${API_PREFIX}/games`) return listNearbyGames(request,env,url);
  if (request.method==="GET" && url.pathname===`${API_PREFIX}/sources`) return listSourceFreshness(request,env);

  let match=url.pathname.match(new RegExp(`^${API_PREFIX}/teams/([^/]+)$`));
  if (request.method==="GET" && match) return getTeam(request,env,decodeURIComponent(match[1]));
  match=url.pathname.match(new RegExp(`^${API_PREFIX}/teams/([^/]+)/schedule$`));
  if (request.method==="GET" && match) return getTeamSchedule(request,env,decodeURIComponent(match[1]));
  match=url.pathname.match(new RegExp(`^${API_PREFIX}/teams/([^/]+)/record$`));
  if (request.method==="GET" && match) return getTeamRecord(request,env,decodeURIComponent(match[1]));
  match=url.pathname.match(new RegExp(`^${API_PREFIX}/conferences/([^/]+)/standings$`));
  if (request.method==="GET" && match) return getStandings(request,env,decodeURIComponent(match[1]));

  if (request.method==="POST" && url.pathname===`${API_PREFIX}/refresh`) {
    if (!env.REFRESH_TOKEN || request.headers.get("x-refresh-token")!==env.REFRESH_TOKEN) return json({error:"not_found"},404,request,env);
    const body=await request.json().catch(()=>({}));
    const result=await runDueCollections(env,{force:true,sourceId:body?.sourceId||null,reason:"manual"});
    return json(result,200,request,env);
  }
  return json({error:"not_found"},404,request,env);
}

async function health(request,env){
  const row=await env.DB.prepare("SELECT COUNT(*) AS teams, (SELECT COUNT(*) FROM games) AS games, (SELECT MAX(last_successful_fetch_at) FROM sources) AS last_refresh FROM teams").first();
  return json({ok:true,service:"localbleachersar-sports-api",...row},200,request,env);
}

async function listSchools(request,env){
  const {results}=await env.DB.prepare(`
    SELECT s.*, COUNT(t.id) AS team_count
    FROM schools s LEFT JOIN teams t ON t.school_id=s.id AND t.active=1
    GROUP BY s.id ORDER BY s.name`).all();
  return json({schools:results},200,request,env);
}

async function getTeam(request,env,teamId){
  const team=await env.DB.prepare(`
    SELECT t.*, s.name AS school_name,s.city,s.state,s.level,s.mascot,s.logo_url,s.latitude AS school_latitude,s.longitude AS school_longitude,
      c.name AS conference_name,c.classification,c.standings_method,
      src.source_url,src.last_successful_fetch_at,src.last_checked_at
    FROM teams t JOIN schools s ON s.id=t.school_id
    LEFT JOIN conferences c ON c.id=t.conference_id
    LEFT JOIN sources src ON src.team_id=t.id AND src.source_priority=1
    WHERE t.id=?`).bind(teamId).first();
  if (!team) return json({error:"team_not_found"},404,request,env);
  const record=await env.DB.prepare("SELECT * FROM team_records WHERE team_id=?").bind(teamId).first();
  return json({team,record:record||emptyRecord(teamId)},200,request,env);
}

async function getTeamSchedule(request,env,teamId){
  const team=await env.DB.prepare("SELECT id FROM teams WHERE id=?").bind(teamId).first();
  if (!team) return json({error:"team_not_found"},404,request,env);
  const {results}=await env.DB.prepare(`
    SELECT g.*, s.source_type, s.last_successful_fetch_at AS source_last_successful_fetch_at
    FROM games g JOIN sources s ON s.id=g.source_id
    WHERE g.team_id=? ORDER BY g.scheduled_at`).bind(teamId).all();
  return json({teamId,games:results},200,request,env);
}

async function getTeamRecord(request,env,teamId){
  const row=await env.DB.prepare(`
    SELECT r.*, t.conference_id, c.name AS conference_name
    FROM teams t LEFT JOIN team_records r ON r.team_id=t.id LEFT JOIN conferences c ON c.id=t.conference_id
    WHERE t.id=?`).bind(teamId).first();
  if (!row) return json({error:"team_not_found"},404,request,env);
  return json({record:{...emptyRecord(teamId),...row}},200,request,env);
}

async function getStandings(request,env,conferenceId){
  const conference=await env.DB.prepare("SELECT * FROM conferences WHERE id=?").bind(conferenceId).first();
  if (!conference) return json({error:"conference_not_found"},404,request,env);
  const {results}=await env.DB.prepare(`
    SELECT st.*, s.name AS school_name,t.sport,t.gender,t.season
    FROM standings st JOIN teams t ON t.id=st.team_id JOIN schools s ON s.id=t.school_id
    WHERE st.conference_id=? ORDER BY st.rank IS NULL, st.rank, s.name`).bind(conferenceId).all();
  return json({conference,standings:results},200,request,env);
}

async function listSourceFreshness(request,env){
  const {results}=await env.DB.prepare(`SELECT id,team_id,source_url,source_type,parser_type,parser_version,last_successful_fetch_at,last_failure_at,last_error,last_http_status,last_checked_at FROM sources WHERE enabled=1 ORDER BY source_priority,id`).all();
  return json({sources:results},200,request,env);
}

async function listNearbyGames(request,env,url){
  const lat=Number(url.searchParams.get("lat")), lon=Number(url.searchParams.get("lon")), radius=Number(url.searchParams.get("radius")||25);
  const since=url.searchParams.get("since")||new Date(Date.now()-6*60*60*1000).toISOString();
  const until=url.searchParams.get("until")||new Date(Date.now()+30*24*60*60*1000).toISOString();
  const {results}=await env.DB.prepare(`
    SELECT g.*, t.sport,t.gender,t.season,sch.id AS school_id,sch.name AS school_name,sch.level,sch.mascot,
      c.name AS conference_name,r.wins,r.losses,r.ties,r.conference_wins,r.conference_losses,r.conference_ties,
      src.source_type,src.last_successful_fetch_at AS source_last_successful_fetch_at
    FROM games g JOIN teams t ON t.id=g.team_id JOIN schools sch ON sch.id=t.school_id
    LEFT JOIN conferences c ON c.id=t.conference_id LEFT JOIN team_records r ON r.team_id=t.id JOIN sources src ON src.id=g.source_id
    WHERE g.scheduled_at BETWEEN ? AND ? ORDER BY g.scheduled_at`).bind(since,until).all();
  let games=results;
  if (Number.isFinite(lat)&&Number.isFinite(lon)&&Number.isFinite(radius)) {
    games=games.map(g=>({...g,distance_miles:haversineMiles(lat,lon,g.latitude,g.longitude)}))
      .filter(g=>g.distance_miles!==null&&g.distance_miles<=radius);
  }
  return json({games},200,request,env);
}

async function runDueCollections(env,{force=false,sourceId=null,reason="scheduled"}={}){
  let query=env.DB.prepare(`
    SELECT src.*, t.season,t.sport,t.gender,t.conference_id,sch.id AS school_id,sch.name AS school_name
    FROM sources src JOIN teams t ON t.id=src.team_id JOIN schools sch ON sch.id=t.school_id
    WHERE src.enabled=1 ${sourceId?"AND src.id=?":""} ORDER BY src.source_priority,src.id`);
  if (sourceId) query=query.bind(sourceId);
  const {results:sources}=await query.all();
  const outcomes=[];
  for (const source of sources) {
    const due=force || await sourceIsDue(env,source);
    if (!due) { outcomes.push({sourceId:source.id,status:"SKIPPED"}); continue; }
    outcomes.push(await collectSource(env,source,reason));
  }
  return {ok:outcomes.every(o=>!["FAILURE"].includes(o.status)),outcomes};
}

async function sourceIsDue(env,source){
  if (!source.last_checked_at) return true;
  const active=await env.DB.prepare(`SELECT 1 AS yes FROM games WHERE team_id=? AND status='SCHEDULED' AND datetime(scheduled_at) BETWEEN datetime('now','-6 hours') AND datetime('now','+12 hours') LIMIT 1`).bind(source.team_id).first();
  const minutes=active?source.active_result_minutes:source.refresh_minutes;
  return Date.now()-Date.parse(source.last_checked_at)>=minutes*60*1000;
}

async function collectSource(env,source,reason){
  const startedAt=new Date().toISOString();
  const run=await env.DB.prepare(`INSERT INTO collection_runs(source_id,started_at,status,parser_version) VALUES(?,?,'RUNNING',?) RETURNING id`).bind(source.id,startedAt,source.parser_version).first();
  try {
    const headers={"user-agent":USER_AGENT,"accept":"text/html,application/xhtml+xml"};
    if (source.etag) headers["if-none-match"]=source.etag;
    if (source.last_modified) headers["if-modified-since"]=source.last_modified;
    const response=await fetch(source.source_url,{headers,redirect:"follow"});
    const checkedAt=new Date().toISOString();
    if (response.status===304) {
      await env.DB.batch([
        env.DB.prepare("UPDATE sources SET last_checked_at=?,last_http_status=304,updated_at=? WHERE id=?").bind(checkedAt,checkedAt,source.id),
        env.DB.prepare("UPDATE collection_runs SET finished_at=?,status='NOT_MODIFIED',http_status=304 WHERE id=?").bind(checkedAt,run.id)
      ]);
      return {sourceId:source.id,status:"NOT_MODIFIED",reason};
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html=await response.text();
    const parsed=await parseSourceHtml(html,source);
    if (parsed.length<source.expected_min_games) throw new Error(`Parser returned ${parsed.length} games; expected at least ${source.expected_min_games}. Last known good data retained.`);
    const existing=await env.DB.prepare("SELECT COUNT(*) AS game_count FROM games WHERE source_id=?").bind(source.id).first();
    const priorCount=Number(existing?.game_count||0);
    const safeFloor=Math.max(Number(source.expected_min_games)||1,Math.floor(priorCount*0.75));
    if (priorCount && parsed.length<safeFloor) throw new Error(`Parser returned ${parsed.length} games versus ${priorCount} previously stored; refusing destructive reconciliation. Last known good data retained.`);
    for (const game of parsed) await upsertGame(env,source,game,checkedAt);
    await reconcileMissingFutureGames(env,source,checkedAt);
    await recalculateRecord(env,source.team_id);
    await recalculateStandingsIfComplete(env,source.conference_id);
    await env.DB.batch([
      env.DB.prepare(`UPDATE sources SET etag=?,last_modified=?,last_successful_fetch_at=?,last_checked_at=?,last_failure_at=NULL,last_error=NULL,last_http_status=?,updated_at=? WHERE id=?`)
        .bind(response.headers.get("etag"),response.headers.get("last-modified"),checkedAt,checkedAt,response.status,checkedAt,source.id),
      env.DB.prepare("UPDATE collection_runs SET finished_at=?,status='SUCCESS',http_status=?,games_seen=? WHERE id=?").bind(checkedAt,response.status,parsed.length,run.id)
    ]);
    return {sourceId:source.id,status:"SUCCESS",gamesSeen:parsed.length,reason};
  } catch(error) {
    const finishedAt=new Date().toISOString();
    const message=String(error?.message||error).slice(0,1000);
    console.error("collector failure",source.id,message);
    await env.DB.batch([
      env.DB.prepare("UPDATE sources SET last_checked_at=?,last_failure_at=?,last_error=?,updated_at=? WHERE id=?").bind(finishedAt,finishedAt,message,finishedAt,source.id),
      env.DB.prepare("UPDATE collection_runs SET finished_at=?,status='FAILURE',error=? WHERE id=?").bind(finishedAt,message,run.id)
    ]);
    return {sourceId:source.id,status:"FAILURE",error:message,reason};
  }
}

async function parseSourceHtml(html,source){
  if (source.parser_type==="sidearm") return parseSidearmHtml(html,source);
  if (source.parser_type==="mascot-media") return parseMascotHtml(html,source);
  throw new Error(`Unsupported parser ${source.parser_type}`);
}

async function parseSidearmHtml(html,source){
  const state={current:null,rows:[]};
  const append=field=>({text(chunk){if(state.current) state.current[field]=(state.current[field]||"")+chunk.text+" ";}});
  const rowHandler={
    element(el){
      if(state.current) return;
      state.current={nativeId:el.getAttribute("data-game-id")||el.getAttribute("data-id")||el.getAttribute("id")||"",full:"",date:"",opponentName:"",opponentText:"",location:"",result:"",conference:""};
      state.rows.push(state.current);
      el.onEndTag(()=>{state.current=null;});
    },
    text(chunk){if(state.current) state.current.full+=chunk.text+" ";}
  };
  const response=new HTMLRewriter()
    .on("li.sidearm-schedule-game, .sidearm-schedule-game-row",rowHandler)
    .on(".sidearm-schedule-game-opponent-date",append("date"))
    .on(".sidearm-schedule-game-opponent-name",append("opponentName"))
    .on(".sidearm-schedule-game-opponent-text",append("opponentText"))
    .on(".sidearm-schedule-game-location",append("location"))
    .on(".sidearm-schedule-game-result",append("result"))
    .on(".sidearm-schedule-game-conference, .sidearm-schedule-game-conference-conference",append("conference"))
    .transform(new Response(html));
  await response.text();
  return dedupe(normalizeSidearmRows(state.rows,source));
}

async function parseMascotHtml(html,source){
  const state={current:null,rows:[]};
  const cell=n=>({text(chunk){if(state.current) state.current.cells[n]=(state.current.cells[n]||"")+chunk.text+" ";}});
  const rowHandler={
    element(el){state.current={nativeId:el.getAttribute("data-id")||el.getAttribute("id")||"",full:"",cells:["","","",""]};state.rows.push(state.current);el.onEndTag(()=>{state.current=null;});},
    text(chunk){if(state.current) state.current.full+=chunk.text+" ";}
  };
  const response=new HTMLRewriter().on("table tbody tr",rowHandler)
    .on("table tbody tr td:nth-child(1)",cell(0)).on("table tbody tr td:nth-child(2)",cell(1))
    .on("table tbody tr td:nth-child(3)",cell(2)).on("table tbody tr td:nth-child(4)",cell(3))
    .transform(new Response(html));
  await response.text();
  return dedupe(normalizeMascotRows(state.rows,source));
}

function dedupe(events){const seen=new Set();return events.filter(e=>{const k=e.sourceEventKey;if(seen.has(k))return false;seen.add(k);return true;});}

async function upsertGame(env,source,game,checkedAt){
  const id=`${source.id}:${game.sourceEventKey}`;
  await env.DB.prepare(`
    INSERT INTO games(id,team_id,source_id,source_event_key,opponent,scheduled_at,scheduled_time_known,venue,location_text,latitude,longitude,home_away,conference_game,counts_for_record,status,team_score,opponent_score,result,notes,source_url,source_updated_at,last_checked_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(source_id,source_event_key) DO UPDATE SET
      opponent=excluded.opponent,scheduled_at=excluded.scheduled_at,scheduled_time_known=excluded.scheduled_time_known,
      venue=COALESCE(NULLIF(excluded.venue,''),games.venue),location_text=COALESCE(NULLIF(excluded.location_text,''),games.location_text),
      latitude=COALESCE(excluded.latitude,games.latitude),longitude=COALESCE(excluded.longitude,games.longitude),home_away=excluded.home_away,
      conference_game=excluded.conference_game,counts_for_record=excluded.counts_for_record,status=excluded.status,
      team_score=excluded.team_score,opponent_score=excluded.opponent_score,result=excluded.result,notes=excluded.notes,
      source_url=excluded.source_url,source_updated_at=excluded.source_updated_at,last_checked_at=excluded.last_checked_at,updated_at=excluded.updated_at`)
    .bind(id,source.team_id,source.id,game.sourceEventKey,game.opponent,game.scheduledAt,game.scheduledTimeKnown?1:0,game.venue||null,game.locationText||null,
      game.latitude??null,game.longitude??null,game.homeAway,game.conferenceGame?1:0,game.countsForRecord?1:0,game.status,game.teamScore??null,game.opponentScore??null,
      game.result||null,game.notes||null,source.source_url,checkedAt,checkedAt,checkedAt).run();
}

async function reconcileMissingFutureGames(env,source,checkedAt){
  await env.DB.prepare(`UPDATE games SET
      status='CANCELED',team_score=NULL,opponent_score=NULL,result=NULL,
      notes=CASE WHEN notes IS NULL OR notes='' THEN 'Removed from current source schedule' ELSE notes || ' · Removed from current source schedule' END,
      last_checked_at=?,updated_at=?
    WHERE source_id=? AND last_checked_at<>? AND status IN ('SCHEDULED','POSTPONED')
      AND datetime(scheduled_at)>=datetime('now','-12 hours')`)
    .bind(checkedAt,checkedAt,source.id,checkedAt).run();
}

async function recalculateRecord(env,teamId){
  const counts=await env.DB.prepare(`SELECT
    SUM(CASE WHEN status='FINAL' AND counts_for_record=1 AND result='W' THEN 1 ELSE 0 END) wins,
    SUM(CASE WHEN status='FINAL' AND counts_for_record=1 AND result='L' THEN 1 ELSE 0 END) losses,
    SUM(CASE WHEN status='FINAL' AND counts_for_record=1 AND result='T' THEN 1 ELSE 0 END) ties,
    SUM(CASE WHEN status='FINAL' AND counts_for_record=1 AND conference_game=1 AND result='W' THEN 1 ELSE 0 END) conference_wins,
    SUM(CASE WHEN status='FINAL' AND counts_for_record=1 AND conference_game=1 AND result='L' THEN 1 ELSE 0 END) conference_losses,
    SUM(CASE WHEN status='FINAL' AND counts_for_record=1 AND conference_game=1 AND result='T' THEN 1 ELSE 0 END) conference_ties
    FROM games WHERE team_id=?`).bind(teamId).first();
  const now=new Date().toISOString();
  await env.DB.prepare(`INSERT INTO team_records(team_id,wins,losses,ties,conference_wins,conference_losses,conference_ties,calculated_at)
    VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(team_id) DO UPDATE SET wins=excluded.wins,losses=excluded.losses,ties=excluded.ties,conference_wins=excluded.conference_wins,conference_losses=excluded.conference_losses,conference_ties=excluded.conference_ties,calculated_at=excluded.calculated_at`)
    .bind(teamId,counts.wins||0,counts.losses||0,counts.ties||0,counts.conference_wins||0,counts.conference_losses||0,counts.conference_ties||0,now).run();
}

async function recalculateStandingsIfComplete(env,conferenceId){
  if (!conferenceId) return;
  const conference=await env.DB.prepare("SELECT * FROM conferences WHERE id=?").bind(conferenceId).first();
  if (!conference || conference.standings_method!=="calculated" || !conference.coverage_complete) return;
  const {results}=await env.DB.prepare(`SELECT t.id team_id,s.name school_name,r.wins,r.losses,r.ties,r.conference_wins cw,r.conference_losses cl,r.conference_ties ct
    FROM teams t JOIN schools s ON s.id=t.school_id LEFT JOIN team_records r ON r.team_id=t.id WHERE t.conference_id=? AND t.active=1`).bind(conferenceId).all();
  results.sort((a,b)=>pct(b.cw,b.cl,b.ct)-pct(a.cw,a.cl,a.ct)||(b.cw||0)-(a.cw||0)||a.school_name.localeCompare(b.school_name));
  const now=new Date().toISOString();
  await env.DB.batch(results.map((r,i)=>env.DB.prepare(`INSERT INTO standings(conference_id,team_id,rank,conference_record,overall_record,method,calculated_at)
    VALUES(?,?,?,?,?,'calculated',?) ON CONFLICT(conference_id,team_id) DO UPDATE SET rank=excluded.rank,conference_record=excluded.conference_record,overall_record=excluded.overall_record,method='calculated',calculated_at=excluded.calculated_at`)
    .bind(conferenceId,r.team_id,i+1,recordText(r.cw,r.cl,r.ct),recordText(r.wins,r.losses,r.ties),now)));
}

function pct(w=0,l=0,t=0){const games=(w||0)+(l||0)+(t||0);return games?((w||0)+0.5*(t||0))/games:0;}
function recordText(w=0,l=0,t=0){return t?`${w||0}-${l||0}-${t||0}`:`${w||0}-${l||0}`;}
function emptyRecord(teamId){return {team_id:teamId,wins:0,losses:0,ties:0,conference_wins:0,conference_losses:0,conference_ties:0,calculated_at:null};}
function haversineMiles(aLat,aLon,bLat,bLon){if (![aLat,aLon,bLat,bLon].every(Number.isFinite)) return null;const R=3958.8,toRad=d=>d*Math.PI/180,dLat=toRad(bLat-aLat),dLon=toRad(bLon-aLon),h=Math.sin(dLat/2)**2+Math.cos(toRad(aLat))*Math.cos(toRad(bLat))*Math.sin(dLon/2)**2;return 2*R*Math.asin(Math.sqrt(h));}

function allowedOrigin(request,env){const origin=request.headers.get("origin");if(!origin)return "*";const allowed=env.ALLOWED_ORIGIN||"https://jamesmethvin74.github.io";return origin===allowed||origin.startsWith("http://localhost:")?origin:"null";}
function json(body,status,request,env){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","access-control-allow-origin":allowedOrigin(request,env),"vary":"Origin"}});}
function corsPreflight(request,env){return new Response(null,{status:204,headers:{"access-control-allow-origin":allowedOrigin(request,env),"access-control-allow-methods":"GET,POST,OPTIONS","access-control-allow-headers":"content-type,x-refresh-token","access-control-max-age":"86400","vary":"Origin"}});}
