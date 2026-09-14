import { rebuildTeamRecords } from "./record-rebuild.js";
import { RECORD_TRUTH_REPAIR_CASES } from "./record-truth-production-repair-plan.js";

const VERSION="record-truth-six-games-v2";
const MAX_PLAN_READS=300;
const MAX_CANONICAL_WRITES=1;
const MAX_PLACEHOLDER_WRITES=1;
const MAX_CONFLICT_RESOLVES=2;
const MAX_REBUILD_TEAMS=2;

const CASE_KEYS=Object.freeze([
  "north-little-rock-beebe-20260824",
  "north-little-rock-lakeside-20260827",
  "harrison-cotter-rematch-20260829",
  "cabot-blue-springs-south-rematch-20260829"
]);

const ALREADY_REPAIRED_CASES=Object.freeze([
  "central-west-helena-forrest-city-20260825",
  "farmington-huntsville-20260825"
]);

function rr(result){return Number(result?.meta?.rows_read||0);}
function rw(result){return Number(result?.meta?.rows_written||0);}
function n(value){if(value===null||value===undefined||value==="")return null;const parsed=Number(value);return Number.isFinite(parsed)?parsed:null;}
function clean(value){return String(value??"").trim();}
function hashText(value){
  let hash=2166136261;
  for(let i=0;i<value.length;i+=1){hash^=value.charCodeAt(i);hash=Math.imul(hash,16777619);}
  return (hash>>>0).toString(16).padStart(8,"0");
}
function caseByKey(key){return RECORD_TRUTH_REPAIR_CASES.find(item=>item.key===key);}
function activeBlockingConflicts(state,canonicalIds){
  const ids=new Set(canonicalIds.filter(Boolean));
  return state.conflicts.filter(row=>ids.has(row.canonical_event_id)&&!row.resolved_at&&["SCORE","STATUS","HOME_AWAY"].includes(row.conflict_type));
}
function canonicalById(state,id){return state.canonicals.find(row=>row.id===id)||null;}
function gameById(state,id){return state.observations.find(row=>row.game_id===id)||null;}
function expectedPerspective(item,schoolId,contestId=null){
  if(item.key==="north-little-rock-beebe-20260824") return item.authoritative_truth[schoolId]||null;
  if(item.key==="north-little-rock-lakeside-20260827") return item.authoritative_truth[schoolId]||null;
  if(item.key==="harrison-cotter-rematch-20260829"){
    const truth=item.authoritative_truth[contestId];
    if(!truth)return null;
    if(schoolId==="df-ht8yyh")return {score:truth.harrison,opponent_score:truth.cotter,result:truth.harrison>truth.cotter?"W":"L"};
    if(schoolId==="df-sz3b5e")return {score:truth.cotter,opponent_score:truth.harrison,result:truth.cotter>truth.harrison?"W":"L"};
  }
  if(item.key==="cabot-blue-springs-south-rematch-20260829"){
    const truth=item.authoritative_truth[contestId];
    if(!truth)return null;
    const opponent="mp-xe6tf6lf7uco1soenbisnw-7a263f82";
    if(schoolId==="df-kq5hlr")return {score:truth.cabot,opponent_score:truth.blue_springs_south,result:truth.cabot>truth.blue_springs_south?"W":"L"};
    if(schoolId===opponent)return {score:truth.blue_springs_south,opponent_score:truth.cabot,result:truth.blue_springs_south>truth.cabot?"W":"L"};
  }
  return null;
}
function gameMatchesPerspective(row,expected,{parserType=null,canonicalId=null,contestId=null}={}){
  if(!row||!expected)return false;
  if(parserType&&row.parser_type!==parserType)return false;
  if(canonicalId&&(row.canonical_event_id!==canonicalId||row.member_canonical_id!==canonicalId))return false;
  if(contestId&&clean(row.source_event_key).toLowerCase()!==`native:${contestId}`.toLowerCase())return false;
  return String(row.game_status||"").toUpperCase()==="FINAL"
    && n(row.team_score)===Number(expected.score)
    && n(row.opponent_score)===Number(expected.opponent_score)
    && clean(row.game_result).toUpperCase()===expected.result;
}
function canonicalMatches(row,{home,away,homeScore,awayScore}){
  return Boolean(row)
    && row.home_school_id===home
    && row.away_school_id===away
    && String(row.status||"").toUpperCase()==="FINAL"
    && n(row.home_score)===homeScore
    && n(row.away_score)===awayScore;
}
function canonicalSignature(row){return [row.id,row.home_school_id,row.away_school_id,row.status,n(row.home_score),n(row.away_score),row.selected_source_id,row.trust_state,n(row.conflict_count)].join("|");}
function observationSignature(row){return [row.game_id,row.reporting_school_id,row.opponent_school_id,row.source_id,row.parser_type,row.source_event_key,row.game_status,n(row.team_score),n(row.opponent_score),row.game_result||null,row.counts_for_record,row.canonical_event_id||null,row.member_canonical_id||null].join("|");}
function conflictSignature(row){return [row.id,row.canonical_event_id,row.conflict_type,row.values_json,row.resolved_at||null].join("|");}
function recordSignature(row){return [row.team_id,n(row.wins),n(row.losses),n(row.ties),n(row.conference_wins),n(row.conference_losses),n(row.conference_ties),row.calculated_at||null].join("|");}

function classifyBeebe(state){
  const item=caseByKey("north-little-rock-beebe-20260824");
  const reasons=[];
  const canonical=canonicalById(state,item.canonical_id);
  const target={home:"df-jufft8",away:"df-hrdb8f",homeScore:3,awayScore:0};
  const exactRows=item.authoritative_game_ids.map(id=>gameById(state,id));
  for(let i=0;i<item.authoritative_game_ids.length;i++){
    const row=exactRows[i];
    const expected=row?expectedPerspective(item,row.reporting_school_id):null;
    if(!gameMatchesPerspective(row,expected,{parserType:"maxpreps-scores",canonicalId:item.canonical_id,contestId:item.authoritative_contest_ids[0]})){
      reasons.push(`authoritative MaxPreps row is missing or changed: ${item.authoritative_game_ids[i]}`);
    }
  }
  const placeholder=gameById(state,item.placeholder_game_id);
  const placeholderDirty=Boolean(placeholder)
    && placeholder.parser_type==="mascot-media"
    && String(placeholder.game_status||"").toUpperCase()==="FINAL"
    && n(placeholder.team_score)===0
    && n(placeholder.opponent_score)===0
    && clean(placeholder.game_result).toUpperCase()==="T";
  const placeholderClean=Boolean(placeholder)
    && String(placeholder.game_status||"").toUpperCase()==="SCHEDULED"
    && n(placeholder.team_score)==null
    && n(placeholder.opponent_score)==null
    && !clean(placeholder.game_result)
    && Number(placeholder.counts_for_record||0)===0;
  if(!placeholderDirty&&!placeholderClean) reasons.push(`exact Mascot placeholder is missing or no longer in an approved dirty/clean shape: ${item.placeholder_game_id}`);

  const allowed=new Set([...item.authoritative_game_ids,item.placeholder_game_id]);
  const unexpected=state.observations.filter(row=>row.member_canonical_id===item.canonical_id&&!allowed.has(row.game_id));
  for(const row of unexpected){
    if(String(row.game_status||"").toUpperCase()!=="FINAL")continue;
    const expected=expectedPerspective(item,row.reporting_school_id);
    if(!gameMatchesPerspective(row,expected,{canonicalId:item.canonical_id})) reasons.push(`unexpected contradictory Beebe/NLR member: ${row.game_id}`);
  }
  const conflicts=activeBlockingConflicts(state,[item.canonical_id]);
  const canonicalGood=canonicalMatches(canonical,target);
  const action=canonicalGood&&placeholderClean&&conflicts.length===0?"already_complete":"repair_canonical";
  return {
    key:item.key,repair_class:item.repair_class,canonical_id:item.canonical_id,action,reasons,
    target:{...target,selected_source_id:exactRows.find(Boolean)?.source_id||null,trust_state:"CORROBORATED"},
    placeholder_game_id:item.placeholder_game_id,
    placeholder_needs_write:placeholderDirty,
    active_blocking_conflict_ids:conflicts.map(row=>row.id)
  };
}

function classifyLakeside(state){
  const item=caseByKey("north-little-rock-lakeside-20260827");
  const reasons=[];
  const canonical=canonicalById(state,item.canonical_id);
  if(!canonicalMatches(canonical,{home:item.expected_home_school_id,away:item.expected_away_school_id,homeScore:item.expected_home_score,awayScore:item.expected_away_score})) reasons.push("canonical is not North Little Rock 1-3 Lakeside");
  for(const id of item.authoritative_game_ids){
    const row=gameById(state,id);
    const expected=row?expectedPerspective(item,row.reporting_school_id):null;
    if(!gameMatchesPerspective(row,expected,{parserType:"dragonfly-public",canonicalId:item.canonical_id,contestId:item.authoritative_contest_ids[0]})) reasons.push(`DragonFly corroborating row is missing or changed: ${id}`);
  }
  const allowed=new Set(item.authoritative_game_ids);
  const unexpected=state.observations.filter(row=>row.member_canonical_id===item.canonical_id&&!allowed.has(row.game_id));
  for(const row of unexpected){
    if(String(row.game_status||"").toUpperCase()!=="FINAL")continue;
    const expected=expectedPerspective(item,row.reporting_school_id);
    if(!gameMatchesPerspective(row,expected,{canonicalId:item.canonical_id})) reasons.push(`unexpected contradictory NLR/Lakeside member: ${row.game_id}`);
  }
  if(activeBlockingConflicts(state,[item.canonical_id]).length) reasons.push("NLR/Lakeside still has an active result/score conflict");
  return {key:item.key,repair_class:item.repair_class,canonical_id:item.canonical_id,action:reasons.length?"unsafe":"already_complete",reasons};
}

function classifyHarrison(state){
  const item=caseByKey("harrison-cotter-rematch-20260829");
  const reasons=[];
  const targets=[
    {contestId:item.authoritative_contest_ids[0],canonicalId:item.canonical_id,home:"df-ht8yyh",away:"df-sz3b5e",homeScore:2,awayScore:0},
    {contestId:item.authoritative_contest_ids[1],canonicalId:item.second_canonical_id,home:"df-ht8yyh",away:"df-sz3b5e",homeScore:3,awayScore:1}
  ];
  for(const target of targets){
    if(!canonicalMatches(canonicalById(state,target.canonicalId),target)) reasons.push(`Harrison/Cotter canonical changed: ${target.canonicalId}`);
    for(const id of item.authoritative_game_ids.filter(value=>value.includes(target.contestId))){
      const row=gameById(state,id);
      const expected=row?expectedPerspective(item,row.reporting_school_id,target.contestId):null;
      if(!gameMatchesPerspective(row,expected,{parserType:"maxpreps-scores",canonicalId:target.canonicalId,contestId:target.contestId})) reasons.push(`Harrison/Cotter rematch row changed: ${id}`);
    }
  }
  if(activeBlockingConflicts(state,targets.map(target=>target.canonicalId)).length) reasons.push("Harrison/Cotter split has an active result/score conflict");
  return {key:item.key,repair_class:item.repair_class,canonical_id:item.canonical_id,second_canonical_id:item.second_canonical_id,action:reasons.length?"unsafe":"already_complete",reasons};
}

function classifyCabot(state){
  const item=caseByKey("cabot-blue-springs-south-rematch-20260829");
  const reasons=[];
  const opponent="mp-xe6tf6lf7uco1soenbisnw-7a263f82";
  const targets=[
    {contestId:item.authoritative_contest_ids[0],canonicalId:item.canonical_id,home:"df-kq5hlr",away:opponent,homeScore:2,awayScore:0},
    {contestId:item.authoritative_contest_ids[1],canonicalId:item.second_canonical_id,home:opponent,away:"df-kq5hlr",homeScore:2,awayScore:1}
  ];
  for(const target of targets){
    if(!canonicalMatches(canonicalById(state,target.canonicalId),target)) reasons.push(`Cabot/Blue Springs South canonical changed: ${target.canonicalId}`);
    for(const id of item.authoritative_game_ids.filter(value=>value.includes(target.contestId))){
      const row=gameById(state,id);
      const expected=row?expectedPerspective(item,row.reporting_school_id,target.contestId):null;
      if(!gameMatchesPerspective(row,expected,{parserType:"maxpreps-scores",canonicalId:target.canonicalId,contestId:target.contestId})) reasons.push(`Cabot/Blue Springs South rematch row changed: ${id}`);
    }
  }
  if(activeBlockingConflicts(state,targets.map(target=>target.canonicalId)).length) reasons.push("Cabot/Blue Springs South split has an active result/score conflict");
  return {key:item.key,repair_class:item.repair_class,canonical_id:item.canonical_id,second_canonical_id:item.second_canonical_id,action:reasons.length?"unsafe":"already_complete",reasons};
}

export function classifyRecordTruthRepairState(state){
  const cases=[classifyBeebe(state),classifyLakeside(state),classifyHarrison(state),classifyCabot(state)];
  const reasons=cases.flatMap(item=>item.reasons.map(reason=>`${item.key}: ${reason}`));
  return {safe:reasons.length===0,reasons,cases};
}

function targetCanonicalIds(){
  const ids=[];
  for(const key of CASE_KEYS){
    const item=caseByKey(key);
    ids.push(item.canonical_id);
    if(item.second_canonical_id)ids.push(item.second_canonical_id);
  }
  return [...new Set(ids)];
}
function targetGameIds(){
  const ids=[];
  for(const key of CASE_KEYS){
    const item=caseByKey(key);
    ids.push(...(item.authoritative_game_ids||[]));
    if(item.placeholder_game_id)ids.push(item.placeholder_game_id);
  }
  return [...new Set(ids)];
}

async function loadRepairState(env){
  const canonicalIds=targetCanonicalIds();
  const gameIds=targetGameIds();
  const recordTeamIds=caseByKey("north-little-rock-beebe-20260824").local_team_ids;
  const canonicalJson=JSON.stringify(canonicalIds),gameJson=JSON.stringify(gameIds),recordJson=JSON.stringify(recordTeamIds);
  const [canonicalResult,observationResult,conflictResult,recordResult]=await env.DB.batch([
    env.DB.prepare(`
      SELECT id,participant_a_school_id,participant_b_school_id,home_school_id,away_school_id,status,home_score,away_score,
        selected_source_id,trust_state,conflict_count,resolution_json,last_reconciled_at,updated_at
      FROM canonical_events WHERE id IN (SELECT value FROM json_each(?)) ORDER BY id`).bind(canonicalJson),
    env.DB.prepare(`
      WITH member_ids AS (
        SELECT game_id FROM canonical_event_members
        WHERE canonical_event_id IN (SELECT value FROM json_each(?))
      ), wanted_ids AS (
        SELECT game_id AS id FROM member_ids
        UNION
        SELECT value AS id FROM json_each(?)
      )
      SELECT g.id AS game_id,g.team_id,t.school_id AS reporting_school_id,g.source_id,src.parser_type,src.authority_rank,
        g.source_event_key,g.opponent_school_id,g.scheduled_at,g.scheduled_time_known,g.home_away,g.conference_game,g.counts_for_record,
        g.status AS game_status,g.team_score,g.opponent_score,g.result AS game_result,g.notes,g.canonical_event_id,
        cem.canonical_event_id AS member_canonical_id
      FROM wanted_ids wanted
      JOIN games g ON g.id=wanted.id
      JOIN teams t ON t.id=g.team_id
      JOIN sources src ON src.id=g.source_id
      LEFT JOIN canonical_event_members cem ON cem.game_id=g.id
      ORDER BY g.id`).bind(canonicalJson,gameJson),
    env.DB.prepare(`
      SELECT id,canonical_event_id,conflict_type,values_json,evidence_json,detected_at,resolved_at
      FROM event_conflicts
      WHERE canonical_event_id IN (SELECT value FROM json_each(?)) AND resolved_at IS NULL
      ORDER BY canonical_event_id,id`).bind(canonicalJson),
    env.DB.prepare(`
      SELECT team_id,wins,losses,ties,conference_wins,conference_losses,conference_ties,calculated_at
      FROM team_records WHERE team_id IN (SELECT value FROM json_each(?)) ORDER BY team_id`).bind(recordJson)
  ]);
  const d1={
    statements:4,
    rows_read:rr(canonicalResult)+rr(observationResult)+rr(conflictResult)+rr(recordResult),
    rows_written:rw(canonicalResult)+rw(observationResult)+rw(conflictResult)+rw(recordResult),
    per_statement:[canonicalResult,observationResult,conflictResult,recordResult].map(result=>({rows_read:rr(result),rows_written:rw(result)}))
  };
  return {canonicals:canonicalResult.results||[],observations:observationResult.results||[],conflicts:conflictResult.results||[],records:recordResult.results||[],d1};
}

function fingerprintPayload(state,classified){
  return {
    version:VERSION,
    cases:classified.cases.map(item=>({key:item.key,action:item.action,target:item.target||null,placeholder_needs_write:item.placeholder_needs_write||false,conflicts:item.active_blocking_conflict_ids||[]})),
    canonicals:state.canonicals.map(canonicalSignature).sort(),
    observations:state.observations.map(observationSignature).sort(),
    conflicts:state.conflicts.map(conflictSignature).sort(),
    records:state.records.map(recordSignature).sort()
  };
}

export async function planRecordTruthProductionRepair(env){
  const state=await loadRepairState(env);
  const classified=classifyRecordTruthRepairState(state);
  const reasons=[...classified.reasons];
  if(state.d1.rows_written!==0)reasons.push(`preflight unexpectedly wrote ${state.d1.rows_written} rows`);
  if(state.d1.rows_read>MAX_PLAN_READS)reasons.push(`preflight read fuse exceeded ${state.d1.rows_read}/${MAX_PLAN_READS}`);
  const payload=fingerprintPayload(state,classified);
  return {
    version:VERSION,
    fingerprint:`${VERSION}-${hashText(JSON.stringify(payload))}`,
    safe:reasons.length===0,
    reasons,
    already_completed_cases:ALREADY_REPAIRED_CASES,
    cases:classified.cases,
    records_before:state.records,
    d1:state.d1,
    write_scope:{canonical_repairs_max:MAX_CANONICAL_WRITES,placeholder_rows_max:MAX_PLACEHOLDER_WRITES,conflict_rows_resolved_max:MAX_CONFLICT_RESOLVES,record_rebuild_teams_max:MAX_REBUILD_TEAMS},
    state_fingerprint_payload:payload
  };
}

async function executeBeebeRepair(env,beebe,now){
  let placeholderRows=0,canonicalRows=0,conflictsResolved=0,conflictCountRows=0;
  if(beebe.placeholder_needs_write){
    const result=await env.DB.prepare(`
      UPDATE games SET status='SCHEDULED',team_score=NULL,opponent_score=NULL,result=NULL,counts_for_record=0,
        notes=CASE WHEN notes IS NULL OR notes='' THEN 'Superseded placeholder T 0-0; verified final retained canonically' ELSE notes || ' · Superseded placeholder T 0-0; verified final retained canonically' END,
        updated_at=?
      WHERE id=? AND status='FINAL' AND team_score=0 AND opponent_score=0 AND result='T'`)
      .bind(now,beebe.placeholder_game_id).run();
    placeholderRows=rw(result);
    if(placeholderRows!==1||placeholderRows>MAX_PLACEHOLDER_WRITES)throw new Error(`placeholder write count ${placeholderRows}/1`);
  }
  const currentPlan=await planRecordTruthProductionRepair(env);
  const currentBeebe=currentPlan.cases.find(item=>item.key===beebe.key);
  if(!currentPlan.safe&&currentPlan.reasons.some(reason=>!reason.includes("preflight read fuse")))throw new Error(`post-placeholder state unsafe: ${currentPlan.reasons.join("; ")}`);
  if(currentBeebe?.action!=="already_complete"){
    const target=beebe.target;
    const result=await env.DB.prepare(`
      UPDATE canonical_events SET home_school_id=?,away_school_id=?,status='FINAL',home_score=?,away_score=?,selected_source_id=?,trust_state=?,
        resolution_json=?,last_reconciled_at=?,updated_at=?
      WHERE id=? AND participant_a_school_id='df-hrdb8f' AND participant_b_school_id='df-jufft8'`)
      .bind(target.home,target.away,target.homeScore,target.awayScore,target.selected_source_id,target.trust_state,
        JSON.stringify({repair:VERSION,case:beebe.key,evidence:"reciprocal exact MaxPreps native final"}),now,now,beebe.canonical_id).run();
    canonicalRows=rw(result);
    if(canonicalRows!==1||canonicalRows>MAX_CANONICAL_WRITES)throw new Error(`canonical write count ${canonicalRows}/1`);
  }
  const conflictIds=beebe.active_blocking_conflict_ids||[];
  if(conflictIds.length){
    if(conflictIds.length>MAX_CONFLICT_RESOLVES)throw new Error(`conflict resolve fuse ${conflictIds.length}/${MAX_CONFLICT_RESOLVES}`);
    const result=await env.DB.prepare(`UPDATE event_conflicts SET resolved_at=? WHERE id IN (SELECT value FROM json_each(?)) AND resolved_at IS NULL`)
      .bind(now,JSON.stringify(conflictIds)).run();
    conflictsResolved=rw(result);
    if(conflictsResolved!==conflictIds.length)throw new Error(`conflict resolve count ${conflictsResolved}/${conflictIds.length}`);
  }
  if(canonicalRows||conflictsResolved){
    const result=await env.DB.prepare(`
      UPDATE canonical_events SET conflict_count=(SELECT COUNT(*) FROM event_conflicts ec WHERE ec.canonical_event_id=canonical_events.id AND ec.resolved_at IS NULL),updated_at=?
      WHERE id=?`).bind(now,beebe.canonical_id).run();
    conflictCountRows=rw(result);
    if(conflictCountRows!==1)throw new Error(`canonical conflict-count refresh ${conflictCountRows}/1`);
  }
  return {placeholder_rows_written:placeholderRows,canonical_rows_written:canonicalRows,conflict_rows_resolved:conflictsResolved,canonical_conflict_count_rows_written:conflictCountRows};
}

export async function executeRecordTruthProductionRepair(env,{fingerprint,now=new Date()}={}){
  const plan=await planRecordTruthProductionRepair(env);
  if(!fingerprint||fingerprint!==plan.fingerprint)throw new Error("record-truth repair fingerprint mismatch");
  if(!plan.safe)throw new Error(`record-truth repair preflight unsafe: ${plan.reasons.join("; ")}`);
  const beebe=plan.cases.find(item=>item.key==="north-little-rock-beebe-20260824");
  const changed=beebe?.action!=="already_complete";
  const checkedAt=now.toISOString();
  const writes=changed?await executeBeebeRepair(env,beebe,checkedAt):{placeholder_rows_written:0,canonical_rows_written:0,conflict_rows_resolved:0,canonical_conflict_count_rows_written:0};
  const touchedTeamIds=changed?caseByKey("north-little-rock-beebe-20260824").local_team_ids:[];
  if(touchedTeamIds.length>MAX_REBUILD_TEAMS)throw new Error(`record rebuild fuse ${touchedTeamIds.length}/${MAX_REBUILD_TEAMS}`);
  const recordResult=touchedTeamIds.length?await rebuildTeamRecords(env,touchedTeamIds,checkedAt):{teams:0,scoredFinals:0,standings:{cohorts:0,standingsRows:0}};
  if(Number(recordResult?.teams||0)!==touchedTeamIds.length)throw new Error(`record rebuild team count ${recordResult?.teams||0}/${touchedTeamIds.length}`);
  const verification=await planRecordTruthProductionRepair(env);
  const bad=verification.cases.filter(item=>item.action!=="already_complete");
  if(!verification.safe||bad.length)throw new Error(`record-truth repair verification failed: ${verification.reasons.join("; ")} ${bad.map(item=>`${item.key}:${item.action}`).join(",")}`.trim());
  return {
    status:"SUCCESS",version:VERSION,fingerprint,
    corrected_cases:changed?[beebe.key]:[],
    already_completed_cases:[...ALREADY_REPAIRED_CASES,...plan.cases.filter(item=>item.action==="already_complete").map(item=>item.key)],
    touched_team_ids:touchedTeamIds,
    writes,
    record_result:recordResult,
    verification
  };
}

export { VERSION as RECORD_TRUTH_PRODUCTION_REPAIR_VERSION, MAX_PLAN_READS };
