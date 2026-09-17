import app from "./m8-worker.js";
import { buildStatewideRecordTruthAudit } from "./m8-final-audit/record-truth-audit.js";
import { finalizeRecordTruthAudit } from "./m8-final-audit/record-truth-audit-output.js";
import { buildM8CompletenessReport } from "./m8-final-audit/m8-completeness-report.js";
import { buildStatewideDataIntegrityAudit } from "./statewide-data-integrity-audit.js";

const RECORD_TRUTH_VIEW="record-truth";
const DATA_INTEGRITY_VIEW="data-integrity";
const FINAL_AUDIT_PATH="/api/v1/internal/m8-final-record-truth-audit-20260914-9c4f2d7e1b6a";
const FINAL_AUDIT_EXPIRES_AT=Date.parse("2026-09-15T01:00:00Z");

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
  const audit=await buildStatewideDataIntegrityAudit(env,{season:"2026",sampleLimit:5000});
  return auditJson(audit,200,{integrity:true});
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

    if (!protectedView && !oneShot) return app.fetch(request,env,ctx);
    if (protectedView && !authorizedAudit(request,env)) return auditJson({error:"not_found"},404,{integrity:coverageView===DATA_INTEGRITY_VIEW});

    try {
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
