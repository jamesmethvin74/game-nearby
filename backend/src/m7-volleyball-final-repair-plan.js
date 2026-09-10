const TARGETS=Object.freeze([
  Object.freeze({
    local_date:"2026-08-17",
    contest_id:"4b56a0a6-8916-42d5-85e5-0846fb51f0f8",
    source_url:"https://www.maxpreps.com/ar/volleyball/match/decatur-vs-gentry/8-17-2026/?c=4b56a0a6-8916-42d5-85e5-0846fb51f0f8",
    canonical_event_id:"ce:volleyball:girls:2026:df-smxrh2:df-z5qhew:20260817:df-6a570653c404b86e1e000002",
    home:{team_id:"df-smxrh2-volleyball-2026",school_id:"df-smxrh2",name:"Gentry",score:3},
    away:{team_id:"df-z5qhew-volleyball-2026",school_id:"df-z5qhew",name:"Decatur",score:0}
  }),
  Object.freeze({
    local_date:"2026-08-17",
    contest_id:"c7434285-c2bf-49d5-9ebe-96db023a90fc",
    source_url:"https://www.maxpreps.com/ar/volleyball/match/lonoke-vs-stuttgart/8-17-2026/?c=c7434285-c2bf-49d5-9ebe-96db023a90fc",
    canonical_event_id:"ce:volleyball:girls:2026:df-qyakr5:df-y85lbp:20260817:df-6a7f65f03bf7545502000000",
    home:{team_id:"df-qyakr5-volleyball-2026",school_id:"df-qyakr5",name:"Lonoke",score:3},
    away:{team_id:"df-y85lbp-volleyball-2026",school_id:"df-y85lbp",name:"Stuttgart",score:0}
  })
]);

const SOURCE_PREFIX="maxpreps-volleyball-results:";
const EXPECTED_SOURCE_URL="https://www.maxpreps.com/ar/volleyball/scores/";

function rowsRead(result){return Number(result?.meta?.rows_read||0);}
function rowsWritten(result){return Number(result?.meta?.rows_written||0);}
function expectedSourceId(teamId){return `${SOURCE_PREFIX}${teamId}`;}
function expectedGameId(teamId,contestId){return `${expectedSourceId(teamId)}:native:${contestId}`;}
function stableRows(rows,key){return [...rows].sort((a,b)=>String(a[key]).localeCompare(String(b[key])));}
function fnv1a32(value){
  let hash=0x811c9dc5;
  for(const char of String(value||"")){hash^=char.codePointAt(0);hash=Math.imul(hash,0x01000193)>>>0;}
  return hash.toString(16).padStart(8,"0");
}

function reportingObservations(){
  const rows=[];
  for(const target of TARGETS){
    rows.push({
      canonical_event_id:target.canonical_event_id,
      contest_id:target.contest_id,
      team_id:target.home.team_id,
      school_id:target.home.school_id,
      opponent_team_id:target.away.team_id,
      opponent_school_id:target.away.school_id,
      opponent_name:target.away.name,
      source_id:expectedSourceId(target.home.team_id),
      game_id:expectedGameId(target.home.team_id,target.contest_id),
      source_event_key:`native:${target.contest_id}`,
      home_away:"home",team_score:target.home.score,opponent_score:target.away.score,result:"W"
    });
    rows.push({
      canonical_event_id:target.canonical_event_id,
      contest_id:target.contest_id,
      team_id:target.away.team_id,
      school_id:target.away.school_id,
      opponent_team_id:target.home.team_id,
      opponent_school_id:target.home.school_id,
      opponent_name:target.home.name,
      source_id:expectedSourceId(target.away.team_id),
      game_id:expectedGameId(target.away.team_id,target.contest_id),
      source_event_key:`native:${target.contest_id}`,
      home_away:"away",team_score:target.away.score,opponent_score:target.home.score,result:"L"
    });
  }
  return rows;
}

async function read(env,sql,args=[]){
  const result=await env.DB.prepare(sql).bind(...args).all();
  const written=rowsWritten(result);
  if(written!==0) throw new Error(`M7 final repair planner must be zero-write; observed rows_written=${written}`);
  return {rows:result.results||[],meta:{rows_read:rowsRead(result),rows_written:written}};
}

function canonicalState(target,row){
  if(!row) return {state:"MISSING",safe:false};
  const participants=new Set([String(row.participant_a_school_id),String(row.participant_b_school_id)]);
  if(!participants.has(target.home.school_id)||!participants.has(target.away.school_id)) return {state:"PARTICIPANT_MISMATCH",safe:false};
  if(String(row.home_school_id)!==target.home.school_id||String(row.away_school_id)!==target.away.school_id) return {state:"HOME_AWAY_MISMATCH",safe:false};
  if(row.status==="FINAL"&&Number(row.home_score)===target.home.score&&Number(row.away_score)===target.away.score) return {state:"ALREADY_CONVERGED",safe:true};
  if(row.status==="SCHEDULED"&&row.home_score==null&&row.away_score==null) return {state:"REPAIR_REQUIRED",safe:true};
  return {state:"UNEXPECTED_CANONICAL_STATE",safe:false};
}

export async function planM7Aug17VolleyballFinalRepair(env){
  const observations=reportingObservations();
  const canonicalIds=TARGETS.map(row=>row.canonical_event_id);
  const sourceIds=observations.map(row=>row.source_id);
  const gameIds=observations.map(row=>row.game_id);

  const canonicals=await read(env,`
    SELECT ce.id,ce.participant_a_school_id,ce.participant_b_school_id,ce.home_school_id,ce.away_school_id,
      ce.scheduled_at,ce.status,ce.home_score,ce.away_score,ce.selected_source_id,ce.trust_state,ce.conflict_count,
      ss.parser_type AS selected_parser_type,ss.authority_rank AS selected_authority_rank
    FROM canonical_events ce LEFT JOIN sources ss ON ss.id=ce.selected_source_id
    WHERE ce.id IN (?,?) ORDER BY ce.id`,canonicalIds);

  const members=await read(env,`
    SELECT cem.canonical_event_id,cem.game_id,cem.source_id,cem.reporting_team_id,
      g.team_id,g.source_event_key,g.opponent_school_id,g.status,g.team_score,g.opponent_score,g.canonical_event_id AS game_canonical_event_id,
      s.parser_type,s.authority_rank
    FROM canonical_event_members cem
    JOIN games g ON g.id=cem.game_id
    JOIN sources s ON s.id=cem.source_id
    WHERE cem.canonical_event_id IN (?,?)
    ORDER BY cem.canonical_event_id,cem.game_id`,canonicalIds);

  const sources=await read(env,`
    SELECT id,team_id,source_url,source_type,parser_type,authority_rank,enabled
    FROM sources WHERE id IN (?,?,?,?) ORDER BY id`,sourceIds);

  const games=await read(env,`
    SELECT id,team_id,source_id,source_event_key,opponent_school_id,status,team_score,opponent_score,result,canonical_event_id
    FROM games WHERE id IN (?,?,?,?) ORDER BY id`,gameIds);

  const conflicts=await read(env,`
    SELECT id,canonical_event_id,conflict_type,values_json,evidence_json
    FROM event_conflicts
    WHERE resolved_at IS NULL AND canonical_event_id IN (?,?)
    ORDER BY canonical_event_id,id`,canonicalIds);

  const canonicalById=new Map(canonicals.rows.map(row=>[String(row.id),row]));
  const sourceById=new Map(sources.rows.map(row=>[String(row.id),row]));
  const gameById=new Map(games.rows.map(row=>[String(row.id),row]));
  const memberByGameId=new Map(members.rows.map(row=>[String(row.game_id),row]));
  const conflictByCanonical=new Map();
  for(const row of conflicts.rows){
    if(!conflictByCanonical.has(String(row.canonical_event_id))) conflictByCanonical.set(String(row.canonical_event_id),[]);
    conflictByCanonical.get(String(row.canonical_event_id)).push(row);
  }

  const blockers=[];
  const canonicalPlan=[];
  for(const target of TARGETS){
    const row=canonicalById.get(target.canonical_event_id);
    const state=canonicalState(target,row);
    const currentConflicts=conflictByCanonical.get(target.canonical_event_id)||[];
    if(!state.safe) blockers.push(`${target.contest_id}:${state.state}`);
    if(row && row.selected_parser_type!=="dragonfly-public") blockers.push(`${target.contest_id}:selected_source_not_dragonfly`);
    if(currentConflicts.length) blockers.push(`${target.contest_id}:unresolved_conflicts:${currentConflicts.map(c=>c.conflict_type).join(",")}`);
    canonicalPlan.push({
      contest_id:target.contest_id,canonical_event_id:target.canonical_event_id,
      desired:{status:"FINAL",home_score:target.home.score,away_score:target.away.score},
      current:row||null,state:state.state,update_required:state.state==="REPAIR_REQUIRED"
    });
  }

  const sourcePlan=[];
  const gamePlan=[];
  const memberPlan=[];
  for(const expected of observations){
    const source=sourceById.get(expected.source_id);
    if(source && (String(source.team_id)!==expected.team_id||source.parser_type!=="maxpreps-scores"||Number(source.authority_rank)!==80)) blockers.push(`${expected.source_id}:unexpected_source_shape`);
    sourcePlan.push({source_id:expected.source_id,team_id:expected.team_id,current:source||null,insert_required:!source});

    const game=gameById.get(expected.game_id);
    let gameAction="INSERT";
    if(game){
      if(String(game.team_id)!==expected.team_id||String(game.source_id)!==expected.source_id||String(game.source_event_key)!==expected.source_event_key||String(game.opponent_school_id)!==expected.opponent_school_id) blockers.push(`${expected.game_id}:unexpected_game_identity`);
      const exact=game.status==="FINAL"&&Number(game.team_score)===expected.team_score&&Number(game.opponent_score)===expected.opponent_score&&String(game.canonical_event_id||"")===expected.canonical_event_id;
      gameAction=exact?"NONE":"UPDATE";
    }
    gamePlan.push({...expected,current:game||null,action:gameAction});

    const member=memberByGameId.get(expected.game_id);
    if(member && String(member.canonical_event_id)!==expected.canonical_event_id) blockers.push(`${expected.game_id}:member_attached_elsewhere`);
    memberPlan.push({game_id:expected.game_id,canonical_event_id:expected.canonical_event_id,current:member||null,insert_required:!member});
  }

  const writeScope={
    sources:{insert_rows:sourcePlan.filter(row=>row.insert_required).length,update_rows:0},
    games:{insert_rows:gamePlan.filter(row=>row.action==="INSERT").length,update_rows:gamePlan.filter(row=>row.action==="UPDATE").length},
    canonical_event_members:{insert_rows:memberPlan.filter(row=>row.insert_required).length,update_rows:0},
    canonical_events:{insert_rows:0,update_rows:canonicalPlan.filter(row=>row.update_required).length},
    event_conflicts:{insert_rows:0,update_rows:0},
    team_records:{insert_rows:0,update_rows:0}
  };
  const expectedRowsWritten=Object.values(writeScope).reduce((sum,row)=>sum+row.insert_rows+row.update_rows,0);
  const d1={
    statements:5,
    rows_read:canonicals.meta.rows_read+members.meta.rows_read+sources.meta.rows_read+games.meta.rows_read+conflicts.meta.rows_read,
    rows_written:0,
    per_statement:[canonicals.meta,members.meta,sources.meta,games.meta,conflicts.meta]
  };
  const fingerprintInput={
    canonicals:stableRows(canonicals.rows,"id"),members:stableRows(members.rows,"game_id"),
    sources:stableRows(sources.rows,"id"),games:stableRows(games.rows,"id"),conflicts:stableRows(conflicts.rows,"id"),writeScope
  };

  return {
    generated_at:new Date().toISOString(),
    cohort:"2026-08-17-local-local-stale-finals",
    safe_to_execute:blockers.length===0,
    blockers,
    plan_fingerprint:`m7-aug17-${fnv1a32(JSON.stringify(fingerprintInput))}`,
    d1,
    expected_rows_written_if_approved:expectedRowsWritten,
    repair_statement_budget:4,
    write_scope:writeScope,
    canonical_plan:canonicalPlan,
    source_plan:sourcePlan,
    game_plan:gamePlan,
    member_plan:memberPlan,
    live_rows:{canonicals:canonicals.rows,members:members.rows,sources:sources.rows,games:games.rows,conflicts:conflicts.rows},
    invariants:{
      production_write_performed:false,
      records_rebuilt:false,
      standings_modified:false,
      source_authority:"DragonFly canonical schedule retained; MaxPreps final evidence only",
      expected_secondary_source_url:EXPECTED_SOURCE_URL
    }
  };
}

export { TARGETS as M7_AUG17_FINAL_TARGETS, reportingObservations as m7Aug17ReportingObservations };
