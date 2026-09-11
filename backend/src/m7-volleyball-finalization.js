import { rebuildStatewideRecords } from "./record-rebuild.js";
import { syncPublishedVolleyballConferenceMembership } from "./volleyball-conference-membership.js";

const SPORT="volleyball";
const GENDER="girls";
const SEASON="2026";
const SEASON_START="2026-08-01T05:00:00.000Z";
const SEASON_END="2026-12-01T06:00:00.000Z";
const TIME_ZONE="America/Chicago";
const DUPLICATE_MAX_MINUTES=15;
const ORPHAN_MAX_MINUTES=360;
const MAX_PLANNER_ROWS_READ=150000;
const MAX_DUPLICATE_LOSERS=80;
const MAX_ORPHAN_ATTACHES=100;
const MAX_COORDINATE_UPDATES=400;
const MAX_MEMBERSHIP_CHANGES=12;

function rowsRead(result){return Number(result?.meta?.rows_read||0);}
function rowsWritten(result){return Number(result?.meta?.rows_written||result?.meta?.changes||0);}
function localDate(value){
  const date=new Date(value);
  if(!Number.isFinite(date.getTime())) return null;
  const parts=new Intl.DateTimeFormat("en-US",{timeZone:TIME_ZONE,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(date);
  const get=type=>parts.find(part=>part.type===type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
function minutesApart(a,b){
  const left=new Date(a).getTime(),right=new Date(b).getTime();
  if(!Number.isFinite(left)||!Number.isFinite(right)) return Infinity;
  return Math.abs(left-right)/60000;
}
function pairKey(a,b,date){return `${[String(a||""),String(b||"")].sort().join("|")}|${date||""}`;}
function scoreBySchool(event){
  if(event.home_score==null||event.away_score==null) return null;
  return new Map([[String(event.home_school_id),Number(event.home_score)],[String(event.away_school_id),Number(event.away_score)]]);
}
function scoreKey(event){
  const scores=scoreBySchool(event);
  if(!scores) return null;
  return [String(event.participant_a_school_id),String(event.participant_b_school_id)]
    .sort().map(id=>`${id}:${scores.get(id)}`).join("|");
}
function eventFinal(event){return event.status==="FINAL"&&event.home_score!=null&&event.away_score!=null;}
function fnv1a32(value){let hash=0x811c9dc5;for(const char of String(value||"")){hash^=char.codePointAt(0);hash=Math.imul(hash,0x01000193)>>>0;}return hash.toString(16).padStart(8,"0");}

function chooseKeeper(events=[]){
  return [...events].sort((a,b)=>
    Number(a.selected_authority_rank??999)-Number(b.selected_authority_rank??999)
    || Number(b.member_count||0)-Number(a.member_count||0)
    || Number(b.status==="FINAL")-Number(a.status==="FINAL")
    || Number(b.scheduled_time_known||0)-Number(a.scheduled_time_known||0)
    || String(a.id).localeCompare(String(b.id))
  )[0];
}

function desiredKeeperState(keeper,cluster){
  const finals=cluster.filter(eventFinal);
  const scoreSource=finals.length?chooseKeeper(finals):null;
  const desired={
    id:keeper.id,
    status:keeper.status,
    home_score:keeper.home_score,
    away_score:keeper.away_score,
    latitude:keeper.latitude,
    longitude:keeper.longitude
  };
  if(scoreSource){
    const scores=scoreBySchool(scoreSource);
    desired.status="FINAL";
    desired.home_score=scores.get(String(keeper.home_school_id));
    desired.away_score=scores.get(String(keeper.away_school_id));
  }
  if((desired.latitude==null||desired.longitude==null)){
    const geo=cluster.find(row=>row.latitude!=null&&row.longitude!=null);
    if(geo){desired.latitude=Number(geo.latitude);desired.longitude=Number(geo.longitude);}
  }
  return desired;
}

export function planDuplicateCanonicalMerges(canonicals=[],members=[],activeConflicts=[]){
  const byEventMembers=new Map();
  for(const row of members){
    if(!byEventMembers.has(row.canonical_event_id)) byEventMembers.set(row.canonical_event_id,[]);
    byEventMembers.get(row.canonical_event_id).push(row);
  }
  const conflictsByEvent=new Map();
  for(const row of activeConflicts){
    if(!conflictsByEvent.has(row.canonical_event_id)) conflictsByEvent.set(row.canonical_event_id,new Set());
    conflictsByEvent.get(row.canonical_event_id).add(String(row.conflict_type||"").toUpperCase());
  }
  const grouped=new Map();
  for(const event of canonicals){
    event.member_count=(byEventMembers.get(event.id)||[]).length;
    const key=pairKey(event.participant_a_school_id,event.participant_b_school_id,localDate(event.scheduled_at));
    if(!grouped.has(key)) grouped.set(key,[]);
    grouped.get(key).push(event);
  }
  const merges=[],blocked=[];
  for(const [key,events] of grouped){
    if(events.length<2) continue;
    const ordered=[...events].sort((a,b)=>new Date(a.scheduled_at)-new Date(b.scheduled_at)||String(a.id).localeCompare(String(b.id)));
    const clusters=[];
    for(const event of ordered){
      const last=clusters.at(-1);
      if(last&&minutesApart(last[0].scheduled_at,event.scheduled_at)<=DUPLICATE_MAX_MINUTES) last.push(event);
      else clusters.push([event]);
    }
    for(const cluster of clusters){
      if(cluster.length<2) continue;
      const finalKeys=[...new Set(cluster.filter(eventFinal).map(scoreKey).filter(Boolean))];
      const hasScoreConflict=cluster.some(event=>conflictsByEvent.get(event.id)?.has("SCORE"));
      if(finalKeys.length>1||hasScoreConflict){
        blocked.push({key,canonical_event_ids:cluster.map(row=>row.id),reason:hasScoreConflict?"active_score_conflict":"final_scores_disagree"});
        continue;
      }
      const keeper=chooseKeeper(cluster);
      const losers=cluster.filter(row=>row.id!==keeper.id);
      merges.push({
        key,
        keeper_id:keeper.id,
        loser_ids:losers.map(row=>row.id),
        member_rows_to_move:losers.reduce((sum,row)=>sum+(byEventMembers.get(row.id)||[]).length,0),
        desired:desiredKeeperState(keeper,cluster)
      });
    }
  }
  return {merges,blocked};
}

function orphanMatchesCanonical(orphan,event){
  const eventDate=localDate(event.scheduled_at),gameDate=localDate(orphan.scheduled_at);
  if(!eventDate||eventDate!==gameDate) return false;
  const schools=new Set([String(event.participant_a_school_id),String(event.participant_b_school_id)]);
  if(!schools.has(String(orphan.reporting_school_id))||!schools.has(String(orphan.opponent_school_id))) return false;
  if(!eventFinal(event)) return false;
  const scores=scoreBySchool(event);
  if(Number(scores.get(String(orphan.reporting_school_id)))!==Number(orphan.team_score)) return false;
  if(Number(scores.get(String(orphan.opponent_school_id)))!==Number(orphan.opponent_score)) return false;
  if(Number(event.scheduled_time_known||0)===0||Number(orphan.scheduled_time_known||0)===0) return true;
  return minutesApart(orphan.scheduled_at,event.scheduled_at)<=ORPHAN_MAX_MINUTES;
}

export function planOrphanAttachments(orphans=[],canonicals=[],members=[]){
  const existingReporting=new Map();
  for(const member of members){
    const key=`${member.canonical_event_id}|${member.reporting_team_id}`;
    existingReporting.set(key,(existingReporting.get(key)||0)+1);
  }
  const attachments=[],blocked=[];
  for(const orphan of orphans){
    const candidates=canonicals.filter(event=>orphanMatchesCanonical(orphan,event));
    if(candidates.length!==1){
      blocked.push({game_id:orphan.id,reason:candidates.length?"multiple_exact_canonical_matches":"no_exact_canonical_match",candidate_ids:candidates.map(row=>row.id)});
      continue;
    }
    const target=candidates[0];
    const already=existingReporting.get(`${target.id}|${orphan.team_id}`)||0;
    attachments.push({game_id:orphan.id,canonical_event_id:target.id,team_id:orphan.team_id,source_id:orphan.source_id,already_reporting_members:already});
  }
  return {attachments,blocked};
}

export function planCoordinateUpdates(canonicals=[],members=[]){
  const membersByEvent=new Map();
  for(const member of members){
    if(member.latitude==null||member.longitude==null) continue;
    if(!membersByEvent.has(member.canonical_event_id)) membersByEvent.set(member.canonical_event_id,[]);
    membersByEvent.get(member.canonical_event_id).push(member);
  }
  const updates=[],blocked=[];
  for(const event of canonicals){
    if(!eventFinal(event)||event.latitude!=null&&event.longitude!=null) continue;
    const rows=membersByEvent.get(event.id)||[];
    if(!rows.length) continue;
    const selected=rows.find(row=>row.source_id===event.selected_source_id);
    if(selected){updates.push({canonical_event_id:event.id,latitude:Number(selected.latitude),longitude:Number(selected.longitude),evidence:"selected_source_member"});continue;}
    const distinct=new Map();
    for(const row of rows){
      const key=`${Number(row.latitude).toFixed(4)},${Number(row.longitude).toFixed(4)}`;
      if(!distinct.has(key)) distinct.set(key,row);
    }
    if(distinct.size===1){
      const row=[...distinct.values()][0];
      updates.push({canonical_event_id:event.id,latitude:Number(row.latitude),longitude:Number(row.longitude),evidence:"unanimous_member_location"});
    } else blocked.push({canonical_event_id:event.id,reason:"member_locations_disagree",locations:[...distinct.keys()]});
  }
  return {updates,blocked};
}

async function read(env,sql,args=[]){
  const result=await env.DB.prepare(sql).bind(...args).all();
  if(rowsWritten(result)!==0) throw new Error("M7 finalization planner wrote to D1");
  return {rows:result.results||[],meta:{rows_read:rowsRead(result),rows_written:0}};
}

async function loadPlannerState(env){
  const localTeams=await read(env,`
    SELECT t.id AS team_id,t.school_id,t.conference_id,s.latitude AS school_latitude,s.longitude AS school_longitude
    FROM teams t JOIN schools s ON s.id=t.school_id
    WHERE t.active=1 AND t.sport=? AND t.gender=? AND t.season=?
      AND s.level='high-school' AND s.state='AR' AND s.catalog_scope='local'`,[SPORT,GENDER,SEASON]);
  const localSchoolIds=[...new Set(localTeams.rows.map(row=>row.school_id))];
  const canonicals=await read(env,`
    SELECT ce.*,src.authority_rank AS selected_authority_rank,src.parser_type AS selected_parser_type
    FROM canonical_events ce
    LEFT JOIN sources src ON src.id=ce.selected_source_id
    WHERE ce.sport=? AND ce.gender=? AND ce.season=?
      AND ce.scheduled_at>=? AND ce.scheduled_at<?
      AND (ce.participant_a_school_id IN (SELECT value FROM json_each(?))
        OR ce.participant_b_school_id IN (SELECT value FROM json_each(?)))
    ORDER BY ce.scheduled_at,ce.id`,[SPORT,GENDER,SEASON,SEASON_START,SEASON_END,JSON.stringify(localSchoolIds),JSON.stringify(localSchoolIds)]);
  const canonicalIds=canonicals.rows.map(row=>row.id);
  const members=canonicalIds.length?await read(env,`
    SELECT cem.canonical_event_id,cem.game_id,cem.source_id,cem.reporting_team_id,
      g.scheduled_at,g.scheduled_time_known,g.status,g.team_score,g.opponent_score,
      g.opponent_school_id,g.home_away,g.latitude,g.longitude,g.source_event_key,
      rt.school_id AS reporting_school_id
    FROM canonical_event_members cem
    JOIN games g ON g.id=cem.game_id
    JOIN teams rt ON rt.id=cem.reporting_team_id
    WHERE cem.canonical_event_id IN (SELECT value FROM json_each(?))`,[JSON.stringify(canonicalIds)]):{rows:[],meta:{rows_read:0,rows_written:0}};
  const conflicts=canonicalIds.length?await read(env,`
    SELECT canonical_event_id,conflict_type FROM event_conflicts
    WHERE resolved_at IS NULL AND canonical_event_id IN (SELECT value FROM json_each(?))`,[JSON.stringify(canonicalIds)]):{rows:[],meta:{rows_read:0,rows_written:0}};
  const orphans=await read(env,`
    SELECT g.id,g.team_id,g.source_id,g.source_event_key,g.opponent_school_id,g.scheduled_at,g.scheduled_time_known,
      g.status,g.team_score,g.opponent_score,g.latitude,g.longitude,t.school_id AS reporting_school_id
    FROM games g
    JOIN teams t ON t.id=g.team_id
    JOIN schools s ON s.id=t.school_id
    WHERE g.canonical_event_id IS NULL
      AND g.status='FINAL' AND g.team_score IS NOT NULL AND g.opponent_score IS NOT NULL
      AND g.opponent_school_id IS NOT NULL
      AND t.active=1 AND t.sport=? AND t.gender=? AND t.season=?
      AND s.level='high-school' AND s.state='AR' AND s.catalog_scope='local'
      AND g.scheduled_at>=? AND g.scheduled_at<?
    ORDER BY g.scheduled_at,g.id`,[SPORT,GENDER,SEASON,SEASON_START,SEASON_END]);
  return {localTeams,canonicals,members,conflicts,orphans};
}

function planFingerprint(plan){
  const payload={
    duplicate_merges:plan.duplicates.merges.map(row=>({keeper:row.keeper_id,losers:row.loser_ids,desired:row.desired})),
    orphan_attachments:plan.orphans.attachments.map(row=>({game:row.game_id,event:row.canonical_event_id})),
    coordinate_updates:plan.coordinates.updates.map(row=>({event:row.canonical_event_id,lat:row.latitude,lon:row.longitude})),
    membership_changes:(plan.membership?.plan?.changes||[]).map(row=>({team_id:row.team_id,conference_id:row.expected_conference_id}))
  };
  return `m7-finalize-${fnv1a32(JSON.stringify(payload))}`;
}

export async function planM7VolleyballFinalization(env,{fetchFn=fetch}={}){
  const state=await loadPlannerState(env);
  const duplicates=planDuplicateCanonicalMerges(state.canonicals.rows,state.members.rows,state.conflicts.rows);
  const loserIds=new Set(duplicates.merges.flatMap(row=>row.loser_ids));
  const survivingCanonicals=state.canonicals.rows.filter(row=>!loserIds.has(row.id));
  const orphans=planOrphanAttachments(state.orphans.rows,survivingCanonicals,state.members.rows);
  const coordinates=planCoordinateUpdates(survivingCanonicals,state.members.rows);
  const membership=await syncPublishedVolleyballConferenceMembership(env,{fetchFn,dryRun:true,maxTeamChanges:MAX_MEMBERSHIP_CHANGES,maxConferenceRows:40});
  const metas=[state.localTeams.meta,state.canonicals.meta,state.members.meta,state.conflicts.meta,state.orphans.meta];
  const d1={statements:metas.length,rows_read:metas.reduce((sum,row)=>sum+row.rows_read,0),rows_written:0,per_statement:metas};
  const duplicateLosers=duplicates.merges.reduce((sum,row)=>sum+row.loser_ids.length,0);
  const duplicateMemberMoves=duplicates.merges.reduce((sum,row)=>sum+row.member_rows_to_move,0);
  const logical={
    canonical_keeper_updates:duplicates.merges.length,
    canonical_member_moves:duplicateMemberMoves,
    canonical_game_moves:duplicateMemberMoves,
    canonical_event_deletes:duplicateLosers,
    orphan_game_attachments:orphans.attachments.length,
    orphan_member_inserts:orphans.attachments.length,
    canonical_coordinate_updates:coordinates.updates.length,
    conference_team_updates:Number(membership?.plan?.change_count||0),
    statewide_record_rows:state.localTeams.rows.length
  };
  const logicalRows=Object.values(logical).reduce((sum,n)=>sum+Number(n||0),0);
  const safe=d1.rows_read<=MAX_PLANNER_ROWS_READ
    && duplicateLosers<=MAX_DUPLICATE_LOSERS
    && orphans.attachments.length<=MAX_ORPHAN_ATTACHES
    && coordinates.updates.length<=MAX_COORDINATE_UPDATES
    && Number(membership?.plan?.change_count||0)<=MAX_MEMBERSHIP_CHANGES;
  const plan={
    generated_at:new Date().toISOString(),d1,safe_to_execute:safe,
    local_team_count:state.localTeams.rows.length,
    duplicates,orphans,coordinates,membership,
    write_scope:{logical_table_rows:logical,logical_application_rows:logicalRows},
    _private:{state}
  };
  plan.plan_fingerprint=planFingerprint(plan);
  return plan;
}

function duplicateStatements(env,plan,now){
  const mappings=plan.duplicates.merges.flatMap(row=>row.loser_ids.map(loser_id=>({loser_id,keeper_id:row.keeper_id})));
  const keepers=plan.duplicates.merges.map(row=>row.desired);
  if(!mappings.length) return [];
  return [
    env.DB.prepare(`WITH payload AS (SELECT json_extract(value,'$.id') id,json_extract(value,'$.status') status,json_extract(value,'$.home_score') home_score,json_extract(value,'$.away_score') away_score,json_extract(value,'$.latitude') latitude,json_extract(value,'$.longitude') longitude FROM json_each(?))
      UPDATE canonical_events SET
        status=(SELECT status FROM payload WHERE id=canonical_events.id),
        home_score=(SELECT home_score FROM payload WHERE id=canonical_events.id),
        away_score=(SELECT away_score FROM payload WHERE id=canonical_events.id),
        latitude=COALESCE((SELECT latitude FROM payload WHERE id=canonical_events.id),latitude),
        longitude=COALESCE((SELECT longitude FROM payload WHERE id=canonical_events.id),longitude),
        last_reconciled_at=?,updated_at=?
      WHERE id IN (SELECT id FROM payload)`).bind(JSON.stringify(keepers),now,now),
    env.DB.prepare(`WITH payload AS (SELECT json_extract(value,'$.loser_id') loser_id,json_extract(value,'$.keeper_id') keeper_id FROM json_each(?))
      UPDATE games SET canonical_event_id=(SELECT keeper_id FROM payload WHERE loser_id=games.canonical_event_id),updated_at=?
      WHERE canonical_event_id IN (SELECT loser_id FROM payload)`).bind(JSON.stringify(mappings),now),
    env.DB.prepare(`WITH payload AS (SELECT json_extract(value,'$.loser_id') loser_id,json_extract(value,'$.keeper_id') keeper_id FROM json_each(?))
      UPDATE canonical_event_members SET canonical_event_id=(SELECT keeper_id FROM payload WHERE loser_id=canonical_event_members.canonical_event_id)
      WHERE canonical_event_id IN (SELECT loser_id FROM payload)`).bind(JSON.stringify(mappings)),
    env.DB.prepare(`WITH payload AS (SELECT json_extract(value,'$.loser_id') loser_id FROM json_each(?))
      DELETE FROM canonical_events WHERE id IN (SELECT loser_id FROM payload)`).bind(JSON.stringify(mappings))
  ];
}

function orphanStatements(env,plan,now){
  const rows=plan.orphans.attachments;
  if(!rows.length) return [];
  return [
    env.DB.prepare(`WITH payload AS (SELECT json_extract(value,'$.game_id') game_id,json_extract(value,'$.canonical_event_id') canonical_event_id FROM json_each(?))
      UPDATE games SET canonical_event_id=(SELECT canonical_event_id FROM payload WHERE game_id=games.id),updated_at=?
      WHERE id IN (SELECT game_id FROM payload) AND canonical_event_id IS NULL`).bind(JSON.stringify(rows),now),
    env.DB.prepare(`WITH payload AS (SELECT json_extract(value,'$.game_id') game_id,json_extract(value,'$.canonical_event_id') canonical_event_id FROM json_each(?))
      INSERT OR IGNORE INTO canonical_event_members(canonical_event_id,game_id,source_id,reporting_team_id,added_at)
      SELECT p.canonical_event_id,g.id,g.source_id,g.team_id,? FROM payload p JOIN games g ON g.id=p.game_id`).bind(JSON.stringify(rows),now)
  ];
}

function coordinateStatement(env,plan,now){
  const rows=plan.coordinates.updates;
  if(!rows.length) return null;
  return env.DB.prepare(`WITH payload AS (SELECT json_extract(value,'$.canonical_event_id') canonical_event_id,json_extract(value,'$.latitude') latitude,json_extract(value,'$.longitude') longitude FROM json_each(?))
    UPDATE canonical_events SET
      latitude=(SELECT latitude FROM payload WHERE canonical_event_id=canonical_events.id),
      longitude=(SELECT longitude FROM payload WHERE canonical_event_id=canonical_events.id),
      last_reconciled_at=?,updated_at=?
    WHERE id IN (SELECT canonical_event_id FROM payload)
      AND (latitude IS NULL OR longitude IS NULL)`).bind(JSON.stringify(rows),now,now);
}

export async function executeM7VolleyballFinalization(env,{fetchFn=fetch,expectedFingerprint=null}={}){
  const plan=await planM7VolleyballFinalization(env,{fetchFn});
  if(!plan.safe_to_execute) throw new Error("M7 finalization live plan is not safe to execute");
  if(expectedFingerprint&&expectedFingerprint!==plan.plan_fingerprint) throw new Error(`M7 finalization fingerprint changed: expected ${expectedFingerprint}, got ${plan.plan_fingerprint}`);
  const now=new Date().toISOString();
  const statements=[...duplicateStatements(env,plan,now),...orphanStatements(env,plan,now)];
  const coordinate=coordinateStatement(env,plan,now);if(coordinate) statements.push(coordinate);
  const repairResults=statements.length?await env.DB.batch(statements):[];
  const repairTelemetry={statements:repairResults.length,rows_read:repairResults.reduce((sum,row)=>sum+rowsRead(row),0),rows_written:repairResults.reduce((sum,row)=>sum+rowsWritten(row),0),per_statement:repairResults.map(row=>({rows_read:rowsRead(row),rows_written:rowsWritten(row)}))};
  const membership=await syncPublishedVolleyballConferenceMembership(env,{fetchFn,dryRun:false,maxTeamChanges:MAX_MEMBERSHIP_CHANGES,maxConferenceRows:40});
  const records=await rebuildStatewideRecords(env,now);
  const verification=await planM7VolleyballFinalization(env,{fetchFn});
  return {
    status:"SUCCESS",executed_at:now,plan_fingerprint:plan.plan_fingerprint,
    planned_write_scope:plan.write_scope,
    repair_d1:repairTelemetry,
    membership,records,
    verification:{
      fingerprint:verification.plan_fingerprint,
      safe_to_execute:verification.safe_to_execute,
      duplicate_merges_remaining:verification.duplicates.merges.length,
      orphan_attachments_remaining:verification.orphans.attachments.length,
      coordinate_updates_remaining:verification.coordinates.updates.length,
      membership_changes_remaining:Number(verification.membership?.plan?.change_count||0),
      d1:verification.d1
    }
  };
}

export const M7_FINALIZATION_LIMITS={MAX_PLANNER_ROWS_READ,MAX_DUPLICATE_LOSERS,MAX_ORPHAN_ATTACHES,MAX_COORDINATE_UPDATES,MAX_MEMBERSHIP_CHANGES};
