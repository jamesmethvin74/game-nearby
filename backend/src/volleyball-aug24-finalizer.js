import { normalizeSchoolAlias } from "./schedule-authority-core.js";
import { rebuildTeamRecords } from "./record-rebuild.js";

export const AUG24_FINALIZE_PATH="/api/v1/internal/volleyball-aug24-finalize";
export const AUG24_FINALIZE_STATUS_PATH="/api/v1/internal/volleyball-aug24-finalize/status";
export const AUG24_AUDIT_RUN_ID=34172135818;

const SCHEDULED_AT="2026-08-24T17:00:00.000Z";
const DATE_START="2026-08-24T05:00:00.000Z";
const DATE_END="2026-08-25T05:00:00.000Z";
const SOURCE_URL="https://www.maxpreps.com/ar/volleyball/scores/?date=8%2F24%2F2026";
const SOURCE_PREFIX="maxpreps-volleyball-results:";

export const AUG24_FINALS=Object.freeze([
  Object.freeze({contestId:"bf452b95-43e9-412c-8bbc-80fcd92ca147",teamId:"df-ezw3f9-volleyball-2026",localSchool:"Marion High School",opponent:"Collierville",externalId:"audit-collierville",localScore:3,opponentScore:1,result:"W"}),
  Object.freeze({contestId:"01c9d8e3-fdea-4c12-879b-6a9f9726bb58",teamId:"df-26g9fq-volleyball-2026",localSchool:"Columbia Christian School",opponent:"Word of God Academy",externalId:"audit-word-of-god-academy",localScore:3,opponentScore:1,result:"W"}),
  Object.freeze({contestId:"b3ba2de8-200c-412e-923e-7bad05699fd2",teamId:"df-kybtet-volleyball-2026",localSchool:"Magnolia High School",opponent:"Pleasant Grove",externalId:"audit-pleasant-grove",localScore:1,opponentScore:3,result:"L"})
]);

function fnv1a32(value) {
  let hash=0x811c9dc5;
  for(const char of String(value||"")) {
    hash^=char.codePointAt(0);
    hash=Math.imul(hash,0x01000193)>>>0;
  }
  return hash.toString(16).padStart(8,"0");
}

function opponentSchoolId(spec) {
  const safe=spec.externalId.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,36)||"opponent";
  return `mp-${safe}-${fnv1a32(`${spec.externalId}|${spec.opponent}`)}`;
}

function sourceFor(spec) {
  return {
    id:`${SOURCE_PREFIX}${spec.teamId}`,
    team_id:spec.teamId,
    source_url:SOURCE_URL,
    source_type:"secondary",
    source_priority:9,
    parser_type:"maxpreps-scores",
    parser_version:"1",
    timezone:"America/Chicago",
    authority_rank:80
  };
}

function canonicalId(schoolId,opponentId) {
  const [a,b]=[schoolId,opponentId].sort();
  return `ce:volleyball:girls:2026:${a}:${b}:20260824:tba`;
}

function values(count,width) {
  return Array.from({length:count},()=>`(${Array.from({length:width},()=>"?").join(",")})`).join(",");
}

async function loadTargets(env) {
  const ids=AUG24_FINALS.map(row=>row.teamId);
  const result=await env.DB.prepare(`
    SELECT t.id AS team_id,t.school_id,t.conference_id,
      COALESCE(NULLIF(s.location_matched_name,''),s.name) AS school_name
    FROM teams t JOIN schools s ON s.id=t.school_id
    WHERE t.id IN (SELECT value FROM json_each(?))
      AND t.active=1 AND t.sport='volleyball' AND t.gender='girls' AND t.season='2026'
      AND s.level='high-school' AND s.catalog_scope='local'`)
    .bind(JSON.stringify(ids)).all();
  const rows=result.results||[];
  if(rows.length!==3) throw new Error(`Exact finalizer target-team count ${rows.length}, expected 3`);
  const byId=new Map(rows.map(row=>[String(row.team_id),row]));
  for(const spec of AUG24_FINALS) {
    const target=byId.get(spec.teamId);
    if(normalizeSchoolAlias(target?.school_name)!==normalizeSchoolAlias(spec.localSchool)) throw new Error(`Target identity changed for ${spec.localSchool}`);
    if(target?.conference_id!=null&&String(target.conference_id)!=="") throw new Error(`Target conference membership changed for ${spec.localSchool}`);
  }
  return byId;
}

async function ensureOpponents(env,now) {
  const rows=AUG24_FINALS.map(spec=>({id:opponentSchoolId(spec),name:spec.opponent}));
  const args=[];
  for(const row of rows) args.push(row.id,row.name,"","","high-school","opponent-only","maxpreps-audit-final",null,now);
  const result=await env.DB.prepare(`
    INSERT OR IGNORE INTO schools
      (id,name,city,state,level,catalog_scope,membership_source,membership_verified_at,updated_at)
    VALUES ${values(rows.length,9)}`)
    .bind(...args).run();
  return {rows,result};
}

async function ensureSources(env,now) {
  const rows=AUG24_FINALS.map(sourceFor);
  const args=[];
  for(const row of rows) args.push(row.id,row.team_id,row.source_url,"secondary",9,"maxpreps-scores","1","America/Chicago",1,1440,60,0,80,2880,now,now,200,now);
  const result=await env.DB.prepare(`
    INSERT OR IGNORE INTO sources
      (id,team_id,source_url,source_type,source_priority,parser_type,parser_version,timezone,
       expected_min_games,refresh_minutes,active_result_minutes,enabled,authority_rank,stale_after_minutes,
       last_successful_fetch_at,last_checked_at,last_http_status,updated_at)
    VALUES ${values(rows.length,18)}`)
    .bind(...args).run();
  return {rows,result};
}

async function upsertGames(env,targets,opponents,now) {
  const statements=AUG24_FINALS.map((spec,index)=>{
    const source=sourceFor(spec);
    const opponent=opponents[index];
    const id=`${source.id}:native:${spec.contestId}`;
    return env.DB.prepare(`
      INSERT INTO games(id,team_id,source_id,source_event_key,opponent,opponent_school_id,scheduled_at,scheduled_time_known,
        venue,location_text,latitude,longitude,home_away,conference_game,counts_for_record,status,team_score,opponent_score,result,notes,
        source_url,source_updated_at,last_checked_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(source_id,source_event_key) DO UPDATE SET
        opponent=excluded.opponent,opponent_school_id=excluded.opponent_school_id,scheduled_at=excluded.scheduled_at,scheduled_time_known=excluded.scheduled_time_known,
        home_away=excluded.home_away,conference_game=excluded.conference_game,counts_for_record=excluded.counts_for_record,status=excluded.status,
        team_score=excluded.team_score,opponent_score=excluded.opponent_score,result=excluded.result,notes=excluded.notes,
        source_url=excluded.source_url,source_updated_at=excluded.source_updated_at,last_checked_at=excluded.last_checked_at,updated_at=excluded.updated_at`)
      .bind(id,spec.teamId,source.id,`native:${spec.contestId}`,spec.opponent,opponent.id,SCHEDULED_AT,0,
        null,null,null,null,"home",0,1,"FINAL",spec.localScore,spec.opponentScore,spec.result,
        `Audited MaxPreps final; statewide audit ${AUG24_AUDIT_RUN_ID}`,SOURCE_URL,now,now,now);
  });
  await env.DB.batch(statements);

  const gameIds=AUG24_FINALS.map(spec=>`${SOURCE_PREFIX}${spec.teamId}:native:${spec.contestId}`);
  const loaded=await env.DB.prepare(`
    SELECT id,team_id,source_id,source_event_key,opponent_school_id,canonical_event_id
    FROM games WHERE id IN (SELECT value FROM json_each(?))`)
    .bind(JSON.stringify(gameIds)).all();
  if((loaded.results||[]).length!==3) throw new Error("Exact finalizer could not materialize all three observations");
  return new Map((loaded.results||[]).map(row=>[String(row.team_id),row]));
}

async function loadExistingCanonicals(env,targets) {
  const schoolIds=[...targets.values()].map(row=>row.school_id);
  const result=await env.DB.prepare(`
    SELECT ce.*
    FROM canonical_events ce
    WHERE ce.sport='volleyball' AND ce.gender='girls' AND ce.season='2026'
      AND datetime(ce.scheduled_at)>=datetime(?) AND datetime(ce.scheduled_at)<datetime(?)
      AND (ce.participant_a_school_id IN (SELECT value FROM json_each(?))
        OR ce.participant_b_school_id IN (SELECT value FROM json_each(?)))`)
    .bind(DATE_START,DATE_END,JSON.stringify(schoolIds),JSON.stringify(schoolIds)).all();
  return result.results||[];
}

function findCanonical(existing,schoolId,opponentId) {
  return existing.find(row=>{
    const participants=[String(row.participant_a_school_id||""),String(row.participant_b_school_id||"")];
    return participants.includes(String(schoolId))&&participants.includes(String(opponentId));
  })||null;
}

async function upsertCanonicals(env,targets,opponents,games,now) {
  const existing=await loadExistingCanonicals(env,targets);
  const planned=AUG24_FINALS.map((spec,index)=>{
    const target=targets.get(spec.teamId);
    const opponent=opponents[index];
    const game=games.get(spec.teamId);
    const prior=findCanonical(existing,target.school_id,opponent.id);
    const id=game?.canonical_event_id||prior?.id||canonicalId(target.school_id,opponent.id);
    const priorHome=prior?.home_school_id, priorAway=prior?.away_school_id;
    const validPriorRelation=[priorHome,priorAway].includes(target.school_id)&&[priorHome,priorAway].includes(opponent.id);
    const homeSchoolId=validPriorRelation?priorHome:target.school_id;
    const awaySchoolId=validPriorRelation?priorAway:opponent.id;
    const localIsHome=homeSchoolId===target.school_id;
    const [a,b]=[target.school_id,opponent.id].sort();
    return {
      spec,target,opponent,game,id,
      participantA:a,participantB:b,
      homeSchoolId,awaySchoolId,
      scheduledAt:prior?.scheduled_at||SCHEDULED_AT,
      scheduledTimeKnown:Number(prior?.scheduled_time_known||0),
      venue:prior?.venue||null,locationText:prior?.location_text||null,
      latitude:prior?.latitude??null,longitude:prior?.longitude??null,
      homeScore:localIsHome?spec.localScore:spec.opponentScore,
      awayScore:localIsHome?spec.opponentScore:spec.localScore
    };
  });

  const canonicalStatements=planned.map(row=>env.DB.prepare(`
    INSERT INTO canonical_events(id,sport,gender,season,participant_a_school_id,participant_b_school_id,home_school_id,away_school_id,
      scheduled_at,scheduled_time_known,venue,location_text,latitude,longitude,conference_game,status,home_score,away_score,selected_source_id,
      trust_state,conflict_count,resolution_json,last_reconciled_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      participant_a_school_id=excluded.participant_a_school_id,participant_b_school_id=excluded.participant_b_school_id,
      home_school_id=excluded.home_school_id,away_school_id=excluded.away_school_id,scheduled_at=excluded.scheduled_at,
      scheduled_time_known=excluded.scheduled_time_known,venue=COALESCE(canonical_events.venue,excluded.venue),
      location_text=COALESCE(canonical_events.location_text,excluded.location_text),latitude=COALESCE(canonical_events.latitude,excluded.latitude),
      longitude=COALESCE(canonical_events.longitude,excluded.longitude),conference_game=0,status='FINAL',home_score=excluded.home_score,
      away_score=excluded.away_score,selected_source_id=excluded.selected_source_id,trust_state=excluded.trust_state,
      conflict_count=0,resolution_json=excluded.resolution_json,last_reconciled_at=excluded.last_reconciled_at,updated_at=excluded.updated_at`)
    .bind(row.id,"volleyball","girls","2026",row.participantA,row.participantB,row.homeSchoolId,row.awaySchoolId,
      row.scheduledAt,row.scheduledTimeKnown,row.venue,row.locationText,row.latitude,row.longitude,0,"FINAL",row.homeScore,row.awayScore,
      row.game.source_id,"SINGLE_SOURCE_LIVE",0,JSON.stringify({mode:"bounded-audit-finalize",auditRunId:AUG24_AUDIT_RUN_ID,contestId:row.spec.contestId}),now,now));
  await env.DB.batch(canonicalStatements);

  const linkStatements=[];
  for(const row of planned) {
    linkStatements.push(env.DB.prepare("UPDATE games SET canonical_event_id=?,updated_at=? WHERE id=?").bind(row.id,now,row.game.id));
    linkStatements.push(env.DB.prepare(`
      INSERT OR REPLACE INTO canonical_event_members(canonical_event_id,game_id,source_id,reporting_team_id,added_at)
      VALUES(?,?,?,?,?)`).bind(row.id,row.game.id,row.game.source_id,row.spec.teamId,now));
  }
  await env.DB.batch(linkStatements);
  return planned;
}

export async function verifyAug24Finals(env) {
  const teamIds=AUG24_FINALS.map(row=>row.teamId);
  const keys=AUG24_FINALS.map(row=>`native:${row.contestId}`);
  const result=await env.DB.prepare(`
    SELECT g.team_id,g.source_event_key,g.opponent,g.opponent_school_id,g.canonical_event_id,
      ce.status,ce.home_school_id,ce.away_school_id,ce.home_score,ce.away_score,
      hs.name AS home_name,aws.name AS away_name
    FROM games g
    JOIN canonical_events ce ON ce.id=g.canonical_event_id
    LEFT JOIN schools hs ON hs.id=ce.home_school_id
    LEFT JOIN schools aws ON aws.id=ce.away_school_id
    WHERE g.team_id IN (SELECT value FROM json_each(?))
      AND g.source_event_key IN (SELECT value FROM json_each(?))`)
    .bind(JSON.stringify(teamIds),JSON.stringify(keys)).all();
  const rows=result.results||[];
  for(const spec of AUG24_FINALS) {
    const row=rows.find(item=>String(item.team_id)===spec.teamId&&String(item.source_event_key)===`native:${spec.contestId}`);
    if(!row||String(row.status)!=="FINAL") throw new Error(`Missing canonical FINAL for ${spec.localSchool} vs ${spec.opponent}`);
    const localKey=normalizeSchoolAlias(spec.localSchool),oppKey=normalizeSchoolAlias(spec.opponent);
    const homeKey=normalizeSchoolAlias(row.home_name),awayKey=normalizeSchoolAlias(row.away_name);
    if(!((homeKey===localKey&&awayKey===oppKey)||(homeKey===oppKey&&awayKey===localKey))) throw new Error(`Wrong participants for ${spec.localSchool} vs ${spec.opponent}`);
    const localIsHome=homeKey===localKey;
    const localScore=Number(localIsHome?row.home_score:row.away_score);
    const opponentScore=Number(localIsHome?row.away_score:row.home_score);
    if(localScore!==spec.localScore||opponentScore!==spec.opponentScore) throw new Error(`Wrong score for ${spec.localSchool} vs ${spec.opponent}`);
  }
  if(rows.length<3) throw new Error(`Exact finalizer verification returned ${rows.length} rows`);
  return {status:"PASS",auditRunId:AUG24_AUDIT_RUN_ID,finals:3,rows};
}

export async function finalizeAug24Finals(env,{now=new Date().toISOString()}={}) {
  const targets=await loadTargets(env);
  const {rows:opponents}=await ensureOpponents(env,now);
  await ensureSources(env,now);
  const games=await upsertGames(env,targets,opponents,now);
  const canonicals=await upsertCanonicals(env,targets,opponents,games,now);
  const recordResult=await rebuildTeamRecords(env,AUG24_FINALS.map(row=>row.teamId),now);
  if(Number(recordResult?.teams)!==3) throw new Error(`Record rebuild touched ${Number(recordResult?.teams||0)} teams, expected 3`);
  if(Number(recordResult?.standings?.cohorts||0)!==0) throw new Error("Exact finalizer unexpectedly touched a standings cohort");
  const verification=await verifyAug24Finals(env);
  return {
    status:"PASS",
    auditRunId:AUG24_AUDIT_RUN_ID,
    finalized:canonicals.map(row=>({contestId:row.spec.contestId,teamId:row.spec.teamId,canonicalEventId:row.id})),
    recordResult,
    verification
  };
}
