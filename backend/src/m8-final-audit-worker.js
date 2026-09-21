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
const LIVE_PIPELINE_REPAIR_PATH="/api/v1/internal/live-pipeline-repair-20260921-61c4a9ef";
const LIVE_PIPELINE_REPAIR_EXPIRES_AT=Date.parse("2026-09-21T20:00:00Z");
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

    const optionsResponse=publicApiOptions(request);
    if (optionsResponse) return optionsResponse;
    if (!protectedView && !oneShot && !livePipelineRepair) {
      const response=await app.fetch(request,env,ctx);
      return publicApiCorsResponse(request,response);
    }
    if (protectedView && !authorizedAudit(request,env)) return auditJson({error:"not_found"},404,{integrity:coverageView===DATA_INTEGRITY_VIEW});

    try {
      if (livePipelineRepair) return await runLivePipelineRepair(env);
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
