import app from "./logo-bootstrap-worker.js";
import { buildResultGapAudit } from "./result-gap-audit.js";
import { dryRunHighSchoolMembership,dryRunCollegeMembership,M9_DRY_RUN_SOURCES } from "./m9-membership-dry-run.js";

const RESULT_GAP_VIEW = "result-gaps";
const M9_DRY_RUN_PATH = "/api/v1/internal/m9-membership-dry-run-20260915-a3f91c2e";

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

function privateJson(body,status=200){
  return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-localbleachers-m9":"dry-run-only"}});
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if(request.method==="GET" && url.pathname===M9_DRY_RUN_PATH){
      const source=String(url.searchParams.get("source")||"").trim();
      if(!M9_DRY_RUN_SOURCES.includes(source)) return privateJson({error:"invalid_source",allowed:M9_DRY_RUN_SOURCES},400);
      try{
        const result=source==="college"?await dryRunCollegeMembership(env):await dryRunHighSchoolMembership(env,source);
        if(Number(result?.d1?.rows_written||0)!==0) return privateJson({error:"dry_run_write_guard",result},500);
        return privateJson(result);
      }catch(error){
        return privateJson({error:"m9_dry_run_failed",source,message:String(error?.message||error)},500);
      }
    }

    const wantsResultGaps = request.method === "GET"
      && url.pathname === "/api/v1/coverage-report"
      && url.searchParams.get("view") === RESULT_GAP_VIEW;

    if (!wantsResultGaps) return app.fetch(request, env, ctx);

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

export { M9_DRY_RUN_PATH, RESULT_GAP_VIEW };
