import { dateKeyInZone } from "./schedule-authority-core.js";
import { zonedIso } from "./parser-core.js";
import { maxPrepsScoresUrl, matchLocalVolleyballTeams, parseMaxPrepsVolleyballScores } from "./maxpreps-volleyball-results.js";
import { rebuildTeamRecords } from "./record-rebuild.js";
import { reconcileResolvedObservation, upsertResolvedObservation } from "./canonical-observation-writer.js";

const TIME_ZONE="America/Chicago";
const SOURCE_PREFIX="maxpreps-volleyball-results:";
const SOURCE_AUTHORITY_RANK=80;

function localDateAt(value) {
  return dateKeyInZone(value instanceof Date?value.toISOString():value,TIME_ZONE);
}

function localDateOffset(localDate,days) {
  const [y,m,d]=String(localDate).split("-").map(Number);
  const noon=new Date(Date.UTC(y,m-1,d+days,18,0,0));
  return new Intl.DateTimeFormat("en-CA",{timeZone:TIME_ZONE,year:"numeric",month:"2-digit",day:"2-digit"}).format(noon);
}

function localIso(localDate,{hour=0,minute=0}={}) {
  const [year,month,day]=String(localDate).split("-").map(Number);
  return zonedIso({year,month,day,hour,minute},TIME_ZONE);
}

function pairKey(a,b,date) {
  return `${[a,b].sort().join("|")}|${date}`;
}

function scoreMapForFinal(final) {
  return new Map([
    [final.homeTeam.school_id,Number(final.home.score)],
    [final.awayTeam.school_id,Number(final.away.score)]
  ]);
}

function canonicalMatchesFinal(event,final) {
  if(!event || event.status!=="FINAL") return false;
  const scores=scoreMapForFinal(final);
  if(event.home_school_id && event.away_school_id) {
    return Number(event.home_score)===scores.get(event.home_school_id)
      && Number(event.away_score)===scores.get(event.away_school_id);
  }
  return false;
}

async function loadLocalTeams(env) {
  const {results}=await env.DB.prepare(`
    SELECT t.id AS team_id,t.school_id,t.sport,t.gender,t.season,t.conference_id,
      COALESCE(NULLIF(s.location_matched_name,''),s.name) AS school_name
    FROM teams t JOIN schools s ON s.id=t.school_id
    WHERE t.active=1 AND t.sport='volleyball' AND t.gender='girls' AND t.season='2026'
      AND s.level='high-school' AND s.catalog_scope='local'
  `).all();
  return results||[];
}

async function loadExistingCanonicals(env,dates,targetSchoolIds=null) {
  if(!dates.length) return [];
  const first=[...dates].sort()[0],last=[...dates].sort().at(-1);
  const start=localIso(first);
  const end=localIso(localDateOffset(last,1));
  const scoped=targetSchoolIds?.length?[...new Set(targetSchoolIds.filter(Boolean))]:null;
  let sql=`
    SELECT id,participant_a_school_id,participant_b_school_id,home_school_id,away_school_id,
      scheduled_at,status,home_score,away_score,conference_game
    FROM canonical_events
    WHERE sport='volleyball' AND gender='girls' AND season='2026'
      AND datetime(scheduled_at)>=datetime(?) AND datetime(scheduled_at)<datetime(?)`;
  if(scoped) sql+=` AND (
    participant_a_school_id IN (SELECT value FROM json_each(?))
    OR participant_b_school_id IN (SELECT value FROM json_each(?))
  )`;
  let query=env.DB.prepare(sql);
  query=scoped?query.bind(start,end,JSON.stringify(scoped),JSON.stringify(scoped)):query.bind(start,end);
  const {results}=await query.all();
  return results||[];
}

function indexCanonicals(rows) {
  const map=new Map();
  for(const row of rows||[]) {
    const date=localDateAt(row.scheduled_at);
    if(!date) continue;
    const key=pairKey(row.participant_a_school_id,row.participant_b_school_id,date);
    if(!map.has(key)) map.set(key,[]);
    map.get(key).push(row);
  }
  return map;
}

async function ensureSecondarySource(env,team,checkedAt) {
  const id=`${SOURCE_PREFIX}${team.team_id}`;
  const sourceUrl="https://www.maxpreps.com/ar/volleyball/scores/";
  await env.DB.prepare(`
    INSERT OR IGNORE INTO sources
      (id,team_id,source_url,source_type,source_priority,parser_type,parser_version,timezone,
       expected_min_games,refresh_minutes,active_result_minutes,enabled,authority_rank,stale_after_minutes,
       last_successful_fetch_at,last_checked_at,last_http_status,updated_at)
    VALUES(?,?,?,'secondary',9,'maxpreps-scores','1',?,1,1440,60,0,?,2880,?,?,200,?)
  `).bind(id,team.team_id,sourceUrl,TIME_ZONE,SOURCE_AUTHORITY_RANK,checkedAt,checkedAt,checkedAt).run();
  return {
    id,
    team_id:team.team_id,
    source_url:sourceUrl,
    source_type:"secondary",
    source_priority:9,
    parser_type:"maxpreps-scores",
    parser_version:"1",
    timezone:TIME_ZONE,
    authority_rank:SOURCE_AUTHORITY_RANK
  };
}

function observationFor(final,reporting,opponent,checkedAt) {
  const isHome=reporting.school_id===final.homeTeam.school_id;
  const teamScore=isHome?final.home.score:final.away.score;
  const opponentScore=isHome?final.away.score:final.home.score;
  return {
    sourceEventKey:`native:${final.contestId}`,
    opponent:opponent.school_name,
    scheduledAt:localIso(final.localDate,{hour:12}),
    scheduledTimeKnown:false,
    venue:null,
    locationText:null,
    latitude:null,
    longitude:null,
    homeAway:isHome?"home":"away",
    conferenceGame:false,
    countsForRecord:true,
    status:"FINAL",
    teamScore:Number(teamScore),
    opponentScore:Number(opponentScore),
    result:Number(teamScore)===Number(opponentScore)?"T":Number(teamScore)>Number(opponentScore)?"W":"L",
    notes:"Secondary final from MaxPreps statewide scores",
    sourceUpdatedAt:checkedAt
  };
}

export function datesForMaxPrepsVolleyballFallback(plan,when=new Date()) {
  if(!plan) return [];
  const today=localDateAt(when);
  if(!today) return [];
  if(plan.runVolleyballLive) return [today];
  if(plan.kind==="morning-results") return [localDateOffset(today,-1)];
  if(plan.kind==="evening-results") return [today];
  return [];
}

export async function runMaxPrepsVolleyballResultFallback(env,{
  dates,
  fetchFn=fetch,
  now=new Date(),
  targetTeamIds=null
}={}) {
  const checkedAt=now.toISOString();
  const requested=[...new Set((dates||[]).filter(date=>/^\d{4}-\d{2}-\d{2}$/.test(date)))];
  if(!requested.length) return {status:"SKIPPED",dates:[],pagesFetched:0,parsedFinals:0,matchedFinals:0,touchedTeams:0,writes:0};

  const localTeams=await loadLocalTeams(env);
  const targetSet=targetTeamIds?.length?new Set(targetTeamIds.map(String)):null;
  const targetSchools=targetSet?[...new Set(localTeams.filter(team=>targetSet.has(String(team.team_id))).map(team=>team.school_id))]:null;
  if(targetSet && !targetSchools.length) {
    return {status:"SKIPPED",reason:"NO_TARGET_TEAMS",dates:requested,pagesFetched:0,parsedFinals:0,matchedFinals:0,touchedTeams:0,writes:0};
  }
  const existing=indexCanonicals(await loadExistingCanonicals(env,requested,targetSchools));
  const candidateFinals=[];
  let parsedFinals=0,ambiguousMatches=0,pagesFetched=0;

  for(const localDate of requested) {
    const url=maxPrepsScoresUrl(localDate);
    const response=await fetchFn(url,{headers:{"user-agent":"LocalBleachersAR-maxpreps-results/1.0","accept":"text/html,application/xhtml+xml"}});
    if(!response.ok) throw new Error(`MaxPreps volleyball scores HTTP ${response.status} for ${localDate}`);
    const html=await response.text();
    pagesFetched++;
    const parsed=parseMaxPrepsVolleyballScores(html,{localDate,sourceUrl:response.url||url});
    parsedFinals+=parsed.length;
    const matched=matchLocalVolleyballTeams(parsed,localTeams);
    ambiguousMatches+=matched.ambiguous.length;
    for(const final of matched.matched) {
      if(targetSet && !targetSet.has(String(final.homeTeam.team_id)) && !targetSet.has(String(final.awayTeam.team_id))) continue;
      const key=pairKey(final.homeTeam.school_id,final.awayTeam.school_id,final.localDate);
      const canonicals=existing.get(key)||[];
      if(canonicals.some(event=>canonicalMatchesFinal(event,final))) continue;
      candidateFinals.push(final);
    }
  }

  if(!candidateFinals.length) {
    return {status:"NOT_MODIFIED",dates:requested,pagesFetched,parsedFinals,matchedFinals:0,ambiguousMatches,touchedTeams:0,writes:0};
  }

  const sources=new Map();
  const touched=new Set();
  let observations=0,reconciled=0;
  for(const final of candidateFinals) {
    for(const [reporting,opponent] of [[final.homeTeam,final.awayTeam],[final.awayTeam,final.homeTeam]]) {
      let source=sources.get(reporting.team_id);
      if(!source) {
        source=await ensureSecondarySource(env,reporting,checkedAt);
        sources.set(reporting.team_id,source);
      }
      const game=observationFor(final,reporting,opponent,checkedAt);
      const gameId=await upsertResolvedObservation(env,source,game,checkedAt,{opponentSchoolId:opponent.school_id});
      observations++;
      const canonicalId=await reconcileResolvedObservation(env,gameId);
      if(canonicalId) reconciled++;
      touched.add(reporting.team_id);
    }
  }

  const recordResult=await rebuildTeamRecords(env,[...touched],checkedAt);
  return {
    status:"SUCCESS",
    dates:requested,
    targetTeams:targetSet?.size??null,
    pagesFetched,
    parsedFinals,
    matchedFinals:candidateFinals.length,
    ambiguousMatches,
    observations,
    reconciled,
    touchedTeams:touched.size,
    recordResult,
    writes:observations+sources.size
  };
}

export { SOURCE_AUTHORITY_RANK, SOURCE_PREFIX };
