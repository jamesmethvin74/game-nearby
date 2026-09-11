import { rebuildTeamRecords } from "./record-rebuild.js";

const EVENT_IDS=[
  "ce:volleyball:girls:2026:df-7x4sxh:df-ht8yyh:20260911:t1800",
  "ce:volleyball:girls:2026:df-7x4sxh:df-9mvcl7:20260919:t1630",
  "ce:volleyball:girls:2026:df-7x4sxh:df-wd92v5:20260923:t1500"
];
const REPORTING_TEAM_ID="df-7x4sxh-volleyball-2026";
const SOURCE_ID="df-7x4sxh-volleyball-2026-official-school-results";
const FINGERPRINT="m7-premature-finals-3-v1";
const RECORD_RECOVERY_FINGERPRINT="m7-pea-ridge-record-recovery-v1";

function rowsRead(result){return Number(result?.meta?.rows_read||0);}
function rowsWritten(result){return Number(result?.meta?.rows_written||0);}

async function loadScope(env){
  const ids=JSON.stringify(EVENT_IDS);
  const [rows,conflicts]=await env.DB.batch([
    env.DB.prepare(`
      SELECT ce.id,ce.scheduled_at,ce.status,ce.home_school_id,ce.away_school_id,
        ce.home_score,ce.away_score,ce.selected_source_id,ce.trust_state,
        cem.game_id,cem.reporting_team_id,g.source_id,g.status AS game_status,
        g.team_score,g.opponent_score,g.result,src.source_type,src.parser_type,
        (SELECT COUNT(*) FROM canonical_event_members x WHERE x.canonical_event_id=ce.id) AS member_count
      FROM canonical_events ce
      JOIN canonical_event_members cem ON cem.canonical_event_id=ce.id
      JOIN games g ON g.id=cem.game_id
      JOIN sources src ON src.id=g.source_id
      WHERE ce.id IN (SELECT value FROM json_each(?))
      ORDER BY ce.id,cem.game_id
    `).bind(ids),
    env.DB.prepare(`
      SELECT canonical_event_id,COUNT(*) AS active_conflicts
      FROM event_conflicts
      WHERE canonical_event_id IN (SELECT value FROM json_each(?)) AND resolved_at IS NULL
      GROUP BY canonical_event_id
    `).bind(ids)
  ]);
  return {rows:rows.results||[],conflicts:conflicts.results||[],d1:{
    statements:2,
    rows_read:rowsRead(rows)+rowsRead(conflicts),
    rows_written:rowsWritten(rows)+rowsWritten(conflicts)
  }};
}

function byEvent(scope){
  const map=new Map();
  for(const row of scope.rows){
    if(!map.has(row.id)) map.set(row.id,[]);
    map.get(row.id).push(row);
  }
  return map;
}

function validateRepairScope(scope,now=new Date()){
  const reasons=[];
  const byId=byEvent(scope);
  for(const id of EVENT_IDS){
    const rows=byId.get(id)||[];
    if(rows.length!==1){reasons.push(`${id}: expected exactly one member row, found ${rows.length}`);continue;}
    const row=rows[0];
    if(Number(row.member_count||0)!==1) reasons.push(`${id}: member_count=${row.member_count}`);
    if(row.reporting_team_id!==REPORTING_TEAM_ID) reasons.push(`${id}: reporting team changed`);
    if(row.source_id!==SOURCE_ID) reasons.push(`${id}: source changed`);
    if(row.source_type!=="official-school"||row.parser_type!=="mascot-media") reasons.push(`${id}: source parser changed`);
    if(row.status!=="FINAL"||row.game_status!=="FINAL") reasons.push(`${id}: no longer final`);
    if(Date.parse(row.scheduled_at)<=now.getTime()) reasons.push(`${id}: no longer future`);
  }
  if(scope.conflicts.length) reasons.push(`active conflicts=${scope.conflicts.length}`);
  return {safe:reasons.length===0,reasons,rows:[...byId.values()].flat()};
}

function validateCorrectedScope(scope){
  const reasons=[];
  const byId=byEvent(scope);
  for(const id of EVENT_IDS){
    const rows=byId.get(id)||[];
    if(rows.length!==1){reasons.push(`${id}: expected exactly one member row, found ${rows.length}`);continue;}
    const row=rows[0];
    if(Number(row.member_count||0)!==1) reasons.push(`${id}: member_count=${row.member_count}`);
    if(row.reporting_team_id!==REPORTING_TEAM_ID) reasons.push(`${id}: reporting team changed`);
    if(row.source_id!==SOURCE_ID) reasons.push(`${id}: source changed`);
    if(row.source_type!=="official-school"||row.parser_type!=="mascot-media") reasons.push(`${id}: source parser changed`);
    if(row.status!=="SCHEDULED"||row.game_status!=="SCHEDULED") reasons.push(`${id}: not corrected to scheduled`);
    if(row.home_score!=null||row.away_score!=null||row.team_score!=null||row.opponent_score!=null||row.result!=null) {
      reasons.push(`${id}: corrected scores/result are not null`);
    }
  }
  if(scope.conflicts.length) reasons.push(`active conflicts=${scope.conflicts.length}`);
  return {safe:reasons.length===0,reasons,rows:[...byId.values()].flat()};
}

export async function planM7PrematureFinalRepair(env,{now=new Date()}={}){
  const scope=await loadScope(env);
  if(scope.d1.rows_written!==0) throw new Error(`preflight wrote ${scope.d1.rows_written} rows`);
  const validation=validateRepairScope(scope,now);
  return {
    fingerprint:FINGERPRINT,
    safe:validation.safe,
    reasons:validation.reasons,
    event_count:validation.rows.length,
    events:validation.rows,
    target_team_id:REPORTING_TEAM_ID,
    d1:scope.d1
  };
}

export async function executeM7PrematureFinalRepair(env,{fingerprint,now=new Date()}={}){
  if(fingerprint!==FINGERPRINT) throw new Error("premature-final repair fingerprint mismatch");
  const plan=await planM7PrematureFinalRepair(env,{now});
  if(!plan.safe) throw new Error(`premature-final repair preflight unsafe: ${plan.reasons.join("; ")}`);
  const checkedAt=now.toISOString();
  const ids=JSON.stringify(EVENT_IDS);
  const writes=await env.DB.batch([
    env.DB.prepare(`
      UPDATE games SET status='SCHEDULED',team_score=NULL,opponent_score=NULL,result=NULL,
        notes=CASE WHEN notes IS NULL OR notes='' THEN 'Corrected premature Mascot Media final'
                   ELSE notes || ' · Corrected premature Mascot Media final' END,
        updated_at=?
      WHERE id IN (
        SELECT cem.game_id FROM canonical_event_members cem
        WHERE cem.canonical_event_id IN (SELECT value FROM json_each(?))
          AND cem.reporting_team_id=?
      ) AND source_id=? AND status='FINAL'
    `).bind(checkedAt,ids,REPORTING_TEAM_ID,SOURCE_ID),
    env.DB.prepare(`
      UPDATE canonical_events SET status='SCHEDULED',home_score=NULL,away_score=NULL,
        trust_state='SINGLE_SOURCE_LIVE',conflict_count=0,last_reconciled_at=?,updated_at=?
      WHERE id IN (SELECT value FROM json_each(?)) AND status='FINAL'
    `).bind(checkedAt,checkedAt,ids)
  ]);
  const writeTelemetry={
    statements:writes.length,
    rows_read:writes.reduce((sum,r)=>sum+rowsRead(r),0),
    rows_written:writes.reduce((sum,r)=>sum+rowsWritten(r),0),
    per_statement:writes.map(r=>({rows_read:rowsRead(r),rows_written:rowsWritten(r)}))
  };
  // D1 rows_written includes index maintenance, so require the update statements to
  // write something but do not confuse physical writes with six logical rows.
  if(writeTelemetry.rows_written<6||writeTelemetry.rows_written>24) {
    throw new Error(`unexpected physical D1 write count: ${writeTelemetry.rows_written}`);
  }

  const recordResult=await rebuildTeamRecords(env,[REPORTING_TEAM_ID],checkedAt);

  const verification=await verifyCorrectedScope(env);
  if(!verification.verified) throw new Error(`premature-final repair verification failed: ${verification.reasons.join("; ")}`);
  return {
    status:"SUCCESS",fingerprint:FINGERPRINT,event_count:3,
    write_telemetry:writeTelemetry,record_result:recordResult,verification
  };
}

async function verifyCorrectedScope(env){
  const scope=await loadScope(env);
  const validation=validateCorrectedScope(scope);
  return {
    verified:validation.safe,
    reasons:validation.reasons,
    event_count:validation.rows.length,
    events:validation.rows,
    d1:scope.d1
  };
}

export async function planM7PrematureFinalRecordRecovery(env){
  const scope=await loadScope(env);
  if(scope.d1.rows_written!==0) throw new Error(`record recovery preflight wrote ${scope.d1.rows_written} rows`);
  const validation=validateCorrectedScope(scope);
  return {
    fingerprint:RECORD_RECOVERY_FINGERPRINT,
    safe:validation.safe,
    reasons:validation.reasons,
    event_count:validation.rows.length,
    target_team_id:REPORTING_TEAM_ID,
    d1:scope.d1
  };
}

export async function executeM7PrematureFinalRecordRecovery(env,{fingerprint,now=new Date()}={}){
  if(fingerprint!==RECORD_RECOVERY_FINGERPRINT) throw new Error("record recovery fingerprint mismatch");
  const plan=await planM7PrematureFinalRecordRecovery(env);
  if(!plan.safe) throw new Error(`record recovery preflight unsafe: ${plan.reasons.join("; ")}`);
  const calculatedAt=now.toISOString();
  const recordResult=await rebuildTeamRecords(env,[REPORTING_TEAM_ID],calculatedAt);
  if(Number(recordResult?.teams||0)!==1) throw new Error(`record recovery rebuilt ${recordResult?.teams||0} teams instead of 1`);
  const recordRow=await env.DB.prepare(`
    SELECT team_id,wins,losses,ties,conference_wins,conference_losses,conference_ties,calculated_at
    FROM team_records WHERE team_id=?
  `).bind(REPORTING_TEAM_ID).first();
  if(!recordRow) throw new Error("Pea Ridge team record missing after rebuild");
  const verification=await verifyCorrectedScope(env);
  if(!verification.verified) throw new Error(`corrected-event verification failed after record rebuild: ${verification.reasons.join("; ")}`);
  return {
    status:"SUCCESS",
    fingerprint:RECORD_RECOVERY_FINGERPRINT,
    target_team_id:REPORTING_TEAM_ID,
    record_result:recordResult,
    record:recordRow,
    corrected_event_verification:verification
  };
}

export {
  EVENT_IDS as M7_PREMATURE_FINAL_EVENT_IDS,
  FINGERPRINT as M7_PREMATURE_FINAL_FINGERPRINT,
  RECORD_RECOVERY_FINGERPRINT as M7_PREMATURE_FINAL_RECORD_RECOVERY_FINGERPRINT
};
