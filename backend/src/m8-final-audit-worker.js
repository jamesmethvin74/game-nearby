import app from "./m8-worker.js";
import { buildStatewideRecordTruthAudit } from "./m8-final-audit/record-truth-audit.js";
import { finalizeRecordTruthAudit } from "./m8-final-audit/record-truth-audit-output.js";
import { buildM8CompletenessReport } from "./m8-final-audit/m8-completeness-report.js";
import { buildStatewideDataIntegrityAudit } from "./statewide-data-integrity-audit.js";
import { reconcileAuditedCanonicalDefects } from "./statewide-data-integrity-repair.js";
import { executeFinalMissingScoreRepair, planFinalMissingScoreRepair } from "./final-missing-score-repair.js";
import { runCertifiedDragonFlyStatewideCollection } from "./dragonfly-certified-statewide.js";
import { statewideSportConfig } from "./statewide-sport-config.js";

const RECORD_TRUTH_VIEW="record-truth";
const DATA_INTEGRITY_VIEW="data-integrity";
const FINAL_AUDIT_PATH="/api/v1/internal/m8-final-record-truth-audit-20260914-9c4f2d7e1b6a";
const FINAL_AUDIT_EXPIRES_AT=Date.parse("2026-09-15T01:00:00Z");
const M15_PATH="/api/v1/internal/m15-statewide-repair-20260917-4c8e2f7a91bd";
const M15_FINGERPRINT="m15-statewide-presentation-repair-1426-364-20260917";
const M15_TRANSPORT_VERSION="m15-v4";

const M15_STATEWIDE_KEYS=new Set(["football-boys","volleyball-girls","basketball-boys","basketball-girls","soccer-boys","soccer-girls"]);
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

async function loadM15OverdueBreakdown(env,issues=[]) {
  const ids=[...new Set(issues
    .filter(issue=>issue?.severity==="blocking"&&issue?.code==="PAST_DUE_NONTERMINAL_DISPLAY")
    .map(issue=>String(issue.game_id||""))
    .filter(Boolean))];
  if(!ids.length) return {rows:[],d1:{rows_read:0,rows_written:0}};
  const query=await env.DB.prepare(`
    WITH requested_games(id) AS (
      SELECT CAST(value AS TEXT)
      FROM json_each(?)
    )
    SELECT
      COALESCE(g.source_id,'') AS source_id,
      COALESCE(src.source_type,'none') AS source_type,
      COALESCE(src.parser_type,'none') AS parser_type,
      COALESCE(src.collection_mode,'none') AS collection_mode,
      COALESCE(src.enabled,0) AS source_enabled,
      COALESCE(src.authority_rank,999) AS authority_rank,
      t.sport,
      sch.level,
      UPPER(COALESCE(ce.status,g.status,'SCHEDULED')) AS effective_status,
      COUNT(*) AS game_rows,
      COUNT(DISTINCT g.team_id) AS teams,
      MIN(g.scheduled_at) AS oldest_scheduled_at,
      MAX(g.scheduled_at) AS newest_scheduled_at
    FROM requested_games requested
    JOIN games g ON g.id=requested.id
    JOIN teams t ON t.id=g.team_id
    JOIN schools sch ON sch.id=t.school_id
    LEFT JOIN sources src ON src.id=g.source_id
    LEFT JOIN canonical_events ce ON ce.id=g.canonical_event_id
    GROUP BY
      COALESCE(g.source_id,''),COALESCE(src.source_type,'none'),COALESCE(src.parser_type,'none'),
      COALESCE(src.collection_mode,'none'),COALESCE(src.enabled,0),COALESCE(src.authority_rank,999),
      t.sport,sch.level,UPPER(COALESCE(ce.status,g.status,'SCHEDULED'))
    ORDER BY game_rows DESC,source_id,t.sport,sch.level`)
    .bind(JSON.stringify(ids)).all();
  const meta=query?.meta||{};
  return {
    rows:query?.results||[],
    d1:{
      rows_read:meta.rows_read==null?null:Number(meta.rows_read),
      rows_written:meta.rows_written==null?0:Number(meta.rows_written),
      duration_ms:meta.duration==null?null:Number(meta.duration)
    }
  };
}

async function loadM15DefectDetails(env,issues=[]) {
  const relevant=issues.filter(issue=>issue?.severity==="blocking"&&issue?.code!=="PAST_DUE_NONTERMINAL_DISPLAY");
  const ids=[...new Set(relevant.flatMap(issue=>[issue.game_id,issue.other_game_id]).map(String).filter(Boolean))];
  if(!ids.length) return {issues:relevant,rows:[],d1:{rows_read:0,rows_written:0}};
  const query=await env.DB.prepare(`
    WITH requested_games(id) AS (
      SELECT CAST(value AS TEXT)
      FROM json_each(?)
    )
    SELECT
      g.id AS game_id,g.team_id,g.source_id,g.opponent,g.opponent_school_id,
      g.scheduled_at AS raw_scheduled_at,g.scheduled_time_known AS raw_time_known,
      g.status AS raw_status,g.team_score AS raw_team_score,g.opponent_score AS raw_opponent_score,
      g.result AS raw_result,g.counts_for_record,g.canonical_event_id,
      src.source_type,src.parser_type,src.collection_mode,src.enabled AS source_enabled,src.authority_rank,
      t.sport,t.gender,t.season,sch.id AS school_id,sch.name AS school_name,sch.level,
      ce.scheduled_at AS canonical_scheduled_at,ce.scheduled_time_known AS canonical_time_known,
      ce.status AS canonical_status,ce.home_score AS canonical_home_score,ce.away_score AS canonical_away_score,
      ce.home_school_id AS canonical_home_school_id,ce.away_school_id AS canonical_away_school_id,
      ce.selected_source_id,ce.trust_state,ce.conflict_count
    FROM requested_games requested
    JOIN games g ON g.id=requested.id
    JOIN teams t ON t.id=g.team_id
    JOIN schools sch ON sch.id=t.school_id
    LEFT JOIN sources src ON src.id=g.source_id
    LEFT JOIN canonical_events ce ON ce.id=g.canonical_event_id
    ORDER BY g.team_id,g.scheduled_at,g.id`)
    .bind(JSON.stringify(ids)).all();
  const meta=query?.meta||{};
  return {
    issues:relevant,
    rows:query?.results||[],
    d1:{rows_read:meta.rows_read==null?null:Number(meta.rows_read),rows_written:meta.rows_written==null?0:Number(meta.rows_written),duration_ms:meta.duration==null?null:Number(meta.duration)}
  };
}


async function runM15StatewideCollection(env,keys=[]) {
  const requested=[...new Set((Array.isArray(keys)?keys:[]).map(String).filter(key=>M15_STATEWIDE_KEYS.has(key)))];
  if(!requested.length||requested.length>6) throw new Error("invalid statewide collection key set");
  const before=await buildStatewideDataIntegrityAudit(env,{season:"2026",sampleLimit:5000});
  const outcomes=[];
  for(const key of requested) {
    try {
      const result=await runCertifiedDragonFlyStatewideCollection(env,statewideSportConfig(key));
      outcomes.push({key,status:"SUCCESS",result});
    } catch(error) {
      outcomes.push({key,status:"FAILED",error:String(error?.message||error)});
    }
  }
  const after=await buildStatewideDataIntegrityAudit(env,{season:"2026",sampleLimit:5000});
  return {
    status:outcomes.some(item=>item.status==="FAILED")?"PARTIAL":"EXECUTED",
    fingerprint:M15_FINGERPRINT,
    transport_version:M15_TRANSPORT_VERSION,
    action:"statewide-collect",
    keys:requested,
    outcomes,
    before:{summary:before.summary,d1:before.d1,issue_counts:m15IssueCounts(before)},
    after:{summary:after.summary,d1:after.d1,issue_counts:m15IssueCounts(after)}
  };
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
    const detail=new URL(request.url).searchParams.get("detail");
    if(detail==="overdue") {
      const breakdown=await loadM15OverdueBreakdown(env,plan.blocking);
      return auditJson({status:"READY",fingerprint:M15_FINGERPRINT,transport_version:M15_TRANSPORT_VERSION,detail:"overdue",summary:plan.audit.summary,issue_counts:plan.byCode,overdue_breakdown:breakdown},200,{integrity:true});
    }
    if(detail==="defects") {
      const defects=await loadM15DefectDetails(env,plan.blocking);
      return auditJson({status:"READY",fingerprint:M15_FINGERPRINT,transport_version:M15_TRANSPORT_VERSION,detail:"defects",summary:plan.audit.summary,issue_counts:plan.byCode,defects},200,{integrity:true});
    }
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

  if(body.action==="statewide-collect") {
    const result=await runM15StatewideCollection(env,body.keys);
    return auditJson(result,result.status==="PARTIAL"?207:200,{integrity:true});
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
  return auditJson({status:refreshResponse.ok?"EXECUTED":"FAILED",fingerprint:M15_FINGERPRINT,transport_version:M15_TRANSPORT_VERSION,action:"authoritative-refresh",source_ids:sourceIds,refresh_status:refreshResponse.status,refresh:payload},refreshResponse.ok?200:refreshResponse.status,{integrity:true});
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
