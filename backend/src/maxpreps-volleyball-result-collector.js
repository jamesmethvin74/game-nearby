import { dateKeyInZone, normalizeSchoolAlias } from "./schedule-authority-core.js";
import { zonedIso } from "./parser-core.js";
import { maxPrepsScoresUrl, matchLocalVolleyballTeams, parseMaxPrepsVolleyballScores } from "./maxpreps-volleyball-results.js";
import { rebuildTeamRecords } from "./record-rebuild.js";
import { reconcileResolvedObservation, upsertResolvedObservation } from "./canonical-observation-writer.js";

const TIME_ZONE="America/Chicago";
const SOURCE_PREFIX="maxpreps-volleyball-results:";
const SOURCE_AUTHORITY_RANK=80;
const MAXPREPS_IDENTITY_PROVIDER="maxpreps";

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

function fnv1a32(value) {
  let hash=0x811c9dc5;
  for(const char of String(value||"")) {
    hash^=char.codePointAt(0);
    hash=Math.imul(hash,0x01000193)>>>0;
  }
  return hash.toString(16).padStart(8,"0");
}

function maxPrepsOpponentSchoolId(externalId,name) {
  const safe=String(externalId||name||"opponent")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g,"-")
    .replace(/^-+|-+$/g,"")
    .slice(0,36)||"opponent";
  return `mp-${safe}-${fnv1a32(`${externalId}|${name}`)}`;
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

async function loadOpponentIdentityContext(env,identityProvider=MAXPREPS_IDENTITY_PROVIDER) {
  const {results:schools}=await env.DB.prepare(`
    WITH local_vb AS (
      SELECT school_id,MIN(id) AS team_id
      FROM teams
      WHERE active=1 AND sport='volleyball' AND gender='girls' AND season='2026'
      GROUP BY school_id
    )
    SELECT s.id,COALESCE(NULLIF(s.location_matched_name,''),s.name) AS school_name,
      s.catalog_scope,local_vb.team_id
    FROM schools s
    LEFT JOIN local_vb ON local_vb.school_id=s.id
    WHERE s.level='high-school'
  `).all();
  const {results:identities}=await env.DB.prepare(`
    SELECT external_school_id,school_id
    FROM school_external_identities
    WHERE provider=?
  `).bind(identityProvider).all();
  const byId=new Map();
  const byName=new Map();
  for(const school of schools||[]) {
    byId.set(school.id,school);
    const key=normalizeSchoolAlias(school.school_name);
    if(!key) continue;
    if(!byName.has(key)) byName.set(key,[]);
    byName.get(key).push(school);
  }
  return {
    byId,
    byName,
    identityByExternal:new Map((identities||[]).map(row=>[String(row.external_school_id),row.school_id]))
  };
}

function planOpponentSchool(context,side) {
  const externalId=String(side?.maxprepsId||"").trim();
  const observedName=String(side?.name||"").trim();
  if(!externalId || !observedName) return {ambiguous:true};

  const identitySchoolId=context.identityByExternal.get(externalId);
  if(identitySchoolId) {
    const school=context.byId.get(identitySchoolId);
    if(!school) return {ambiguous:true};
    return {
      school:{school_id:school.id,school_name:school.school_name,catalog_scope:school.catalog_scope,team_id:school.team_id||null},
      externalId,observedName,createSchool:false,linkIdentity:false
    };
  }

  const candidates=context.byName.get(normalizeSchoolAlias(observedName))||[];
  if(candidates.length>1) return {ambiguous:true};
  if(candidates.length===1) {
    const school=candidates[0];
    return {
      school:{school_id:school.id,school_name:school.school_name,catalog_scope:school.catalog_scope,team_id:school.team_id||null},
      externalId,observedName,createSchool:false,linkIdentity:true
    };
  }

  const schoolId=maxPrepsOpponentSchoolId(externalId,observedName);
  return {
    school:{school_id:schoolId,school_name:observedName,catalog_scope:"opponent-only"},
    externalId,observedName,createSchool:true,linkIdentity:true
  };
}

async function persistOpponentPlan(env,plan,checkedAt,identityProvider=MAXPREPS_IDENTITY_PROVIDER) {
  let schoolCreated=0,identityLinked=0;
  if(plan.createSchool) {
    const result=await env.DB.prepare(`
      INSERT OR IGNORE INTO schools
        (id,name,city,state,level,catalog_scope,membership_source,membership_verified_at,updated_at)
      VALUES(?,?, '', '', 'high-school','opponent-only','maxpreps-result-opponent',NULL,?)
    `).bind(plan.school.school_id,plan.observedName,checkedAt).run();
    schoolCreated=Number(result?.meta?.changes??result?.changes??0)>0?1:0;
  }
  if(plan.linkIdentity) {
    const result=await env.DB.prepare(`
      INSERT INTO school_external_identities
        (provider,external_school_id,school_id,observed_name,last_seen_at,updated_at)
      VALUES(?,?,?,?,?,?)
      ON CONFLICT(provider,external_school_id) DO UPDATE SET
        observed_name=excluded.observed_name,last_seen_at=excluded.last_seen_at,updated_at=excluded.updated_at
    `).bind(identityProvider,plan.externalId,plan.school.school_id,plan.observedName,checkedAt,checkedAt).run();
    identityLinked=Number(result?.meta?.changes??result?.changes??0)>0?1:0;
  }
  return {schoolCreated,identityLinked};
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
  targetTeamIds=null,
  opponentIdentityProvider=MAXPREPS_IDENTITY_PROVIDER
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
  const localLocal=[];
  const oneSided=[];
  let parsedFinals=0,ambiguousMatches=0,oneSidedMatches=0,pagesFetched=0;

  for(const localDate of requested) {
    const url=maxPrepsScoresUrl(localDate);
    const response=await fetchFn(url,{headers:{"user-agent":"LocalBleachersAR-maxpreps-results/1.0","accept":"text/html,application/xhtml+xml"}});
    if(!response.ok) throw new Error(`MaxPreps volleyball scores HTTP ${response.status} for ${localDate}`);
    const html=await response.text();
    pagesFetched++;
    const parsed=parseMaxPrepsVolleyballScores(html,{localDate,sourceUrl:response.url||url});
    parsedFinals+=parsed.length;
    const matches=matchLocalVolleyballTeams(parsed,localTeams);
    ambiguousMatches+=matches.ambiguous.length;
    oneSidedMatches+=matches.oneSided.length;
    for(const final of matches.matched) {
      if(targetSet && !targetSet.has(String(final.homeTeam.team_id)) && !targetSet.has(String(final.awayTeam.team_id))) continue;
      localLocal.push(final);
    }
    for(const final of matches.oneSided) {
      const localTeam=final.homeTeam?.team_id?final.homeTeam:final.awayTeam;
      if(targetSet && !targetSet.has(String(localTeam?.team_id))) continue;
      oneSided.push(final);
    }
  }

  const resolvedFinals=[...localLocal];
  if(oneSided.length) {
    const context=await loadOpponentIdentityContext(env,opponentIdentityProvider);
    for(const final of oneSided) {
      const sideKey=final.unresolvedSide;
      const plan=planOpponentSchool(context,final[sideKey]);
      if(plan.ambiguous) {
        ambiguousMatches++;
        continue;
      }
      resolvedFinals.push({
        ...final,
        homeTeam:sideKey==="home"?plan.school:final.homeTeam,
        awayTeam:sideKey==="away"?plan.school:final.awayTeam,
        opponentPlan:plan
      });
    }
  }

  const candidateFinals=[];
  for(const final of resolvedFinals) {
    const key=pairKey(final.homeTeam.school_id,final.awayTeam.school_id,final.localDate);
    const canonicals=existing.get(key)||[];
    if(canonicals.some(event=>canonicalMatchesFinal(event,final))) continue;
    candidateFinals.push(final);
  }

  if(!candidateFinals.length) {
    return {status:"NOT_MODIFIED",dates:requested,pagesFetched,parsedFinals,matchedFinals:0,oneSidedMatches,ambiguousMatches,touchedTeams:0,writes:0};
  }

  const sources=new Map();
  const touched=new Set();
  const persistedOpponents=new Map();
  let observations=0,reconciled=0,opponentSchoolsMaterialized=0,opponentIdentitiesLinked=0;
  for(const final of candidateFinals) {
    if(final.opponentPlan) {
      const key=final.opponentPlan.externalId;
      if(!persistedOpponents.has(key)) {
        const persisted=await persistOpponentPlan(env,final.opponentPlan,checkedAt,opponentIdentityProvider);
        persistedOpponents.set(key,persisted);
        opponentSchoolsMaterialized+=persisted.schoolCreated;
        opponentIdentitiesLinked+=persisted.identityLinked;
      }
    }
    const reportingPairs=[];
    if(final.homeTeam?.team_id) reportingPairs.push([final.homeTeam,final.awayTeam]);
    if(final.awayTeam?.team_id) reportingPairs.push([final.awayTeam,final.homeTeam]);
    for(const [reporting,opponent] of reportingPairs) {
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
    oneSidedMatches,
    ambiguousMatches,
    observations,
    reconciled,
    opponentSchoolsMaterialized,
    opponentIdentitiesLinked,
    touchedTeams:touched.size,
    recordResult,
    writes:observations+sources.size+opponentSchoolsMaterialized+opponentIdentitiesLinked
  };
}

export { MAXPREPS_IDENTITY_PROVIDER, SOURCE_AUTHORITY_RANK, SOURCE_PREFIX };
