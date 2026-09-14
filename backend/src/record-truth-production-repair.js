import { rebuildTeamRecords } from "./record-rebuild.js";
import { RECORD_TRUTH_REPAIR_CASES, RECORD_TRUTH_REPAIR_TEAM_IDS } from "./record-truth-production-repair-plan.js";

const VERSION="record-truth-six-games-v1";
const MAX_PLAN_READS=300;
const MAX_PLACEHOLDER_WRITES=4;
const MAX_RESULT_NEUTRALIZATIONS=4;
const MAX_MEMBER_MOVES=8;
const MAX_NEW_CANONICALS=2;
const MAX_PRIMARY_CANONICAL_REPAIRS=4;
const MAX_CONFLICT_WRITES=16;

const ADVANCED_CASE_KEYS=new Set([
  "north-little-rock-beebe-20260824",
  "north-little-rock-lakeside-20260827",
  "harrison-cotter-rematch-20260829",
  "cabot-blue-springs-south-rematch-20260829"
]);

const NEW_CANONICAL_IDS=Object.freeze({
  "harrison-cotter-rematch-20260829":"ce:volleyball:girls:2026:df-ht8yyh:df-sz3b5e:20260829:mp-3fa66510-5b2b-47c8-b51a-642679c44b6a",
  "cabot-blue-springs-south-rematch-20260829":"ce:volleyball:girls:2026:df-kq5hlr:mp-xe6tf6lf7uco1soenbisnw-7a263f82:20260829:mp-df6a4eed-d762-4c70-abe3-624fd7452bcc"
});

function rr(result){return Number(result?.meta?.rows_read||0);}
function rw(result){return Number(result?.meta?.rows_written||0);}
function n(value){if(value===null||value===undefined||value==="")return null;const parsed=Number(value);return Number.isFinite(parsed)?parsed:null;}
function clean(value){return String(value??"").trim();}
function resultFor(teamScore,opponentScore){
  const a=n(teamScore),b=n(opponentScore);
  if(a==null||b==null)return null;
  return a===b?"T":a>b?"W":"L";
}
function hashText(value){
  let hash=2166136261;
  for(let i=0;i<value.length;i+=1){hash^=value.charCodeAt(i);hash=Math.imul(hash,16777619);}
  return (hash>>>0).toString(16).padStart(8,"0");
}
function sameSet(a,b){
  const aa=[...(a||[])].filter(Boolean).sort(),bb=[...(b||[])].filter(Boolean).sort();
  return aa.length===bb.length&&aa.every((value,index)=>value===bb[index]);
}
function canonicalMatchesTarget(row,target){
  if(!row||!target)return false;
  return row.home_school_id===target.home_school_id
    && row.away_school_id===target.away_school_id
    && String(row.status||"").toUpperCase()==="FINAL"
    && n(row.home_score)===target.home_score
    && n(row.away_score)===target.away_score;
}
function caseByKey(key){return RECORD_TRUTH_REPAIR_CASES.find(item=>item.key===key);}
function expectedScores(item,contestId){
  if(item.key==="north-little-rock-beebe-20260824") return {"df-jufft8":3,"df-hrdb8f":0};
  if(item.key==="north-little-rock-lakeside-20260827") return {"df-hrdb8f":1,"df-vt4unv":3};
  if(item.key==="harrison-cotter-rematch-20260829") {
    if(contestId==="350185fc-ef8a-471b-a26e-1c9f04dfc231") return {"df-ht8yyh":2,"df-sz3b5e":0};
    if(contestId==="3fa66510-5b2b-47c8-b51a-642679c44b6a") return {"df-ht8yyh":3,"df-sz3b5e":1};
  }
  if(item.key==="cabot-blue-springs-south-rematch-20260829") {
    const opponent="mp-xe6tf6lf7uco1soenbisnw-7a263f82";
    if(contestId==="441a726d-4c94-4d68-bae8-4101f7d54446") return {"df-kq5hlr":2,[opponent]:0};
    if(contestId==="df6a4eed-d762-4c70-abe3-624fd7452bcc") return {"df-kq5hlr":1,[opponent]:2};
  }
  return null;
}
function expectedParticipantIds(item,contestId){return Object.keys(expectedScores(item,contestId)||{}).sort();}
function exactContestRows(observations,contestId){
  const key=`native:${contestId}`.toLowerCase();
  return (observations||[]).filter(row=>clean(row.source_event_key).toLowerCase()===key);
}
function observationSignature(row){
  return [row.game_id,row.reporting_school_id,row.opponent_school_id,row.source_id,row.parser_type,row.source_event_key,row.game_status,n(row.team_score),n(row.opponent_score),row.game_result||null,row.canonical_event_id||null,row.member_canonical_id||null].join("|");
}
function canonicalSignature(row){
  return [row.id,row.home_school_id,row.away_school_id,row.status,n(row.home_score),n(row.away_score),row.selected_source_id,row.trust_state,n(row.conflict_count)].join("|");
}
function conflictSignature(row){return [row.id,row.canonical_event_id,row.conflict_type,row.values_json,row.resolved_at||null].join("|");}
function recordSignature(row){return [row.team_id,n(row.wins),n(row.losses),n(row.ties),n(row.conference_wins),n(row.conference_losses),n(row.conference_ties),row.calculated_at||null].join("|");}

function targetFromContestRows(item,contestId,rows){
  const reasons=[];
  const scores=expectedScores(item,contestId);
  if(!scores){return {target:null,reasons:[`${item.key}: no authoritative score map for ${contestId}`]};}
  if(!rows.length){return {target:null,reasons:[`${item.key}: no persisted native MaxPreps observation for ${contestId}`]};}
  const participants=Object.keys(scores).sort();
  const homes=new Set(),aways=new Set();
  let scheduledAt=null,scheduledTimeKnown=0,venue=null,locationText=null,latitude=null,longitude=null,conferenceGame=0;
  const sourceRows=[];
  for(const row of rows){
    if(String(row.parser_type||"")!=="maxpreps-scores") reasons.push(`${item.key}: ${row.game_id} exact contest is not maxpreps-scores`);
    if(String(row.game_status||"").toUpperCase()!=="FINAL") reasons.push(`${item.key}: ${row.game_id} exact contest is not FINAL`);
    if(!participants.includes(row.reporting_school_id)||!participants.includes(row.opponent_school_id)) reasons.push(`${item.key}: ${row.game_id} participants changed`);
    const expectedTeam=scores[row.reporting_school_id],expectedOpponent=scores[row.opponent_school_id];
    if(n(row.team_score)!==expectedTeam||n(row.opponent_score)!==expectedOpponent) reasons.push(`${item.key}: ${row.game_id} score ${row.team_score}-${row.opponent_score} does not match pinned ${expectedTeam}-${expectedOpponent}`);
    const expectedResult=resultFor(expectedTeam,expectedOpponent);
    if(clean(row.game_result).toUpperCase()!==expectedResult) reasons.push(`${item.key}: ${row.game_id} result ${row.game_result||"null"} does not match pinned ${expectedResult}`);
    if(row.home_away==="home"){homes.add(row.reporting_school_id);aways.add(row.opponent_school_id);}
    else if(row.home_away==="away"){homes.add(row.opponent_school_id);aways.add(row.reporting_school_id);}
    if(!scheduledAt||Number(row.scheduled_time_known||0)>scheduledTimeKnown){scheduledAt=row.scheduled_at;scheduledTimeKnown=Number(row.scheduled_time_known||0);}
    venue=venue||row.venue||null;locationText=locationText||row.location_text||null;
    latitude=latitude??n(row.latitude);longitude=longitude??n(row.longitude);
    conferenceGame=Math.max(conferenceGame,Number(row.conference_game||0));
    sourceRows.push(row);
  }
  if(homes.size!==1||aways.size!==1) reasons.push(`${item.key}: native ${contestId} does not have one stable home/away orientation`);
  const homeSchoolId=[...homes][0]||null,awaySchoolId=[...aways][0]||null;
  if(!sameSet([homeSchoolId,awaySchoolId],participants)) reasons.push(`${item.key}: derived home/away participants do not match pinned pair`);
  if(item.expected_home_school_id&&homeSchoolId!==item.expected_home_school_id) reasons.push(`${item.key}: derived home school ${homeSchoolId||"null"} != ${item.expected_home_school_id}`);
  if(item.expected_away_school_id&&awaySchoolId!==item.expected_away_school_id) reasons.push(`${item.key}: derived away school ${awaySchoolId||"null"} != ${item.expected_away_school_id}`);
  if(item.expected_home_score!=null&&scores[homeSchoolId]!==item.expected_home_score) reasons.push(`${item.key}: derived home score ${scores[homeSchoolId]} != ${item.expected_home_score}`);
  if(item.expected_away_score!=null&&scores[awaySchoolId]!==item.expected_away_score) reasons.push(`${item.key}: derived away score ${scores[awaySchoolId]} != ${item.expected_away_score}`);
  const ranked=[...sourceRows].sort((a,b)=>Number(a.authority_rank??999)-Number(b.authority_rank??999)||String(a.source_id||"").localeCompare(String(b.source_id||"")));
  const sourceIds=[...new Set(sourceRows.map(row=>row.source_id).filter(Boolean))];
  return {
    reasons,
    target:reasons.length?null:{
      participant_a_school_id:participants[0],participant_b_school_id:participants[1],
      home_school_id:homeSchoolId,away_school_id:awaySchoolId,
      scheduled_at:scheduledAt,scheduled_time_known:scheduledTimeKnown,
      venue,location_text:locationText,latitude,longitude,conference_game:conferenceGame,
      status:"FINAL",home_score:scores[homeSchoolId],away_score:scores[awaySchoolId],
      selected_source_id:ranked[0]?.source_id||null,
      trust_state:sourceIds.length>1?"CORROBORATED":"SINGLE_SOURCE_LIVE",
      source_ids:sourceIds
    }
  };
}

function classifyPoisoned(item,state){
  const reasons=[];
  const canonical=state.canonicals.find(row=>row.id===item.canonical_id)||null;
  const contestId=item.authoritative_contest_ids[0];
  const exact=exactContestRows(state.observations,contestId);
  const built=targetFromContestRows(item,contestId,exact);
  reasons.push(...built.reasons);
  if(!canonical) reasons.push(`${item.key}: canonical event is missing`);
  if(canonical&&!sameSet([canonical.participant_a_school_id,canonical.participant_b_school_id],expectedParticipantIds(item,contestId))) reasons.push(`${item.key}: canonical participants changed`);

  const memberRows=state.observations.filter(row=>row.member_canonical_id===item.canonical_id||row.canonical_event_id===item.canonical_id);
  const placeholderGameIds=[];
  const neutralizeResultGameIds=[];
  const scores=expectedScores(item,contestId)||{};
  for(const row of memberRows){
    if(item.key==="north-little-rock-beebe-20260824"
      && row.parser_type==="mascot-media"
      && String(row.game_status||"").toUpperCase()==="FINAL"
      && n(row.team_score)===0&&n(row.opponent_score)===0
      && clean(row.game_result).toUpperCase()==="T") placeholderGameIds.push(row.game_id);
    const expected=scores[row.reporting_school_id];
    const expectedOpp=scores[row.opponent_school_id];
    if(expected==null||expectedOpp==null) continue;
    const expectedResult=resultFor(expected,expectedOpp);
    const rawResult=clean(row.game_result).toUpperCase();
    const isExact=clean(row.source_event_key).toLowerCase()===`native:${contestId}`.toLowerCase();
    if(!isExact&&/^[WLT]$/.test(rawResult)&&rawResult!==expectedResult){
      // We only neutralize the stale explicit result claim. Canonical scores remain the
      // pinned contest truth; unexpected volume is guarded by the write fuse.
      neutralizeResultGameIds.push(row.game_id);
    }
  }
  if(placeholderGameIds.length>MAX_PLACEHOLDER_WRITES) reasons.push(`${item.key}: placeholder rows ${placeholderGameIds.length} exceed fuse ${MAX_PLACEHOLDER_WRITES}`);
  if(neutralizeResultGameIds.length>MAX_RESULT_NEUTRALIZATIONS) reasons.push(`${item.key}: result neutralizations ${neutralizeResultGameIds.length} exceed fuse ${MAX_RESULT_NEUTRALIZATIONS}`);
  const action=canonical&&built.target&&canonicalMatchesTarget(canonical,built.target)&&placeholderGameIds.length===0&&neutralizeResultGameIds.length===0?"already_complete":"repair_canonical";
  return {key:item.key,repair_class:item.repair_class,canonical_id:item.canonical_id,action,target:built.target,placeholder_game_ids:[...new Set(placeholderGameIds)].sort(),neutralize_result_game_ids:[...new Set(neutralizeResultGameIds)].sort(),exact_game_ids:exact.map(row=>row.game_id).sort(),reasons};
}

function classifyRematch(item,state){
  const reasons=[];
  const [firstContestId,secondContestId]=item.authoritative_contest_ids;
  const firstRows=exactContestRows(state.observations,firstContestId);
  const secondRows=exactContestRows(state.observations,secondContestId);
  const firstBuilt=targetFromContestRows(item,firstContestId,firstRows);
  const secondBuilt=targetFromContestRows(item,secondContestId,secondRows);
  reasons.push(...firstBuilt.reasons,...secondBuilt.reasons);
  const oldCanonical=state.canonicals.find(row=>row.id===item.canonical_id)||null;
  const newCanonicalId=NEW_CANONICAL_IDS[item.key];
  const newCanonical=state.canonicals.find(row=>row.id===newCanonicalId)||null;
  if(!oldCanonical) reasons.push(`${item.key}: first-match canonical is missing`);
  for(const row of firstRows){
    if(row.canonical_event_id&&row.canonical_event_id!==item.canonical_id) reasons.push(`${item.key}: first contest ${row.game_id} is attached to unexpected ${row.canonical_event_id}`);
  }
  for(const row of secondRows){
    if(row.canonical_event_id&&row.canonical_event_id!==item.canonical_id&&row.canonical_event_id!==newCanonicalId) reasons.push(`${item.key}: second contest ${row.game_id} is attached to unexpected ${row.canonical_event_id}`);
  }
  if(newCanonical&&secondBuilt.target&&!canonicalMatchesTarget(newCanonical,secondBuilt.target)) reasons.push(`${item.key}: existing second-match canonical does not match pinned truth`);
  const moveGameIds=secondRows.filter(row=>row.canonical_event_id!==newCanonicalId||row.member_canonical_id!==newCanonicalId).map(row=>row.game_id);
  if(moveGameIds.length>MAX_MEMBER_MOVES) reasons.push(`${item.key}: member moves ${moveGameIds.length} exceed fuse ${MAX_MEMBER_MOVES}`);
  const complete=oldCanonical&&newCanonical&&firstBuilt.target&&secondBuilt.target
    && canonicalMatchesTarget(oldCanonical,firstBuilt.target)
    && canonicalMatchesTarget(newCanonical,secondBuilt.target)
    && moveGameIds.length===0;
  return {key:item.key,repair_class:item.repair_class,canonical_id:item.canonical_id,new_canonical_id:newCanonicalId,action:complete?"already_complete":"split_rematch",first_contest_id:firstContestId,second_contest_id:secondContestId,first_target:firstBuilt.target,second_target:secondBuilt.target,first_game_ids:firstRows.map(row=>row.game_id).sort(),second_game_ids:secondRows.map(row=>row.game_id).sort(),move_game_ids:[...new Set(moveGameIds)].sort(),reasons};
}

export function classifyRecordTruthRepairState(state){
  const cases=[];
  for(const item of RECORD_TRUTH_REPAIR_CASES.filter(row=>ADVANCED_CASE_KEYS.has(row.key))){
    cases.push(item.repair_class==="same-day-rematch-split"?classifyRematch(item,state):classifyPoisoned(item,state));
  }
  const reasons=cases.flatMap(item=>item.reasons.map(reason=>`${item.key}: ${reason.replace(`${item.key}: `,"")}`));
  return {safe:reasons.length===0,reasons,cases};
}

function allCanonicalIds(){
  return [...new Set([
    ...RECORD_TRUTH_REPAIR_CASES.filter(row=>ADVANCED_CASE_KEYS.has(row.key)).map(row=>row.canonical_id),
    ...Object.values(NEW_CANONICAL_IDS)
  ])];
}
function allNativeKeys(){
  return [...new Set(RECORD_TRUTH_REPAIR_CASES.filter(row=>ADVANCED_CASE_KEYS.has(row.key)).flatMap(row=>(row.authoritative_contest_ids||[]).map(id=>`native:${id}`)))];
}

async function loadRepairState(env){
  const canonicalIds=allCanonicalIds(),nativeKeys=allNativeKeys(),teamIds=RECORD_TRUTH_REPAIR_TEAM_IDS;
  const canonicalJson=JSON.stringify(canonicalIds),nativeJson=JSON.stringify(nativeKeys),teamJson=JSON.stringify(teamIds);
  const [canonicalResult,observationResult,conflictResult,recordResult]=await env.DB.batch([
    env.DB.prepare(`
      SELECT id,sport,gender,season,participant_a_school_id,participant_b_school_id,home_school_id,away_school_id,
        scheduled_at,scheduled_time_known,venue,location_text,latitude,longitude,conference_game,status,home_score,away_score,
        selected_source_id,trust_state,conflict_count,resolution_json,last_reconciled_at,updated_at
      FROM canonical_events WHERE id IN (SELECT value FROM json_each(?)) ORDER BY id`).bind(canonicalJson),
    env.DB.prepare(`
      SELECT g.id AS game_id,g.team_id,t.school_id AS reporting_school_id,g.source_id,src.parser_type,src.authority_rank,
        g.source_event_key,g.opponent_school_id,g.scheduled_at,g.scheduled_time_known,g.venue,g.location_text,g.latitude,g.longitude,
        g.home_away,g.conference_game,g.counts_for_record,g.status AS game_status,g.team_score,g.opponent_score,g.result AS game_result,
        g.notes,g.canonical_event_id,cem.canonical_event_id AS member_canonical_id
      FROM games g
      JOIN teams t ON t.id=g.team_id
      JOIN sources src ON src.id=g.source_id
      LEFT JOIN canonical_event_members cem ON cem.game_id=g.id
      WHERE g.canonical_event_id IN (SELECT value FROM json_each(?))
         OR g.source_event_key IN (SELECT value FROM json_each(?))
      ORDER BY g.id`).bind(canonicalJson,nativeJson),
    env.DB.prepare(`
      SELECT id,canonical_event_id,conflict_type,values_json,evidence_json,detected_at,resolved_at
      FROM event_conflicts
      WHERE canonical_event_id IN (SELECT value FROM json_each(?))
      ORDER BY canonical_event_id,id`).bind(canonicalJson),
    env.DB.prepare(`
      SELECT team_id,wins,losses,ties,conference_wins,conference_losses,conference_ties,calculated_at
      FROM team_records WHERE team_id IN (SELECT value FROM json_each(?)) ORDER BY team_id`).bind(teamJson)
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
    cases:classified.cases.map(item=>({
      key:item.key,action:item.action,canonical_id:item.canonical_id,new_canonical_id:item.new_canonical_id||null,
      target:item.target||null,first_target:item.first_target||null,second_target:item.second_target||null,
      placeholder_game_ids:item.placeholder_game_ids||[],neutralize_result_game_ids:item.neutralize_result_game_ids||[],move_game_ids:item.move_game_ids||[]
    })),
    canonicals:state.canonicals.map(canonicalSignature).sort(),
    observations:state.observations.map(observationSignature).sort(),
    conflicts:state.conflicts.filter(row=>!row.resolved_at).map(conflictSignature).sort(),
    records:state.records.map(recordSignature).sort()
  };
}

export async function planRecordTruthProductionRepair(env){
  const state=await loadRepairState(env);
  const classified=classifyRecordTruthRepairState(state);
  const reasons=[...classified.reasons];
  if(state.d1.rows_written!==0) reasons.push(`preflight unexpectedly wrote ${state.d1.rows_written} rows`);
  if(state.d1.rows_read>MAX_PLAN_READS) reasons.push(`preflight read fuse exceeded ${state.d1.rows_read}/${MAX_PLAN_READS}`);
  const payload=fingerprintPayload(state,classified);
  return {
    version:VERSION,
    fingerprint:`${VERSION}-${hashText(JSON.stringify(payload))}`,
    safe:reasons.length===0,
    reasons,
    already_completed_cases:["central-west-helena-forrest-city-20260825","farmington-huntsville-20260825"],
    cases:classified.cases,
    records_before:state.records,
    d1:state.d1,
    write_scope:{primary_canonical_repairs_max:MAX_PRIMARY_CANONICAL_REPAIRS,new_canonicals_max:MAX_NEW_CANONICALS,placeholder_game_rows_max:MAX_PLACEHOLDER_WRITES,result_neutralizations_max:MAX_RESULT_NEUTRALIZATIONS,member_moves_max:MAX_MEMBER_MOVES,conflict_rows_max:MAX_CONFLICT_WRITES,record_rebuild_teams_max:RECORD_TRUTH_REPAIR_TEAM_IDS.length},
    state_fingerprint_payload:payload
  };
}

function preparedCanonicalUpdate(env,id,target,now,resolution){
  return env.DB.prepare(`
    UPDATE canonical_events SET
      home_school_id=?,away_school_id=?,status='FINAL',home_score=?,away_score=?,selected_source_id=?,trust_state=?,
      resolution_json=?,last_reconciled_at=?,updated_at=?
    WHERE id=? AND participant_a_school_id=? AND participant_b_school_id=?`)
    .bind(target.home_school_id,target.away_school_id,target.home_score,target.away_score,target.selected_source_id,target.trust_state,
      JSON.stringify(resolution),now,now,id,target.participant_a_school_id,target.participant_b_school_id);
}

function preparedCanonicalInsert(env,id,target,now,resolution){
  return env.DB.prepare(`
    INSERT INTO canonical_events(
      id,sport,gender,season,participant_a_school_id,participant_b_school_id,home_school_id,away_school_id,
      scheduled_at,scheduled_time_known,venue,location_text,latitude,longitude,conference_game,status,home_score,away_score,
      selected_source_id,trust_state,conflict_count,resolution_json,last_reconciled_at,updated_at)
    VALUES(?, 'volleyball','girls','2026', ?,?,?,?,?,?,?,?,?,?,?,?,'FINAL',?,?,?,?,0,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      home_school_id=excluded.home_school_id,away_school_id=excluded.away_school_id,scheduled_at=excluded.scheduled_at,
      scheduled_time_known=excluded.scheduled_time_known,venue=excluded.venue,location_text=excluded.location_text,
      latitude=excluded.latitude,longitude=excluded.longitude,conference_game=excluded.conference_game,status='FINAL',
      home_score=excluded.home_score,away_score=excluded.away_score,selected_source_id=excluded.selected_source_id,
      trust_state=excluded.trust_state,resolution_json=excluded.resolution_json,last_reconciled_at=excluded.last_reconciled_at,updated_at=excluded.updated_at`)
    .bind(id,target.participant_a_school_id,target.participant_b_school_id,target.home_school_id,target.away_school_id,
      target.scheduled_at,target.scheduled_time_known,target.venue,target.location_text,target.latitude,target.longitude,target.conference_game,
      target.home_score,target.away_score,target.selected_source_id,target.trust_state,JSON.stringify(resolution),now,now);
}

async function executeCanonicalRepairs(env,plan,now){
  const statements=[];
  let expectedPrimary=0,expectedNew=0;
  for(const item of plan.cases){
    if(item.action==="already_complete") continue;
    if(item.action==="repair_canonical"){
      expectedPrimary++;
      statements.push(preparedCanonicalUpdate(env,item.canonical_id,item.target,now,{repair:VERSION,case:item.key,mode:"fingerprinted-authoritative-final"}));
    } else if(item.action==="split_rematch"){
      expectedPrimary++;
      expectedNew++;
      statements.push(preparedCanonicalUpdate(env,item.canonical_id,item.first_target,now,{repair:VERSION,case:item.key,mode:"rematch-first"}));
      statements.push(preparedCanonicalInsert(env,item.new_canonical_id,item.second_target,now,{repair:VERSION,case:item.key,mode:"rematch-second"}));
    }
  }
  if(expectedPrimary>MAX_PRIMARY_CANONICAL_REPAIRS) throw new Error(`primary canonical fuse ${expectedPrimary}/${MAX_PRIMARY_CANONICAL_REPAIRS}`);
  if(expectedNew>MAX_NEW_CANONICALS) throw new Error(`new canonical fuse ${expectedNew}/${MAX_NEW_CANONICALS}`);
  if(!statements.length) return {rows_written:0,statements:0,expected_primary:0,expected_new:0};
  const results=await env.DB.batch(statements);
  const rowsWritten=results.reduce((sum,result)=>sum+rw(result),0);
  const minimum=expectedPrimary+expectedNew;
  if(rowsWritten<minimum) throw new Error(`canonical repair wrote ${rowsWritten}; expected at least ${minimum}`);
  return {rows_written:rowsWritten,statements:statements.length,expected_primary:expectedPrimary,expected_new:expectedNew};
}

async function executeObservationRepairs(env,plan,now){
  const placeholders=[...new Set(plan.cases.flatMap(item=>item.placeholder_game_ids||[]))];
  const neutralize=[...new Set(plan.cases.flatMap(item=>item.neutralize_result_game_ids||[]).filter(id=>!placeholders.includes(id)))];
  if(placeholders.length>MAX_PLACEHOLDER_WRITES) throw new Error(`placeholder write fuse ${placeholders.length}/${MAX_PLACEHOLDER_WRITES}`);
  if(neutralize.length>MAX_RESULT_NEUTRALIZATIONS) throw new Error(`result-neutralization fuse ${neutralize.length}/${MAX_RESULT_NEUTRALIZATIONS}`);
  let placeholderResult=null,neutralizeResult=null;
  if(placeholders.length){
    placeholderResult=await env.DB.prepare(`
      UPDATE games SET status='SCHEDULED',team_score=NULL,opponent_score=NULL,result=NULL,counts_for_record=0,
        notes=CASE WHEN notes IS NULL OR notes='' THEN 'Superseded placeholder T 0-0; verified final retained canonically' ELSE notes || ' · Superseded placeholder T 0-0; verified final retained canonically' END,
        updated_at=?
      WHERE id IN (SELECT value FROM json_each(?)) AND status='FINAL' AND team_score=0 AND opponent_score=0 AND result='T'`)
      .bind(now,JSON.stringify(placeholders)).run();
    if(rw(placeholderResult)!==placeholders.length) throw new Error(`placeholder write count ${rw(placeholderResult)}/${placeholders.length}`);
  }
  if(neutralize.length){
    neutralizeResult=await env.DB.prepare(`
      UPDATE games SET result=NULL,
        notes=CASE WHEN notes IS NULL OR notes='' THEN 'Explicit result superseded by fingerprinted native final' ELSE notes || ' · Explicit result superseded by fingerprinted native final' END,
        updated_at=?
      WHERE id IN (SELECT value FROM json_each(?)) AND status='FINAL' AND result IN ('W','L','T')`)
      .bind(now,JSON.stringify(neutralize)).run();
    if(rw(neutralizeResult)!==neutralize.length) throw new Error(`result neutralization count ${rw(neutralizeResult)}/${neutralize.length}`);
  }
  return {placeholder_rows_written:rw(placeholderResult),result_rows_written:rw(neutralizeResult),placeholder_game_ids:placeholders,neutralized_game_ids:neutralize};
}

async function executeRematchMoves(env,plan,now){
  let totalMoves=0,totalRowsWritten=0,statements=0;
  for(const item of plan.cases.filter(row=>row.action==="split_rematch")){
    const ids=item.move_game_ids||[];
    if(!ids.length) continue;
    totalMoves+=ids.length;
    if(totalMoves>MAX_MEMBER_MOVES) throw new Error(`member move fuse ${totalMoves}/${MAX_MEMBER_MOVES}`);
    const json=JSON.stringify(ids);
    const results=await env.DB.batch([
      env.DB.prepare(`DELETE FROM canonical_event_members WHERE game_id IN (SELECT value FROM json_each(?)) AND canonical_event_id<>?`).bind(json,item.new_canonical_id),
      env.DB.prepare(`UPDATE games SET canonical_event_id=?,updated_at=? WHERE id IN (SELECT value FROM json_each(?))`).bind(item.new_canonical_id,now,json),
      env.DB.prepare(`INSERT OR REPLACE INTO canonical_event_members(canonical_event_id,game_id,source_id,reporting_team_id,added_at)
        SELECT ?,g.id,g.source_id,g.team_id,? FROM games g WHERE g.id IN (SELECT value FROM json_each(?))`).bind(item.new_canonical_id,now,json)
    ]);
    statements+=3;
    totalRowsWritten+=results.reduce((sum,result)=>sum+rw(result),0);
  }
  return {logical_member_moves:totalMoves,rows_written:totalRowsWritten,statements};
}

async function resolveRepairConflicts(env,plan,now){
  const ids=[...new Set(plan.cases.flatMap(item=>[item.canonical_id,item.new_canonical_id]).filter(Boolean))];
  if(!ids.length) return {rows_written:0,conflicts_resolved:0};
  const json=JSON.stringify(ids);
  const resolved=await env.DB.prepare(`
    UPDATE event_conflicts SET resolved_at=?
    WHERE canonical_event_id IN (SELECT value FROM json_each(?)) AND resolved_at IS NULL
      AND conflict_type IN ('SCORE','STATUS','HOME_AWAY')`).bind(now,json).run();
  if(rw(resolved)>MAX_CONFLICT_WRITES) throw new Error(`conflict write fuse ${rw(resolved)}/${MAX_CONFLICT_WRITES}`);
  const refreshed=await env.DB.prepare(`
    UPDATE canonical_events SET conflict_count=(
      SELECT COUNT(*) FROM event_conflicts ec WHERE ec.canonical_event_id=canonical_events.id AND ec.resolved_at IS NULL
    ),updated_at=? WHERE id IN (SELECT value FROM json_each(?))`).bind(now,json).run();
  return {rows_written:rw(resolved)+rw(refreshed),conflicts_resolved:rw(resolved),canonical_conflict_counts_refreshed:rw(refreshed)};
}

export async function executeRecordTruthProductionRepair(env,{fingerprint,now=new Date()}={}){
  const plan=await planRecordTruthProductionRepair(env);
  if(!fingerprint||fingerprint!==plan.fingerprint) throw new Error("record-truth repair fingerprint mismatch");
  if(!plan.safe) throw new Error(`record-truth repair preflight unsafe: ${plan.reasons.join("; ")}`);
  const checkedAt=now.toISOString();
  const canonicalWrites=await executeCanonicalRepairs(env,plan,checkedAt);
  const observationWrites=await executeObservationRepairs(env,plan,checkedAt);
  const memberWrites=await executeRematchMoves(env,plan,checkedAt);
  const conflictWrites=await resolveRepairConflicts(env,plan,checkedAt);
  const recordResult=await rebuildTeamRecords(env,RECORD_TRUTH_REPAIR_TEAM_IDS,checkedAt);
  if(Number(recordResult?.teams||0)!==RECORD_TRUTH_REPAIR_TEAM_IDS.length) throw new Error(`record rebuild team count ${recordResult?.teams||0}/${RECORD_TRUTH_REPAIR_TEAM_IDS.length}`);
  const verification=await planRecordTruthProductionRepair(env);
  const bad=verification.cases.filter(item=>item.action!=="already_complete");
  if(!verification.safe||bad.length) throw new Error(`record-truth repair verification failed: ${verification.reasons.join("; ")} ${bad.map(item=>`${item.key}:${item.action}`).join(",")}`.trim());
  return {
    status:"SUCCESS",version:VERSION,fingerprint,
    corrected_cases:plan.cases.filter(item=>item.action!=="already_complete").map(item=>item.key),
    already_completed_cases:plan.already_completed_cases,
    canonical_writes:canonicalWrites,observation_writes:observationWrites,member_writes:memberWrites,conflict_writes:conflictWrites,
    record_result:recordResult,verification
  };
}

export { VERSION as RECORD_TRUTH_PRODUCTION_REPAIR_VERSION, NEW_CANONICAL_IDS, MAX_PLAN_READS };
