import { dateKeyInZone } from "./schedule-authority-core.js";
import { zonedIso } from "./parser-core.js";
import { maxPrepsScoresUrl, matchLocalVolleyballTeams, parseMaxPrepsVolleyballScores } from "./maxpreps-volleyball-results.js";

const TIME_ZONE="America/Chicago";
const SEASON_START="2026-08-01";
const SOURCE_PREFIX="maxpreps-volleyball-results:";
const SOURCE_URL="https://www.maxpreps.com/ar/volleyball/scores/";
const MAX_PLANNER_ROWS_READ=100000;
const MAX_LOGICAL_WRITES=1200;
const MAX_D1_WRITES=1800;
const MAX_CONTESTS=140;

function rowsRead(result){return Number(result?.meta?.rows_read||0);}
function rowsWritten(result){return Number(result?.meta?.rows_written||result?.meta?.changes||0);}
function localDateOffset(localDate,days){
  const [y,m,d]=String(localDate).split("-").map(Number);
  return new Intl.DateTimeFormat("en-CA",{timeZone:TIME_ZONE,year:"numeric",month:"2-digit",day:"2-digit"})
    .format(new Date(Date.UTC(y,m-1,d+days,18,0,0)));
}
function localIso(localDate,{hour=12,minute=0}={}){
  const [year,month,day]=String(localDate).split("-").map(Number);
  return zonedIso({year,month,day,hour,minute},TIME_ZONE);
}
function dateRange(start,end){
  const rows=[];
  for(let day=start,guard=0;day&&day<=end&&guard<130;day=localDateOffset(day,1),guard++) rows.push(day);
  return rows;
}
function pairKey(a,b,date){return `${[String(a),String(b)].sort().join("|")}|${date}`;}
function sourceId(teamId){return `${SOURCE_PREFIX}${teamId}`;}
function gameId(teamId,contestId){return `${sourceId(teamId)}:native:${contestId}`;}
function safeIdToken(value){return String(value||"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");}
function canonicalId(final){
  const participants=[final.homeTeam.school_id,final.awayTeam.school_id].sort();
  return ["ce","volleyball","girls","2026",participants[0],participants[1],final.localDate.replaceAll("-",""),`mp-${safeIdToken(final.contestId)}`].join(":");
}
function canonicalScore(event,final){
  const bySchool=new Map([[String(final.homeTeam.school_id),Number(final.home.score)],[String(final.awayTeam.school_id),Number(final.away.score)]]);
  return {home_score:bySchool.get(String(event.home_school_id)),away_score:bySchool.get(String(event.away_school_id))};
}
function eventMatchesFinal(event,final){
  if(String(event.status)!=="FINAL"||event.home_score==null||event.away_score==null) return false;
  const desired=canonicalScore(event,final);
  return Number(event.home_score)===Number(desired.home_score)&&Number(event.away_score)===Number(desired.away_score);
}
function observationRows(candidate){
  const final=candidate.final;
  const canonical=candidate.canonical;
  const canonicalHome=canonical?.home_school_id||final.homeTeam.school_id;
  const canonicalAway=canonical?.away_school_id||final.awayTeam.school_id;
  const scheduledAt=canonical?.scheduled_at||localIso(final.localDate,{hour:12});
  return [final.homeTeam,final.awayTeam].map(team=>{
    const opponent=team.school_id===final.homeTeam.school_id?final.awayTeam:final.homeTeam;
    const teamScore=team.school_id===final.homeTeam.school_id?Number(final.home.score):Number(final.away.score);
    const opponentScore=team.school_id===final.homeTeam.school_id?Number(final.away.score):Number(final.home.score);
    const homeAway=team.school_id===canonicalHome?"home":team.school_id===canonicalAway?"away":"unknown";
    return {
      game_id:gameId(team.team_id,final.contestId),team_id:team.team_id,school_id:team.school_id,
      source_id:sourceId(team.team_id),source_event_key:`native:${final.contestId}`,
      opponent_name:opponent.school_name||opponent.name||"Opponent",opponent_school_id:opponent.school_id,
      scheduled_at:scheduledAt,home_away:homeAway,team_score:teamScore,opponent_score:opponentScore,
      result:teamScore===opponentScore?"T":teamScore>opponentScore?"W":"L",
      canonical_event_id:candidate.canonical_event_id
    };
  });
}
function fnv1a32(value){let hash=0x811c9dc5;for(const char of String(value||"")){hash^=char.codePointAt(0);hash=Math.imul(hash,0x01000193)>>>0;}return hash.toString(16).padStart(8,"0");}
async function read(env,sql,args=[]){
  const result=await env.DB.prepare(sql).bind(...args).all();
  if(rowsWritten(result)!==0) throw new Error("M7 local-final planner performed an unexpected write");
  return {rows:result.results||[],meta:{rows_read:rowsRead(result),rows_written:0}};
}
async function readIds(env,table,columns,ids,idColumn="id"){
  if(!ids.length) return {rows:[],meta:{rows_read:0,rows_written:0}};
  return read(env,`SELECT ${columns} FROM ${table} WHERE ${idColumn} IN (SELECT value FROM json_each(?))`,[JSON.stringify(ids)]);
}
async function fetchAuthority(localTeams,dates,fetchFn){
  const finals=[],oneSided=[],ambiguous=[];
  let parsedFinals=0;
  for(let offset=0;offset<dates.length;offset+=5){
    const batch=dates.slice(offset,offset+5);
    const pages=await Promise.all(batch.map(async localDate=>{
      const url=maxPrepsScoresUrl(localDate);
      const response=await fetchFn(url,{headers:{"user-agent":"LocalBleachersAR-m7-convergence/1.0","accept":"text/html,application/xhtml+xml"}});
      if(!response.ok) throw new Error(`MaxPreps volleyball scores HTTP ${response.status} for ${localDate}`);
      return {localDate,parsed:parseMaxPrepsVolleyballScores(await response.text(),{localDate,sourceUrl:response.url||url})};
    }));
    for(const page of pages){
      parsedFinals+=page.parsed.length;
      const matched=matchLocalVolleyballTeams(page.parsed,localTeams);
      finals.push(...matched.matched);oneSided.push(...matched.oneSided);ambiguous.push(...matched.ambiguous);
    }
  }
  return {finals,oneSided,ambiguous,parsedFinals};
}

export async function planM7LocalFinalConvergence(env,{fetchFn=fetch,now=new Date()}={}){
  const endDate=dateKeyInZone(now.toISOString(),TIME_ZONE);
  const dates=dateRange(SEASON_START,endDate);
  const teams=await read(env,`
    SELECT t.id AS team_id,t.school_id,t.conference_id,s.name AS raw_school_name,
      s.location_matched_name,COALESCE(NULLIF(s.location_matched_name,''),s.name) AS school_name
    FROM teams t JOIN schools s ON s.id=t.school_id
    WHERE t.active=1 AND t.sport='volleyball' AND t.gender='girls' AND t.season='2026'
      AND s.level='high-school' AND s.state='AR' AND s.catalog_scope='local'
    ORDER BY t.id`);
  const authority=await fetchAuthority(teams.rows,dates,fetchFn);
  const startIso=localIso(SEASON_START,{hour:0}),endIso=localIso(localDateOffset(endDate,1),{hour:0});
  const canonicals=await read(env,`
    SELECT ce.id,ce.participant_a_school_id,ce.participant_b_school_id,ce.home_school_id,ce.away_school_id,
      ce.scheduled_at,ce.scheduled_time_known,ce.status,ce.home_score,ce.away_score,ce.selected_source_id,
      ce.trust_state,ce.conflict_count,src.parser_type AS selected_parser_type
    FROM canonical_events ce LEFT JOIN sources src ON src.id=ce.selected_source_id
    WHERE ce.scheduled_at>=? AND ce.scheduled_at<?
      AND ce.sport='volleyball' AND ce.gender='girls' AND ce.season='2026'
    ORDER BY ce.scheduled_at,ce.id`,[startIso,endIso]);

  const eventsByPair=new Map();
  for(const row of canonicals.rows){
    const date=dateKeyInZone(row.scheduled_at,TIME_ZONE);if(!date) continue;
    const key=pairKey(row.participant_a_school_id,row.participant_b_school_id,date);
    if(!eventsByPair.has(key)) eventsByPair.set(key,[]);eventsByPair.get(key).push(row);
  }
  const finalsByPair=new Map();
  for(const final of authority.finals){
    const key=pairKey(final.homeTeam.school_id,final.awayTeam.school_id,final.localDate);
    if(!finalsByPair.has(key)) finalsByPair.set(key,[]);finalsByPair.get(key).push(final);
  }

  const preliminary=[],excluded=[];let alreadyConverged=0;
  for(const final of authority.finals){
    const key=pairKey(final.homeTeam.school_id,final.awayTeam.school_id,final.localDate);
    const events=eventsByPair.get(key)||[];
    if(events.some(event=>eventMatchesFinal(event,final))){alreadyConverged++;continue;}
    if(events.length===0){
      preliminary.push({kind:"missing",final,canonical:null,canonical_event_id:canonicalId(final)});continue;
    }
    if(events.length===1 && (finalsByPair.get(key)||[]).length===1){
      const event=events[0];
      if(event.status==="SCHEDULED"&&event.home_score==null&&event.away_score==null&&event.selected_parser_type==="dragonfly-public"&&Number(event.conflict_count||0)===0&&event.home_school_id&&event.away_school_id){
        preliminary.push({kind:"stale",final,canonical:event,canonical_event_id:event.id});continue;
      }
    }
    excluded.push({contest_id:final.contestId,local_date:final.localDate,reason:events.length>1?"multiple_existing_canonicals":(finalsByPair.get(key)||[]).length>1?"multiple_authority_finals_same_pair_date":"existing_canonical_not_safe",canonical_ids:events.map(row=>row.id)});
  }
  if(preliminary.length>MAX_CONTESTS) throw new Error(`M7 local-final candidate count ${preliminary.length} exceeds cap ${MAX_CONTESTS}`);

  const observations=preliminary.flatMap(observationRows);
  const sourceIds=[...new Set(observations.map(row=>row.source_id))];
  const gameIds=[...new Set(observations.map(row=>row.game_id))];
  const staleIds=[...new Set(preliminary.filter(row=>row.kind==="stale").map(row=>row.canonical_event_id))];
  const sources=await readIds(env,"sources","id,team_id,source_type,parser_type,authority_rank,enabled",sourceIds);
  const games=await readIds(env,"games","id,team_id,source_id,source_event_key,opponent_school_id,status,team_score,opponent_score,result,canonical_event_id",gameIds);
  const members=await readIds(env,"canonical_event_members","canonical_event_id,game_id,source_id,reporting_team_id",gameIds,"game_id");
  const conflicts=staleIds.length?await read(env,"SELECT canonical_event_id,conflict_type FROM event_conflicts WHERE resolved_at IS NULL AND canonical_event_id IN (SELECT value FROM json_each(?))",[JSON.stringify(staleIds)]):{rows:[],meta:{rows_read:0,rows_written:0}};
  const sourceById=new Map(sources.rows.map(row=>[String(row.id),row]));
  const gameById=new Map(games.rows.map(row=>[String(row.id),row]));
  const memberByGame=new Map(members.rows.map(row=>[String(row.game_id),row]));
  const conflictIds=new Set(conflicts.rows.map(row=>String(row.canonical_event_id)));

  const safe=[],blocked=[];
  for(const candidate of preliminary){
    const reasons=[];const obs=observationRows(candidate);
    if(candidate.kind==="stale"&&conflictIds.has(candidate.canonical_event_id)) reasons.push("unresolved_event_conflict");
    for(const expected of obs){
      const source=sourceById.get(expected.source_id);
      if(source&&(String(source.team_id)!==expected.team_id||source.parser_type!=="maxpreps-scores"||Number(source.authority_rank)!==80)) reasons.push(`${expected.source_id}:unexpected_source`);
      const game=gameById.get(expected.game_id);
      if(game){
        const identityOk=String(game.team_id)===expected.team_id&&String(game.source_id)===expected.source_id&&String(game.source_event_key)===expected.source_event_key&&String(game.opponent_school_id)===expected.opponent_school_id;
        const scoreOk=game.status==="FINAL"&&Number(game.team_score)===expected.team_score&&Number(game.opponent_score)===expected.opponent_score&&String(game.result||"")===expected.result;
        const attachment=String(game.canonical_event_id||"");
        if(!identityOk||!scoreOk||(attachment&&attachment!==candidate.canonical_event_id)) reasons.push(`${expected.game_id}:unexpected_game_state`);
      }
      const member=memberByGame.get(expected.game_id);
      if(member&&String(member.canonical_event_id)!==candidate.canonical_event_id) reasons.push(`${expected.game_id}:member_attached_elsewhere`);
    }
    if(reasons.length) blocked.push({contest_id:candidate.final.contestId,local_date:candidate.final.localDate,kind:candidate.kind,reasons});
    else safe.push(candidate);
  }

  const safeContestIds=new Set(safe.map(row=>row.final.contestId));
  const safeObs=observations.filter(row=>safeContestIds.has(row.source_event_key.replace(/^native:/,"")));
  const uniqueSafeSourceIds=[...new Set(safeObs.map(row=>row.source_id))];
  const sourceInserts=uniqueSafeSourceIds.filter(id=>!sourceById.has(id));
  const gameInserts=safeObs.filter(row=>!gameById.has(row.game_id));
  const gameAttaches=safeObs.filter(row=>gameById.has(row.game_id)&&!gameById.get(row.game_id).canonical_event_id);
  const memberInserts=safeObs.filter(row=>!memberByGame.has(row.game_id));
  const missing=safe.filter(row=>row.kind==="missing");
  const stale=safe.filter(row=>row.kind==="stale");
  const logical={sources_insert:sourceInserts.length,canonical_events_insert:missing.length,games_insert:gameInserts.length,games_attach_update:gameAttaches.length,canonical_event_members_insert:memberInserts.length,canonical_events_update:stale.length};
  const logicalRows=Object.values(logical).reduce((sum,n)=>sum+n,0);
  const expectedD1Rows=logicalRows+gameInserts.length+gameAttaches.length;
  const metas=[teams.meta,canonicals.meta,sources.meta,games.meta,members.meta,conflicts.meta];
  const d1={statements:metas.length,rows_read:metas.reduce((sum,row)=>sum+row.rows_read,0),rows_written:0,per_statement:metas};
  const safeToExecute=safe.length>0&&d1.rows_read<=MAX_PLANNER_ROWS_READ&&logicalRows<=MAX_LOGICAL_WRITES&&expectedD1Rows<=MAX_D1_WRITES;
  const fingerprintInput=safe.map(candidate=>({kind:candidate.kind,contest_id:candidate.final.contestId,canonical_event_id:candidate.canonical_event_id,canonical:candidate.canonical&&{id:candidate.canonical.id,status:candidate.canonical.status,home_score:candidate.canonical.home_score,away_score:candidate.canonical.away_score,selected_source_id:candidate.canonical.selected_source_id},score:[candidate.final.home.score,candidate.final.away.score]}));
  return {
    generated_at:new Date().toISOString(),through_local_date:endDate,
    authority:{dates:dates.length,parsed_finals:authority.parsedFinals,matched_local_local:authority.finals.length,one_sided:authority.oneSided.length,ambiguous:authority.ambiguous.length},
    d1,safe_to_execute:safeToExecute,plan_fingerprint:`m7-local-finals-${fnv1a32(JSON.stringify(fingerprintInput))}`,
    candidates:{total:safe.length,stale:stale.length,missing:missing.length,already_converged:alreadyConverged,blocked:blocked.length,excluded:excluded.length},
    write_scope:{logical_table_rows:logical,logical_application_rows:logicalRows,expected_d1_rows_written_max:expectedD1Rows,trigger_overhead_budget:gameInserts.length+gameAttaches.length},
    safe_contests:safe.map(candidate=>({kind:candidate.kind,contest_id:candidate.final.contestId,local_date:candidate.final.localDate,canonical_event_id:candidate.canonical_event_id,home:{name:candidate.final.home.name,score:Number(candidate.final.home.score),team_id:candidate.final.homeTeam.team_id,school_id:candidate.final.homeTeam.school_id},away:{name:candidate.final.away.name,score:Number(candidate.final.away.score),team_id:candidate.final.awayTeam.team_id,school_id:candidate.final.awayTeam.school_id},canonical_current:candidate.canonical})),
    blocked,excluded,
    _private:{safe,safeObs,sourceInserts,gameInserts,gameAttaches,memberInserts,missing,stale,sourceById,gameById,memberByGame}
  };
}

function sourcePayload(plan,checkedAt){
  const byTeam=new Map(plan._private.safeObs.map(row=>[row.source_id,row.team_id]));
  return plan._private.sourceInserts.map(id=>({id,team_id:byTeam.get(id),checked_at:checkedAt}));
}
function missingCanonicalPayload(plan,checkedAt){
  return plan._private.missing.map(candidate=>{
    const final=candidate.final;const obs=observationRows(candidate);const sourceIds=obs.map(row=>row.source_id).sort();const selected=sourceIds[0];const scoreGame=obs.find(row=>row.source_id===selected)||obs[0];
    return {id:candidate.canonical_event_id,participant_a_school_id:[final.homeTeam.school_id,final.awayTeam.school_id].sort()[0],participant_b_school_id:[final.homeTeam.school_id,final.awayTeam.school_id].sort()[1],home_school_id:final.homeTeam.school_id,away_school_id:final.awayTeam.school_id,scheduled_at:localIso(final.localDate,{hour:12}),home_score:Number(final.home.score),away_score:Number(final.away.score),selected_source_id:selected,resolution_json:JSON.stringify({selectedObservationId:scoreGame.game_id,timeObservationId:scoreGame.game_id,relationObservationId:scoreGame.game_id,venueObservationId:null,scoreObservationId:scoreGame.game_id,sourceIds,eventSlot:`mp-${safeIdToken(final.contestId)}`,m7LocalFinalConvergence:true}),checked_at:checkedAt};
  });
}
function gamePayload(rows,checkedAt){return rows.map(row=>({...row,checked_at:checkedAt}));}
function memberPayload(rows,checkedAt){return rows.map(row=>({canonical_event_id:row.canonical_event_id,game_id:row.game_id,source_id:row.source_id,reporting_team_id:row.team_id,checked_at:checkedAt}));}
function stalePayload(plan,checkedAt){
  return plan._private.stale.map(candidate=>{const score=canonicalScore(candidate.canonical,candidate.final);const obs=observationRows(candidate);return {id:candidate.canonical_event_id,home_score:score.home_score,away_score:score.away_score,score_game_id:obs[0].game_id,checked_at:checkedAt};});
}
function stmtMeta(result,index){return {statement:index+1,rows_read:rowsRead(result),rows_written:rowsWritten(result),changes:Number(result?.meta?.changes||0)};}

export async function executeM7LocalFinalConvergence(env,{fetchFn=fetch,now=new Date()}={}){
  const plan=await planM7LocalFinalConvergence(env,{fetchFn,now});
  if(!plan.safe_to_execute) throw new Error(`M7 local-final convergence is not safe to execute: candidates=${plan.candidates.total}, reads=${plan.d1.rows_read}, logical=${plan.write_scope.logical_application_rows}, d1Max=${plan.write_scope.expected_d1_rows_written_max}`);
  const checkedAt=now.toISOString();
  const sources=sourcePayload(plan,checkedAt),canonicals=missingCanonicalPayload(plan,checkedAt),gameInserts=gamePayload(plan._private.gameInserts,checkedAt),gameAttaches=gamePayload(plan._private.gameAttaches,checkedAt),members=memberPayload(plan._private.memberInserts,checkedAt),stale=stalePayload(plan,checkedAt);
  const statements=[];
  if(sources.length) statements.push(env.DB.prepare(`
    INSERT INTO sources(id,team_id,source_url,source_type,source_priority,parser_type,parser_version,timezone,expected_min_games,refresh_minutes,active_result_minutes,enabled,authority_rank,stale_after_minutes,last_successful_fetch_at,last_checked_at,last_http_status,updated_at)
    SELECT json_extract(value,'$.id'),json_extract(value,'$.team_id'),?,'secondary',9,'maxpreps-scores','1',?,1,1440,60,0,80,2880,json_extract(value,'$.checked_at'),json_extract(value,'$.checked_at'),200,json_extract(value,'$.checked_at') FROM json_each(?)`).bind(SOURCE_URL,TIME_ZONE,JSON.stringify(sources)));
  if(canonicals.length) statements.push(env.DB.prepare(`
    INSERT INTO canonical_events(id,sport,gender,season,participant_a_school_id,participant_b_school_id,home_school_id,away_school_id,scheduled_at,scheduled_time_known,venue,location_text,latitude,longitude,conference_game,status,home_score,away_score,selected_source_id,trust_state,conflict_count,resolution_json,last_reconciled_at,updated_at)
    SELECT json_extract(value,'$.id'),'volleyball','girls','2026',json_extract(value,'$.participant_a_school_id'),json_extract(value,'$.participant_b_school_id'),json_extract(value,'$.home_school_id'),json_extract(value,'$.away_school_id'),json_extract(value,'$.scheduled_at'),0,NULL,NULL,NULL,NULL,0,'FINAL',json_extract(value,'$.home_score'),json_extract(value,'$.away_score'),json_extract(value,'$.selected_source_id'),'CORROBORATED',0,json_extract(value,'$.resolution_json'),json_extract(value,'$.checked_at'),json_extract(value,'$.checked_at') FROM json_each(?)`).bind(JSON.stringify(canonicals)));
  if(gameInserts.length) statements.push(env.DB.prepare(`
    INSERT INTO games(id,team_id,source_id,source_event_key,opponent,opponent_school_id,scheduled_at,scheduled_time_known,venue,location_text,latitude,longitude,home_away,conference_game,counts_for_record,status,team_score,opponent_score,result,notes,source_url,source_updated_at,last_checked_at,updated_at,canonical_event_id)
    SELECT json_extract(value,'$.game_id'),json_extract(value,'$.team_id'),json_extract(value,'$.source_id'),json_extract(value,'$.source_event_key'),json_extract(value,'$.opponent_name'),json_extract(value,'$.opponent_school_id'),json_extract(value,'$.scheduled_at'),0,NULL,NULL,NULL,NULL,json_extract(value,'$.home_away'),0,1,'FINAL',json_extract(value,'$.team_score'),json_extract(value,'$.opponent_score'),json_extract(value,'$.result'),'Secondary final from MaxPreps statewide scores',?,json_extract(value,'$.checked_at'),json_extract(value,'$.checked_at'),json_extract(value,'$.checked_at'),json_extract(value,'$.canonical_event_id') FROM json_each(?)`).bind(SOURCE_URL,JSON.stringify(gameInserts)));
  if(gameAttaches.length) statements.push(env.DB.prepare(`
    WITH payload AS (SELECT json_extract(value,'$.game_id') AS game_id,json_extract(value,'$.canonical_event_id') AS canonical_event_id,json_extract(value,'$.checked_at') AS checked_at FROM json_each(?))
    UPDATE games SET canonical_event_id=(SELECT canonical_event_id FROM payload WHERE game_id=games.id),updated_at=(SELECT checked_at FROM payload WHERE game_id=games.id)
    WHERE canonical_event_id IS NULL AND id IN (SELECT game_id FROM payload)`).bind(JSON.stringify(gameAttaches)));
  if(members.length) statements.push(env.DB.prepare(`
    INSERT INTO canonical_event_members(canonical_event_id,game_id,source_id,reporting_team_id,added_at)
    SELECT json_extract(value,'$.canonical_event_id'),json_extract(value,'$.game_id'),json_extract(value,'$.source_id'),json_extract(value,'$.reporting_team_id'),json_extract(value,'$.checked_at') FROM json_each(?)`).bind(JSON.stringify(members)));
  if(stale.length) statements.push(env.DB.prepare(`
    WITH payload AS (SELECT json_extract(value,'$.id') AS id,json_extract(value,'$.home_score') AS home_score,json_extract(value,'$.away_score') AS away_score,json_extract(value,'$.score_game_id') AS score_game_id,json_extract(value,'$.checked_at') AS checked_at FROM json_each(?))
    UPDATE canonical_events
    SET status='FINAL',home_score=(SELECT home_score FROM payload WHERE id=canonical_events.id),away_score=(SELECT away_score FROM payload WHERE id=canonical_events.id),trust_state='CORROBORATED',conflict_count=0,
      resolution_json=json_set(CASE WHEN json_valid(resolution_json) THEN resolution_json ELSE '{}' END,'$.scoreObservationId',(SELECT score_game_id FROM payload WHERE id=canonical_events.id),'$.sourceIds',json(COALESCE((SELECT json_group_array(source_id) FROM (SELECT DISTINCT source_id FROM canonical_event_members WHERE canonical_event_id=canonical_events.id ORDER BY source_id)),'[]')),'$.m7LocalFinalConvergence',1),
      last_reconciled_at=(SELECT checked_at FROM payload WHERE id=canonical_events.id),updated_at=(SELECT checked_at FROM payload WHERE id=canonical_events.id)
    WHERE id IN (SELECT id FROM payload) AND status='SCHEDULED' AND home_score IS NULL AND away_score IS NULL AND conflict_count=0`).bind(JSON.stringify(stale)));
  const results=statements.length?await env.DB.batch(statements):[];
  const perStatement=results.map(stmtMeta);const repairRowsWritten=perStatement.reduce((sum,row)=>sum+row.rows_written,0);
  if(repairRowsWritten>plan.write_scope.expected_d1_rows_written_max) throw new Error(`M7 local-final D1 rows_written ${repairRowsWritten} exceeded budget ${plan.write_scope.expected_d1_rows_written_max}`);

  const targetCanonicalIds=plan._private.safe.map(row=>row.canonical_event_id);const targetGameIds=plan._private.safeObs.map(row=>row.game_id);
  const verifiedCanonicals=await readIds(env,"canonical_events","id,home_school_id,away_school_id,status,home_score,away_score,conflict_count",targetCanonicalIds);
  const verifiedGames=await readIds(env,"games","id,status,team_score,opponent_score,canonical_event_id",targetGameIds);
  const verifiedMembers=await readIds(env,"canonical_event_members","canonical_event_id,game_id",targetGameIds,"game_id");
  const canonicalById=new Map(verifiedCanonicals.rows.map(row=>[String(row.id),row]));const verifiedGameById=new Map(verifiedGames.rows.map(row=>[String(row.id),row]));const verifiedMemberByGame=new Map(verifiedMembers.rows.map(row=>[String(row.game_id),row]));
  const failures=[];
  for(const candidate of plan._private.safe){
    const event=canonicalById.get(candidate.canonical_event_id);if(!event||!eventMatchesFinal(event,candidate.final)||Number(event.conflict_count||0)!==0) failures.push(`${candidate.final.contestId}:canonical`);
    for(const expected of observationRows(candidate)){
      const game=verifiedGameById.get(expected.game_id),member=verifiedMemberByGame.get(expected.game_id);
      if(!game||game.status!=="FINAL"||Number(game.team_score)!==expected.team_score||Number(game.opponent_score)!==expected.opponent_score||String(game.canonical_event_id)!==candidate.canonical_event_id) failures.push(`${expected.game_id}:game`);
      if(!member||String(member.canonical_event_id)!==candidate.canonical_event_id) failures.push(`${expected.game_id}:member`);
    }
  }
  if(failures.length) throw new Error(`M7 local-final verification failed: ${failures.slice(0,20).join(';')}`);
  return {status:"SUCCESS",plan_fingerprint:plan.plan_fingerprint,candidates:plan.candidates,write_scope:plan.write_scope,d1:{planner:plan.d1,repair:{statements:perStatement.length,rows_written:repairRowsWritten,per_statement:perStatement},verification:{statements:3,rows_read:verifiedCanonicals.meta.rows_read+verifiedGames.meta.rows_read+verifiedMembers.meta.rows_read,rows_written:0}},verified:{canonicals:verifiedCanonicals.rows.length,games:verifiedGames.rows.length,members:verifiedMembers.rows.length},excluded:plan.excluded,blocked:plan.blocked,invariants:{one_sided_modified:false,score_conflicts_modified:false,team_records_modified:false,standings_modified:false}};
}
