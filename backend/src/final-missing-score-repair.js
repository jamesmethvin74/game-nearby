import { rebuildTeamRecords } from "./record-rebuild.js";

const FINGERPRINT_PREFIX = "final-missing-score-two-games-v2";
const MAX_PLAN_READS = 200;
const MAX_DIRECT_WRITES = 2;

export const FINAL_MISSING_SCORE_CASES = Object.freeze([
  Object.freeze({
    key:"central-forrest-city-20260825",
    canonicalId:"ce:volleyball:girls:2026:df-7kza8c:df-cqpax3:20260825:df-695fcf130e0845562900001c",
    eventId:"695fcf130e0845562900001c",
    scheduledAt:"2026-08-25T21:30:00.000Z",
    homeSchoolId:"df-cqpax3",
    awaySchoolId:"df-7kza8c",
    homeTeamId:"df-cqpax3-volleyball-2026",
    awayTeamId:"df-7kza8c-volleyball-2026",
    homeScore:0,
    awayScore:3,
    evidence:"DragonFly has reciprocal W/L observations and one full 3-0 source observation; MaxPreps independently reports Central 3-0 Forrest City with sets 25-23, 25-14, 25-21."
  }),
  Object.freeze({
    key:"farmington-huntsville-20260825",
    canonicalId:"ce:volleyball:girls:2026:df-8pkud7:df-qgka87:20260825:df-69babe474fd8441434000004",
    eventId:"69babe474fd8441434000004",
    scheduledAt:"2026-08-25T23:30:00.000Z",
    homeSchoolId:"df-8pkud7",
    awaySchoolId:"df-qgka87",
    homeTeamId:"df-8pkud7-volleyball-2026",
    awayTeamId:"df-qgka87-volleyball-2026",
    homeScore:0,
    awayScore:3,
    evidence:"DragonFly has reciprocal Farmington W / Huntsville L observations with Farmington score 3; Huntsville official athletics and MaxPreps independently report Huntsville 0-3 Farmington."
  })
]);

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

export function classifyFinalMissingScoreRows(rows=[], conflictRows=[]){
  const reasons=[];
  const cases=[];

  for(const item of FINAL_MISSING_SCORE_CASES){
    const matches=rows.filter(row=>row.canonical_id===item.canonicalId);
    const base=matches[0]||null;
    const homeFinals=matches.filter(row=>row.reporting_team_id===item.homeTeamId&&row.game_status==="FINAL");
    const awayFinals=matches.filter(row=>row.reporting_team_id===item.awayTeamId&&row.game_status==="FINAL");
    const activeConflicts=conflictRows.filter(row=>row.canonical_event_id===item.canonicalId&&!row.resolved_at);
    const blockingConflicts=activeConflicts.filter(row=>row.conflict_type!=="VENUE");
    const local=[];

    if(!base) local.push("canonical event is missing");
    if(base&&base.canonical_status!=="FINAL") local.push(`canonical status is ${base.canonical_status||"null"}, not FINAL`);
    if(base&&base.home_school_id!==item.homeSchoolId) local.push(`home school changed to ${base.home_school_id||"null"}`);
    if(base&&base.away_school_id!==item.awaySchoolId) local.push(`away school changed to ${base.away_school_id||"null"}`);
    if(!homeFinals.length) local.push("no FINAL observation exists for the home team");
    if(!awayFinals.length) local.push("no FINAL observation exists for the away team");
    if(blockingConflicts.length) local.push(`blocking active conflicts=${blockingConflicts.map(row=>row.conflict_type).join(",")}`);

    for(const row of homeFinals){
      if(![null,item.homeScore].includes(numberOrNull(row.team_score)) || numberOrNull(row.opponent_score)!==item.awayScore || String(row.game_result||"")!=="L") {
        local.push(`home observation contradicts verified 0-3 result: ${row.game_id}`);
      }
    }
    for(const row of awayFinals){
      if(numberOrNull(row.team_score)!==item.awayScore || ![null,item.homeScore].includes(numberOrNull(row.opponent_score)) || String(row.game_result||"")!=="W") {
        local.push(`away observation contradicts verified 3-0 result: ${row.game_id}`);
      }
    }

    const canonicalComplete=Boolean(base)
      && numberOrNull(base.home_score)===item.homeScore
      && numberOrNull(base.away_score)===item.awayScore;
    const canonicalPartial=Boolean(base)
      && numberOrNull(base.home_score)===null
      && numberOrNull(base.away_score)===item.awayScore;

    let action="unsafe";
    if(!local.length&&canonicalComplete) action="already_complete";
    else if(!local.length&&canonicalPartial) action="apply_canonical_resolution";
    else if(!local.length) local.push("canonical score state no longer matches the exact proven partial or complete state");

    if(local.length) reasons.push(...local.map(reason=>`${item.key}: ${reason}`));
    cases.push({
      key:item.key,
      canonical_id:item.canonicalId,
      event_id:item.eventId,
      scheduled_at:item.scheduledAt,
      action,
      evidence:item.evidence,
      current:{
        home_score:numberOrNull(base?.home_score),
        away_score:numberOrNull(base?.away_score),
        member_count:matches.length,
        final_member_count:homeFinals.length+awayFinals.length,
        member_signatures:matches.map(memberSignature).sort(),
        active_conflicts:activeConflicts.map(conflictSignature).sort(),
        ignored_venue_conflict_count:activeConflicts.filter(row=>row.conflict_type==="VENUE").length
      },
      target:{home_score:item.homeScore,away_score:item.awayScore}
    });
  }
  return {safe:reasons.length===0,reasons,cases};
}

async function loadRepairState(env){
  const canonicalIds=FINAL_MISSING_SCORE_CASES.map(item=>item.canonicalId);
  const teamIds=FINAL_MISSING_SCORE_CASES.flatMap(item=>[item.homeTeamId,item.awayTeamId]);
  const [eventRows,conflictRows,recordRows]=await env.DB.batch([
    env.DB.prepare(`
      SELECT ce.id AS canonical_id,ce.status AS canonical_status,ce.home_school_id,ce.away_school_id,
        ce.home_score,ce.away_score,ce.trust_state,ce.conflict_count,
        cem.game_id,cem.reporting_team_id,cem.source_id,
        g.status AS game_status,g.team_score,g.opponent_score,g.result AS game_result
      FROM canonical_events ce
      JOIN canonical_event_members cem ON cem.canonical_event_id=ce.id
      JOIN games g ON g.id=cem.game_id
      WHERE ce.id IN (?,?)
      ORDER BY ce.id,cem.reporting_team_id,cem.source_id,cem.game_id
    `).bind(...canonicalIds),
    env.DB.prepare(`
      SELECT id,canonical_event_id,conflict_type,values_json,resolved_at
      FROM event_conflicts
      WHERE canonical_event_id IN (?,?) AND resolved_at IS NULL
      ORDER BY canonical_event_id,id
    `).bind(...canonicalIds),
    env.DB.prepare(`
      SELECT team_id,wins,losses,ties,conference_wins,conference_losses,conference_ties,calculated_at
      FROM team_records WHERE team_id IN (?,?,?,?) ORDER BY team_id
    `).bind(...teamIds)
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
  return `${FINGERPRINT_PREFIX}-${hashText(JSON.stringify(classified.cases.map(item=>({key:item.key,action:item.action,current:item.current,target:item.target}))))}`;
}

export async function planFinalMissingScoreRepair(env){
  const state=await loadRepairState(env);
  const classified=classifyFinalMissingScoreRows(state.eventRows,state.conflictRows);
  const reasons=[...classified.reasons];
  if(state.d1.rows_written!==0) reasons.push(`plan unexpectedly wrote ${state.d1.rows_written} rows`);
  if(state.d1.rows_read>MAX_PLAN_READS) reasons.push(`plan read fuse exceeded: ${state.d1.rows_read} > ${MAX_PLAN_READS}`);
  return {
    fingerprint:fingerprintFor(classified),
    safe:reasons.length===0,
    reasons,
    cases:classified.cases,
    records_before:state.recordRows,
    write_scope:{canonical_events_max:2,game_rows_max:0,conflict_rows_max:0,record_rebuild_teams_max:4,direct_writes_max:MAX_DIRECT_WRITES},
    d1:state.d1
  };
}

function canonicalWhere(cases){
  return cases.map(()=>"(id=? AND home_school_id=? AND away_school_id=? AND status='FINAL' AND home_score IS NULL AND away_score=3)").join(" OR ");
}

export async function executeFinalMissingScoreRepair(env,{fingerprint,now=new Date()}={}){
  const plan=await planFinalMissingScoreRepair(env);
  if(!fingerprint||fingerprint!==plan.fingerprint) throw new Error("final-score repair fingerprint mismatch");
  if(!plan.safe) throw new Error(`final-score repair preflight unsafe: ${plan.reasons.join("; ")}`);

  const applyCases=FINAL_MISSING_SCORE_CASES.filter(item=>plan.cases.find(row=>row.key===item.key)?.action==="apply_canonical_resolution");
  if(!applyCases.length) return {status:"ALREADY_COMPLETE",fingerprint:plan.fingerprint,plan};

  const checkedAt=now.toISOString();
  const bindings=applyCases.flatMap(item=>[item.canonicalId,item.homeSchoolId,item.awaySchoolId]);
  const canonicalWrite=await env.DB.prepare(`
    UPDATE canonical_events
    SET home_score=0,away_score=3,status='FINAL',last_reconciled_at=?,updated_at=?
    WHERE ${canonicalWhere(applyCases)}
  `).bind(checkedAt,checkedAt,...bindings).run();

  const directRowsWritten=rw(canonicalWrite);
  if(directRowsWritten!==applyCases.length) throw new Error(`canonical write count mismatch: expected ${applyCases.length}, got ${directRowsWritten}`);
  if(directRowsWritten>MAX_DIRECT_WRITES) throw new Error(`direct write fuse tripped: ${directRowsWritten} > ${MAX_DIRECT_WRITES}`);

  const touchedTeamIds=[...new Set(applyCases.flatMap(item=>[item.homeTeamId,item.awayTeamId]))];
  const recordResult=await rebuildTeamRecords(env,touchedTeamIds,checkedAt);
  if(Number(recordResult?.teams||0)!==touchedTeamIds.length) throw new Error(`record rebuild team count mismatch: expected ${touchedTeamIds.length}, got ${recordResult?.teams||0}`);

  const verification=await planFinalMissingScoreRepair(env);
  const bad=verification.cases.filter(item=>item.action!=="already_complete");
  if(!verification.safe||bad.length) throw new Error(`final-score repair verification failed: ${verification.reasons.join("; ")} ${bad.map(item=>`${item.key}:${item.action}`).join(",")}`.trim());

  return {
    status:"SUCCESS",
    fingerprint,
    corrected_cases:applyCases.map(item=>item.key),
    direct_write_telemetry:{statements:1,rows_read:rr(canonicalWrite),rows_written:directRowsWritten,canonical_rows_written:directRowsWritten,game_rows_written:0,conflict_rows_written:0},
    record_result:recordResult,
    verification
  };
}

export { FINGERPRINT_PREFIX as FINAL_MISSING_SCORE_FINGERPRINT_PREFIX, MAX_PLAN_READS, MAX_DIRECT_WRITES };
