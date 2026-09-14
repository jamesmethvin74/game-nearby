import app from "./logo-bootstrap-worker.js";
import { buildResultGapAudit } from "./result-gap-audit.js";
import { buildStatewideRecordTruthAudit } from "./record-truth-audit.js";

const RESULT_GAP_VIEW = "result-gaps";
const RECORD_TRUTH_VIEW = "record-truth";

function jsonFrom(upstream, body) {
  const headers = new Headers(upstream.headers);
  headers.set("content-type","application/json; charset=utf-8");
  headers.set("x-localbleachers-m8-audit","result-gaps-v1");
  headers.delete("content-length");
  return new Response(JSON.stringify(body), {
    status:upstream.status,
    statusText:upstream.statusText,
    headers
  });
}

function auditJson(body,status=200) {
  return new Response(JSON.stringify(body),{
    status,
    headers:{
      "content-type":"application/json; charset=utf-8",
      "cache-control":"no-store",
      "access-control-allow-origin":"*",
      "x-localbleachers-record-truth-audit":"record-truth-v1"
    }
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const coverageView = request.method === "GET" && url.pathname === "/api/v1/coverage-report"
      ? url.searchParams.get("view")
      : null;

    if (coverageView === RECORD_TRUTH_VIEW) {
      try {
        return auditJson(await buildStatewideRecordTruthAudit(env,{season:"2026"}));
      } catch (error) {
        console.error("record truth audit failed",error);
        return auditJson({error:"record_truth_audit_failed",message:String(error?.message||error)},500);
      }
    }

    if (coverageView !== RESULT_GAP_VIEW) return app.fetch(request, env, ctx);

    // Reuse the existing truthful statewide snapshot. The M8 classifier is purely
    // in-memory and intentionally adds no D1 statement or write.
    const fullUrl = new URL(request.url);
    fullUrl.searchParams.delete("view");
    const upstream = await app.fetch(new Request(fullUrl.toString(), request), env, ctx);
    if (!upstream.ok) return upstream;

    let report;
    try { report = await upstream.clone().json(); }
    catch { return upstream; }
    if (!Array.isArray(report?.teams)) {
      return jsonFrom(upstream, { error:"m8_result_gap_audit_unavailable", message:"Truthful coverage snapshot did not include team evidence." });
    }
    return jsonFrom(upstream, buildResultGapAudit(report));
  },
  async scheduled(controller, env, ctx) {
    return app.scheduled(controller, env, ctx);
  }
};

export { RECORD_TRUTH_VIEW, RESULT_GAP_VIEW };
