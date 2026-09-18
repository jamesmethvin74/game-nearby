import { buildStatewideDataIntegrityAudit } from "./statewide-data-integrity-audit.js";
import { STATEWIDE_REPAIR_CODES, repairAuditedPresentationDefects } from "./statewide-data-integrity-repair.js";
import { buildStatewideRecordTruthAudit } from "./record-truth-audit.js";
import { finalizeRecordTruthAudit } from "./record-truth-audit-output.js";
import { rebuildTeamRecords } from "./record-rebuild.js";

export const INTEGRITY_GATE_AUDIT_SAMPLE_LIMIT=50000;
export const INTEGRITY_GATE_MAX_REPAIR_PASSES=2;
export const INTEGRITY_GATE_MAX_PRESENTATION_ISSUES=250;
export const INTEGRITY_GATE_MAX_RECORD_REBUILD_TEAMS=250;

const RECORD_MATERIALIZATION_CODES=new Set([
  "STALE_RECORD_ROW",
  "STALE_STORED_RECORD",
  "STALE_STORED_RECORD_CONTRADICTS_FINAL_EVIDENCE",
  "STALE_STORED_CONFERENCE_RECORD_CONTRADICTS_FINAL_EVIDENCE",
  "MATERIALIZED_STANDING_RECORD_CONTRADICTION",
  "MATERIALIZED_CONFERENCE_RECORD_CONTRADICTION"
]);

function blockingPresentationIssues(audit={}) {
  return (audit.issues||[]).filter(issue=>issue?.severity==="blocking");
}

function repairablePresentationIssues(audit={}) {
  return blockingPresentationIssues(audit).filter(issue=>STATEWIDE_REPAIR_CODES.has(issue.code));
}

export function recordBlockingIssues(audit={}) {
  const output=[];
  for(const team of audit.teams||[]) {
    for(const issue of team.issues||[]) {
      if(issue?.severity!=="blocking" || issue?.resolved===true) continue;
      output.push({
        team_id:team.team_id||null,
        school_name:team.school_name||null,
        sport:team.sport||null,
        gender:team.gender||null,
        code:issue.code||"UNKNOWN",
        detail:issue.detail||""
      });
    }
  }
  return output;
}

export function recordMaterializationRepairTeamIds(audit={}) {
  const ids=[];
  for(const team of audit.teams||[]) {
    if(team?.public_record_verified!==true || !team?.team_id) continue;
    const repairable=(team.issues||[]).some(issue=>RECORD_MATERIALIZATION_CODES.has(String(issue?.code||"")));
    if(repairable) ids.push(String(team.team_id));
  }
  return [...new Set(ids)];
}

function countByCode(issues=[]) {
  const counts={};
  for(const issue of issues) {
    const code=String(issue?.code||"UNKNOWN");
    counts[code]=(counts[code]||0)+1;
  }
  return counts;
}

function presentationSummary(audit={}) {
  const blocking=blockingPresentationIssues(audit);
  return {
    ...(audit.summary||{}),
    blocking_issue_counts:countByCode(blocking)
  };
}

function recordSummary(audit={}) {
  const blockers=recordBlockingIssues(audit);
  return {
    ...(audit.summary||{}),
    blocking_issue_count:blockers.length,
    blocking_issue_counts:countByCode(blockers)
  };
}

function presentationExamples(audit={},limit=20) {
  return blockingPresentationIssues(audit).slice(0,limit).map(issue=>({
    team_id:issue.team_id||null,
    school_name:issue.school_name||null,
    sport:issue.sport||null,
    code:issue.code||null,
    game_id:issue.game_id||null,
    other_game_id:issue.other_game_id||null,
    detail:issue.detail||null
  }));
}

function recordExamples(audit={},limit=20) {
  return recordBlockingIssues(audit).slice(0,limit);
}

function summarizeRepair(repair={}) {
  return {
    before_blocking:Number(repair.before_blocking||0),
    canonical:repair.canonical||null,
    score_promotions:Array.isArray(repair.score_repair?.promoted)?repair.score_repair.promoted.length:0,
    suppressed_rows:Number(repair.suppression?.rows_written||0),
    affected_teams:Array.isArray(repair.affected_team_ids)?repair.affected_team_ids.length:0,
    record_rebuild:repair.record_rebuild||null,
    d1:repair.d1||null,
    after_summary:repair.after_summary||null
  };
}

async function persistIntegrityState(env,result,checkedAt) {
  const clean=result.status==="CLEAN";
  const lastError=clean
    ? null
    : (
      "presentation_blockers="+result.presentation.after.blocking_issues+
      "; record_blocking_issues="+result.record.after.blocking_issue_count+
      "; unexplained_record_contradictions="+Number(result.record.after.unexplained_record_contradictions||0)+
      (result.fuses.length?"; fuses="+result.fuses.join(","):"")
    ).slice(0,1000);
  const details=JSON.stringify({
    version:"statewide-integrity-gate-v1",
    generated_at:result.generated_at,
    reason:result.reason,
    status:result.status,
    presentation:result.presentation,
    record:result.record,
    repairs:result.repairs,
    fuses:result.fuses,
    blocker_examples:result.blocker_examples
  });
  const p=result.presentation.after;
  const initialFailures=clean?0:1;
  const response=await env.DB.prepare(`
    INSERT INTO statewide_collection_state(
      id,provider,feed_url,last_checked_at,last_successful_fetch_at,
      last_event_count,last_observation_count,last_source_count,
      consecutive_failures,last_error,details_json,updated_at
    )
    VALUES(
      'localbleachers:statewide-integrity:2026',
      'localbleachers-integrity',
      'internal://statewide-integrity',
      ?,?,?,?,?,?,?,?,?
    )
    ON CONFLICT(id) DO UPDATE SET
      provider=excluded.provider,
      feed_url=excluded.feed_url,
      last_checked_at=excluded.last_checked_at,
      last_successful_fetch_at=COALESCE(excluded.last_successful_fetch_at,statewide_collection_state.last_successful_fetch_at),
      last_event_count=excluded.last_event_count,
      last_observation_count=excluded.last_observation_count,
      last_source_count=excluded.last_source_count,
      consecutive_failures=CASE WHEN excluded.last_error IS NULL THEN 0 ELSE statewide_collection_state.consecutive_failures+1 END,
      last_error=excluded.last_error,
      details_json=excluded.details_json,
      updated_at=excluded.updated_at
  `).bind(
    checkedAt,
    clean?checkedAt:null,
    Number(p.total_schedule_rows_examined||0),
    Number(p.total_normalized_schedule_rows||0),
    Number(p.total_active_teams_examined||0),
    initialFailures,
    lastError,
    details,
    checkedAt
  ).run();
  const meta=response?.meta||{};
  return {
    rows_read:Number(meta.rows_read||0),
    rows_written:Number(meta.rows_written||0),
    duration_ms:Number(meta.duration||0)||0
  };
}

export async function runStatewideIntegrityGate(env,{
  season="2026",
  now=new Date(),
  reason="scheduled",
  maxRepairPasses=INTEGRITY_GATE_MAX_REPAIR_PASSES,
  maxPresentationIssues=INTEGRITY_GATE_MAX_PRESENTATION_ISSUES,
  maxRecordRebuildTeams=INTEGRITY_GATE_MAX_RECORD_REBUILD_TEAMS,
  buildPresentationAudit=buildStatewideDataIntegrityAudit,
  repairPresentation=repairAuditedPresentationDefects,
  buildRecordAudit=buildStatewideRecordTruthAudit,
  finalizeRecordAudit=finalizeRecordTruthAudit,
  rebuildRecords=rebuildTeamRecords,
  persistState=persistIntegrityState
}={}) {
  const checkedAt=now.toISOString();
  const auditOptions={season,now,sampleLimit:INTEGRITY_GATE_AUDIT_SAMPLE_LIMIT};
  let presentation=await buildPresentationAudit(env,auditOptions);
  const presentationBefore=presentationSummary(presentation);
  const repairs=[];
  const fuses=[];

  for(let pass=1;pass<=Math.max(0,Number(maxRepairPasses)||0);pass++) {
    const repairable=repairablePresentationIssues(presentation);
    if(!repairable.length) break;
    if(repairable.length>maxPresentationIssues) {
      fuses.push("presentation:"+repairable.length+">"+maxPresentationIssues);
      break;
    }
    const repair=await repairPresentation(env,presentation,{
      now,
      rebuildAudit:()=>buildPresentationAudit(env,auditOptions)
    });
    repairs.push({pass,...summarizeRepair(repair)});
    presentation=repair.after_audit||await buildPresentationAudit(env,auditOptions);
    if(!blockingPresentationIssues(presentation).length) break;
  }

  let recordAudit=finalizeRecordAudit(await buildRecordAudit(env,{season,now}));
  const recordBefore=recordSummary(recordAudit);
  const rebuildIds=recordMaterializationRepairTeamIds(recordAudit);
  let recordRebuild={teams:0,scoredFinals:0,standings:{cohorts:0,standingsRows:0}};

  if(rebuildIds.length) {
    if(rebuildIds.length>maxRecordRebuildTeams) {
      fuses.push("record-rebuild:"+rebuildIds.length+">"+maxRecordRebuildTeams);
    } else {
      recordRebuild=await rebuildRecords(env,rebuildIds,checkedAt);
      recordAudit=finalizeRecordAudit(await buildRecordAudit(env,{season,now}));
    }
  }

  const presentationAfter=presentationSummary(presentation);
  const recordAfter=recordSummary(recordAudit);
  const unexplainedRecordContradictions=Number(recordAudit.summary?.unexplained_record_contradictions||0);
  const clean=Number(presentationAfter.blocking_issues||0)===0
    && Number(recordAfter.blocking_issue_count||0)===0
    && unexplainedRecordContradictions===0
    && fuses.length===0;

  const result={
    status:clean?"CLEAN":fuses.length?"FUSE_BLOCKED":"BLOCKED",
    generated_at:checkedAt,
    reason,
    season:String(season),
    presentation:{
      before:presentationBefore,
      after:presentationAfter
    },
    record:{
      before:recordBefore,
      after:{
        ...recordAfter,
        unexplained_record_contradictions:unexplainedRecordContradictions,
        non_verified:Number(recordAudit.summary?.non_verified||0)
      },
      rebuilt_team_ids:rebuildIds,
      rebuild:recordRebuild
    },
    repairs,
    fuses,
    blocker_examples:{
      presentation:presentationExamples(presentation),
      record:recordExamples(recordAudit)
    }
  };

  result.state_write=await persistState(env,result,checkedAt);

  const logPayload={
    status:result.status,
    reason,
    presentation_before:Number(presentationBefore.blocking_issues||0),
    presentation_after:Number(presentationAfter.blocking_issues||0),
    record_blocking:Number(recordAfter.blocking_issue_count||0),
    unexplained_record_contradictions:unexplainedRecordContradictions,
    repair_passes:repairs.length,
    record_rebuild_teams:Number(recordRebuild?.teams||0),
    fuses
  };
  if(clean) console.log("statewide integrity gate",logPayload);
  else console.error("statewide integrity gate blocked",{...logPayload,blocker_examples:result.blocker_examples});
  return result;
}

export { persistIntegrityState };
