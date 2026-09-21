import app from "./one-truth-worker.js";
import { buildStatewideRecordTruthAudit } from "./m8-final-audit/record-truth-audit.js";
import { finalizeRecordTruthAudit } from "./m8-final-audit/record-truth-audit-output.js";
import { buildM8CompletenessReport } from "./m8-final-audit/m8-completeness-report.js";
import { buildStatewideDataIntegrityAudit } from "./statewide-data-integrity-audit.js";
import { runStatewideIntegrityGate } from "./statewide-integrity-gate.js";
import { rebuildOneTruth, staleOneTruthTeamIds } from "./one-truth.js";

const RECORD_TRUTH_VIEW="record-truth";
const DATA_INTEGRITY_VIEW="data-integrity";
const FINAL_AUDIT_PATH="/api/v1/internal/m8-final-record-truth-audit-20260914-9c4f2d7e1b6a";
const FINAL_AUDIT_EXPIRES_AT=Date.parse("2026-09-15T01:00:00Z");
const LIVE_PIPELINE_CERT_PATH="/api/v1/internal/live-pipeline-cert-20260921-8f3c1d72";
const LIVE_PIPELINE_CERT_EXPIRES_AT=Date.parse("2026-09-21T20:00:00Z");
const LIVE_PIPELINE_REPAIR_PATH="/api/v1/internal/live-pipeline-repair-20260921-61c4a9ef";
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


async function runLivePipelineCertification(env) {
  const audit=await buildStatewideDataIntegrityAudit(env,{season:"2026",sampleLimit:1000});

  const recentRunsQuery=await env.DB.prepare(`
    SELECT
      cr.id AS run_id,cr.source_id,cr.started_at,cr.finished_at,cr.status,cr.http_status,cr.games_seen,
      src.team_id,src.source_type,src.parser_type,src.last_successful_fetch_at,src.last_checked_at,
      t.school_id,t.sport,t.gender,sch.name AS school_name
    FROM collection_runs cr
    JOIN sources src ON src.id=cr.source_id
    JOIN teams t ON t.id=src.team_id
    JOIN schools sch ON sch.id=t.school_id
    WHERE t.active=1
      AND t.season='2026'
      AND sch.catalog_scope='local'
      AND t.sport IN ('football','volleyball')
      AND datetime(cr.started_at)>=datetime('now','-7 days')
    ORDER BY datetime(cr.started_at) DESC,cr.id DESC
    LIMIT 300
  `).all();

  const recentFinalsQuery=await env.DB.prepare(`
    SELECT
      g.id AS game_id,g.team_id,t.school_id,sch.name AS school_name,sch.latitude,sch.longitude,
      t.sport,t.gender,t.conference_id,c.name AS conference_name,
      g.source_id,src.source_type,src.parser_type,src.last_successful_fetch_at,
      g.opponent,g.scheduled_at,g.updated_at,g.status,g.team_score,g.opponent_score,g.canonical_event_id,
      ce.status AS canonical_status,ce.home_score AS canonical_home_score,ce.away_score AS canonical_away_score,
      ce.last_reconciled_at,ce.trust_state AS canonical_trust_state,ce.conflict_count AS canonical_conflict_count,
      truth.status AS truth_status,truth.team_score AS truth_team_score,truth.opponent_score AS truth_opponent_score,
      truth.refreshed_at AS truth_game_refreshed_at,
      teamtruth.overall_record AS truth_overall_record,
      teamtruth.conference_record AS truth_conference_record,
      teamtruth.rank AS truth_rank,
      teamtruth.refreshed_at AS truth_team_refreshed_at,
      tr.calculated_at AS record_calculated_at
    FROM games g
    JOIN teams t ON t.id=g.team_id
    JOIN schools sch ON sch.id=t.school_id
    JOIN sources src ON src.id=g.source_id
    LEFT JOIN conferences c ON c.id=t.conference_id
    LEFT JOIN canonical_events ce ON ce.id=g.canonical_event_id
    LEFT JOIN ONE_TRUTH_TB truth
      ON truth.row_type='GAME'
     AND truth.team_id=g.team_id
     AND (
       (g.canonical_event_id IS NOT NULL AND truth.canonical_event_id=g.canonical_event_id)
       OR
       (g.canonical_event_id IS NULL AND truth.game_id=g.id)
     )
    LEFT JOIN ONE_TRUTH_TB teamtruth ON teamtruth.truth_id='TEAM:'||g.team_id
    LEFT JOIN team_records tr ON tr.team_id=g.team_id
    WHERE t.active=1
      AND t.season='2026'
      AND sch.catalog_scope='local'
      AND t.sport IN ('football','volleyball')
      AND g.status='FINAL'
      AND g.team_score IS NOT NULL
      AND g.opponent_score IS NOT NULL
      AND datetime(g.updated_at)>=datetime('now','-7 days')
    ORDER BY datetime(g.updated_at) DESC,g.id
    LIMIT 300
  `).all();

  const staleTruthQuery=await env.DB.prepare(`
    SELECT t.id AS team_id,t.school_id,sch.name AS school_name,t.sport,t.gender,
      MAX(COALESCE(src.last_successful_fetch_at,src.updated_at,src.created_at)) AS newest_source_at,
      ot.refreshed_at AS truth_refreshed_at
    FROM teams t
    JOIN schools sch ON sch.id=t.school_id
    LEFT JOIN sources src ON src.team_id=t.id AND src.enabled=1
    LEFT JOIN ONE_TRUTH_TB ot ON ot.truth_id='TEAM:'||t.id
    WHERE t.active=1
      AND t.season='2026'
      AND sch.catalog_scope='local'
      AND t.sport IN ('football','volleyball')
    GROUP BY t.id,t.school_id,sch.name,t.sport,t.gender,ot.refreshed_at
    HAVING ot.refreshed_at IS NULL
       OR MAX(COALESCE(src.last_successful_fetch_at,src.updated_at,src.created_at)) > ot.refreshed_at
    ORDER BY t.sport,t.id
  `).all();

  const runs=recentRunsQuery.results||[];
  const finals=recentFinalsQuery.results||[];
  const staleTruth=staleTruthQuery.results||[];
  const completeCanonical=finals.filter(row =>
    row.canonical_event_id
    && String(row.canonical_status||"").toUpperCase()==="FINAL"
    && row.canonical_home_score!=null
    && row.canonical_away_score!=null
  );
  const truthFinals=finals.filter(row =>
    String(row.truth_status||"").toUpperCase()==="FINAL"
    && row.truth_team_score!=null
    && row.truth_opponent_score!=null
  );
  const newestBySport={};
  for(const sport of ["football","volleyball"]) {
    newestBySport[sport]=finals.find(row=>row.sport===sport && row.truth_status==="FINAL")||null;
  }
  const successfulRuns=runs.filter(row=>row.status==="SUCCESS"||row.status==="NOT_MODIFIED");
  const runBySport=Object.fromEntries(["football","volleyball"].map(sport=>[
    sport,
    successfulRuns.filter(row=>row.sport===sport).slice(0,20)
  ]));

  return auditJson({
    generated_at:new Date().toISOString(),
    season:"2026",
    scheduler:{
      cloudflare_cron:"*/30 * * * *",
      recent_collection_runs:runs.length,
      recent_success_or_not_modified:successfulRuns.length,
      by_sport:runBySport
    },
    recent_finals:{
      observations:finals.length,
      canonicalized:finals.filter(row=>Boolean(row.canonical_event_id)).length,
      canonical_final_complete:completeCanonical.length,
      present_as_scored_final_in_one_truth:truthFinals.length,
      samples:finals.slice(0,40),
      newest_by_sport:newestBySport
    },
    one_truth:{
      stale_football_volleyball_teams:staleTruth.length,
      stale_samples:staleTruth.slice(0,40)
    },
    integrity:{
      active_teams:audit.summary?.total_active_teams_examined,
      source_issues:audit.summary?.upstream_source_observation_issues,
      source_codes:audit.summary?.upstream_source_issues_by_code,
      one_truth_blocking:audit.summary?.one_truth_surface_blocking_issues,
      source_vs_truth_blocking:audit.summary?.source_vs_truth_blocking_issues,
      presentation_codes:audit.summary?.issues_by_code,
      source_issue_samples:(audit.issues||[]).filter(row=>row.surface==="source-observation").slice(0,40)
    },
    d1:{
      audit:audit.d1,
      recent_runs:{
        rows_read:Number(recentRunsQuery.meta?.rows_read||0),
        rows_written:Number(recentRunsQuery.meta?.rows_written||0)
      },
      recent_finals:{
        rows_read:Number(recentFinalsQuery.meta?.rows_read||0),
        rows_written:Number(recentFinalsQuery.meta?.rows_written||0)
      },
      stale_truth:{
        rows_read:Number(staleTruthQuery.meta?.rows_read||0),
        rows_written:Number(staleTruthQuery.meta?.rows_written||0)
      }
    }
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
    const livePipelineCert=request.method==="GET"
      && url.pathname===LIVE_PIPELINE_CERT_PATH
      && Date.now()<=LIVE_PIPELINE_CERT_EXPIRES_AT;
    const livePipelineRepair=request.method==="POST"
      && url.pathname===LIVE_PIPELINE_REPAIR_PATH
      && Date.now()<=LIVE_PIPELINE_CERT_EXPIRES_AT;

    const optionsResponse=publicApiOptions(request);
    if (optionsResponse) return optionsResponse;
    if (!protectedView && !oneShot && !livePipelineCert && !livePipelineRepair) {
      const response=await app.fetch(request,env,ctx);
      return publicApiCorsResponse(request,response);
    }
    if (protectedView && !authorizedAudit(request,env)) return auditJson({error:"not_found"},404,{integrity:coverageView===DATA_INTEGRITY_VIEW});

    try {
      if (livePipelineRepair) return await runLivePipelineRepair(env);
      if (livePipelineCert) return await runLivePipelineCertification(env);
      if (coverageView===DATA_INTEGRITY_VIEW) return await runDataIntegrityAudit(env);
      return await runRecordTruthAudit(env);
    } catch (error) {
      if (coverageView===DATA_INTEGRITY_VIEW) {
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
