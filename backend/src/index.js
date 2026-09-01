import { normalizeMascotRows, normalizeSidearmRows } from "./parser-core.js";
import { normalizeDragonFlyHtml, normalizeDragonFlyPayload } from "./dragonfly-core.js";
import { dragonFlyFeedBaseUrl, fetchDragonFlyPagedPayload } from "./dragonfly-feed.js";
import { collectionSafety, deriveSourceHealth, normalizeSchoolAlias, observationsLikelySameEvent, resolveCanonicalEvent } from "./schedule-authority-core.js";
import { recordFromScheduleRows } from "./schedule-response-normalizer.js";

const API_PREFIX="/api/v1";
const USER_AGENT="LocalBleachersAR/2.0 (+https://github.com/jamesmethvin74/game-nearby)";

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
  if (request.method==="GET" && url.pathname===`${API_PREFIX}/conflicts`) return listActiveConflicts(request,env);

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
  const row=await env.DB.prepare("SELECT COUNT(*) AS teams, (SELECT COUNT(*) FROM games) AS observations, (SELECT COUNT(*) FROM canonical_events) AS canonical_games, (SELECT MAX(last_successful_fetch_at) FROM sources) AS last_refresh FROM teams").first();
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
      src.source_url,src.last_successful_fetch_at,src.last_checked_at,src.parser_type AS primary_parser_type
    FROM teams t JOIN schools s ON s.id=t.school_id
    LEFT JOIN conferences c ON c.id=t.conference_id
    LEFT JOIN sources src ON src.id=(SELECT id FROM sources WHERE team_id=t.id AND enabled=1 ORDER BY authority_rank,source_priority,id LIMIT 1)
    WHERE t.id=?`).bind(teamId).first();
  if (!team) return json({error:"team_not_found"},404,request,env);
  const record=await env.DB.prepare("SELECT * FROM team_records WHERE team_id=?").bind(teamId).first();
  return json({team,record:record||emptyRecord(teamId)},200,request,env);
}

async function getTeamSchedule(request,env,teamId){
  const team=await env.DB.prepare(`
    SELECT t.*,s.name AS school_name,c.name AS conference_name
    FROM teams t JOIN schools s ON s.id=t.school_id
    LEFT JOIN conferences c ON c.id=t.conference_id
    WHERE t.id=?`).bind(teamId).first();
  if (!team) return json({error:"team_not_found"},404,request,env);
  await recalculateRecord(env,teamId);
  const record=await env.DB.prepare("SELECT * FROM team_records WHERE team_id=?").bind(teamId).first();
  const {results}=await env.DB.prepare(`
    SELECT g.*, s.source_type,s.parser_type,s.authority_rank,s.last_successful_fetch_at AS source_last_successful_fetch_at,
      ce.scheduled_at AS canonical_scheduled_at,ce.scheduled_time_known AS canonical_time_known,ce.venue AS canonical_venue,
      ce.status AS canonical_status,ce.home_score AS canonical_home_score,ce.away_score AS canonical_away_score,
      ce.home_school_id AS canonical_home_school_id,ce.away_school_id AS canonical_away_school_id,
      ce.trust_state AS data_trust,ce.conflict_count,hs.name AS canonical_home_name,aws.name AS canonical_away_name,
      ROW_NUMBER() OVER (PARTITION BY COALESCE(g.canonical_event_id,g.id) ORDER BY s.authority_rank,s.source_priority,s.id) AS authority_row
    FROM games g JOIN sources s ON s.id=g.source_id
    LEFT JOIN canonical_events ce ON ce.id=g.canonical_event_id
    LEFT JOIN schools hs ON hs.id=ce.home_school_id LEFT JOIN schools aws ON aws.id=ce.away_school_id
    WHERE g.team_id=? ORDER BY COALESCE(ce.scheduled_at,g.scheduled_at)`).bind(teamId).all();
  const games=results.filter(r=>Number(r.authority_row)===1).map(r=>resolvedGameForTeam(r,team.school_id));
  return json({teamId,games,record:{...emptyRecord(teamId),...(record||{}),conference_id:team.conference_id||null,conference_name:team.conference_name||null}},200,request,env);
}

function resolvedGameForTeam(row,schoolId){
  if (!row.canonical_event_id) return {...row,data_trust:row.data_trust||"SINGLE_SOURCE_LIVE",conflict_count:Number(row.conflict_count||0)};
  const isHome=row.canonical_home_school_id===schoolId;
  const isAway=row.canonical_away_school_id===schoolId;
  const teamScore=isHome?row.canonical_home_score:isAway?row.canonical_away_score:row.team_score;
  const opponentScore=isHome?row.canonical_away_score:isAway?row.canonical_home_score:row.opponent_score;
  const status=row.canonical_status||row.status;
  const result=status==="FINAL" && teamScore!=null && opponentScore!=null ? (Number(teamScore)===Number(opponentScore)?"T":Number(teamScore)>Number(opponentScore)?"W":"L") : null;
  return {...row,
    id:row.canonical_event_id,canonical_event_id:row.canonical_event_id,
    opponent:isHome?row.canonical_away_name:isAway?row.canonical_home_name:row.opponent,
    scheduled_at:row.canonical_scheduled_at||row.scheduled_at,
    scheduled_time_known:row.canonical_time_known??row.scheduled_time_known,
    venue:row.canonical_venue||row.venue,
    home_away:isHome?"home":isAway?"away":row.home_away,
    status,team_score:teamScore,opponent_score:opponentScore,result,
    data_trust:row.data_trust||"SINGLE_SOURCE_LIVE",conflict_count:Number(row.conflict_count||0)
  };
}

async function getTeamRecord(request,env,teamId){
  const team=await env.DB.prepare("SELECT id FROM teams WHERE id=?").bind(teamId).first();
  if (!team) return json({error:"team_not_found"},404,request,env);
  await recalculateRecord(env,teamId);
  const row=await env.DB.prepare(`
    SELECT r.*, t.conference_id, c.name AS conference_name
    FROM teams t LEFT JOIN team_records r ON r.team_id=t.id LEFT JOIN conferences c ON c.id=t.conference_id
    WHERE t.id=?`).bind(teamId).first();
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
  const {results}=await env.DB.prepare(`
    SELECT src.id,src.team_id,src.source_url,src.source_type,src.source_priority,src.authority_rank,src.parser_type,src.parser_version,
      src.expected_min_games,src.refresh_minutes,src.stale_after_minutes,src.consecutive_failures,src.last_game_count,src.suspicious_game_count,
      src.last_successful_fetch_at,src.last_failure_at,src.last_error,src.last_http_status,src.last_checked_at,
      COUNT(DISTINCT CASE WHEN ec.resolved_at IS NULL THEN ec.id END) AS active_conflict_count
    FROM sources src
    LEFT JOIN canonical_event_members cem ON cem.source_id=src.id
    LEFT JOIN event_conflicts ec ON ec.canonical_event_id=cem.canonical_event_id
    WHERE src.enabled=1 GROUP BY src.id ORDER BY src.authority_rank,src.source_priority,src.id`).all();
  return json({sources:results.map(source=>({...source,health_state:deriveSourceHealth(source)}))},200,request,env);
}

async function listActiveConflicts(request,env){
  const {results}=await env.DB.prepare(`
    SELECT ec.*,ce.sport,ce.gender,ce.season,ce.scheduled_at,ce.trust_state,
      a.name AS participant_a,b.name AS participant_b
    FROM event_conflicts ec JOIN canonical_events ce ON ce.id=ec.canonical_event_id
    JOIN schools a ON a.id=ce.participant_a_school_id JOIN schools b ON b.id=ce.participant_b_school_id
    WHERE ec.resolved_at IS NULL ORDER BY ce.scheduled_at,ec.conflict_type`).all();
  return json({conflicts:results},200,request,env);
}

async function listNearbyGames(request,env,url){
  const lat=Number(url.searchParams.get("lat")), lon=Number(url.searchParams.get("lon")), radius=Number(url.searchParams.get("radius")||25);
  const since=url.searchParams.get("since")||new Date(Date.now()-6*60*60*1000).toISOString();
  const until=url.searchParams.get("until")||new Date(Date.now()+30*24*60*60*1000).toISOString();
  const {results}=await env.DB.prepare(`
    SELECT g.*, t.sport,t.gender,t.season,sch.id AS school_id,sch.name AS school_name,sch.level,sch.mascot,
      c.name AS conference_name,r.wins,r.losses,r.ties,r.conference_wins,r.conference_losses,r.conference_ties,
      src.source_type,src.parser_type,src.authority_rank,src.last_successful_fetch_at AS source_last_successful_fetch_at,
      ce.scheduled_at AS canonical_scheduled_at,ce.scheduled_time_known AS canonical_time_known,ce.venue AS canonical_venue,
      ce.status AS canonical_status,ce.home_score AS canonical_home_score,ce.away_score AS canonical_away_score,
      ce.home_school_id AS canonical_home_school_id,ce.away_school_id AS canonical_away_school_id,
      ce.trust_state AS data_trust,ce.conflict_count,hs.name AS canonical_home_name,aws.name AS canonical_away_name,
      ROW_NUMBER() OVER (PARTITION BY COALESCE(g.canonical_event_id,g.id) ORDER BY src.authority_rank,src.source_priority,src.id) AS authority_row
    FROM games g JOIN teams t ON t.id=g.team_id JOIN schools sch ON sch.id=t.school_id
    LEFT JOIN conferences c ON c.id=t.conference_id LEFT JOIN team_records r ON r.team_id=t.id JOIN sources src ON src.id=g.source_id
    LEFT JOIN canonical_events ce ON ce.id=g.canonical_event_id LEFT JOIN schools hs ON hs.id=ce.home_school_id LEFT JOIN schools aws ON aws.id=ce.away_school_id
    WHERE COALESCE(ce.scheduled_at,g.scheduled_at) BETWEEN ? AND ? ORDER BY COALESCE(ce.scheduled_at,g.scheduled_at)`).bind(since,until).all();
  let games=results.filter(r=>Number(r.authority_row)===1).map(r=>resolvedGameForTeam(r,r.school_id));
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
    WHERE src.enabled=1 ${sourceId?"AND src.id=?":""} ORDER BY src.authority_rank,src.source_priority,src.id`);
  if (sourceId) query=query.bind(sourceId);
  const {results:sources}=await query.all();
  const outcomes=[];
  const sharedFetches=new Map();
  for (const source of sources) {
    const due=force || await sourceIsDue(env,source);
    if (!due) { outcomes.push({sourceId:source.id,status:"SKIPPED"}); continue; }
    outcomes.push(await collectSource(env,source,reason,sharedFetches));
  }
  return {ok:outcomes.every(o=>!["FAILURE"].includes(o.status)),outcomes};
}

async function sourceIsDue(env,source){
  if (!source.last_checked_at) return true;
  const active=await env.DB.prepare(`SELECT 1 AS yes FROM games WHERE team_id=? AND status='SCHEDULED' AND datetime(scheduled_at) BETWEEN datetime('now','-6 hours') AND datetime('now','+12 hours') LIMIT 1`).bind(source.team_id).first();
  const minutes=active?source.active_result_minutes:source.refresh_minutes;
  return Date.now()-Date.parse(source.last_checked_at)>=minutes*60*1000;
}

async function fetchSourceMaterial(source,sharedFetches){
  if (source.parser_type==="dragonfly-public") {
    const feedKey=dragonFlyFeedBaseUrl(source.source_url);
    let pending=sharedFetches.get(feedKey);
    if (!pending) {
      pending=fetchDragonFlyPagedPayload(source.source_url,{
        fetchFn:fetch,
        headers:{"user-agent":USER_AGENT,"accept":"application/json"}
      }).then(result=>({
        body:JSON.stringify(result.payload),contentType:"application/json",status:result.httpStatus,
        etag:null,lastModified:null,notModified:false,pagesFetched:result.pageCount
      }));
      sharedFetches.set(feedKey,pending);
    }
    return pending;
  }

  const headers={"user-agent":USER_AGENT,"accept":"application/json,text/html,application/xhtml+xml"};
  if (source.etag) headers["if-none-match"]=source.etag;
  if (source.last_modified) headers["if-modified-since"]=source.last_modified;
  const response=await fetch(source.source_url,{headers,redirect:"follow"});
  if (response.status===304) return {notModified:true,status:304,body:"",contentType:"",etag:source.etag||null,lastModified:source.last_modified||null,pagesFetched:null};
  if (!response.ok) {
    const error=new Error(`HTTP ${response.status}`);
    error.httpStatus=response.status;
    throw error;
  }
  return {
    notModified:false,status:response.status,body:await response.text(),contentType:response.headers.get("content-type")||"",
    etag:response.headers.get("etag"),lastModified:response.headers.get("last-modified"),pagesFetched:null
  };
}

async function collectSource(env,source,reason,sharedFetches=new Map()){
  const startedAt=new Date().toISOString();
  const run=await env.DB.prepare(`INSERT INTO collection_runs(source_id,started_at,status,parser_version) VALUES(?,?,'RUNNING',?) RETURNING id`).bind(source.id,startedAt,source.parser_version).first();
  try {
    const fetched=await fetchSourceMaterial(source,sharedFetches);
    const checkedAt=new Date().toISOString();
    if (fetched.notModified) {
      await env.DB.batch([
        env.DB.prepare("UPDATE sources SET last_checked_at=?,last_successful_fetch_at=?,last_http_status=304,consecutive_failures=0,suspicious_game_count=0,updated_at=? WHERE id=?").bind(checkedAt,checkedAt,checkedAt,source.id),
        env.DB.prepare("UPDATE collection_runs SET finished_at=?,status='NOT_MODIFIED',http_status=304 WHERE id=?").bind(checkedAt,run.id)
      ]);
      return {sourceId:source.id,status:"NOT_MODIFIED",reason};
    }
    const parsed=await parseSourceBody(fetched.body,source,fetched.contentType);
    const existing=await env.DB.prepare("SELECT COUNT(*) AS game_count FROM games WHERE source_id=?").bind(source.id).first();
    const priorCount=Number(existing?.game_count||0);
    const safety=collectionSafety({parsedCount:parsed.length,expectedMinGames:source.expected_min_games,priorCount});
    if (!safety.safe) throw new Error(safety.reason);
    for (const game of parsed) {
      const gameId=await upsertGame(env,source,game,checkedAt);
      await reconcileCanonicalGame(env,gameId);
    }
    await reconcileMissingFutureGames(env,source,checkedAt);
    await reconcileSourceGames(env,source.id);
    await recalculateRecord(env,source.team_id);
    await recalculateStandingsIfComplete(env,source.conference_id);
    await env.DB.batch([
      env.DB.prepare(`UPDATE sources SET etag=?,last_modified=?,last_successful_fetch_at=?,last_checked_at=?,last_failure_at=NULL,last_error=NULL,last_http_status=?,consecutive_failures=0,last_game_count=?,suspicious_game_count=0,updated_at=? WHERE id=?`)
        .bind(fetched.etag,fetched.lastModified,checkedAt,checkedAt,fetched.status,parsed.length,checkedAt,source.id),
      env.DB.prepare("UPDATE collection_runs SET finished_at=?,status='SUCCESS',http_status=?,games_seen=? WHERE id=?").bind(checkedAt,fetched.status,parsed.length,run.id)
    ]);
    return {sourceId:source.id,status:"SUCCESS",gamesSeen:parsed.length,pagesFetched:fetched.pagesFetched,reason};
  } catch(error) {
    const finishedAt=new Date().toISOString();
    const message=String(error?.message||error).slice(0,1000);
    const suspicious=/Parser returned|destructive reconciliation/i.test(message)?1:0;
    const httpStatus=Number(error?.httpStatus)||null;
    console.error("collector failure",source.id,message);
    await env.DB.batch([
      env.DB.prepare("UPDATE sources SET last_checked_at=?,last_failure_at=?,last_error=?,last_http_status=?,consecutive_failures=COALESCE(consecutive_failures,0)+1,suspicious_game_count=CASE WHEN ?=1 THEN 1 ELSE suspicious_game_count END,updated_at=? WHERE id=?").bind(finishedAt,finishedAt,message,httpStatus,suspicious,finishedAt,source.id),
      env.DB.prepare("UPDATE collection_runs SET finished_at=?,status='FAILURE',http_status=?,error=? WHERE id=?").bind(finishedAt,httpStatus,message,run.id)
    ]);
    return {sourceId:source.id,status:"FAILURE",error:message,reason};
  }
}

async function parseSourceBody(body,source,contentType=""){
  if (source.parser_type==="sidearm") return parseSidearmHtml(body,source);
  if (source.parser_type==="mascot-media") return parseMascotHtml(body,source);
  if (source.parser_type==="dragonfly-public") {
    if (/application\/json/i.test(contentType) || /^[\s\r\n]*[\[{]/.test(body)) {
      try { return dedupe(normalizeDragonFlyPayload(JSON.parse(body),source)); } catch {}
    }
    const visibleText=await extractVisibleText(body);
    return dedupe(normalizeDragonFlyHtml(body,source,{visibleText}));
  }
  throw new Error(`Unsupported parser ${source.parser_type}`);
}

async function extractVisibleText(html){
  let text="";
  const response=new HTMLRewriter().on("body",{text(chunk){text+=`${chunk.text}\n`;}}).transform(new Response(html));
  await response.text();
  return text;
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

async function resolveOpponentSchool(env,opponent){
  const normalized=normalizeSchoolAlias(opponent);
  if (!normalized) return null;
  const alias=await env.DB.prepare("SELECT school_id FROM school_aliases WHERE normalized_alias=?").bind(normalized).first();
  if (alias?.school_id) return alias.school_id;
  const {results}=await env.DB.prepare("SELECT id,name,mascot FROM schools").all();
  const match=results.find(s=>normalizeSchoolAlias(s.name)===normalized || normalizeSchoolAlias(`${s.name} ${s.mascot||''}`)===normalized);
  if (!match) return null;
  await env.DB.prepare("INSERT OR IGNORE INTO school_aliases(normalized_alias,school_id,alias_text) VALUES(?,?,?)").bind(normalized,match.id,opponent).run();
  return match.id;
}

async function upsertGame(env,source,game,checkedAt){
  const id=`${source.id}:${game.sourceEventKey}`;
  const opponentSchoolId=await resolveOpponentSchool(env,game.opponent);
  await env.DB.prepare(`
    INSERT INTO games(id,team_id,source_id,source_event_key,opponent,opponent_school_id,scheduled_at,scheduled_time_known,venue,location_text,latitude,longitude,home_away,conference_game,counts_for_record,status,team_score,opponent_score,result,notes,source_url,source_updated_at,last_checked_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(source_id,source_event_key) DO UPDATE SET
      opponent=excluded.opponent,opponent_school_id=excluded.opponent_school_id,scheduled_at=excluded.scheduled_at,scheduled_time_known=excluded.scheduled_time_known,
      venue=COALESCE(NULLIF(excluded.venue,''),games.venue),location_text=COALESCE(NULLIF(excluded.location_text,''),games.location_text),
      latitude=COALESCE(excluded.latitude,games.latitude),longitude=COALESCE(excluded.longitude,games.longitude),home_away=excluded.home_away,
      conference_game=excluded.conference_game,counts_for_record=excluded.counts_for_record,status=excluded.status,
      team_score=excluded.team_score,opponent_score=excluded.opponent_score,result=excluded.result,notes=excluded.notes,
      source_url=excluded.source_url,source_updated_at=excluded.source_updated_at,last_checked_at=excluded.last_checked_at,updated_at=excluded.updated_at`)
    .bind(id,source.team_id,source.id,game.sourceEventKey,game.opponent,opponentSchoolId,game.scheduledAt,game.scheduledTimeKnown?1:0,game.venue||null,game.locationText||null,
      game.latitude??null,game.longitude??null,game.homeAway,game.conferenceGame?1:0,game.countsForRecord?1:0,game.status,game.teamScore??null,game.opponentScore??null,
      game.result||null,game.notes||null,source.source_url,game.sourceUpdatedAt||checkedAt,checkedAt,checkedAt).run();
  return id;
}

async function observationById(env,gameId){
  return env.DB.prepare(`
    SELECT g.*,t.sport,t.gender,t.season,t.id AS reporting_team_id,sch.id AS reporting_school_id,sch.name AS reporting_school_name,
      src.source_type,src.parser_type,src.source_priority,src.authority_rank,src.timezone
    FROM games g JOIN teams t ON t.id=g.team_id JOIN schools sch ON sch.id=t.school_id JOIN sources src ON src.id=g.source_id
    WHERE g.id=?`).bind(gameId).first();
}

async function reconcileCanonicalGame(env,gameId){
  const seed=await observationById(env,gameId);
  if (!seed?.opponent_school_id) return null;
  const timeZone=seed.timezone||"America/Chicago";
  const {results:candidates}=await env.DB.prepare(`
    SELECT g.*,t.sport,t.gender,t.season,t.id AS reporting_team_id,sch.id AS reporting_school_id,sch.name AS reporting_school_name,
      src.source_type,src.parser_type,src.source_priority,src.authority_rank,src.timezone
    FROM games g JOIN teams t ON t.id=g.team_id JOIN schools sch ON sch.id=t.school_id JOIN sources src ON src.id=g.source_id
    WHERE g.opponent_school_id IS NOT NULL AND t.sport=? AND t.gender=? AND t.season=?
      AND ((sch.id=? AND g.opponent_school_id=?) OR (sch.id=? AND g.opponent_school_id=?))
      AND datetime(g.scheduled_at) BETWEEN datetime(?,'-36 hours') AND datetime(?,'+36 hours')
    ORDER BY src.authority_rank,src.source_priority,src.id`).bind(seed.sport,seed.gender,seed.season,
      seed.reporting_school_id,seed.opponent_school_id,seed.opponent_school_id,seed.reporting_school_id,seed.scheduled_at,seed.scheduled_at).all();
  const related=candidates.filter(candidate=>candidate.id===seed.id || observationsLikelySameEvent(seed,candidate,{timeZone}));
  if (!related.length) return null;
  let resolved;
  try { resolved=resolveCanonicalEvent(related,{timeZone}); }
  catch { return null; }
  const now=new Date().toISOString();
  const selected=related.find(o=>o.id===resolved.resolutionEvidence.selectedObservationId) || related[0];
  const venueObservation=related.find(o=>o.id===resolved.resolutionEvidence.venueObservationId) || selected;
  const geoObservation=related.find(o=>o.latitude!=null && o.longitude!=null) || selected;
  const conferenceGame=Number(selected?.conference_game||0);
  await env.DB.prepare(`
    INSERT INTO canonical_events(id,sport,gender,season,participant_a_school_id,participant_b_school_id,home_school_id,away_school_id,scheduled_at,scheduled_time_known,venue,location_text,latitude,longitude,conference_game,status,home_score,away_score,selected_source_id,trust_state,conflict_count,resolution_json,last_reconciled_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET home_school_id=excluded.home_school_id,away_school_id=excluded.away_school_id,scheduled_at=excluded.scheduled_at,
      scheduled_time_known=excluded.scheduled_time_known,venue=excluded.venue,location_text=excluded.location_text,latitude=excluded.latitude,longitude=excluded.longitude,
      conference_game=excluded.conference_game,status=excluded.status,home_score=excluded.home_score,away_score=excluded.away_score,selected_source_id=excluded.selected_source_id,
      trust_state=excluded.trust_state,conflict_count=excluded.conflict_count,resolution_json=excluded.resolution_json,last_reconciled_at=excluded.last_reconciled_at,updated_at=excluded.updated_at`)
    .bind(resolved.id,resolved.sport,resolved.gender,resolved.season,resolved.participantA,resolved.participantB,resolved.homeSchoolId,resolved.awaySchoolId,
      resolved.scheduledAt,resolved.scheduledTimeKnown?1:0,resolved.venue||null,venueObservation?.location_text||resolved.venue||null,geoObservation?.latitude??null,geoObservation?.longitude??null,
      conferenceGame,resolved.status,resolved.homeScore??null,resolved.awayScore??null,resolved.selectedSourceId,resolved.trustState,resolved.conflicts.length,
      JSON.stringify(resolved.resolutionEvidence),now,now).run();
  const oldIds=[...new Set(related.map(o=>o.canonical_event_id).filter(id=>id&&id!==resolved.id))];
  for (const candidate of related) {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM canonical_event_members WHERE game_id=?").bind(candidate.id),
      env.DB.prepare("UPDATE games SET canonical_event_id=? WHERE id=?").bind(resolved.id,candidate.id),
      env.DB.prepare("INSERT OR REPLACE INTO canonical_event_members(canonical_event_id,game_id,source_id,reporting_team_id,added_at) VALUES(?,?,?,?,?)").bind(resolved.id,candidate.id,candidate.source_id,candidate.reporting_team_id,now)
    ]);
  }
  await env.DB.prepare("UPDATE event_conflicts SET resolved_at=? WHERE canonical_event_id=? AND resolved_at IS NULL").bind(now,resolved.id).run();
  for (const conflict of resolved.conflicts) {
    await env.DB.prepare("INSERT INTO event_conflicts(canonical_event_id,conflict_type,values_json,evidence_json,detected_at) VALUES(?,?,?,?,?)")
      .bind(resolved.id,conflict.type,JSON.stringify(conflict.values),JSON.stringify({gameIds:related.map(o=>o.id),sourceIds:related.map(o=>o.source_id)}),now).run();
  }
  for (const oldId of oldIds) {
    const member=await env.DB.prepare("SELECT 1 AS yes FROM canonical_event_members WHERE canonical_event_id=? LIMIT 1").bind(oldId).first();
    if (!member) await env.DB.prepare("DELETE FROM canonical_events WHERE id=?").bind(oldId).run();
  }
  return resolved.id;
}

async function reconcileSourceGames(env,sourceId){
  const {results}=await env.DB.prepare("SELECT id FROM games WHERE source_id=?").bind(sourceId).all();
  for (const row of results) await reconcileCanonicalGame(env,row.id);
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
  const team=await env.DB.prepare("SELECT t.*,s.id AS school_id FROM teams t JOIN schools s ON s.id=t.school_id WHERE t.id=?").bind(teamId).first();
  if (!team) return;
  const {results:canonical}=await env.DB.prepare(`SELECT ce.* FROM canonical_events ce
    WHERE ce.sport=? AND ce.gender=? AND ce.season=? AND (ce.home_school_id=? OR ce.away_school_id=?)`).bind(team.sport,team.gender,team.season,team.school_id,team.school_id).all();
  const {results:raw}=await env.DB.prepare("SELECT * FROM games WHERE team_id=? AND canonical_event_id IS NULL").bind(teamId).all();
  const candidates=[];
  for (const event of canonical) {
    const isHome=event.home_school_id===team.school_id;
    const isAway=event.away_school_id===team.school_id;
    candidates.push({
      school_id:team.school_id,sport:team.sport,gender:team.gender,
      opponent:isHome?event.away_school_id:isAway?event.home_school_id:event.participant_b_school_id||event.id,
      scheduled_at:event.scheduled_at,status:event.status,
      team_score:isHome?event.home_score:isAway?event.away_score:null,
      opponent_score:isHome?event.away_score:isAway?event.home_score:null,
      conference_game:event.conference_game,counts_for_record:1,
      canonical_event_id:event.id,data_trust:event.trust_state,
      source_type:"official-conference",parser_type:"dragonfly-public"
    });
  }
  for (const game of raw) {
    candidates.push({...game,school_id:team.school_id,sport:team.sport,gender:team.gender,opponent:game.opponent_school_id||game.opponent});
  }
  const record=recordFromScheduleRows(candidates,{reportingSchoolId:team.school_id,maxMinutes:15});
  const now=new Date().toISOString();
  await env.DB.prepare(`INSERT INTO team_records(team_id,wins,losses,ties,conference_wins,conference_losses,conference_ties,calculated_at)
    VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(team_id) DO UPDATE SET wins=excluded.wins,losses=excluded.losses,ties=excluded.ties,conference_wins=excluded.conference_wins,conference_losses=excluded.conference_losses,conference_ties=excluded.conference_ties,calculated_at=excluded.calculated_at`)
    .bind(teamId,record.wins,record.losses,record.ties,record.conference_wins,record.conference_losses,record.conference_ties,now).run();
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
