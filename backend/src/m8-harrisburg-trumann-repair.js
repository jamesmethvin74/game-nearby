import { rebuildTeamRecords } from "./record-rebuild.js";

const FINGERPRINT_PREFIX = "m8-harrisburg-trumann-20260914-v1";
const MAX_PLAN_READS = 80;
const MAX_DIRECT_WRITES = 1;

export const HARRISBURG_TRUMANN_CASE = Object.freeze({
  key:"harrisburg-trumann-20260911",
  canonicalId:"ce:football:boys:2026:df-jys3ef:df-vm7v8n:20260911:df-69d51fb3f977a82d28000000",
  homeSchoolId:"df-jys3ef",
  awaySchoolId:"df-vm7v8n",
  homeTeamId:"df-jys3ef-football-2026",
  awayTeamId:"df-vm7v8n-football-2026",
  scheduledAt:"2026-09-12T00:00:00.000Z",
  homeScore:0,
  awayScore:12,
  evidence:"MaxPreps reports Harrisburg 12-0 Trumann on Sep. 11, 2026; production DragonFly reciprocal observations already preserve Harrisburg=12 while the Trumann score is null."
});

function rr(result){ return Number(result?.meta?.rows_read || 0); }
function rw(result){ return Number(result?.meta?.rows_written || 0); }
function numberOrNull(value){
  if(value===null || value===undefined || value==="") return null;
  const n=Number(value);
  return Number.isFinite(n)?n:null;
}
function hashText(value){
  let hash=2166136261;
  for(let i=0;i<value.length;i+=1){ hash^=value.charCodeAt(i); hash=Math.imul(hash,16777619); }
  return (hash>>>0).toString(16).padStart(8,"0");
}
function memberSignature(row){
  return [row.game_id,row.reporting_team_id,row.source_id,row.game_status,numberOrNull(row.team_score),numberOrNull(row.opponent_score),row.game_result||null].join("|");
}
function conflictSignature(row){ return [row.id,row.conflict_type,row.values_json].join("|"); }

export function classifyHarrisburgTrumannRepair(rows=[], conflictRows=[]){
  const item=HARRISBURG_TRUMANN_CASE;
  const reasons=[];
  const base=rows[0]||null;
  const homeFinals=rows.filter(row=>row.reporting_team_id===item.homeTeamId&&row.game_status==="FINAL");
  const awayFinals=rows.filter(row=>row.reporting_team_id===item.awayTeamId&&row.game_status==="FINAL");
  const activeConflicts=conflictRows.filter(row=>!row.resolved_at);

  if(!base) reasons.push("canonical event is missing");
  if(base&&base.canonical_id!==item.canonicalId) reasons.push(`canonical id changed to ${base.canonical_id||"null"}`);
  if(base&&base.canonical_status!=="FINAL") reasons.push(`canonical status is ${base.canonical_status||"null"}, not FINAL`);
  if(base&&base.home_school_id!==item.homeSchoolId) reasons.push(`home school changed to ${base.home_school_id||"null"}`);
  if(base&&base.away_school_id!==item.awaySchoolId) reasons.push(`away school changed to ${base.away_school_id||"null"}`);
  if(base&&base.scheduled_at!==item.scheduledAt) reasons.push(`scheduled time changed to ${base.scheduled_at||"null"}`);
  if(base&&Number(base.conflict_count||0)!==0) reasons.push(`canonical conflict_count=${base.conflict_count}`);
  if(activeConflicts.length) reasons.push(`active conflicts=${activeConflicts.map(row=>row.conflict_type).join(",")}`);
  if(!homeFinals.length) reasons.push("no FINAL Trumann observation exists");
  if(!awayFinals.length) reasons.push("no FINAL Harrisburg observation exists");

  for(const row of homeFinals){
    const team=numberOrNull(row.team_score);
    const opponent=numberOrNull(row.opponent_score);
    const result=String(row.game_result||"").toUpperCase();
    if(![null,0].includes(team)||opponent!==12||!["","L"].includes(result)) {
      reasons.push(`Trumann observation contradicts proven 0-12 result: ${row.game_id}`);
    }
  }
  for(const row of awayFinals){
    const team=numberOrNull(row.team_score);
    const opponent=numberOrNull(row.opponent_score);
    const result=String(row.game_result||"").toUpperCase();
    if(team!==12||![null,0].includes(opponent)||!["","W"].includes(result)) {
      reasons.push(`Harrisburg observation contradicts proven 12-0 result: ${row.game_id}`);
    }
  }

  const canonicalComplete=Boolean(base)
    && numberOrNull(base.home_score)===0
    && numberOrNull(base.away_score)===12;
  const canonicalPartial=Boolean(base)
    && numberOrNull(base.home_score)===null
    && numberOrNull(base.away_score)===12;

  let action="unsafe";
  if(!reasons.length&&canonicalComplete) action="already_complete";
  else if(!reasons.length&&canonicalPartial) action="apply_canonical_resolution";
  else if(!reasons.length) reasons.push("canonical score state no longer matches the exact proven partial or complete state");

  return {
    safe:reasons.length===0,
    reasons,
    case:{
      key:item.key,
      canonical_id:item.canonicalId,
      action,
      evidence:item.evidence,
      current:{
        home_score:numberOrNull(base?.home_score),
        away_score:numberOrNull(base?.away_score),
        member_count:rows.length,
        final_member_count:homeFinals.length+awayFinals.length,
        member_signatures:rows.map(memberSignature).sort(),
        active_conflicts:activeConflicts.map(conflictSignature).sort()
      },
      target:{home_score:0,away_score:12}
    }
  };
}

async function loadRepairState(env){
  const item=HARRISBURG_TRUMANN_CASE;
  const [eventRows,conflictRows,recordRows]=await env.DB.batch([
    env.DB.prepare(`
      SELECT ce.id AS canonical_id,ce.status AS canonical_status,ce.home_school_id,ce.away_school_id,
        ce.scheduled_at,ce.home_score,ce.away_score,ce.trust_state,ce.conflict_count,
        cem.game_id,cem.reporting_team_id,cem.source_id,
        g.status AS game_status,g.team_score,g.opponent_score,g.result AS game_result
      FROM canonical_events ce
      JOIN canonical_event_members cem ON cem.canonical_event_id=ce.id
      JOIN games g ON g.id=cem.game_id
      WHERE ce.id=?
      ORDER BY cem.reporting_team_id,cem.source_id,cem.game_id
    `).bind(item.canonicalId),
    env.DB.prepare(`
      SELECT id,canonical_event_id,conflict_type,values_json,resolved_at
      FROM event_conflicts
      WHERE canonical_event_id=? AND resolved_at IS NULL
      ORDER BY id
    `).bind(item.canonicalId),
    env.DB.prepare(`
      SELECT team_id,wins,losses,ties,conference_wins,conference_losses,conference_ties,calculated_at
      FROM team_records WHERE team_id IN (?,?) ORDER BY team_id
    `).bind(item.homeTeamId,item.awayTeamId)
  ]);
  const d1={
    statements:3,
    rows_read:rr(eventRows)+rr(conflictRows)+rr(recordRows),
    rows_written:rw(eventRows)+rw(conflictRows)+rw(recordRows),
    per_statement:[
      {rows_read:rr(eventRows),rows_written:rw(eventRows)},
      {rows_read:rr(conflictRows),rows_written:rw(conflictRows)},
      {rows_read:rr(recordRows),rows_written:rw(recordRows)}
    ]
  };
  return {eventRows:eventRows.results||[],conflictRows:conflictRows.results||[],recordRows:recordRows.results||[],d1};
}

function fingerprintFor(classified){
  return `${FINGERPRINT_PREFIX}-${hashText(JSON.stringify({action:classified.case.action,current:classified.case.current,target:classified.case.target}))}`;
}

export async function planHarrisburgTrumannRepair(env){
  const state=await loadRepairState(env);
  const classified=classifyHarrisburgTrumannRepair(state.eventRows,state.conflictRows);
  const reasons=[...classified.reasons];
  if(state.d1.rows_written!==0) reasons.push(`plan unexpectedly wrote ${state.d1.rows_written} rows`);
  if(state.d1.rows_read>MAX_PLAN_READS) reasons.push(`plan read fuse exceeded: ${state.d1.rows_read} > ${MAX_PLAN_READS}`);
  return {
    fingerprint:fingerprintFor(classified),
    safe:reasons.length===0,
    reasons,
    case:classified.case,
    records_before:state.recordRows,
    write_scope:{canonical_events_max:1,game_rows_max:0,conflict_rows_max:0,record_rebuild_teams_max:2,direct_writes_max:MAX_DIRECT_WRITES},
    d1:state.d1
  };
}

export async function executeHarrisburgTrumannRepair(env,{fingerprint,now=new Date()}={}){
  const item=HARRISBURG_TRUMANN_CASE;
  const plan=await planHarrisburgTrumannRepair(env);
  if(!fingerprint||fingerprint!==plan.fingerprint) throw new Error("Harrisburg-Trumann repair fingerprint mismatch");
  if(!plan.safe) throw new Error(`Harrisburg-Trumann repair preflight unsafe: ${plan.reasons.join("; ")}`);
  if(plan.case.action==="already_complete") return {status:"ALREADY_COMPLETE",fingerprint:plan.fingerprint,plan};
  if(plan.case.action!=="apply_canonical_resolution") throw new Error(`Harrisburg-Trumann repair action is ${plan.case.action}`);

  const checkedAt=now.toISOString();
  const canonicalWrite=await env.DB.prepare(`
    UPDATE canonical_events
    SET home_score=0,away_score=12,status='FINAL',last_reconciled_at=?,updated_at=?
    WHERE id=? AND home_school_id=? AND away_school_id=? AND scheduled_at=?
      AND status='FINAL' AND home_score IS NULL AND away_score=12 AND conflict_count=0
  `).bind(checkedAt,checkedAt,item.canonicalId,item.homeSchoolId,item.awaySchoolId,item.scheduledAt).run();

  const directRowsWritten=rw(canonicalWrite);
  if(directRowsWritten!==1) throw new Error(`canonical write count mismatch: expected 1, got ${directRowsWritten}`);
  if(directRowsWritten>MAX_DIRECT_WRITES) throw new Error(`direct write fuse tripped: ${directRowsWritten} > ${MAX_DIRECT_WRITES}`);

  const touchedTeamIds=[item.homeTeamId,item.awayTeamId];
  const recordResult=await rebuildTeamRecords(env,touchedTeamIds,checkedAt);
  if(Number(recordResult?.teams||0)!==2) throw new Error(`record rebuild team count mismatch: expected 2, got ${recordResult?.teams||0}`);

  const verification=await planHarrisburgTrumannRepair(env);
  if(!verification.safe||verification.case.action!=="already_complete") {
    throw new Error(`Harrisburg-Trumann repair verification failed: ${verification.reasons.join("; ")} action=${verification.case.action}`.trim());
  }

  return {
    status:"SUCCESS",
    fingerprint,
    corrected_case:item.key,
    direct_write_telemetry:{statements:1,rows_read:rr(canonicalWrite),rows_written:directRowsWritten,canonical_rows_written:directRowsWritten,game_rows_written:0,conflict_rows_written:0},
    record_result:recordResult,
    verification
  };
}

export { FINGERPRINT_PREFIX as HARRISBURG_TRUMANN_FINGERPRINT_PREFIX, MAX_PLAN_READS, MAX_DIRECT_WRITES };
