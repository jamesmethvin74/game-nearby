import app from "./one-truth-worker.js";
import { buildStatewideRecordTruthAudit } from "./m8-final-audit/record-truth-audit.js";
import { finalizeRecordTruthAudit } from "./m8-final-audit/record-truth-audit-output.js";
import { buildM8CompletenessReport } from "./m8-final-audit/m8-completeness-report.js";
import { buildStatewideDataIntegrityAudit } from "./statewide-data-integrity-audit.js";
import { runStatewideIntegrityGate } from "./statewide-integrity-gate.js";
import { rebuildOneTruth, staleOneTruthTeamIds } from "./one-truth.js";
import { rebuildTeamRecords } from "./record-rebuild.js";
import { PRESENTATION_SUPPRESSED_NOTE } from "./current-schedule-truth.js";

const RECORD_TRUTH_VIEW="record-truth";
const DATA_INTEGRITY_VIEW="data-integrity";
const FINAL_AUDIT_PATH="/api/v1/internal/m8-final-record-truth-audit-20260914-9c4f2d7e1b6a";
const FINAL_AUDIT_EXPIRES_AT=Date.parse("2026-09-15T01:00:00Z");
const LIVE_PIPELINE_REPAIR_PATH="/api/v1/internal/live-pipeline-repair-20260921-61c4a9ef";
const LIVE_PIPELINE_REPAIR_EXPIRES_AT=Date.parse("2026-09-21T20:00:00Z");
const CONWAY_VAN_BUREN_RECOVERY_PATH="/api/v1/internal/conway-van-buren-recovery-20260921-4f8c27d1";
const CONWAY_VAN_BUREN_RECOVERY_EXPIRES_AT=Date.parse("2026-09-21T23:30:00Z");
const FINAL_SUPPRESSION_AUDIT_PATH="/api/v1/internal/final-suppression-regression-audit-20260921-a31d6c84";
const FINAL_SUPPRESSION_AUDIT_EXPIRES_AT=Date.parse("2026-09-21T23:30:00Z");\nconst PHASE1_STATEWIDE_AUDIT_PATH="/api/v1/internal/phase1-statewide-integrity-audit-20260921-8d6c2f1a";\nconst PHASE1_STATEWIDE_AUDIT_EXPIRES_AT=Date.parse("2026-09-22T04:15:00Z");
function publicApiCorsResponse(request,response) {
  const url=new URL(request.url);
  if (request.method!=="GET" || !url.pathname.startsWith("/api/v1/") || url.pathname.startsWith("/api/v1/internal/")) return response;
  const headers=new Headers(response.headers);
  headers.set("access-control-allow-origin","*");
  headers.set("access-control-allow-methods","GET, OPTIONS");
  headers.set("x-localbleachers-api-cors","outer-public-read-v1");
  headers.delete("vary");
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}

function publicApiOptions(request) {
  const url=new URL(request.url);
  if (request.method!=="OPTIONS" || !url.pathname.startsWith("/api/v1/") || url.pathname.startsWith("/api/v1/internal/")) return null;
  return new Response(null,{status:204,headers:{
    "access-control-allow-origin":"*",
    "access-control-allow-methods":"GET, OPTIONS",
    "access-control-allow-headers":"content-type",
    "cache-control":"no-store",
    "x-localbleachers-api-cors":"outer-public-read-v1"
  }});
}

function authorizedAudit(request,env) {
  return Boolean(env.REFRESH_TOKEN) && request.headers.get("x-refresh-token")===env.REFRESH_TOKEN;
}

function auditJson(body,status=200,{integrity=false}={}) {
  return new Response(JSON.stringify(body),{
    status,
    headers:{
      "content-type":"application/json; charset=utf-8",
      "cache-control":"no-store",
      "x-localbleachers-record-truth-audit":"record-truth-v1",
      ...(integrity?{"x-localbleachers-data-integrity-audit":"statewide-data-integrity-v1"}:{})
    }
  });
}

async function runRecordTruthAudit(env) {
  const audit=finalizeRecordTruthAudit(await buildStatewideRecordTruthAudit(env,{season:"2026"}));
  audit.completeness_report=buildM8CompletenessReport(audit);
  return auditJson(audit);
}

async function runDataIntegrityAudit(env) {
  const audit=await buildStatewideDataIntegrityAudit(env,{season:"2026",sampleLimit:1000});
  return auditJson(audit,200,{integrity:true});
}


async function runFinalSuppressionRegressionAudit(env) {
  const audit=await buildStatewideDataIntegrityAudit(env,{season:"2026",sampleLimit:2000});
  const relevantCodes=new Set([
    "SOURCE_FINAL_COUNT_VS_ONE_TRUTH",
    "ONE_TRUTH_TEAM_RECORD_VS_VISIBLE_FINALS",
    "RESULT_ONLY_EVIDENCE_MISSING_FROM_ONE_TRUTH",
    "ONE_TRUTH_RANK_MISMATCH"
  ]);
  const relevantIssues=(audit.issues||[]).filter(issue=>relevantCodes.has(String(issue?.code||"")));

  const {results:suppressedFinalMissing=[]}=await env.DB.prepare(`
    SELECT DISTINCT
      cem.reporting_team_id AS team_id,
      t.school_id,
      sch.name AS school_name,
      t.sport,t.gender,t.season,
      ce.id AS canonical_event_id,
      ce.scheduled_at,
      ce.home_school_id,ce.away_school_id,
      ce.home_score,ce.away_score,
      ce.trust_state,
      g.id AS member_game_id,
      g.source_id,
      g.status AS member_status,
      g.team_score AS member_team_score,
      g.opponent_score AS member_opponent_score
    FROM canonical_events ce
    JOIN canonical_event_members cem ON cem.canonical_event_id=ce.id
    JOIN games g ON g.id=cem.game_id AND g.team_id=cem.reporting_team_id
    JOIN sources src ON src.id=g.source_id
    JOIN teams t ON t.id=cem.reporting_team_id
    JOIN schools sch ON sch.id=t.school_id
    WHERE ce.status='FINAL'
      AND ce.home_score IS NOT NULL
      AND ce.away_score IS NOT NULL
      AND t.active=1
      AND t.season='2026'
      AND sch.catalog_scope='local'
      AND LOWER(COALESCE(src.id,'')) NOT LIKE '%-official-school-results'
      AND instr(COALESCE(g.notes,''),?)>0
      AND NOT EXISTS (
        SELECT 1
        FROM ONE_TRUTH_TB ot
        WHERE ot.row_type='GAME'
          AND ot.team_id=cem.reporting_team_id
          AND ot.canonical_event_id=ce.id
          AND ot.status='FINAL'
          AND ot.team_score IS NOT NULL
          AND ot.opponent_score IS NOT NULL
          AND COALESCE(ot.counts_for_record,1)<>0
      )
    ORDER BY cem.reporting_team_id,ce.scheduled_at,ce.id
  `).bind(PRESENTATION_SUPPRESSED_NOTE).all();

  const affectedTeamIds=[...new Set([
    ...relevantIssues.map(issue=>String(issue?.team_id||"")).filter(Boolean),
    ...suppressedFinalMissing.map(row=>String(row?.team_id||"")).filter(Boolean)
  ])];
  const affectedGames=[...new Set([
    ...relevantIssues.map(issue=>String(issue?.canonical_event_id||issue?.game_id||"")).filter(Boolean),
    ...suppressedFinalMissing.map(row=>String(row?.canonical_event_id||"")).filter(Boolean)
  ])];

  return auditJson({
    status:"SUCCESS",
    generated_at:new Date().toISOString(),
    statewide_active_teams:audit.summary?.total_active_teams_examined??null,
    relevant_issue_count:relevantIssues.length,
    relevant_issues:relevantIssues,
    suppressed_complete_final_missing_truth_count:suppressedFinalMissing.length,
    suppressed_complete_final_missing_truth:suppressedFinalMissing,
    affected_team_count:affectedTeamIds.length,
    affected_game_count:affectedGames.length,
    affected_team_ids:affectedTeamIds,
    affected_games:affectedGames,
    source_issue_codes:audit.summary?.upstream_source_issues_by_code||{},
    one_truth_blocking:audit.summary?.one_truth_surface_blocking_issues??null,
    source_vs_truth_blocking:audit.summary?.source_vs_truth_blocking_issues??null
  },200,{integrity:true});
}


async function runConwayVanBurenRecovery(env,ctx) {
  const teamId="conway-volleyball-2026";
  if(!env.REFRESH_TOKEN) return auditJson({status:"BLOCKED",reason:"refresh_token_missing"},500,{integrity:true});

  const {results:sources=[]}=await env.DB.prepare(`
    SELECT id,source_type,parser_type,last_successful_fetch_at,last_checked_at
    FROM sources
    WHERE enabled=1
      AND team_id=?
      AND source_type IN ('official-school','official-conference')
    ORDER BY authority_rank,source_priority,id
  `).bind(teamId).all();
  const sourceIds=sources.map(source=>String(source.id||"")).filter(Boolean);
  if(sourceIds.length<1 || sourceIds.length>16) {
    return auditJson({status:"BLOCKED",reason:"unexpected_source_scope",sources},409,{integrity:true});
  }

  const refreshResponse=await app.fetch(new Request("https://localbleachers.internal/api/v1/refresh",{
    method:"POST",
    headers:{
      "content-type":"application/json",
      "x-refresh-token":env.REFRESH_TOKEN
    },
    body:JSON.stringify({sourceIds})
  }),env,ctx);
  const refreshText=await refreshResponse.text();
  let refresh=null;
  try { refresh=JSON.parse(refreshText); } catch { refresh={raw:refreshText}; }
  if(!refreshResponse.ok || refresh?.ok!==true) {
    return auditJson({status:"REFRESH_FAILED",http_status:refreshResponse.status,sources,refresh},500,{integrity:true});
  }

  const {results:related=[]}=await env.DB.prepare(`
    SELECT DISTINCT opponent_team.id AS team_id
    FROM games g
    JOIN teams reporting_team ON reporting_team.id=g.team_id
    LEFT JOIN teams opponent_team
      ON opponent_team.school_id=g.opponent_school_id
     AND opponent_team.sport=reporting_team.sport
     AND opponent_team.gender=reporting_team.gender
     AND opponent_team.season=reporting_team.season
     AND opponent_team.active=1
    WHERE g.team_id=?
      AND lower(COALESCE(g.opponent,'')) LIKE '%van buren%'
      AND opponent_team.id IS NOT NULL
  `).bind(teamId).all();
  const teamIds=[...new Set([teamId,...related.map(row=>String(row.team_id||"")).filter(Boolean)])];

  const recordRebuild=await rebuildTeamRecords(env,teamIds,new Date().toISOString());
  const oneTruth=await rebuildOneTruth(env,{season:"2026",teamIds});

  return auditJson({
    status:"SUCCESS",
    sources,
    refresh,
    team_ids:teamIds,
    record_rebuild:recordRebuild,
    one_truth:oneTruth
  },200,{integrity:true});
}


async function runLivePipelineRepair(env) {
  const now=new Date();
  const gate=await runStatewideIntegrityGate(env,{
    season:"2026",
    now,
    reason:"live-pipeline-certification"
  });
  if(gate.status==="BLOCKED" || gate.status==="FUSE_BLOCKED") {
    return auditJson({status:"BLOCKED",gate},409,{integrity:true});
  }

  const forced=[...new Set((gate.refresh_team_ids||[]).map(String).filter(Boolean))];
  let forcedRefresh=null;
  if(forced.length) forcedRefresh=await rebuildOneTruth(env,{season:"2026",teamIds:forced});

  let batches=0;
  let staleRefreshed=0;
  while(batches<20) {
    const stale=await staleOneTruthTeamIds(env,{season:"2026",limit:64});
    if(!stale.length) break;
    await rebuildOneTruth(env,{season:"2026",teamIds:stale});
    staleRefreshed+=stale.length;
    batches++;
  }
  const remaining=await staleOneTruthTeamIds(env,{season:"2026",limit:1});
  if(remaining.length) {
    return auditJson({
      status:"STALE_DRAIN_INCOMPLETE",
      gate,
      forced_refresh:forcedRefresh,
      stale_batches:batches,
      stale_refreshed:staleRefreshed,
      remaining
    },500,{integrity:true});
  }

  const after=await buildStatewideDataIntegrityAudit(env,{season:"2026",sampleLimit:1000});
  return auditJson({
    status:"SUCCESS",
    gate,
    forced_refresh:forcedRefresh,
    stale_batches:batches,
    stale_refreshed:staleRefreshed,
    after:{
      active_teams:after.summary?.total_active_teams_examined,
      source_issues:after.summary?.upstream_source_observation_issues,
      source_codes:after.summary?.upstream_source_issues_by_code,
      one_truth_blocking:after.summary?.one_truth_surface_blocking_issues,
      source_vs_truth_blocking:after.summary?.source_vs_truth_blocking_issues,
      presentation_codes:after.summary?.issues_by_code,
      issues:after.issues
    },
    d1:after.d1
  },200,{integrity:true});
}

export default {
  async fetch(request,env,ctx) {
    const url=new URL(request.url);
    const coverageView=request.method==="GET" && url.pathname==="/api/v1/coverage-report"
      ? url.searchParams.get("view")
      : null;
    const protectedView=coverageView===RECORD_TRUTH_VIEW || coverageView===DATA_INTEGRITY_VIEW;
    const oneShot=request.method==="GET"
      && url.pathname===FINAL_AUDIT_PATH
      && Date.now()<=FINAL_AUDIT_EXPIRES_AT;
    const livePipelineRepair=request.method==="POST"
      && url.pathname===LIVE_PIPELINE_REPAIR_PATH
      && Date.now()<=LIVE_PIPELINE_REPAIR_EXPIRES_AT;
    const conwayVanBurenRecovery=request.method==="POST"
      && url.pathname===CONWAY_VAN_BUREN_RECOVERY_PATH
      && Date.now()<=CONWAY_VAN_BUREN_RECOVERY_EXPIRES_AT;
    const finalSuppressionAudit=request.method==="GET"
      && url.pathname===FINAL_SUPPRESSION_AUDIT_PATH
      && Date.now()<=FINAL_SUPPRESSION_AUDIT_EXPIRES_AT;

    const optionsResponse=publicApiOptions(request);
    if (optionsResponse) return optionsResponse;
    if (!protectedView && !oneShot && !livePipelineRepair && !conwayVanBurenRecovery && !finalSuppressionAudit && !phase1StatewideAudit) {
      const response=await app.fetch(request,env,ctx);
      return publicApiCorsResponse(request,response);
    }
    if (protectedView && !authorizedAudit(request,env)) return auditJson({error:"not_found"},404,{integrity:coverageView===DATA_INTEGRITY_VIEW});

    try {
      if (finalSuppressionAudit) return await runFinalSuppressionRegressionAudit(env);
      if (conwayVanBurenRecovery) return await runConwayVanBurenRecovery(env,ctx);
      if (livePipelineRepair) return await runLivePipelineRepair(env);
      if (coverageView===DATA_INTEGRITY_VIEW) return await runDataIntegrityAudit(env);
      return await runRecordTruthAudit(env);
    } catch (error) {
      if (coverageView===DATA_INTEGRITY_VIEW || phase1StatewideAudit) {
        console.error("statewide data integrity audit failed",error);
        return auditJson({error:"data_integrity_audit_failed",message:String(error?.message||error)},500,{integrity:true});
      }
      console.error("final M8 record truth audit failed",error);
      return auditJson({error:"record_truth_audit_failed",message:String(error?.message||error)},500);
    }
  },
  async scheduled(controller,env,ctx) {
    return app.scheduled(controller,env,ctx);
  }
};

export { DATA_INTEGRITY_VIEW, FINAL_AUDIT_EXPIRES_AT, FINAL_AUDIT_PATH };
