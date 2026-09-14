import app from "./m8-worker.js";
import { buildStatewideRecordTruthAudit } from "./m8-final-audit/record-truth-audit.js";
import { finalizeRecordTruthAudit } from "./m8-final-audit/record-truth-audit-output.js";
import { buildM8CompletenessReport } from "./m8-final-audit/m8-completeness-report.js";

const RECORD_TRUTH_VIEW="record-truth";

function authorizedAudit(request,env) {
  return Boolean(env.REFRESH_TOKEN) && request.headers.get("x-refresh-token")===env.REFRESH_TOKEN;
}

function auditJson(body,status=200) {
  return new Response(JSON.stringify(body),{
    status,
    headers:{
      "content-type":"application/json; charset=utf-8",
      "cache-control":"no-store",
      "x-localbleachers-record-truth-audit":"record-truth-v1"
    }
  });
}

export default {
  async fetch(request,env,ctx) {
    const url=new URL(request.url);
    const wantsAudit=request.method==="GET"
      && url.pathname==="/api/v1/coverage-report"
      && url.searchParams.get("view")===RECORD_TRUTH_VIEW;
    if (!wantsAudit) return app.fetch(request,env,ctx);
    if (!authorizedAudit(request,env)) return auditJson({error:"not_found"},404);
    try {
      const audit=finalizeRecordTruthAudit(await buildStatewideRecordTruthAudit(env,{season:"2026"}));
      audit.completeness_report=buildM8CompletenessReport(audit);
      return auditJson(audit);
    } catch (error) {
      console.error("final M8 record truth audit failed",error);
      return auditJson({error:"record_truth_audit_failed",message:String(error?.message||error)},500);
    }
  },
  async scheduled(controller,env,ctx) {
    return app.scheduled(controller,env,ctx);
  }
};
