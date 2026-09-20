import app from "./one-truth-worker.js";
import { buildStatewideRecordTruthAudit } from "./m8-final-audit/record-truth-audit.js";
import { finalizeRecordTruthAudit } from "./m8-final-audit/record-truth-audit-output.js";
import { buildM8CompletenessReport } from "./m8-final-audit/m8-completeness-report.js";
import { buildStatewideDataIntegrityAudit } from "./statewide-data-integrity-audit.js";
import { repairAuditedPresentationDefects } from "./statewide-data-integrity-repair.js";
import { rebuildOneTruth } from "./one-truth.js";

const RECORD_TRUTH_VIEW="record-truth";
const DATA_INTEGRITY_VIEW="data-integrity";
const FINAL_AUDIT_PATH="/api/v1/internal/m8-final-record-truth-audit-20260914-9c4f2d7e1b6a";
const FINAL_AUDIT_EXPIRES_AT=Date.parse("2026-09-15T01:00:00Z");
const SOURCE_REPAIR_PATH="/api/v1/internal/source-reconcile-20260920-6e8d4b2a";
const SOURCE_REPAIR_EXPIRES_AT=Date.parse("2026-09-21T05:00:00Z");
const SOURCE_REPAIR_RUN_ID="one-shot:source-reconcile-20260920-6e8d4b2a";
const SOURCE_REPAIR_STATUS_PATH="/api/v1/internal/source-reconcile-status-20260920-6e8d4b2a";

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

async function sourceReconciliationStatus(env) {
  const row=await env.DB.prepare(`
    SELECT id,last_checked_at,last_successful_fetch_at,last_error,details_json,updated_at
    FROM statewide_collection_state
    WHERE id=?
  `).bind(SOURCE_REPAIR_RUN_ID).first();
  let details=null;
  try { details=row?.details_json?JSON.parse(row.details_json):null; } catch {}
  return auditJson({
    status:details?.status || (row ? "UNKNOWN" : "NOT_STARTED"),
    last_checked_at:row?.last_checked_at || null,
    last_successful_fetch_at:row?.last_successful_fetch_at || null,
    last_error:row?.last_error || null,
    updated_at:row?.updated_at || null,
    details
  },200,{integrity:true});
}

async function runSourceReconciliation(env) {
  const startedAt=new Date().toISOString();
  const claim=await env.DB.prepare(`
    INSERT OR IGNORE INTO statewide_collection_state
      (id,provider,feed_url,last_checked_at,details_json,updated_at)
    VALUES(?,'localbleachers-system',?, ?, ?, ?)
  `).bind(
    SOURCE_REPAIR_RUN_ID,
    SOURCE_REPAIR_PATH,
    startedAt,
    JSON.stringify({status:"RUNNING",started_at:startedAt}),
    startedAt
  ).run();
  if(Number(claim?.meta?.changes||claim?.changes||0)!==1) {
    const prior=await env.DB.prepare("SELECT details_json,last_successful_fetch_at,last_error FROM statewide_collection_state WHERE id=?")
      .bind(SOURCE_REPAIR_RUN_ID).first();
    return auditJson({
      status:"ALREADY_CLAIMED",
      prior:prior||null
    },409,{integrity:true});
  }

  try {
    const before=await buildStatewideDataIntegrityAudit(env,{season:"2026",sampleLimit:1000});
    const repair=await repairAuditedPresentationDefects(env,before,{
      rebuildAudit:()=>buildStatewideDataIntegrityAudit(env,{season:"2026",sampleLimit:1000})
    });
    const oneTruth=await rebuildOneTruth(env,{season:"2026"});
    const after=await buildStatewideDataIntegrityAudit(env,{season:"2026",sampleLimit:1000});
    const completedAt=new Date().toISOString();
    const summary={
      status:"EXECUTED",
      started_at:startedAt,
      completed_at:completedAt,
      before_summary:before.summary,
      repair:{
        before_blocking:repair.before_blocking,
        canonical:repair.canonical,
        score_repair:repair.score_repair,
        suppression:repair.suppression,
        affected_team_ids:repair.affected_team_ids,
        record_rebuild:repair.record_rebuild,
        after_summary:repair.after_summary,
        after_issue_counts:repair.after_issue_counts,
        d1:repair.d1
      },
      one_truth_rebuild:oneTruth,
      after_summary:after.summary,
      remaining_issues:after.issues
    };
    await env.DB.prepare(`
      UPDATE statewide_collection_state
      SET last_checked_at=?,last_successful_fetch_at=?,last_error=NULL,details_json=?,updated_at=?
      WHERE id=?
    `).bind(completedAt,completedAt,JSON.stringify({
      status:"COMPLETE",
      completed_at:completedAt,
      before_source_issues:Number(before.summary?.upstream_source_observation_issues||0),
      after_source_issues:Number(after.summary?.upstream_source_observation_issues||0),
      after_one_truth_blocking:Number(after.summary?.one_truth_surface_blocking_issues||0),
      after_source_vs_truth_blocking:Number(after.summary?.source_vs_truth_blocking_issues||0)
    }),completedAt,SOURCE_REPAIR_RUN_ID).run();
    return auditJson(summary,200,{integrity:true});
  } catch(error) {
    await env.DB.prepare("DELETE FROM statewide_collection_state WHERE id=?").bind(SOURCE_REPAIR_RUN_ID).run();
    throw error;
  }
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
    const sourceRepair=request.method==="POST"
      && url.pathname===SOURCE_REPAIR_PATH
      && Date.now()<=SOURCE_REPAIR_EXPIRES_AT;
    const sourceRepairStatus=request.method==="GET"
      && url.pathname===SOURCE_REPAIR_STATUS_PATH
      && Date.now()<=SOURCE_REPAIR_EXPIRES_AT;

    const optionsResponse=publicApiOptions(request);
    if (optionsResponse) return optionsResponse;
    if (!protectedView && !oneShot && !sourceRepair && !sourceRepairStatus) {
      const response=await app.fetch(request,env,ctx);
      return publicApiCorsResponse(request,response);
    }
    if (protectedView && !authorizedAudit(request,env)) return auditJson({error:"not_found"},404,{integrity:coverageView===DATA_INTEGRITY_VIEW});

    try {
      if (sourceRepairStatus) return await sourceReconciliationStatus(env);
      if (sourceRepair) return await runSourceReconciliation(env);
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

export { DATA_INTEGRITY_VIEW, FINAL_AUDIT_EXPIRES_AT, FINAL_AUDIT_PATH, SOURCE_REPAIR_EXPIRES_AT, SOURCE_REPAIR_PATH, SOURCE_REPAIR_STATUS_PATH };
