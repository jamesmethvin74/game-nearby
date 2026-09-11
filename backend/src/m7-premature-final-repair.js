import { rebuildTeamRecords } from "./record-rebuild.js";

const EVENT_IDS=[
  "ce:volleyball:girls:2026:df-7x4sxh:df-ht8yyh:20260911:t1800",
  "ce:volleyball:girls:2026:df-7x4sxh:df-9mvcl7:20260919:t1630",
  "ce:volleyball:girls:2026:df-7x4sxh:df-wd92v5:20260923:t1500"
];
const REPORTING_TEAM_ID="df-7x4sxh-volleyball-2026";
const SOURCE_ID="df-7x4sxh-volleyball-2026-official-school-results";
const FINGERPRINT="m7-premature-finals-3-v1";

function rowsRead(result){return Number(result?.meta?.rows_read||0);}
function rowsWritten(result){return Number(result?.meta?.rows_written||0);}

async function loadScope(env){
  const ids=JSON.stringify(EVENT_IDS);
  const [rows,conflicts]=await env.DB.batch([
    env.DB.prepare(`
      SELECT ce.id,ce.scheduled_at,ce.status,ce.home_school_id,ce.away_school_id,
        ce.home_score,ce.away_score,ce.selected_source_id,ce.trust_state,
        cem.game_id,cem.reporting_team_id,g.source_id,g.status AS game_status,
        g.team_score,g.opponent_score,src.source_type,src.parser_type,
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

function validateScope(scope,now=new Date()){
  const reasons=[];
  const byId=new Map();
  for(const row of scope.rows){
    if(!byId.has(row.id)) byId.set(row.id,[]);
    byId.get(row.id).push(row);
  }
  for(const id of EVENT_IDS){
    const rows=byId.get(id)||[];
    if(rows.length!==1){reasons.push(`${id}: expected exactly one member row, found ${rows.length}`);continue;}
    const row=rows[0];
    if(Number(row.member_count)!==1) reasons.push(`${id}: member_count=${row.member_count}`);
    if(row.reporting_team_id!==REPORTING_TEAM_ID) reasons.push(`${id}: reporting team changed`);
    if(row.source_id!==SOURCE_ID) reasons.push(`${id}: source changed`);
    if(row.source_type!=="official-school"||row.parser_type!=="mascot-media") reasons.push(`${id}: source parser changed`);
    if(row.status!=="FINAL"||row.game_status!=="FINAL") reasons.push(`${id}: no longer final`);
    if(Date.parse(row.scheduled_at)<=now.getTime()) reasons.push(`${id}: no longer future`);
  }
  if(scope.conflicts.length) reasons.push(`active conflicts=${scope.conflicts.length}`);
  return {safe:reasons.length===0,reasons,rows:[...byId.values()].flat()};
}

export async function planM7PrematureFinalRepair(env,{now=new Date()}={}){
  const scope=await loadScope(env);
  if(scope.d1.rows_written!==0) throw new Error(`preflight wrote ${scope.d1.rows_written} rows`);
  const validation=validateScope(scope,now);
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
  if(writeTelemetry.rows_written!==6) throw new Error(`expected 6 logical D1 writes, got ${writeTelemetry.rows_written}`);

  const recordResult=await rebuildTeamRecords(env,[REPORTING_TEAM_ID],checkedAt);

  const [verifyEvents,verifyGames]=await env.DB.batch([
    env.DB.prepare(`SELECT id,status,home_score,away_score FROM canonical_events
      WHERE id IN (SELECT value FROM json_each(?)) ORDER BY id`).bind(ids),
    env.DB.prepare(`SELECT cem.canonical_event_id,g.id,g.status,g.team_score,g.opponent_score,g.result
      FROM canonical_event_members cem JOIN games g ON g.id=cem.game_id
      WHERE cem.canonical_event_id IN (SELECT value FROM json_each(?)) ORDER BY cem.canonical_event_id`).bind(ids)
  ]);
  const events=verifyEvents.results||[];
  const games=verifyGames.results||[];
  const verified=events.length===3&&games.length===3
    &&events.every(row=>row.status==="SCHEDULED"&&row.home_score==null&&row.away_score==null)
    &&games.every(row=>row.status==="SCHEDULED"&&row.team_score==null&&row.opponent_score==null&&row.result==null);
  if(!verified) throw new Error("premature-final repair verification failed");
  return {
    status:"SUCCESS",fingerprint:FINGERPRINT,event_count:3,
    write_telemetry:writeTelemetry,record_result:recordResult,
    verification:{verified,events,games,d1:{
      statements:2,
      rows_read:rowsRead(verifyEvents)+rowsRead(verifyGames),
      rows_written:rowsWritten(verifyEvents)+rowsWritten(verifyGames)
    }}
  };
}

export { EVENT_IDS as M7_PREMATURE_FINAL_EVENT_IDS, FINGERPRINT as M7_PREMATURE_FINAL_FINGERPRINT };
