import app from "./m8-worker.js";
import { buildStatewideRecordTruthAudit } from "./m8-final-audit/record-truth-audit.js";
import { finalizeRecordTruthAudit } from "./m8-final-audit/record-truth-audit-output.js";
import { buildM8CompletenessReport } from "./m8-final-audit/m8-completeness-report.js";

const RECORD_TRUTH_VIEW="record-truth";
const FINAL_AUDIT_PATH="/api/v1/internal/m8-final-record-truth-audit-20260914-9c4f2d7e1b6a";
const FINAL_AUDIT_EXPIRES_AT=Date.parse("2026-09-15T01:00:00Z");
const M10_MISSING_STANDINGS_PATH="/api/v1/internal/m10-missing-standings-20260915-b76f4a91";
const M10_MISSING_STANDINGS_EXPIRES_AT=Date.parse("2026-09-16T03:00:00Z");

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

async function runAudit(env) {
  const audit=finalizeRecordTruthAudit(await buildStatewideRecordTruthAudit(env,{season:"2026"}));
  audit.completeness_report=buildM8CompletenessReport(audit);
  return auditJson(audit);
}

async function runM10MissingStandingsProbe(env) {
  const result=await env.DB.prepare(`
    SELECT
      cm.team_id,
      s.name AS school_name,
      t.sport,
      t.gender,
      t.season,
      cm.conference_id,
      c.name AS conference_name,
      COALESCE(r.wins,0) AS wins,
      COALESCE(r.losses,0) AS losses,
      COALESCE(r.ties,0) AS ties,
      COALESCE(r.conference_wins,0) AS conference_wins,
      COALESCE(r.conference_losses,0) AS conference_losses,
      COALESCE(r.conference_ties,0) AS conference_ties
    FROM conference_memberships cm
    JOIN teams t ON t.id=cm.team_id
    JOIN schools s ON s.id=t.school_id
    LEFT JOIN conferences c ON c.id=cm.conference_id
    JOIN team_records r ON r.team_id=t.id
    LEFT JOIN standings st
      ON st.conference_id=cm.conference_id
     AND st.team_id=cm.team_id
     AND st.method='calculated'
    WHERE cm.membership_state='member'
      AND t.active=1
      AND t.season='2026'
      AND s.catalog_scope='local'
      AND (COALESCE(r.conference_wins,0)+COALESCE(r.conference_losses,0)+COALESCE(r.conference_ties,0))>0
      AND st.team_id IS NULL
    ORDER BY cm.conference_id,t.sport,t.gender,s.name,cm.team_id
    LIMIT 20
  `).all();
  const rows=result.results||[];
  return auditJson({
    status:rows.length===7?"PASS":"CHECK",
    missing_count:rows.length,
    rows,
    d1:{rows_read:Number(result.meta?.rows_read||0),rows_written:Number(result.meta?.rows_written||0)}
  });
}

export default {
  async fetch(request,env,ctx) {
    const url=new URL(request.url);
    const m10MissingStandings=request.method==="GET"
      && url.pathname===M10_MISSING_STANDINGS_PATH
      && Date.now()<=M10_MISSING_STANDINGS_EXPIRES_AT;
    if (m10MissingStandings) {
      try { return await runM10MissingStandingsProbe(env); }
      catch (error) {
        console.error("bounded M10 missing-standings probe failed",error);
        return auditJson({error:"m10_missing_standings_probe_failed",message:String(error?.message||error)},500);
      }
    }

    const authorizedView=request.method==="GET"
      && url.pathname==="/api/v1/coverage-report"
      && url.searchParams.get("view")===RECORD_TRUTH_VIEW;
    const oneShot=request.method==="GET"
      && url.pathname===FINAL_AUDIT_PATH
      && Date.now()<=FINAL_AUDIT_EXPIRES_AT;

    if (!authorizedView && !oneShot) return app.fetch(request,env,ctx);
    if (authorizedView && !authorizedAudit(request,env)) return auditJson({error:"not_found"},404);

    try { return await runAudit(env); }
    catch (error) {
      console.error("final M8 record truth audit failed",error);
      return auditJson({error:"record_truth_audit_failed",message:String(error?.message||error)},500);
    }
  },
  async scheduled(controller,env,ctx) {
    return app.scheduled(controller,env,ctx);
  }
};

export {
  FINAL_AUDIT_EXPIRES_AT,
  FINAL_AUDIT_PATH,
  M10_MISSING_STANDINGS_EXPIRES_AT,
  M10_MISSING_STANDINGS_PATH
};
