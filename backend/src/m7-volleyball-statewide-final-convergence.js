import { dateKeyInZone, normalizeSchoolAlias } from "./schedule-authority-core.js";
import { zonedIso } from "./parser-core.js";
import { maxPrepsScoresUrl, parseMaxPrepsVolleyballScores } from "./maxpreps-volleyball-results.js";

const TIME_ZONE="America/Chicago";
const SEASON_START="2026-08-01";
const SOURCE_PREFIX="maxpreps-volleyball-results:";
const SOURCE_URL="https://www.maxpreps.com/ar/volleyball/scores/";
const MAX_PLANNER_ROWS_READ=100000;
const MAX_LOGICAL_WRITES=2200;
const MAX_PROJECTED_D1_WRITES=20000;
const MAX_ACTUAL_D1_WRITES=25000;
const MAX_CONTESTS=260;

const CURATED_LOCAL_IDENTITIES=[
  {externalId:"ut02d8qdO0O8i_doZtI7Uw",observedName:"Robinson",schoolName:"Joe T. Robinson High School",schoolId:"df-dss449",teamId:"df-dss449-volleyball-2026"},
  {externalId:"d4Sw_RfckEKv0XOlmkG-DQ",observedName:"Founders Classical Academy",schoolName:"Founders Classical Academy - Rogers",schoolId:"df-vs7zsu",teamId:"df-vs7zsu-volleyball-2026"},
  {externalId:"C9COhYLsrUC5L1enldyxqg",observedName:"St. Joseph",schoolName:"St. Joseph Catholic School",schoolId:"df-snevs7",teamId:"df-snevs7-volleyball-2026"},
  {externalId:"5XlPoXlHVUecGtTOAN3SRQ",observedName:"Mansfield",schoolName:"Mansfield High School",schoolId:"aaa-ferexu",city:"Mansfield",address:"2500 Hwy 71 S",postalCode:"72944"},
  {externalId:"F9fnZRJeFUuvV_0_08IhQg",observedName:"Providence Academy",schoolName:"Providence Classical Christian Academy",schoolId:"df-k7ketx",teamId:"df-k7ketx-volleyball-2026"},
  {externalId:"YJHlEgFue0irQPIlLm5Q-w",observedName:"Gospel Light Christian",schoolName:"Gospel Light Christian School",schoolId:"aaa-zmhvly",city:"Hot Springs",address:"600 Garland Ave",postalCode:"71913"},
  {externalId:"sHh3qkQJPke4L9myhhjWgA",observedName:"Westside",schoolName:"Westside High School",city:"Jonesboro",address:"1630 Highway 91 W",postalCode:"72404",fallbackSchoolId:"westside-jonesboro-ar"},
  {externalId:"HQd_XdqDnEaSkACj366Qew",observedName:"Abundant Life",schoolName:"Abundant Life School-Sherwood",schoolId:"df-qrvx97",teamId:"df-qrvx97-volleyball-2026"},
  {externalId:"F9-X-i8gqU64FyP_dzDpJA",observedName:"Benton",schoolName:"Benton High School",city:"Benton",address:"211 N Border St",postalCode:"72015",fallbackSchoolId:"benton-ar"},
  {externalId:"TRTv46QlGkiOZnZiZuvEFA",observedName:"Hot Springs",schoolName:"Hot Springs World Class High School",schoolId:"df-c7mr94",teamId:"df-c7mr94-volleyball-2026"},
  {externalId:"WGaVxf4nNESUk2TPdI59Nw",observedName:"Little Rock HomeSchool",schoolName:"Little Rock HomeSchool",city:"Little Rock",fallbackSchoolId:"little-rock-homeschool-ar"},
  {externalId:"pb-yoxKPm0SjFnsGBlQmGw",observedName:"Arkansas",schoolName:"Arkansas High School",schoolId:"aaa-nwwk4z",teamId:"aaa-nwwk4z-volleyball-2026"},
  {externalId:"usogxZzRRkquprCpPVv1sQ",observedName:"Ozark",schoolName:"Ozark High School",city:"Ozark",address:"1631 Hillbilly Dr",postalCode:"72949",fallbackSchoolId:"ozark-ar"},
  {externalId:"kW5vLAmulUGVpq3TkQscvw",observedName:"Exalt Academy",schoolName:"Exalt Academy Of Southwest Little Rock",schoolId:"df-a6slv2",teamId:"df-a6slv2-volleyball-2026"},
  {externalId:"na2_GZ9LIUKJ1QMTw15dPQ",observedName:"Izard County",schoolName:"Izard County Consolidated High School",schoolId:"df-354bu3",teamId:"df-354bu3-volleyball-2026"},
  {externalId:"4jkQE2ZhXkGKy7q2jDNJtQ",observedName:"KIPP Delta",schoolName:"KIPP Delta High School",schoolId:"df-2tng4g",teamId:"df-2tng4g-volleyball-2026",city:"Helena",address:"210 Cherry St",postalCode:"72342",forceSchoolMetadata:true},
  {externalId:"3-5cGT0mV0iSYNrarYLkxg",observedName:"Trinity Christian",schoolName:"Trinity Christian High School",city:"Texarkana",address:"3107 Trinity Blvd",postalCode:"71854",fallbackSchoolId:"trinity-christian-texarkana-ar"},
  {externalId:"x0Yb6Gbij0utAUls3HdXtA",observedName:"Christian Ministries Academy",schoolName:"Christian Ministries Academy",city:"Hot Springs",address:"548 Brookhill Ranch Rd",postalCode:"71909",fallbackSchoolId:"christian-ministries-academy-ar"},
  {externalId:"CoX3tc7gWEWYQZDOTfgnEA",observedName:"Lisa Academy",schoolName:"Lisa Academy West High School",schoolId:"df-epraq7",teamId:"df-epraq7-volleyball-2026"}
];

function rowsRead(result){return Number(result?.meta?.rows_read||0);}
function rowsWritten(result){return Number(result?.meta?.rows_written||result?.meta?.changes||0);}
function clean(value=""){return String(value).toLowerCase().replace(/homeschool/g,"home school").replace(/\bprep\b/g,"preparatory").replace(/\bsr\.?\b|\bsenior\b|\bjr\.?\b|\bjunior\b/g," ").replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();}
function localDateOffset(localDate,days){const [y,m,d]=String(localDate).split("-").map(Number);return new Intl.DateTimeFormat("en-CA",{timeZone:TIME_ZONE,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(Date.UTC(y,m-1,d+days,18)));}
function localIso(localDate,{hour=12,minute=0}={}){const [year,month,day]=String(localDate).split("-").map(Number);return zonedIso({year,month,day,hour,minute},TIME_ZONE);}
function dateRange(start,end){const rows=[];for(let day=start,guard=0;day&&day<=end&&guard<130;day=localDateOffset(day,1),guard++)rows.push(day);return rows;}
function pairKey(a,b,date){return `${[String(a),String(b)].sort().join("|")}|${date}`;}
function sourceId(teamId){return `${SOURCE_PREFIX}${teamId}`;}
function gameId(teamId,contestId){return `${sourceId(teamId)}:native:${contestId}`;}
function safeIdToken(value){return String(value||"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");}
function fnv1a32(value){let hash=0x811c9dc5;for(const char of String(value||"")){hash^=char.codePointAt(0);hash=Math.imul(hash,0x01000193)>>>0;}return hash.toString(16).padStart(8,"0");}
function externalSchoolId(externalId,name){const safe=safeIdToken(externalId||name||"opponent").slice(0,36)||"opponent";return `mp-${safe}-${fnv1a32(`${externalId}|${name}`)}`;}
function canonicalId(final){const participants=[final.homeResolved.school_id,final.awayResolved.school_id].sort();return ["ce","volleyball","girls","2026",participants[0],participants[1],final.localDate.replaceAll("-",""),`mp-${safeIdToken(final.contestId)}`].join(":");}
function normalized(value){return normalizeSchoolAlias(clean(value));}
function sourceState(sourceUrl,observedName){
  try{
    const url=new URL(sourceUrl);
    if(url.pathname.includes("/ar/volleyball/match/"))return "AR";
    const match=url.pathname.match(/\/inter-state\/volleyball\/match\/([^/]+)\//);if(!match)return null;
    const pieces=match[1].split("-vs-");if(pieces.length!==2)return null;
    const observedTokens=new Set(clean(observedName).split(" ").filter(Boolean));
    const scored=pieces.map(piece=>{const state=piece.match(/-([a-z]{2})$/i)?.[1]?.toUpperCase()||null;const tokens=new Set(clean(piece.replace(/-[a-z]{2}$/i," ")).split(" ").filter(Boolean));let overlap=0;for(const token of observedTokens)if(tokens.has(token))overlap++;return {state,overlap};}).sort((a,b)=>b.overlap-a.overlap);
    return scored[0].overlap>0&&scored[0].overlap>scored[1].overlap?scored[0].state:null;
  }catch{return null;}
}
function aliases(row={}){const values=[row.school_name,row.raw_school_name,row.location_matched_name,row.name].filter(Boolean);const set=new Set();for(const value of values){for(const candidate of [value,String(value).replace(/^the\s+/i,""),String(value).replace(/\bcollegiate\b/ig," "),String(value).replace(/\b(?:arts?|science|magnet|conversion|charter)\b/ig," ")]){const key=normalized(candidate);if(key)set.add(key);}}return [...set];}
async function read(env,sql,args=[]){const result=await env.DB.prepare(sql).bind(...args).all();if(rowsWritten(result)!==0)throw new Error("M7 statewide convergence planner wrote to D1");return {rows:result.results||[],meta:{rows_read:rowsRead(result),rows_written:0}};}
async function readIds(env,table,columns,ids,idColumn="id"){if(!ids.length)return {rows:[],meta:{rows_read:0,rows_written:0}};return read(env,`SELECT ${columns} FROM ${table} WHERE ${idColumn} IN (SELECT value FROM json_each(?))`,[JSON.stringify(ids)]);}

function materializeCuratedLocal(curated,allSchools){
  let school=curated.schoolId?allSchools.find(row=>String(row.school_id)===String(curated.schoolId)):null;
  if(!school){
    const wanted=normalized(curated.schoolName||curated.observedName);
    const candidates=allSchools.filter(row=>aliases(row).includes(wanted));
    if(candidates.length===1)school=candidates[0];
    else if(candidates.length>1)return {error:"multiple_catalog_school_candidates",candidates:candidates.map(row=>row.school_id)};
  }
  const schoolId=school?.school_id||curated.schoolId||curated.fallbackSchoolId;
  if(!schoolId)return {error:"missing_school_id"};
  const teamId=curated.teamId||school?.team_id||`${schoolId}-volleyball-2026`;
  return {
    externalId:curated.externalId,observedName:curated.observedName,
    school_id:schoolId,team_id:teamId,school_name:curated.schoolName||school?.school_name||curated.observedName,
    raw_school_name:curated.schoolName||school?.raw_school_name||curated.observedName,
    location_matched_name:curated.schoolName||school?.location_matched_name||null,
    city:curated.city||school?.city||"",state:"AR",address:curated.address||school?.address||null,postal_code:curated.postalCode||school?.postal_code||null,
    catalog_scope:"local",conference_id:school?.conference_id||null,existing_school:Boolean(school),existing_team:Boolean(school?.team_id),forceSchoolMetadata:Boolean(curated.forceSchoolMetadata||!school||school.catalog_scope!=="local"||!school.team_id)
  };
}

async function fetchAuthority(dates,fetchFn){
  const finals=[];let parsed=0;
  for(let offset=0;offset<dates.length;offset+=5){
    const batch=await Promise.all(dates.slice(offset,offset+5).map(async localDate=>{const url=maxPrepsScoresUrl(localDate);const response=await fetchFn(url,{headers:{"user-agent":"LocalBleachersAR-m7-statewide-convergence/1.0","accept":"text/html,application/xhtml+xml"}});if(!response.ok)throw new Error(`MaxPreps volleyball scores HTTP ${response.status} for ${localDate}`);const rows=parseMaxPrepsVolleyballScores(await response.text(),{localDate,sourceUrl:response.url||url});return rows;}));
    for(const rows of batch){parsed+=rows.length;finals.push(...rows);}
  }
  return {finals,parsed};
}

function canonicalScore(event,final){const scores=new Map([[String(final.homeResolved.school_id),Number(final.home.score)],[String(final.awayResolved.school_id),Number(final.away.score)]]);return {home_score:scores.get(String(event.home_school_id)),away_score:scores.get(String(event.away_school_id))};}
function eventMatchesFinal(event,final){if(String(event.status)!=="FINAL"||event.home_score==null||event.away_score==null)return false;const desired=canonicalScore(event,final);return Number(event.home_score)===Number(desired.home_score)&&Number(event.away_score)===Number(desired.away_score);}
function observationRows(candidate){
  const final=candidate.final,event=candidate.canonical;
  const canonicalHome=event?.home_school_id||final.homeResolved.school_id,canonicalAway=event?.away_school_id||final.awayResolved.school_id;
  const scheduledAt=event?.scheduled_at||localIso(final.localDate,{hour:12});
  const rows=[];
  for(const [side,resolved,other,score,otherScore] of [["home",final.homeResolved,final.awayResolved,final.home.score,final.away.score],["away",final.awayResolved,final.homeResolved,final.away.score,final.home.score]]){
    if(!resolved.local||!resolved.team_id)continue;
    const homeAway=resolved.school_id===canonicalHome?"home":resolved.school_id===canonicalAway?"away":side;
    rows.push({game_id:gameId(resolved.team_id,final.contestId),team_id:resolved.team_id,school_id:resolved.school_id,source_id:sourceId(resolved.team_id),source_event_key:`native:${final.contestId}`,opponent_name:other.school_name||other.observed_name||"Opponent",opponent_school_id:other.school_id,scheduled_at:scheduledAt,home_away:homeAway,team_score:Number(score),opponent_score:Number(otherScore),result:Number(score)===Number(otherScore)?"T":Number(score)>Number(otherScore)?"W":"L",canonical_event_id:candidate.canonical_event_id,source_url:final.sourceUrl});
  }
  return rows;
}

export async function planM7StatewideFinalConvergence(env,{fetchFn=fetch,now=new Date()}={}){
  const endDate=dateKeyInZone(now.toISOString(),TIME_ZONE),dates=dateRange(SEASON_START,endDate),checkedAt=now.toISOString();
  const catalog=await read(env,`
    SELECT s.id AS school_id,s.name AS raw_school_name,s.location_matched_name,
      COALESCE(NULLIF(s.location_matched_name,''),s.name) AS school_name,
      s.city,s.state,s.address,s.postal_code,s.catalog_scope,s.latitude,s.longitude,
      t.id AS team_id,t.active AS team_active,t.conference_id
    FROM schools s
    LEFT JOIN teams t ON t.school_id=s.id AND t.sport='volleyball' AND t.gender='girls' AND t.season='2026'
    WHERE s.level='high-school'
    ORDER BY s.id`);
  const identities=await read(env,`
    SELECT sei.external_school_id,sei.school_id,sei.observed_name,s.catalog_scope,s.state,
      COALESCE(NULLIF(s.location_matched_name,''),s.name) AS school_name,
      t.id AS team_id,t.active AS team_active,t.conference_id
    FROM school_external_identities sei
    JOIN schools s ON s.id=sei.school_id
    LEFT JOIN teams t ON t.school_id=s.id AND t.sport='volleyball' AND t.gender='girls' AND t.season='2026'
    WHERE sei.provider='maxpreps'`);
  const identityByExternal=new Map(identities.rows.map(row=>[String(row.external_school_id),row]));
  const curatedByExternal=new Map();const curatedErrors=[];const curatedRows=[];
  for(const curated of CURATED_LOCAL_IDENTITIES){const row=materializeCuratedLocal(curated,catalog.rows);if(row.error)curatedErrors.push({external_id:curated.externalId,name:curated.observedName,...row});else{curatedRows.push(row);curatedByExternal.set(curated.externalId,row);}}
  const localTeams=catalog.rows.filter(row=>row.team_id&&Number(row.team_active)!==0&&row.catalog_scope==="local").map(row=>({...row,team_id:String(row.team_id)}));
  for(const row of curatedRows){if(!localTeams.some(team=>team.team_id===row.team_id))localTeams.push({...row,team_active:1});}
  const localBySchool=new Map(localTeams.map(row=>[String(row.school_id),row]));
  const aliasMap=new Map();for(const team of localTeams)for(const key of aliases(team)){if(!aliasMap.has(key))aliasMap.set(key,new Map());aliasMap.get(key).set(team.school_id,team);}
  const authority=await fetchAuthority(dates,fetchFn);
  const externalSchoolPlans=new Map(),resolvedFinals=[],identityBlocks=[];
  function resolveSide(side,final){
    const externalId=String(side?.maxprepsId||"").trim(),observedName=String(side?.name||"").trim();if(!externalId||!observedName)return {error:"missing_identity"};
    const curated=curatedByExternal.get(externalId),known=identityByExternal.get(externalId);
    if(curated){
      if(known&&String(known.school_id)!==String(curated.school_id))return {error:"curated_identity_conflict",external_id:externalId,existing_school_id:known.school_id,expected_school_id:curated.school_id};
      return {...curated,local:true,externalId,observed_name:observedName};
    }
    if(known){
      if(known.catalog_scope==="local"){
        const team=localBySchool.get(String(known.school_id));if(!team)return {error:"known_local_school_missing_team",external_id:externalId,school_id:known.school_id};
        return {...team,local:true,externalId,observed_name:observedName};
      }
      return {school_id:known.school_id,school_name:known.school_name||observedName,local:false,externalId,observed_name:observedName,state:known.state||sourceState(final.sourceUrl,observedName)||""};
    }
    const exact=[...(aliasMap.get(normalized(observedName))?.values()||[])];
    if(exact.length===1)return {...exact[0],local:true,externalId,observed_name:observedName};
    if(exact.length>1)return {error:"ambiguous_local_alias",external_id:externalId,candidates:exact.map(row=>row.school_id)};
    const state=sourceState(final.sourceUrl,observedName);
    if(state&&state!=="AR"){
      const school_id=externalSchoolId(externalId,observedName);const plan={school_id,school_name:observedName,local:false,externalId,observed_name:observedName,state};externalSchoolPlans.set(externalId,plan);return plan;
    }
    return {error:state==="AR"?"unresolved_arkansas_identity":"unknown_identity_state",external_id:externalId,observed_name:observedName,state};
  }
  for(const final of authority.finals){const homeResolved=resolveSide(final.home,final),awayResolved=resolveSide(final.away,final);if(homeResolved.error||awayResolved.error){identityBlocks.push({contest_id:final.contestId,local_date:final.localDate,home:homeResolved,away:awayResolved});continue;}if(!homeResolved.local&&!awayResolved.local)continue;resolvedFinals.push({...final,homeResolved,awayResolved});}
  const startIso=localIso(SEASON_START,{hour:0}),endIso=localIso(localDateOffset(endDate,1),{hour:0});
  const canonicals=await read(env,`
    SELECT ce.id,ce.participant_a_school_id,ce.participant_b_school_id,ce.home_school_id,ce.away_school_id,
      ce.scheduled_at,ce.scheduled_time_known,ce.status,ce.home_score,ce.away_score,ce.selected_source_id,
      ce.trust_state,ce.conflict_count,src.parser_type AS selected_parser_type
    FROM canonical_events ce LEFT JOIN sources src ON src.id=ce.selected_source_id
    WHERE ce.scheduled_at>=? AND ce.scheduled_at<? AND ce.sport='volleyball' AND ce.gender='girls' AND ce.season='2026'
    ORDER BY ce.scheduled_at,ce.id`,[startIso,endIso]);
  const eventsByPair=new Map();for(const row of canonicals.rows){const date=dateKeyInZone(row.scheduled_at,TIME_ZONE);if(!date)continue;const key=pairKey(row.participant_a_school_id,row.participant_b_school_id,date);if(!eventsByPair.has(key))eventsByPair.set(key,[]);eventsByPair.get(key).push(row);}
  const finalsByPair=new Map();for(const final of resolvedFinals){const key=pairKey(final.homeResolved.school_id,final.awayResolved.school_id,final.localDate);if(!finalsByPair.has(key))finalsByPair.set(key,[]);finalsByPair.get(key).push(final);}
  const preliminary=[],excluded=[];let alreadyConverged=0;
  for(const final of resolvedFinals){
    const key=pairKey(final.homeResolved.school_id,final.awayResolved.school_id,final.localDate),events=eventsByPair.get(key)||[],sameDay=finalsByPair.get(key)||[];
    if(events.some(event=>eventMatchesFinal(event,final))){alreadyConverged++;continue;}
    if(events.length===0){preliminary.push({kind:"missing",final,canonical:null,canonical_event_id:canonicalId(final)});continue;}
    if(events.length===1&&sameDay.length===1){const event=events[0];if(event.selected_parser_type==="dragonfly-public"&&Number(event.conflict_count||0)===0&&event.home_school_id&&event.away_school_id){if(event.status==="SCHEDULED"&&event.home_score==null&&event.away_score==null){preliminary.push({kind:"stale",final,canonical:event,canonical_event_id:event.id});continue;}if(event.status==="FINAL"&&(event.home_score==null||event.away_score==null)){preliminary.push({kind:"score_fill",final,canonical:event,canonical_event_id:event.id});continue;}}}
    excluded.push({contest_id:final.contestId,local_date:final.localDate,reason:events.length>1?"multiple_existing_canonicals":sameDay.length>1?"multiple_authority_finals_same_pair_date":"existing_canonical_not_safe",canonical_ids:events.map(row=>row.id)});
  }
  if(preliminary.length>MAX_CONTESTS)throw new Error(`M7 statewide candidate count ${preliminary.length} exceeds cap ${MAX_CONTESTS}`);
  const observations=preliminary.flatMap(observationRows),sourceIds=[...new Set(observations.map(row=>row.source_id))],gameIds=[...new Set(observations.map(row=>row.game_id))],existingCanonicalIds=[...new Set(preliminary.filter(row=>row.kind!=="missing").map(row=>row.canonical_event_id))];
  const sources=await readIds(env,"sources","id,team_id,source_type,parser_type,authority_rank,enabled",sourceIds);
  const games=await readIds(env,"games","id,team_id,source_id,source_event_key,opponent_school_id,status,team_score,opponent_score,result,canonical_event_id",gameIds);
  const members=await readIds(env,"canonical_event_members","canonical_event_id,game_id,source_id,reporting_team_id",gameIds,"game_id");
  const conflicts=existingCanonicalIds.length?await read(env,"SELECT canonical_event_id,conflict_type FROM event_conflicts WHERE resolved_at IS NULL AND canonical_event_id IN (SELECT value FROM json_each(?))",[JSON.stringify(existingCanonicalIds)]):{rows:[],meta:{rows_read:0,rows_written:0}};
  const sourceById=new Map(sources.rows.map(row=>[String(row.id),row])),gameById=new Map(games.rows.map(row=>[String(row.id),row])),memberByGame=new Map(members.rows.map(row=>[String(row.game_id),row])),conflictIds=new Set(conflicts.rows.map(row=>String(row.canonical_event_id)));
  const safe=[],blocked=[];
  for(const candidate of preliminary){const reasons=[];const obs=observationRows(candidate);if(candidate.kind!=="missing"&&conflictIds.has(candidate.canonical_event_id))reasons.push("unresolved_event_conflict");for(const expected of obs){const source=sourceById.get(expected.source_id);if(source&&(String(source.team_id)!==expected.team_id||source.parser_type!=="maxpreps-scores"||Number(source.authority_rank)!==80))reasons.push(`${expected.source_id}:unexpected_source`);const game=gameById.get(expected.game_id);if(game){const identityOk=String(game.team_id)===expected.team_id&&String(game.source_id)===expected.source_id&&String(game.source_event_key)===expected.source_event_key&&String(game.opponent_school_id)===expected.opponent_school_id;const scoreOk=game.status==="FINAL"&&Number(game.team_score)===expected.team_score&&Number(game.opponent_score)===expected.opponent_score&&String(game.result||"")===expected.result;const attachment=String(game.canonical_event_id||"");if(!identityOk||!scoreOk||(attachment&&attachment!==candidate.canonical_event_id))reasons.push(`${expected.game_id}:unexpected_game_state`);}const member=memberByGame.get(expected.game_id);if(member&&String(member.canonical_event_id)!==candidate.canonical_event_id)reasons.push(`${expected.game_id}:member_attached_elsewhere`);}if(reasons.length)blocked.push({contest_id:candidate.final.contestId,local_date:candidate.final.localDate,kind:candidate.kind,reasons});else safe.push(candidate);}
  const safeContestIds=new Set(safe.map(row=>row.final.contestId)),safeObs=observations.filter(row=>safeContestIds.has(row.source_event_key.replace(/^native:/,""))),safeSourceIds=[...new Set(safeObs.map(row=>row.source_id))];
  const sourceInserts=safeSourceIds.filter(id=>!sourceById.has(id)),gameInserts=safeObs.filter(row=>!gameById.has(row.game_id)),gameAttaches=safeObs.filter(row=>gameById.has(row.game_id)&&!gameById.get(row.game_id).canonical_event_id),memberInserts=safeObs.filter(row=>!memberByGame.has(row.game_id));
  const missing=safe.filter(row=>row.kind==="missing"),stale=safe.filter(row=>row.kind==="stale"),scoreFill=safe.filter(row=>row.kind==="score_fill");
  const identityLinks=new Map();for(const candidate of safe){for(const [side,resolved] of [[candidate.final.home,candidate.final.homeResolved],[candidate.final.away,candidate.final.awayResolved]]){const ext=String(side.maxprepsId||"");const known=identityByExternal.get(ext);if(ext&&!known)identityLinks.set(ext,{external_school_id:ext,school_id:resolved.school_id,observed_name:side.name});}}
  const localSchoolUpserts=curatedRows.filter(row=>row.forceSchoolMetadata||!row.existing_school).map(row=>({id:row.school_id,name:row.school_name,city:row.city,state:"AR",address:row.address,postal_code:row.postal_code}));
  const teamUpserts=curatedRows.filter(row=>!row.existing_team).map(row=>({id:row.team_id,school_id:row.school_id}));
  const externalCreates=[...externalSchoolPlans.values()].filter(plan=>safe.some(candidate=>candidate.final.homeResolved.school_id===plan.school_id||candidate.final.awayResolved.school_id===plan.school_id)).filter(plan=>!catalog.rows.some(row=>String(row.school_id)===String(plan.school_id))).map(plan=>({id:plan.school_id,name:plan.school_name,state:plan.state}));
  const logical={local_schools_upsert:localSchoolUpserts.length,teams_upsert:teamUpserts.length,external_schools_insert:externalCreates.length,identity_insert:identityLinks.size,sources_insert:sourceInserts.length,canonical_events_insert:missing.length,games_insert:gameInserts.length,games_attach_update:gameAttaches.length,canonical_event_members_insert:memberInserts.length,canonical_events_update:stale.length+scoreFill.length};
  const logicalRows=Object.values(logical).reduce((sum,n)=>sum+n,0),projectedD1Writes=Math.ceil(logicalRows*8.0+gameInserts.length*2);
  const metas=[catalog.meta,identities.meta,canonicals.meta,sources.meta,games.meta,members.meta,conflicts.meta],d1={statements:metas.length,rows_read:metas.reduce((sum,row)=>sum+row.rows_read,0),rows_written:0,per_statement:metas};
  const fingerprintInput=safe.map(candidate=>({kind:candidate.kind,contest_id:candidate.final.contestId,canonical_event_id:candidate.canonical_event_id,score:[candidate.final.home.score,candidate.final.away.score],schools:[candidate.final.homeResolved.school_id,candidate.final.awayResolved.school_id]}));
  const safeToExecute=safe.length>0&&!curatedErrors.length&&d1.rows_read<=MAX_PLANNER_ROWS_READ&&logicalRows<=MAX_LOGICAL_WRITES&&projectedD1Writes<=MAX_PROJECTED_D1_WRITES;
  return {generated_at:checkedAt,through_local_date:endDate,authority:{dates:dates.length,parsed_finals:authority.parsed,resolved_finals:resolvedFinals.length,identity_blocked_finals:identityBlocks.length},d1,safe_to_execute:safeToExecute,plan_fingerprint:`m7-statewide-finals-${fnv1a32(JSON.stringify(fingerprintInput))}`,catalog_plan:{curated_identities:curatedRows.length,curated_errors:curatedErrors,local_school_upserts:localSchoolUpserts.length,team_upserts:teamUpserts.length,external_school_inserts:externalCreates.length,identity_inserts:identityLinks.size},candidates:{total:safe.length,missing:missing.length,stale:stale.length,score_fill:scoreFill.length,already_converged:alreadyConverged,blocked:blocked.length,excluded:excluded.length},write_scope:{logical_table_rows:logical,logical_application_rows:logicalRows,projected_d1_rows_written_guard:projectedD1Writes,actual_rows_written_fuse:MAX_ACTUAL_D1_WRITES},blocked_identity:identityBlocks,blocked,excluded,_private:{safe,safeObs,sourceInserts,gameInserts,gameAttaches,memberInserts,missing,stale,scoreFill,identityLinks:[...identityLinks.values()],localSchoolUpserts,teamUpserts,externalCreates}};
}

function schoolUpsertStatement(env,rows,now){return env.DB.prepare(`WITH payload AS (SELECT json_extract(value,'$.id') id,json_extract(value,'$.name') name,json_extract(value,'$.city') city,json_extract(value,'$.state') state,json_extract(value,'$.address') address,json_extract(value,'$.postal_code') postal_code FROM json_each(?)) INSERT INTO schools(id,name,city,state,level,address,postal_code,location_source,location_matched_name,location_updated_at,catalog_scope,membership_source,membership_verified_at,updated_at) SELECT id,name,COALESCE(city,''),COALESCE(state,'AR'),'high-school',address,postal_code,'m7-curated-maxpreps',name,?,'local','m7-curated-maxpreps',?,? FROM payload WHERE true ON CONFLICT(id) DO UPDATE SET name=excluded.name,city=CASE WHEN excluded.city<>'' THEN excluded.city ELSE schools.city END,state='AR',address=COALESCE(excluded.address,schools.address),postal_code=COALESCE(excluded.postal_code,schools.postal_code),location_source=COALESCE(schools.location_source,excluded.location_source),location_matched_name=excluded.location_matched_name,location_updated_at=excluded.location_updated_at,catalog_scope='local',membership_source=excluded.membership_source,membership_verified_at=excluded.membership_verified_at,updated_at=excluded.updated_at`).bind(JSON.stringify(rows),now,now,now);}
function teamUpsertStatement(env,rows,now){return env.DB.prepare(`WITH payload AS (SELECT json_extract(value,'$.id') id,json_extract(value,'$.school_id') school_id FROM json_each(?)) INSERT INTO teams(id,school_id,sport,gender,season,conference_id,active,updated_at) SELECT id,school_id,'volleyball','girls','2026',NULL,1,? FROM payload WHERE true ON CONFLICT(id) DO UPDATE SET active=1,updated_at=excluded.updated_at`).bind(JSON.stringify(rows),now);}
function externalSchoolInsertStatement(env,rows,now){return env.DB.prepare(`WITH payload AS (SELECT json_extract(value,'$.id') id,json_extract(value,'$.name') name,json_extract(value,'$.state') state FROM json_each(?)) INSERT OR IGNORE INTO schools(id,name,city,state,level,catalog_scope,membership_source,membership_verified_at,updated_at) SELECT id,name,'',COALESCE(state,''),'high-school','opponent-only','maxpreps-result-opponent',NULL,? FROM payload`).bind(JSON.stringify(rows),now);}
function identityInsertStatement(env,rows,now){return env.DB.prepare(`WITH payload AS (SELECT json_extract(value,'$.external_school_id') external_school_id,json_extract(value,'$.school_id') school_id,json_extract(value,'$.observed_name') observed_name FROM json_each(?)) INSERT INTO school_external_identities(provider,external_school_id,school_id,observed_name,last_seen_at,updated_at) SELECT 'maxpreps',external_school_id,school_id,observed_name,?,? FROM payload WHERE true ON CONFLICT(provider,external_school_id) DO UPDATE SET observed_name=excluded.observed_name,last_seen_at=excluded.last_seen_at,updated_at=excluded.updated_at WHERE school_external_identities.school_id=excluded.school_id`).bind(JSON.stringify(rows),now,now);}
function sourceInsertStatement(env,ids,teamBySource,now){const rows=ids.map(id=>({id,team_id:teamBySource.get(id)}));return env.DB.prepare(`WITH payload AS (SELECT json_extract(value,'$.id') id,json_extract(value,'$.team_id') team_id FROM json_each(?)) INSERT OR IGNORE INTO sources(id,team_id,source_url,source_type,source_priority,parser_type,parser_version,timezone,expected_min_games,refresh_minutes,active_result_minutes,enabled,authority_rank,stale_after_minutes,last_successful_fetch_at,last_checked_at,last_http_status,updated_at) SELECT id,team_id,?,'secondary',9,'maxpreps-scores','1',?,1,1440,60,0,80,2880,?,?,200,? FROM payload`).bind(JSON.stringify(rows),SOURCE_URL,TIME_ZONE,now,now,now);}
function canonicalInsertStatement(env,candidates,now){const rows=candidates.map(candidate=>{const f=candidate.final,ids=[f.homeResolved.school_id,f.awayResolved.school_id].sort(),selected=observationRows(candidate)[0]?.source_id||null;return {id:candidate.canonical_event_id,a:ids[0],b:ids[1],home:f.homeResolved.school_id,away:f.awayResolved.school_id,scheduled_at:localIso(f.localDate,{hour:12}),home_score:Number(f.home.score),away_score:Number(f.away.score),selected_source_id:selected,resolution_json:JSON.stringify({m7:true,contest_id:f.contestId,source_url:f.sourceUrl})};});return env.DB.prepare(`WITH payload AS (SELECT json_extract(value,'$.id') id,json_extract(value,'$.a') a,json_extract(value,'$.b') b,json_extract(value,'$.home') home,json_extract(value,'$.away') away,json_extract(value,'$.scheduled_at') scheduled_at,json_extract(value,'$.home_score') home_score,json_extract(value,'$.away_score') away_score,json_extract(value,'$.selected_source_id') selected_source_id,json_extract(value,'$.resolution_json') resolution_json FROM json_each(?)) INSERT INTO canonical_events(id,sport,gender,season,participant_a_school_id,participant_b_school_id,home_school_id,away_school_id,scheduled_at,scheduled_time_known,conference_game,status,home_score,away_score,selected_source_id,trust_state,conflict_count,resolution_json,last_reconciled_at,updated_at) SELECT id,'volleyball','girls','2026',a,b,home,away,scheduled_at,0,0,'FINAL',home_score,away_score,selected_source_id,'SINGLE_SOURCE_LIVE',0,resolution_json,?,? FROM payload`).bind(JSON.stringify(rows),now,now);}
function gameInsertStatement(env,rows,now){return env.DB.prepare(`WITH payload AS (SELECT json_extract(value,'$.game_id') id,json_extract(value,'$.team_id') team_id,json_extract(value,'$.source_id') source_id,json_extract(value,'$.source_event_key') source_event_key,json_extract(value,'$.opponent_name') opponent,json_extract(value,'$.opponent_school_id') opponent_school_id,json_extract(value,'$.scheduled_at') scheduled_at,json_extract(value,'$.home_away') home_away,json_extract(value,'$.team_score') team_score,json_extract(value,'$.opponent_score') opponent_score,json_extract(value,'$.result') result,json_extract(value,'$.canonical_event_id') canonical_event_id,json_extract(value,'$.source_url') source_url FROM json_each(?)) INSERT INTO games(id,team_id,source_id,source_event_key,opponent,opponent_school_id,scheduled_at,scheduled_time_known,venue,location_text,latitude,longitude,home_away,conference_game,counts_for_record,status,team_score,opponent_score,result,notes,source_url,source_updated_at,last_checked_at,canonical_event_id,updated_at) SELECT id,team_id,source_id,source_event_key,opponent,opponent_school_id,scheduled_at,0,NULL,NULL,NULL,NULL,home_away,0,1,'FINAL',team_score,opponent_score,result,'Secondary final from MaxPreps statewide scores',source_url,?,?,canonical_event_id,? FROM payload`).bind(JSON.stringify(rows),now,now,now);}
function gameAttachStatement(env,rows,now){return env.DB.prepare(`WITH payload AS (SELECT json_extract(value,'$.game_id') game_id,json_extract(value,'$.canonical_event_id') canonical_event_id FROM json_each(?)) UPDATE games SET canonical_event_id=(SELECT canonical_event_id FROM payload p WHERE p.game_id=games.id),updated_at=? WHERE id IN (SELECT game_id FROM payload) AND canonical_event_id IS NULL`).bind(JSON.stringify(rows),now);}
function memberInsertStatement(env,rows,now){return env.DB.prepare(`WITH payload AS (SELECT json_extract(value,'$.canonical_event_id') canonical_event_id,json_extract(value,'$.game_id') game_id,json_extract(value,'$.source_id') source_id,json_extract(value,'$.team_id') team_id FROM json_each(?)) INSERT OR IGNORE INTO canonical_event_members(canonical_event_id,game_id,source_id,reporting_team_id,added_at) SELECT canonical_event_id,game_id,source_id,team_id,? FROM payload`).bind(JSON.stringify(rows),now);}
function canonicalUpdateStatement(env,candidates,now){const rows=candidates.map(candidate=>{const score=canonicalScore(candidate.canonical,candidate.final);return {id:candidate.canonical_event_id,home_score:score.home_score,away_score:score.away_score};});return env.DB.prepare(`WITH payload AS (SELECT json_extract(value,'$.id') id,json_extract(value,'$.home_score') home_score,json_extract(value,'$.away_score') away_score FROM json_each(?)) UPDATE canonical_events SET status='FINAL',home_score=(SELECT home_score FROM payload p WHERE p.id=canonical_events.id),away_score=(SELECT away_score FROM payload p WHERE p.id=canonical_events.id),trust_state=CASE WHEN selected_source_id LIKE 'maxpreps-volleyball-results:%' THEN trust_state ELSE 'CORROBORATED' END,last_reconciled_at=?,updated_at=? WHERE id IN (SELECT id FROM payload)`).bind(JSON.stringify(rows),now,now);}

export async function executeM7StatewideFinalConvergence(env,{fetchFn=fetch,now=new Date()}={}){
  const plan=await planM7StatewideFinalConvergence(env,{fetchFn,now});if(!plan.safe_to_execute)throw new Error("M7 statewide final plan is not safe to execute");
  const p=plan._private,checkedAt=now.toISOString(),teamBySource=new Map(p.safeObs.map(row=>[row.source_id,row.team_id]));
  const statements=[];if(p.localSchoolUpserts.length)statements.push(schoolUpsertStatement(env,p.localSchoolUpserts,checkedAt));if(p.teamUpserts.length)statements.push(teamUpsertStatement(env,p.teamUpserts,checkedAt));if(p.externalCreates.length)statements.push(externalSchoolInsertStatement(env,p.externalCreates,checkedAt));if(p.identityLinks.length)statements.push(identityInsertStatement(env,p.identityLinks,checkedAt));if(p.sourceInserts.length)statements.push(sourceInsertStatement(env,p.sourceInserts,teamBySource,checkedAt));if(p.missing.length)statements.push(canonicalInsertStatement(env,p.missing,checkedAt));if(p.gameInserts.length)statements.push(gameInsertStatement(env,p.gameInserts,checkedAt));if(p.gameAttaches.length)statements.push(gameAttachStatement(env,p.gameAttaches,checkedAt));if(p.memberInserts.length)statements.push(memberInsertStatement(env,p.memberInserts,checkedAt));if(p.stale.length||p.scoreFill.length)statements.push(canonicalUpdateStatement(env,[...p.stale,...p.scoreFill],checkedAt));
  if(statements.length>20)throw new Error(`M7 statewide convergence statement count ${statements.length} exceeded fuse`);
  const results=statements.length?await env.DB.batch(statements):[],repair={statements:results.length,rows_read:results.reduce((s,r)=>s+rowsRead(r),0),rows_written:results.reduce((s,r)=>s+rowsWritten(r),0),per_statement:results.map((r,index)=>({statement:index+1,rows_read:rowsRead(r),rows_written:rowsWritten(r)}))};
  if(repair.rows_written>MAX_ACTUAL_D1_WRITES)throw new Error(`M7 statewide convergence rows_written ${repair.rows_written} exceeded fuse ${MAX_ACTUAL_D1_WRITES}`);
  const verifyIds=[...p.safe.map(row=>row.canonical_event_id)],verify=verifyIds.length?await read(env,`SELECT ce.id,ce.status,ce.home_score,ce.away_score,COUNT(DISTINCT cem.game_id) AS member_count FROM canonical_events ce LEFT JOIN canonical_event_members cem ON cem.canonical_event_id=ce.id WHERE ce.id IN (SELECT value FROM json_each(?)) GROUP BY ce.id,ce.status,ce.home_score,ce.away_score`,[JSON.stringify(verifyIds)]):{rows:[],meta:{rows_read:0,rows_written:0}};
  const verifiedById=new Map(verify.rows.map(row=>[String(row.id),row])),failures=[];for(const candidate of p.safe){const row=verifiedById.get(candidate.canonical_event_id),desired=candidate.kind==="missing"?{home_score:Number(candidate.final.home.score),away_score:Number(candidate.final.away.score)}:canonicalScore(candidate.canonical,candidate.final),expectedMembers=observationRows(candidate).length;if(!row||row.status!=="FINAL"||Number(row.home_score)!==Number(desired.home_score)||Number(row.away_score)!==Number(desired.away_score)||Number(row.member_count)<expectedMembers)failures.push({contest_id:candidate.final.contestId,canonical_event_id:candidate.canonical_event_id});}
  if(failures.length)throw new Error(`M7 statewide post-write verification failed for ${failures.length} contests`);
  const {_private,...publicPlan}=plan;return {status:"SUCCESS",...publicPlan,d1:{planner:plan.d1,repair,verification:verify.meta},verified:{contests:p.safe.length,failures:0},touched_team_ids:[...new Set(p.safeObs.map(row=>row.team_id))]};
}

export { CURATED_LOCAL_IDENTITIES, MAX_ACTUAL_D1_WRITES, MAX_PROJECTED_D1_WRITES };
