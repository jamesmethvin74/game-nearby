import { zonedIso } from "./parser-core.js";
import {
  matchLocalVolleyballTeams,
  maxPrepsScoresUrl,
  parseMaxPrepsVolleyballScores
} from "./maxpreps-volleyball-results.js";

const TIME_ZONE="America/Chicago";
const SOURCE_PREFIX="maxpreps-volleyball-results:";

function rowsRead(result){return Number(result?.meta?.rows_read||0);}
function rowsWritten(result){return Number(result?.meta?.rows_written||0);}
function sourceId(teamId){return `${SOURCE_PREFIX}${teamId}`;}
function gameId(teamId,contestId){return `${sourceId(teamId)}:native:${contestId}`;}
function pairKey(a,b){return [String(a),String(b)].sort().join("|");}
function placeholders(count){return Array(count).fill("?").join(",");}
function fnv1a32(value){
  let hash=0x811c9dc5;
  for(const char of String(value||"")){hash^=char.codePointAt(0);hash=Math.imul(hash,0x01000193)>>>0;}
  return hash.toString(16).padStart(8,"0");
}
function localIso(localDate){
  const [year,month,day]=String(localDate).split("-").map(Number);
  return zonedIso({year,month,day,hour:0,minute:0},TIME_ZONE);
}
function nextLocalDate(localDate){
  const [year,month,day]=String(localDate).split("-").map(Number);
  const value=new Date(Date.UTC(year,month-1,day+1,18));
  return new Intl.DateTimeFormat("en-CA",{timeZone:TIME_ZONE,year:"numeric",month:"2-digit",day:"2-digit"}).format(value);
}

async function read(env,sql,args=[]){
  const result=await env.DB.prepare(sql).bind(...args).all();
  const written=rowsWritten(result);
  if(written!==0) throw new Error(`M7 date final planner must be zero-write; observed rows_written=${written}`);
  return {rows:result.results||[],meta:{rows_read:rowsRead(result),rows_written:0}};
}

function scoreBySchool(event){
  return new Map([[String(event.home_school_id),Number(event.home_score)],[String(event.away_school_id),Number(event.away_score)]]);
}
function canonicalMatchesFinal(event,final){
  if(event.status!=="FINAL"||event.home_score==null||event.away_score==null) return false;
  const scores=scoreBySchool(event);
  return Number(scores.get(String(final.homeTeam.school_id)))===Number(final.home.score)
    && Number(scores.get(String(final.awayTeam.school_id)))===Number(final.away.score);
}
function classifyMatchedFinal(final,events){
  if(events.some(event=>canonicalMatchesFinal(event,final))) return "already_converged";
  if(events.some(event=>event.status==="SCHEDULED")) return "stale_scheduled_external_final";
  if(events.some(event=>event.status==="FINAL")) return "external_final_score_conflict";
  return "missing_externally_published_final";
}

export function canonicalDesiredFinal(target,canonical){
  const scores=new Map([
    [String(target.home.school_id),Number(target.home.score)],
    [String(target.away.school_id),Number(target.away.score)]
  ]);
  return {
    status:"FINAL",
    home_school_id:canonical.home_school_id,
    away_school_id:canonical.away_school_id,
    home_score:scores.get(String(canonical.home_school_id)),
    away_score:scores.get(String(canonical.away_school_id))
  };
}

function reportingRows(target){
  return [
    {
      canonical_event_id:target.canonical_event_id,contest_id:target.contest_id,
      team_id:target.home.team_id,school_id:target.home.school_id,
      opponent_team_id:target.away.team_id,opponent_school_id:target.away.school_id,
      opponent_name:target.away.name,source_id:sourceId(target.home.team_id),
      game_id:gameId(target.home.team_id,target.contest_id),source_event_key:`native:${target.contest_id}`,
      home_away:"home",team_score:target.home.score,opponent_score:target.away.score,
      result:Number(target.home.score)>Number(target.away.score)?"W":Number(target.home.score)<Number(target.away.score)?"L":"T"
    },
    {
      canonical_event_id:target.canonical_event_id,contest_id:target.contest_id,
      team_id:target.away.team_id,school_id:target.away.school_id,
      opponent_team_id:target.home.team_id,opponent_school_id:target.home.school_id,
      opponent_name:target.home.name,source_id:sourceId(target.away.team_id),
      game_id:gameId(target.away.team_id,target.contest_id),source_event_key:`native:${target.contest_id}`,
      home_away:"away",team_score:target.away.score,opponent_score:target.home.score,
      result:Number(target.away.score)>Number(target.home.score)?"W":Number(target.away.score)<Number(target.home.score)?"L":"T"
    }
  ];
}

export async function planM7VolleyballDateFinals(env,localDate,{fetchFn=fetch}={}){
  if(!/^2026-\d{2}-\d{2}$/.test(String(localDate||""))) throw new Error("M7 volleyball planner date must be YYYY-MM-DD in 2026");
  const start=localIso(localDate),end=localIso(nextLocalDate(localDate));

  const teams=await read(env,`
    SELECT t.id AS team_id,t.school_id,COALESCE(NULLIF(s.location_matched_name,''),s.name) AS school_name
    FROM teams t JOIN schools s ON s.id=t.school_id
    WHERE t.active=1 AND t.sport='volleyball' AND t.gender='girls' AND t.season='2026'
      AND s.level='high-school' AND s.state='AR' AND s.catalog_scope='local'
    ORDER BY t.id`);

  // Keep the indexed column bare. Wrapping scheduled_at in datetime() defeats idx_canonical_events_time.
  const canonicals=await read(env,`
    SELECT ce.id,ce.participant_a_school_id,ce.participant_b_school_id,ce.home_school_id,ce.away_school_id,
      ce.scheduled_at,ce.status,ce.home_score,ce.away_score,ce.selected_source_id,ce.trust_state,ce.conflict_count,
      src.parser_type AS selected_parser_type,src.authority_rank AS selected_authority_rank
    FROM canonical_events ce
    LEFT JOIN sources src ON src.id=ce.selected_source_id
    WHERE ce.sport='volleyball' AND ce.gender='girls' AND ce.season='2026'
      AND ce.scheduled_at>=? AND ce.scheduled_at<?
    ORDER BY ce.id`,[start,end]);

  const scoreUrl=maxPrepsScoresUrl(localDate);
  const response=await fetchFn(scoreUrl,{headers:{"user-agent":"LocalBleachersAR-m7-date-audit/1.0","accept":"text/html,application/xhtml+xml"}});
  if(!response.ok) throw new Error(`MaxPreps volleyball scores HTTP ${response.status} for ${localDate}`);
  const parsed=parseMaxPrepsVolleyballScores(await response.text(),{localDate,sourceUrl:response.url||scoreUrl});
  const matches=matchLocalVolleyballTeams(parsed,teams.rows);

  const eventsByPair=new Map();
  for(const event of canonicals.rows){
    const key=pairKey(event.participant_a_school_id,event.participant_b_school_id);
    if(!eventsByPair.has(key)) eventsByPair.set(key,[]);
    eventsByPair.get(key).push(event);
  }

  const matched=[];
  const staleTargets=[];
  for(const final of matches.matched){
    const events=eventsByPair.get(pairKey(final.homeTeam.school_id,final.awayTeam.school_id))||[];
    const type=classifyMatchedFinal(final,events);
    const row={
      type,contest_id:final.contestId,source_url:final.sourceUrl,
      home:{name:final.home.name,score:Number(final.home.score),team_id:final.homeTeam.team_id,school_id:final.homeTeam.school_id},
      away:{name:final.away.name,score:Number(final.away.score),team_id:final.awayTeam.team_id,school_id:final.awayTeam.school_id},
      canonical_events:events.map(event=>({id:event.id,status:event.status,home_school_id:event.home_school_id,away_school_id:event.away_school_id,home_score:event.home_score,away_score:event.away_score,selected_source_id:event.selected_source_id,selected_parser_type:event.selected_parser_type,trust_state:event.trust_state,conflict_count:event.conflict_count}))
    };
    matched.push(row);
    if(type==="stale_scheduled_external_final"&&events.length===1) staleTargets.push({...row,canonical_event_id:events[0].id,canonical:events[0]});
  }

  const observations=staleTargets.flatMap(reportingRows);
  let sources={rows:[],meta:{rows_read:0,rows_written:0}};
  let games={rows:[],meta:{rows_read:0,rows_written:0}};
  let members={rows:[],meta:{rows_read:0,rows_written:0}};
  let conflicts={rows:[],meta:{rows_read:0,rows_written:0}};
  if(observations.length){
    const sourceIds=[...new Set(observations.map(row=>row.source_id))];
    const gameIds=[...new Set(observations.map(row=>row.game_id))];
    const canonicalIds=[...new Set(staleTargets.map(row=>row.canonical_event_id))];
    sources=await read(env,`SELECT id,team_id,source_url,source_type,parser_type,authority_rank,enabled FROM sources WHERE id IN (${placeholders(sourceIds.length)}) ORDER BY id`,sourceIds);
    games=await read(env,`SELECT id,team_id,source_id,source_event_key,opponent_school_id,status,team_score,opponent_score,result,canonical_event_id FROM games WHERE id IN (${placeholders(gameIds.length)}) ORDER BY id`,gameIds);
    members=await read(env,`SELECT canonical_event_id,game_id,source_id,reporting_team_id FROM canonical_event_members WHERE canonical_event_id IN (${placeholders(canonicalIds.length)}) ORDER BY canonical_event_id,game_id`,canonicalIds);
    conflicts=await read(env,`SELECT id,canonical_event_id,conflict_type FROM event_conflicts WHERE resolved_at IS NULL AND canonical_event_id IN (${placeholders(canonicalIds.length)}) ORDER BY canonical_event_id,id`,canonicalIds);
  }

  const sourceById=new Map(sources.rows.map(row=>[String(row.id),row]));
  const gameById=new Map(games.rows.map(row=>[String(row.id),row]));
  const memberByGameId=new Map(members.rows.map(row=>[String(row.game_id),row]));
  const conflictsByCanonical=new Map();
  for(const row of conflicts.rows){
    if(!conflictsByCanonical.has(String(row.canonical_event_id))) conflictsByCanonical.set(String(row.canonical_event_id),[]);
    conflictsByCanonical.get(String(row.canonical_event_id)).push(row);
  }

  const blockers=[];
  const stalePlan=[];
  for(const target of staleTargets){
    const canonical=target.canonical;
    const participants=new Set([String(canonical.participant_a_school_id),String(canonical.participant_b_school_id)]);
    if(!participants.has(String(target.home.school_id))||!participants.has(String(target.away.school_id))) blockers.push(`${target.contest_id}:participant_mismatch`);
    if(!participants.has(String(canonical.home_school_id))||!participants.has(String(canonical.away_school_id))) blockers.push(`${target.contest_id}:canonical_home_away_invalid`);
    if(canonical.status!=="SCHEDULED"||canonical.home_score!=null||canonical.away_score!=null) blockers.push(`${target.contest_id}:canonical_state_changed`);
    if(canonical.selected_parser_type!=="dragonfly-public") blockers.push(`${target.contest_id}:selected_source_not_dragonfly`);
    if(Number(canonical.conflict_count)!==0||(conflictsByCanonical.get(target.canonical_event_id)||[]).length) blockers.push(`${target.contest_id}:unresolved_conflict`);
    const desired=canonicalDesiredFinal(target,canonical);
    if(!Number.isFinite(desired.home_score)||!Number.isFinite(desired.away_score)) blockers.push(`${target.contest_id}:score_orientation_unresolved`);
    stalePlan.push({contest_id:target.contest_id,canonical_event_id:target.canonical_event_id,authority_home:target.home,authority_away:target.away,canonical_desired:desired,current:canonical});
  }

  const sourcePlan=[];const gamePlan=[];const memberPlan=[];
  for(const expected of observations){
    const source=sourceById.get(expected.source_id)||null;
    if(source&&(String(source.team_id)!==expected.team_id||source.parser_type!=="maxpreps-scores"||Number(source.authority_rank)!==80)) blockers.push(`${expected.source_id}:unexpected_source_shape`);
    sourcePlan.push({source_id:expected.source_id,team_id:expected.team_id,current:source,insert_required:!source});
    const game=gameById.get(expected.game_id)||null;
    let action="INSERT";
    if(game){
      if(String(game.team_id)!==expected.team_id||String(game.opponent_school_id)!==expected.opponent_school_id||String(game.source_event_key)!==expected.source_event_key) blockers.push(`${expected.game_id}:unexpected_game_identity`);
      const exact=game.status==="FINAL"&&Number(game.team_score)===expected.team_score&&Number(game.opponent_score)===expected.opponent_score&&String(game.canonical_event_id||"")===expected.canonical_event_id;
      action=exact?"NONE":"UPDATE";
    }
    gamePlan.push({...expected,current:game,action});
    const member=memberByGameId.get(expected.game_id)||null;
    if(member&&String(member.canonical_event_id)!==expected.canonical_event_id) blockers.push(`${expected.game_id}:member_attached_elsewhere`);
    memberPlan.push({game_id:expected.game_id,canonical_event_id:expected.canonical_event_id,current:member,insert_required:!member});
  }

  const logicalTableRows={
    sources_insert:new Set(sourcePlan.filter(row=>row.insert_required).map(row=>row.source_id)).size,
    games_insert:gamePlan.filter(row=>row.action==="INSERT").length,
    games_update:gamePlan.filter(row=>row.action==="UPDATE").length,
    canonical_event_members_insert:memberPlan.filter(row=>row.insert_required).length,
    canonical_events_update:stalePlan.length,
    event_conflicts:0,team_records:0,standings:0
  };
  const writeScope={logical_table_rows:logicalTableRows,logical_application_rows:Object.values(logicalTableRows).reduce((sum,value)=>sum+Number(value||0),0)};
  const d1Statements=[teams.meta,canonicals.meta,sources.meta,games.meta,members.meta,conflicts.meta];
  const d1={statements:d1Statements.length,rows_read:d1Statements.reduce((sum,row)=>sum+row.rows_read,0),rows_written:0,per_statement:d1Statements};
  const oneSided=matches.oneSided.map(final=>({
    contest_id:final.contestId,source_url:final.sourceUrl,
    home:{name:final.home.name,score:Number(final.home.score),local_team_id:final.homeTeam?.team_id||null},
    away:{name:final.away.name,score:Number(final.away.score),local_team_id:final.awayTeam?.team_id||null},
    unresolved_side:final.unresolvedSide
  }));
  const fingerprintInput={localDate,stalePlan,sourcePlan,gamePlan,memberPlan,conflicts:conflicts.rows,writeScope};
  return {
    generated_at:new Date().toISOString(),local_date:localDate,
    authority:{parsed_finals:parsed.length,matched_local_local:matches.matched.length,one_sided_local:oneSided.length,ambiguous:matches.ambiguous.length},
    d1,
    safe_to_execute_stale_local_local:blockers.length===0&&stalePlan.length>0,
    blockers,
    plan_fingerprint:`m7-${localDate.replaceAll("-","")}-${fnv1a32(JSON.stringify(fingerprintInput))}`,
    write_scope:writeScope,
    stale_local_local:stalePlan,
    source_plan:sourcePlan,game_plan:gamePlan,member_plan:memberPlan,
    one_sided_finals:oneSided,
    other_local_local_gaps:matched.filter(row=>row.type!=="already_converged"&&row.type!=="stale_scheduled_external_final"),
    already_converged_count:matched.filter(row=>row.type==="already_converged").length,
    invariants:{production_write_performed:false,logical_rows_are_not_d1_rows_written:true,indexed_canonical_time_predicate:true}
  };
}
