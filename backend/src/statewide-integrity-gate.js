import { buildStatewideDataIntegrityAudit } from "./statewide-data-integrity-audit.js";
import { STATEWIDE_REPAIR_CODES, applyAuditedSourceDefectSnapshot } from "./statewide-data-integrity-repair.js";
import { buildStatewideStandingsReadinessAudit } from "./standings-readiness-audit.js";

export const INTEGRITY_GATE_AUDIT_SAMPLE_LIMIT=50000;
export const INTEGRITY_GATE_MAX_PRESENTATION_ISSUES=250;

function blockingPresentationIssues(audit={}) {
  return (audit.issues||[]).filter(issue=>issue?.severity==="blocking");
}

const DEFERRED_DOWNSTREAM_CODES=new Set([
  "PAST_DUE_NONTERMINAL_DISPLAY",
  "SOURCE_FINAL_COUNT_VS_ONE_TRUTH"
]);

function sourceObservationBlockers(audit={}) {
  return blockingPresentationIssues(audit).filter(issue=>issue?.surface==="source-observation");
}

function repairableSourceIssues(audit={}) {
  return sourceObservationBlockers(audit).filter(issue=>STATEWIDE_REPAIR_CODES.has(String(issue?.code||"")));
}

function hardBlockingIssues(audit={}) {
  return blockingPresentationIssues(audit).filter(issue=>{
    const code=String(issue?.code||"");
    if(issue?.surface==="source-observation") return !STATEWIDE_REPAIR_CODES.has(code);
    return !DEFERRED_DOWNSTREAM_CODES.has(code);
  });
}

function refreshTeamIds(audit={},repair={}) {
  return [...new Set([
    ...((repair?.affected_team_ids||[]).map(String)),
    ...blockingPresentationIssues(audit)
      .filter(issue=>issue?.surface!=="source-observation" && DEFERRED_DOWNSTREAM_CODES.has(String(issue?.code||"")))
      .map(issue=>String(issue?.team_id||""))
  ].filter(Boolean))];
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
  const blockers=blockingPresentationIssues(audit);
  return {
    ...(audit.summary||{}),
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

function emptyDeferredRecordState() {
  return {
    status:"DEFERRED_TO_RECORD_TRUTH_PIPELINE",
    after:{
      blocking_issue_count:null,
      unexplained_record_contradictions:null,
      non_verified:null
    },
    rebuilt_team_ids:[],
    rebuild:{teams:0,scoredFinals:0,standings:{cohorts:0,standingsRows:0}}
  };
}

export async function persistIntegrityState(env,result,checkedAt) {
  const clean=result.status==="CLEAN";
  const pending=result.status==="REPAIRED_PENDING_VERIFY";
  const lastError=clean
    ? null
    : (
      "presentation_blockers="+Number(result.presentation?.after?.blocking_issues||0)+
      "; standings_blockers="+Number(result.standings?.summary?.blocking_issues||0)+
      (pending?"; pending_verify=1":"")+
      (result.fuses?.length?"; fuses="+result.fuses.join(","):"")
    ).slice(0,1000);
  const details=JSON.stringify({
    version:"statewide-integrity-gate-v2",
    generated_at:result.generated_at,
    reason:result.reason,
    status:result.status,
    presentation:result.presentation,
    record:result.record,
    standings:result.standings,
    repairs:result.repairs,
    fuses:result.fuses,
    blocker_examples:result.blocker_examples
  });
  const p=result.presentation?.after||{};
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
      consecutive_failures=CASE
        WHEN excluded.last_error IS NULL THEN 0
        WHEN excluded.last_error LIKE '%pending_verify=1%' THEN statewide_collection_state.consecutive_failures
        ELSE statewide_collection_state.consecutive_failures+1
      END,
      last_error=excluded.last_error,
      details_json=excluded.details_json,
      updated_at=excluded.updated_at
  `).bind(
    checkedAt,
    clean?checkedAt:null,
    Number(p.total_schedule_rows_examined||0),
    Number(p.total_normalized_schedule_rows||0),
    Number(p.total_active_teams_examined||0),
    clean?0:1,
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
  maxPresentationIssues=INTEGRITY_GATE_MAX_PRESENTATION_ISSUES,
  buildPresentationAudit=buildStatewideDataIntegrityAudit,
  repairPresentation=applyAuditedSourceDefectSnapshot,
  auditStandings=false,
  buildStandingsAudit=buildStatewideStandingsReadinessAudit,
  persistState=persistIntegrityState
}={}) {
  const checkedAt=now.toISOString();
  const audit=await buildPresentationAudit(env,{
    season,
    now,
    sampleLimit:INTEGRITY_GATE_AUDIT_SAMPLE_LIMIT
  });
  const before=presentationSummary(audit);
  const repairable=repairableSourceIssues(audit);
  const hard=hardBlockingIssues(audit);
  const deferred=blockingPresentationIssues(audit).filter(issue=>
    issue?.surface!=="source-observation"
    && DEFERRED_DOWNSTREAM_CODES.has(String(issue?.code||""))
  );
  const fuses=[];
  const repairs=[];
  let repair=null;

  let status="CLEAN";
  if(hard.length) {
    status="BLOCKED";
  } else if(repairable.length>maxPresentationIssues) {
    status="FUSE_BLOCKED";
    fuses.push("presentation:"+repairable.length+">"+maxPresentationIssues);
  } else if(repairable.length) {
    repair=await repairPresentation(env,audit,{now});
    repairs.push({
      issue_count:Number(repair.source_issue_count||repair.issue_count||0),
      issue_counts:countByCode(repairable),
      suppressed_rows:Number(repair.suppression?.rows_written||0),
      affected_teams:Array.isArray(repair.affected_team_ids)?repair.affected_team_ids.length:0,
      affected_team_ids:Array.isArray(repair.affected_team_ids)?repair.affected_team_ids:[],
      canonical:repair.canonical||null,
      score_repair:repair.score_repair||null,
      record_rebuild:repair.record_rebuild||null,
      d1:repair.d1||null
    });
    status="REPAIRED_PENDING_VERIFY";
  } else if(deferred.length) {
    status="REPAIRED_PENDING_VERIFY";
  }

  let standings={status:"NOT_RUN",summary:{conferences_examined:0,blocking_issues:0,warning_issues:0,issues_by_code:{}},issues:[],checked:[]};
  if(auditStandings) {
    standings=await buildStandingsAudit(env);
    if(Number(standings?.summary?.blocking_issues||0)>0) status="BLOCKED";
  }

  const result={
    status,
    generated_at:checkedAt,
    reason,
    season:String(season),
    presentation:{
      before,
      after:{
        ...before,
        pending_verify:status==="REPAIRED_PENDING_VERIFY"
      }
    },
    record:emptyDeferredRecordState(),
    standings,
    repairs,
    refresh_team_ids:refreshTeamIds(audit,repair),
    fuses,
    blocker_examples:{
      presentation:presentationExamples(audit),
      standings:(standings.issues||[]).filter(row=>row.severity==="blocking").slice(0,20),
      record_contradictions:[],
      record_gaps:[]
    }
  };

  result.state_write=await persistState(env,result,checkedAt);
  const logPayload={
    status,
    reason,
    presentation_blockers:Number(before.blocking_issues||0),
    repairable_source_blockers:repairable.length,
    hard_blockers:hard.length,
    deferred_downstream_blockers:deferred.length,
    repair_passes:repairs.length,
    standings_blockers:Number(standings?.summary?.blocking_issues||0),
    standings_warnings:Number(standings?.summary?.warning_issues||0),
    fuses
  };
  if(status==="CLEAN") console.log("statewide integrity gate",logPayload);
  else if(status==="REPAIRED_PENDING_VERIFY") console.log("statewide integrity gate repair queued for verify",logPayload);
  else console.error("statewide integrity gate blocked",{...logPayload,blocker_examples:result.blocker_examples});
  return result;
}
