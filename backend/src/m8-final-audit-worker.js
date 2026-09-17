import app from "./m8-worker.js";
import { buildStatewideRecordTruthAudit } from "./m8-final-audit/record-truth-audit.js";
import { finalizeRecordTruthAudit } from "./m8-final-audit/record-truth-audit-output.js";
import { buildM8CompletenessReport } from "./m8-final-audit/m8-completeness-report.js";
import { buildStatewideDataIntegrityAudit } from "./statewide-data-integrity-audit.js";
import { reconcileAuditedCanonicalDefects } from "./statewide-data-integrity-repair.js";
import { executeFinalMissingScoreRepair, planFinalMissingScoreRepair } from "./final-missing-score-repair.js";

const RECORD_TRUTH_VIEW="record-truth";
const DATA_INTEGRITY_VIEW="data-integrity";
const FINAL_AUDIT_PATH="/api/v1/internal/m8-final-record-truth-audit-20260914-9c4f2d7e1b6a";
const FINAL_AUDIT_EXPIRES_AT=Date.parse("2026-09-15T01:00:00Z");
const M15_PATH="/api/v1/internal/m15-statewide-repair-20260917-4c8e2f7a91bd";
const M15_FINGERPRINT="m15-statewide-presentation-repair-1426-364-20260917";
const M15_TRANSPORT_VERSION="m15-v3";
const M15_CODES=new Set([
  "SPLIT_CANONICAL_LOGICAL_GAME",
  "STALE_NONTERMINAL_TWIN_OF_FINAL",
  "DUPLICATE_SCHEDULE_ENTRY",
  "DISPLAY_FINAL_MISSING_SCORE",
  "PAST_DUE_NONTERMINAL_DISPLAY"
]);

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

async function loadM15Sources(request,env,ctx) {
  const sourcesResponse=await app.fetch(new Request(new URL("/api/v1/sources",request.url),{method:"GET"}),env,ctx);
  if(!sourcesResponse.ok) throw new Error(`M15 sources lookup failed: ${sourcesResponse.status}`);
  const sourcesPayload=await sourcesResponse.json();
  return Array.isArray(sourcesPayload.sources)?sourcesPayload.sources:[];
}

function m15IssueCounts(audit) {
  const byCode={};
  for(const issue of audit.issues||[]) {
    if(issue.severity!=="blocking"||!M15_CODES.has(issue.code)) continue;
    byCode[issue.code]=(byCode[issue.code]||0)+1;
  }
  return byCode;
}

async function buildM15Plan(request,env,ctx) {
  const audit=await buildStatewideDataIntegrityAudit(env,{season:"2026",sampleLimit:5000});
  const blocking=(audit.issues||[]).filter(issue=>issue.severity==="blocking"&&M15_CODES.has(issue.code));
  const affectedTeamIds=[...new Set(blocking.map(issue=>String(issue.team_id||"")).filter(Boolean))];
  const affectedTeams=new Set(affectedTeamIds);
  const sources=await loadM15Sources(request,env,ctx);
  const sourceIds=[...new Set(sources
    .filter(source=>affectedTeams.has(String(source.team_id||"")))
    .map(source=>String(source.id||""))
    .filter(Boolean))];
  return {audit,blocking,affectedTeamIds,sourceIds,byCode:m15IssueCounts(audit)};
}

async function runM15CanonicalRepair(env) {
  const before=await buildStatewideDataIntegrityAudit(env,{season:"2026",sampleLimit:5000});
  const repair=await reconcileAuditedCanonicalDefects(env,before);
  const after=await buildStatewideDataIntegrityAudit(env,{season:"2026",sampleLimit:5000});
  return {
    status:"EXECUTED",
    fingerprint:M15_FINGERPRINT,
    transport_version:M15_TRANSPORT_VERSION,
    action:"canonical-reconcile",
    before:{summary:before.summary,d1:before.d1,issue_counts:m15IssueCounts(before)},
    repair,
    after:{summary:after.summary,d1:after.d1,issue_counts:m15IssueCounts(after)}
  };
}

async function runM15MissingScoreRepair(env) {
  const before=await buildStatewideDataIntegrityAudit(env,{season:"2026",sampleLimit:5000});
  const plan=await planFinalMissingScoreRepair(env);
  if(!plan.safe) {
    return {
      status:"UNSAFE",
      fingerprint:M15_FINGERPRINT,
      transport_version:M15_TRANSPORT_VERSION,
      action:"missing-score-repair",
      before:{summary:before.summary,d1:before.d1,issue_counts:m15IssueCounts(before)},
      plan
    };
  }
  const repair=await executeFinalMissingScoreRepair(env,{fingerprint:plan.fingerprint});
  const after=await buildStatewideDataIntegrityAudit(env,{season:"2026",sampleLimit:5000});
  return {
    status:"EXECUTED",
    fingerprint:M15_FINGERPRINT,
    transport_version:M15_TRANSPORT_VERSION,
    action:"missing-score-repair",
    before:{summary:before.summary,d1:before.d1,issue_counts:m15IssueCounts(before)},
    plan,
    repair,
    after:{summary:after.summary,d1:after.d1,issue_counts:m15IssueCounts(after)}
  };
}

async function runM15Transport(request,env,ctx) {
  if(request.method==="GET") {
    const plan=await buildM15Plan(request,env,ctx);
    return auditJson({
      status:"READY",
      fingerprint:M15_FINGERPRINT,
      transport_version:M15_TRANSPORT_VERSION,
      summary:plan.audit.summary,
      d1:plan.audit.d1,
      issue_counts:plan.byCode,
      blocking_issue_rows:plan.blocking.length,
      affected_team_ids:plan.affectedTeamIds,
      source_ids:plan.sourceIds
    },200,{integrity:true});
  }
  if(request.method!=="POST") return auditJson({error:"not_found"},404,{integrity:true});
  const body=await request.json().catch(()=>({}));
  if(body.fingerprint!==M15_FINGERPRINT||body.transport_version!==M15_TRANSPORT_VERSION) {
    return auditJson({error:"not_found"},404,{integrity:true});
  }

  if(body.action==="canonical-reconcile") {
    const result=await runM15CanonicalRepair(env);
    return auditJson(result,200,{integrity:true});
  }
  if(body.action==="missing-score-repair") {
    const result=await runM15MissingScoreRepair(env);
    return auditJson(result,result.status==="UNSAFE"?409:200,{integrity:true});
  }

  const sourceIds=[...new Set((Array.isArray(body.sourceIds)?body.sourceIds:[]).map(String).filter(Boolean))];
  if(sourceIds.length<1||sourceIds.length>16) return auditJson({error:"invalid_source_batch"},400,{integrity:true});

  const sources=await loadM15Sources(request,env,ctx);
  const enabledSourceIds=new Set(sources.map(source=>String(source?.id||"")).filter(Boolean));
  const rejected=sourceIds.filter(id=>!enabledSourceIds.has(id));
  if(rejected.length) return auditJson({error:"unknown_or_disabled_source",rejected},409,{integrity:true});
  if(!env.REFRESH_TOKEN) return auditJson({error:"refresh_token_unavailable"},503,{integrity:true});

  const refreshRequest=new Request(new URL("/api/v1/refresh",request.url),{
    method:"POST",
    headers:{"content-type":"application/json","x-refresh-token":env.REFRESH_TOKEN},
    body:JSON.stringify({sourceIds,force:true,reason:"m15-statewide-repair"})
  });
  const refreshResponse=await app.fetch(refreshRequest,env,ctx);
  const text=await refreshResponse.text();
  let payload={};
  try{payload=text?JSON.parse(text):{};}catch{payload={raw:text.slice(0,2000)};}
  return auditJson({
    status:refreshResponse.ok?"EXECUTED":"FAILED",
    fingerprint:M15_FINGERPRINT,
    transport_version:M15_TRANSPORT_VERSION,
    action:"authoritative-refresh",
    source_ids:sourceIds,
    refresh_status:refreshResponse.status,
    refresh:payload
  },refreshResponse.ok?200:refreshResponse.status,{integrity:true});
}

async function runDataIntegrityAudit(env) {
  const audit=await buildStatewideDataIntegrityAudit(env,{season:"2026",sampleLimit:5000});
  return auditJson(audit,200,{integrity:true});
}

export default {
  async fetch(request,env,ctx) {
    const url=new URL(request.url);
    if(url.pathname===M15_PATH) {
      try{return await runM15Transport(request,env,ctx);}catch(error){
        console.error("M15 statewide repair transport failed",error);
        return auditJson({error:"m15_transport_failed",message:String(error?.message||error)},500,{integrity:true});
      }
    }
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

export { DATA_INTEGRITY_VIEW, FINAL_AUDIT_EXPIRES_AT, FINAL_AUDIT_PATH, M15_FINGERPRINT, M15_PATH, M15_TRANSPORT_VERSION };
