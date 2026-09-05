import { normalizeSchoolAlias, resolveCanonicalEvent } from "./schedule-authority-core.js";
import { rebuildTeamRecords } from "./record-rebuild.js";

const ARCHIVE_URL="https://hootens.com/weekly-matchups/";
const STATE_ID="hootens:football:current";
const USER_AGENT="LocalBleachersAR/2.0 (+https://github.com/jamesmethvin74/game-nearby)";
const LOOKBACK_HOURS=42;
const LOOKAHEAD_HOURS=8;

function clean(value){return String(value??"").replace(/\u00a0/g," ").replace(/\s+/g," ").trim();}
function safe(value){return clean(value).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");}
function intScore(value){const text=clean(value);if(!/\d/.test(text))return null;const n=Number(text.replace(/[^0-9-]/g,""));return Number.isFinite(n)?n:null;}
function resultCode(teamScore,opponentScore){return teamScore===opponentScore?"T":teamScore>opponentScore?"W":"L";}
function hashText(value){let hash=2166136261;for(let i=0;i<value.length;i++){hash^=value.charCodeAt(i);hash=Math.imul(hash,16777619);}return (hash>>>0).toString(16).padStart(8,"0");}

export function expandedAlias(value){
  let text=normalizeSchoolAlias(value);
  text=text.replace(/^lr\s+/,"little rock ").replace(/^fs\s+/,"fort smith ").replace(/^hs\s+lakeside$/,"hot springs lakeside");
  text=text.replace(/^har ber springdale$/,"springdale har ber").replace(/^heritage rogers$/,"rogers heritage").replace(/^southside batesville$/,"batesville southside");
  text=text.replace(/^harmony grove haskell$/,"haskell harmony grove");
  return text;
}

export function normalizeHootensRows(rows=[]){
  const out=[];
  for(const row of rows){
    const links=Array.isArray(row?.teamLinks)?row.teamLinks:[];
    const cells=Array.isArray(row?.cells)?row.cells:[];
    if(links.length<2 || cells.length<4) continue;
    const status=clean(cells[2]).toLowerCase();
    if(!/\bfinal\b/.test(status)) continue;
    const homeScore=intScore(cells[1]),awayScore=intScore(cells[3]);
    if(homeScore==null||awayScore==null) continue;
    const homeName=clean(links[0]?.text),awayName=clean(links[1]?.text);
    if(!homeName||!awayName) continue;
    out.push({
      homeName,awayName,homeScore,awayScore,status:"FINAL",
      homeHref:clean(links[0]?.href)||null,awayHref:clean(links[1]?.href)||null,
      sourceEventKey:`hootens:${safe(homeName)}:${safe(awayName)}`
    });
  }
  return out;
}

async function extractScoreboardRows(html,HTMLRewriterClass=globalThis.HTMLRewriter){
  if(!HTMLRewriterClass) throw new Error("HTMLRewriter unavailable for Hooten scoreboard parse");
  const state={current:null,rows:[]};
  const response=new HTMLRewriterClass()
    .on("tr",{element(el){state.current={cells:["","","","",""],cellIndex:-1,teamLinks:[],activeLink:null};state.rows.push(state.current);el.onEndTag(()=>{state.current=null;});}})
    .on("tr td",{element(){if(state.current)state.current.cellIndex+=1;},text(chunk){if(state.current&&state.current.cellIndex>=0&&state.current.cellIndex<state.current.cells.length)state.current.cells[state.current.cellIndex]+=chunk.text+" ";}})
    .on("tr a[href*='/teams/']",{element(el){if(!state.current)return;const link={href:el.getAttribute("href")||"",text:""};state.current.teamLinks.push(link);state.current.activeLink=link;el.onEndTag(()=>{if(state.current)state.current.activeLink=null;});},text(chunk){if(state.current?.activeLink)state.current.activeLink.text+=chunk.text+" ";}})
    .transform(new Response(html));
  await response.text();
  return state.rows;
}

async function discoverCurrentScoreboardUrl(fetchFn=fetch,HTMLRewriterClass=globalThis.HTMLRewriter){
  const response=await fetchFn(ARCHIVE_URL,{headers:{"user-agent":USER_AGENT,"accept":"text/html,application/xhtml+xml"},redirect:"follow"});
  if(!response.ok) throw new Error(`Hooten archive HTTP ${response.status}`);
  const html=await response.text();
  if(!HTMLRewriterClass) throw new Error("HTMLRewriter unavailable for Hooten archive parse");
  const anchors=[];let active=null;
  const parsed=new HTMLRewriterClass().on("a",{
    element(el){active={href:el.getAttribute("href")||"",text:""};anchors.push(active);el.onEndTag(()=>{active=null;});},
    text(chunk){if(active)active.text+=chunk.text+" ";}
  }).transform(new Response(html));
  await parsed.text();
  const found=anchors.find(item=>/scoreboard\s+week\s+\d+/i.test(clean(item.text))&&/\/matchup\//i.test(item.href));
  if(!found) throw new Error("Hooten current scoreboard link not found");
  return new URL(found.href,ARCHIVE_URL).toString();
}

function indexSchoolAliases(schools,aliases){
  const byAlias=new Map();
  const add=(alias,school)=>{
    const key=expandedAlias(alias);if(!key)return;
    const current=byAlias.get(key);
    if(!current)byAlias.set(key,school);
    else if(current.school_id!==school.school_id)byAlias.set(key,null);
  };
  for(const school of schools){add(school.school_name,school);add(`${school.school_name} ${school.mascot||""}`,school);}
  const schoolById=new Map(schools.map(s=>[s.school_id,s]));
  for(const alias of aliases){const school=schoolById.get(alias.school_id);if(school)add(alias.alias_text||alias.normalized_alias,school);}
  return byAlias;
}

function pickSchool(name,index){return index.get(expandedAlias(name))||null;}
function chooseAnchor(candidates,opponentName,opponentSchoolId){
  if(!candidates?.length)return null;
  if(opponentSchoolId){const exact=candidates.find(g=>g.opponent_school_id===opponentSchoolId);if(exact)return exact;}
  const target=expandedAlias(opponentName);
  const exact=candidates.find(g=>expandedAlias(g.opponent)===target);if(exact)return exact;
  return candidates[0]||null;
}

async function loadContext(env){
  const [schoolsResult,aliasesResult,gamesResult]=await Promise.all([
    env.DB.prepare(`SELECT t.id AS team_id,t.school_id,s.name AS school_name,s.mascot FROM teams t JOIN schools s ON s.id=t.school_id WHERE t.active=1 AND t.sport='football' AND t.gender='boys' AND t.season='2026' AND s.level='high-school' AND s.state='AR' AND s.catalog_scope='local'`).all(),
    env.DB.prepare(`SELECT sa.normalized_alias,sa.alias_text,sa.school_id FROM school_aliases sa JOIN teams t ON t.school_id=sa.school_id WHERE t.active=1 AND t.sport='football' AND t.gender='boys' AND t.season='2026'`).all(),
    env.DB.prepare(`SELECT g.*,src.authority_rank,src.source_priority,src.parser_type,t.school_id,s.name AS school_name FROM games g JOIN sources src ON src.id=g.source_id JOIN teams t ON t.id=g.team_id JOIN schools s ON s.id=t.school_id WHERE t.active=1 AND t.sport='football' AND t.gender='boys' AND t.season='2026' AND s.level='high-school' AND s.state='AR' AND s.catalog_scope='local' AND datetime(g.scheduled_at) BETWEEN datetime('now','-${LOOKBACK_HOURS} hours') AND datetime('now','+${LOOKAHEAD_HOURS} hours') ORDER BY src.authority_rank,src.source_priority,src.id`).all()
  ]);
  return {
    schools:schoolsResult.results||[],aliases:aliasesResult.results||[],games:gamesResult.results||[],
    meta:{rowsRead:Number(schoolsResult.meta?.rows_read||0)+Number(aliasesResult.meta?.rows_read||0)+Number(gamesResult.meta?.rows_read||0)}
  };
}

async function ensureHootenSource(env,school,scoreboardUrl,checkedAt){
  const sourceId=`${school.team_id}-hootens-statewide`;
  await env.DB.prepare(`
    INSERT INTO sources(id,team_id,source_url,source_type,source_priority,parser_type,parser_version,timezone,expected_min_games,refresh_minutes,active_result_minutes,enabled,authority_rank,stale_after_minutes,collection_mode,updated_at)
    VALUES(?,?,?,'media-scoreboard',90,'hootens-statewide','1','America/Chicago',1,30,5,0,90,180,'statewide',?)
    ON CONFLICT(id) DO UPDATE SET source_url=excluded.source_url,updated_at=excluded.updated_at
  `).bind(sourceId,school.team_id,scoreboardUrl,checkedAt).run();
  return {...school,id:sourceId,source_url:scoreboardUrl,source_type:"media-scoreboard",source_priority:90,parser_type:"hootens-statewide",parser_version:"1",timezone:"America/Chicago",authority_rank:90};
}

async function upsertHootenObservation(env,source,anchor,final,teamScore,opponentScore,checkedAt){
  const sourceEventKey=`${final.sourceEventKey}:${safe(anchor.scheduled_at)}`;
  const id=`${source.id}:${sourceEventKey}`;
  await env.DB.prepare(`
    INSERT INTO games(id,team_id,source_id,source_event_key,opponent,opponent_school_id,scheduled_at,scheduled_time_known,venue,location_text,latitude,longitude,home_away,conference_game,counts_for_record,status,team_score,opponent_score,result,notes,source_url,source_updated_at,last_checked_at,updated_at,canonical_event_id)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(source_id,source_event_key) DO UPDATE SET
      opponent=excluded.opponent,opponent_school_id=excluded.opponent_school_id,scheduled_at=excluded.scheduled_at,scheduled_time_known=excluded.scheduled_time_known,
      venue=excluded.venue,location_text=excluded.location_text,latitude=excluded.latitude,longitude=excluded.longitude,home_away=excluded.home_away,
      conference_game=excluded.conference_game,counts_for_record=excluded.counts_for_record,status=excluded.status,team_score=excluded.team_score,
      opponent_score=excluded.opponent_score,result=excluded.result,notes=excluded.notes,source_url=excluded.source_url,
      source_updated_at=excluded.source_updated_at,last_checked_at=excluded.last_checked_at,updated_at=excluded.updated_at,canonical_event_id=excluded.canonical_event_id
  `).bind(
    id,source.team_id,source.id,sourceEventKey,anchor.opponent,anchor.opponent_school_id,anchor.scheduled_at,anchor.scheduled_time_known,
    anchor.venue||null,anchor.location_text||null,anchor.latitude??null,anchor.longitude??null,anchor.home_away,anchor.conference_game,
    anchor.counts_for_record,"FINAL",teamScore,opponentScore,resultCode(teamScore,opponentScore),"Hooten's statewide scoreboard final",
    source.source_url,checkedAt,checkedAt,checkedAt,anchor.canonical_event_id
  ).run();
  await env.DB.prepare(`INSERT OR REPLACE INTO canonical_event_members(canonical_event_id,game_id,source_id,reporting_team_id,added_at) VALUES(?,?,?,?,?)`)
    .bind(anchor.canonical_event_id,id,source.id,source.team_id,checkedAt).run();
  return id;
}

async function reconcileAnchoredCanonical(env,canonicalId,checkedAt){
  const result=await env.DB.prepare(`
    SELECT g.*,t.sport,t.gender,t.season,t.id AS reporting_team_id,sch.id AS reporting_school_id,sch.name AS reporting_school_name,
      src.source_type,src.parser_type,src.source_priority,src.authority_rank,src.timezone
    FROM games g JOIN teams t ON t.id=g.team_id JOIN schools sch ON sch.id=t.school_id JOIN sources src ON src.id=g.source_id
    WHERE g.canonical_event_id=? ORDER BY src.authority_rank,src.source_priority,src.id
  `).bind(canonicalId).all();
  const observations=result.results||[];
  if(!observations.length)return null;
  let resolved;
  try{resolved=resolveCanonicalEvent(observations,{timeZone:"America/Chicago",now:checkedAt});}
  catch(error){console.warn("Hooten canonical reconciliation skipped",{canonicalId,error:String(error?.message||error)});return null;}
  const selected=observations.find(o=>o.id===resolved.resolutionEvidence.selectedObservationId)||observations[0];
  const venueObservation=observations.find(o=>o.id===resolved.resolutionEvidence.venueObservationId)||selected;
  const geoObservation=observations.find(o=>o.latitude!=null&&o.longitude!=null)||selected;
  await env.DB.prepare(`
    UPDATE canonical_events SET
      home_school_id=?,away_school_id=?,scheduled_at=?,scheduled_time_known=?,venue=?,location_text=?,latitude=?,longitude=?,conference_game=?,
      status=?,home_score=?,away_score=?,selected_source_id=?,trust_state=?,conflict_count=?,resolution_json=?,last_reconciled_at=?,updated_at=?
    WHERE id=?
  `).bind(
    resolved.homeSchoolId,resolved.awaySchoolId,resolved.scheduledAt,resolved.scheduledTimeKnown?1:0,resolved.venue||null,
    venueObservation?.location_text||resolved.venue||null,geoObservation?.latitude??null,geoObservation?.longitude??null,Number(selected?.conference_game||0),
    resolved.status,resolved.homeScore??null,resolved.awayScore??null,resolved.selectedSourceId,resolved.trustState,resolved.conflicts.length,
    JSON.stringify(resolved.resolutionEvidence),checkedAt,checkedAt,canonicalId
  ).run();
  await env.DB.prepare("UPDATE event_conflicts SET resolved_at=? WHERE canonical_event_id=? AND resolved_at IS NULL").bind(checkedAt,canonicalId).run();
  for(const conflict of resolved.conflicts){
    await env.DB.prepare("INSERT INTO event_conflicts(canonical_event_id,conflict_type,values_json,evidence_json,detected_at) VALUES(?,?,?,?,?)")
      .bind(canonicalId,conflict.type,JSON.stringify(conflict.values),JSON.stringify({gameIds:observations.map(o=>o.id),sourceIds:observations.map(o=>o.source_id)}),checkedAt).run();
  }
  return resolved;
}

async function updateRawAnchor(env,anchor,teamScore,opponentScore,checkedAt,scoreboardUrl){
  await env.DB.prepare(`
    UPDATE games SET status='FINAL',team_score=?,opponent_score=?,result=?,notes=CASE WHEN notes IS NULL OR notes='' THEN ? ELSE notes END,last_checked_at=?,updated_at=? WHERE id=?
  `).bind(teamScore,opponentScore,resultCode(teamScore,opponentScore),`Final score verified from Hooten's statewide scoreboard: ${scoreboardUrl}`,checkedAt,checkedAt,anchor.id).run();
}

async function saveState(env,{scoreboardUrl,signature,checkedAt,finals,matched,unmatched,status,error=null}){
  const details=JSON.stringify({scoreboardUrl,signature,finals,matched,unmatched});
  await env.DB.prepare(`
    INSERT INTO statewide_collection_state(id,provider,feed_url,last_checked_at,last_successful_fetch_at,last_event_count,consecutive_failures,last_error,details_json,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      provider=excluded.provider,feed_url=excluded.feed_url,last_checked_at=excluded.last_checked_at,
      last_successful_fetch_at=COALESCE(excluded.last_successful_fetch_at,statewide_collection_state.last_successful_fetch_at),
      last_event_count=CASE WHEN excluded.last_successful_fetch_at IS NOT NULL THEN excluded.last_event_count ELSE statewide_collection_state.last_event_count END,
      consecutive_failures=CASE WHEN excluded.last_successful_fetch_at IS NOT NULL THEN 0 ELSE COALESCE(statewide_collection_state.consecutive_failures,0)+1 END,
      last_error=excluded.last_error,details_json=excluded.details_json,updated_at=excluded.updated_at
  `).bind(STATE_ID,"hootens",scoreboardUrl,checkedAt,status==="SUCCESS"?checkedAt:null,finals,status==="SUCCESS"?0:1,error,details,checkedAt).run();
}

export async function runHootensStatewideResults(env,{fetchFn=fetch,HTMLRewriterClass=globalThis.HTMLRewriter,now=new Date(),force=false}={}){
  const checkedAt=now.toISOString();let scoreboardUrl="";
  try{
    scoreboardUrl=await discoverCurrentScoreboardUrl(fetchFn,HTMLRewriterClass);
    const response=await fetchFn(scoreboardUrl,{headers:{"user-agent":USER_AGENT,"accept":"text/html,application/xhtml+xml"},redirect:"follow"});
    if(!response.ok)throw new Error(`Hooten scoreboard HTTP ${response.status}`);
    const rows=await extractScoreboardRows(await response.text(),HTMLRewriterClass);
    const finals=normalizeHootensRows(rows);
    const signature=`${finals.length}:${hashText(JSON.stringify(finals.map(f=>[f.homeName,f.homeScore,f.awayName,f.awayScore]).sort()))}`;
    const prior=await env.DB.prepare("SELECT details_json FROM statewide_collection_state WHERE id=?").bind(STATE_ID).first();
    if(!force&&prior?.details_json){
      try{
        const details=JSON.parse(prior.details_json);
        if(details.signature===signature){
          await saveState(env,{scoreboardUrl,signature,checkedAt,finals:finals.length,matched:Number(details.matched||0),unmatched:Number(details.unmatched||0),status:"SUCCESS"});
          return {status:"NOT_MODIFIED",scoreboardUrl,finals:finals.length,matched:Number(details.matched||0),unmatched:Number(details.unmatched||0),touchedTeams:0};
        }
      }catch{}
    }

    const context=await loadContext(env);
    const aliasIndex=indexSchoolAliases(context.schools,context.aliases);
    const gamesBySchool=new Map();
    for(const game of context.games){if(!gamesBySchool.has(game.school_id))gamesBySchool.set(game.school_id,[]);gamesBySchool.get(game.school_id).push(game);}
    const touched=new Set();let matched=0;const unmatched=[];

    for(const final of finals){
      const left=pickSchool(final.homeName,aliasIndex),right=pickSchool(final.awayName,aliasIndex);
      const reporting=left||right;
      if(!reporting){unmatched.push({home:final.homeName,away:final.awayName,reason:"no_local_school_match"});continue;}
      const reportingIsLeft=Boolean(left);
      const opponentLocal=reportingIsLeft?right:left;
      const opponentName=reportingIsLeft?final.awayName:final.homeName;
      const teamScore=reportingIsLeft?final.homeScore:final.awayScore;
      const opponentScore=reportingIsLeft?final.awayScore:final.homeScore;
      const anchor=chooseAnchor(gamesBySchool.get(reporting.school_id),opponentName,opponentLocal?.school_id||null);
      if(!anchor){unmatched.push({home:final.homeName,away:final.awayName,reason:"no_recent_game_anchor",schoolId:reporting.school_id});continue;}

      if(anchor.opponent_school_id&&anchor.canonical_event_id){
        const source=await ensureHootenSource(env,reporting,scoreboardUrl,checkedAt);
        await upsertHootenObservation(env,source,anchor,final,teamScore,opponentScore,checkedAt);
        await reconcileAnchoredCanonical(env,anchor.canonical_event_id,checkedAt);
      }else{
        await updateRawAnchor(env,anchor,teamScore,opponentScore,checkedAt,scoreboardUrl);
      }
      touched.add(reporting.team_id);matched++;
      if(opponentLocal?.team_id)touched.add(opponentLocal.team_id);
    }

    if(touched.size)await rebuildTeamRecords(env,[...touched],checkedAt);
    await saveState(env,{scoreboardUrl,signature,checkedAt,finals:finals.length,matched,unmatched:unmatched.length,status:"SUCCESS"});
    console.log("Hooten statewide football results",{scoreboardUrl,finals:finals.length,matched,unmatched:unmatched.length,touchedTeams:touched.size,selectorRowsRead:context.meta.rowsRead});
    return {status:"SUCCESS",scoreboardUrl,finals:finals.length,matched,unmatched:unmatched.length,touchedTeams:touched.size,selectorRowsRead:context.meta.rowsRead,unmatchedSample:unmatched.slice(0,20)};
  }catch(error){
    const message=String(error?.message||error).slice(0,1000);
    if(scoreboardUrl)await saveState(env,{scoreboardUrl,signature:null,checkedAt,finals:0,matched:0,unmatched:0,status:"FAILURE",error:message}).catch(()=>{});
    console.error("Hooten statewide result collection failed",message);
    return {status:"FAILURE",scoreboardUrl,error:message};
  }
}

export { ARCHIVE_URL, STATE_ID };
