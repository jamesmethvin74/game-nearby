import app from "./m8-worker.js";
import { buildStatewideRecordTruthAudit } from "./m8-final-audit/record-truth-audit.js";
import { finalizeRecordTruthAudit } from "./m8-final-audit/record-truth-audit-output.js";
import { buildM8CompletenessReport } from "./m8-final-audit/m8-completeness-report.js";

const RECORD_TRUTH_VIEW="record-truth";
const FINAL_AUDIT_PATH="/api/v1/internal/m8-final-record-truth-audit-20260914-9c4f2d7e1b6a";
const FINAL_AUDIT_EXPIRES_AT=Date.parse("2026-09-15T01:00:00Z");
const M10_FINAL_VERIFY_PATH="/api/v1/internal/m10-final-verify-20260915-6d4c9e21";
const M10_FINAL_VERIFY_EXPIRES_AT=Date.parse("2026-09-16T03:00:00Z");

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

async function runM10FinalVerification(env) {
  const query=await env.DB.prepare(`
    WITH truth AS (
      SELECT
        cm.team_id,
        t.conference_id AS team_conference_id,
        cm.membership_state,
        cm.conference_id AS membership_conference_id,
        COALESCE(r.wins,0) AS wins,
        COALESCE(r.losses,0) AS losses,
        COALESCE(r.ties,0) AS ties,
        COALESCE(r.conference_wins,0) AS conference_wins,
        COALESCE(r.conference_losses,0) AS conference_losses,
        COALESCE(r.conference_ties,0) AS conference_ties,
        st.team_id AS standing_team_id,
        st.conference_record AS materialized_conference_record,
        st.overall_record AS materialized_overall_record
      FROM conference_memberships cm
      JOIN teams t ON t.id=cm.team_id
      JOIN schools s ON s.id=t.school_id
      LEFT JOIN team_records r ON r.team_id=t.id
      LEFT JOIN standings st
        ON st.team_id=cm.team_id
       AND st.conference_id=cm.conference_id
       AND st.method='calculated'
      WHERE t.active=1
        AND t.season='2026'
        AND s.catalog_scope='local'
    ), normalized AS (
      SELECT truth.*,
        (conference_wins+conference_losses+conference_ties) AS conference_games,
        CASE WHEN ties>0
          THEN printf('%d-%d-%d',wins,losses,ties)
          ELSE printf('%d-%d',wins,losses)
        END AS expected_overall_record,
        CASE WHEN conference_ties>0
          THEN printf('%d-%d-%d',conference_wins,conference_losses,conference_ties)
          ELSE printf('%d-%d',conference_wins,conference_losses)
        END AS expected_conference_record
      FROM truth
    )
    SELECT
      COUNT(*) AS membership_rows,
      SUM(CASE WHEN membership_state='member' THEN 1 ELSE 0 END) AS member,
      SUM(CASE WHEN membership_state='independent' THEN 1 ELSE 0 END) AS independent,
      SUM(CASE WHEN membership_state='unknown' THEN 1 ELSE 0 END) AS unknown,
      SUM(CASE WHEN membership_state NOT IN ('member','independent','unknown')
        OR (membership_state='member' AND membership_conference_id IS NULL)
        OR (membership_state IN ('independent','unknown') AND membership_conference_id IS NOT NULL)
        THEN 1 ELSE 0 END) AS invalid_memberships,
      SUM(CASE WHEN membership_state='member'
        AND COALESCE(team_conference_id,'')<>COALESCE(membership_conference_id,'')
        THEN 1 ELSE 0 END) AS conference_pointer_mismatches,
      SUM(CASE WHEN membership_state IN ('independent','unknown')
        AND team_conference_id IS NOT NULL THEN 1 ELSE 0 END) AS nonmember_pointer_mismatches,
      SUM(CASE WHEN membership_state='member' AND standing_team_id IS NOT NULL THEN 1 ELSE 0 END) AS materialized_calculated_rows,
      SUM(CASE WHEN membership_state='member' AND conference_games>0 AND standing_team_id IS NULL THEN 1 ELSE 0 END) AS started_members_missing_materialized_standings,
      SUM(CASE WHEN standing_team_id IS NOT NULL
        AND COALESCE(materialized_overall_record,'')<>expected_overall_record
        THEN 1 ELSE 0 END) AS overall_record_contradictions,
      SUM(CASE WHEN standing_team_id IS NOT NULL
        AND conference_games>0
        AND COALESCE(materialized_conference_record,'')<>expected_conference_record
        THEN 1 ELSE 0 END) AS conference_record_contradictions,
      SUM(CASE WHEN standing_team_id IS NOT NULL
        AND (
          COALESCE(materialized_overall_record,'')<>expected_overall_record
          OR (conference_games>0 AND COALESCE(materialized_conference_record,'')<>expected_conference_record)
        ) THEN 1 ELSE 0 END) AS unexplained_record_contradictions
    FROM normalized
  `).all();
  const values=query.results?.[0]||{};
  const pass=Number(values.membership_rows||0)===1220
    && Number(values.member||0)===1190
    && Number(values.independent||0)===1
    && Number(values.unknown||0)===29
    && Number(values.invalid_memberships||0)===0
    && Number(values.conference_pointer_mismatches||0)===0
    && Number(values.nonmember_pointer_mismatches||0)===0
    && Number(values.started_members_missing_materialized_standings||0)===0
    && Number(values.unexplained_record_contradictions||0)===0
    && Number(query.meta?.rows_written||0)===0;
  return auditJson({
    status:pass?"PASS":"FAIL",
    verification:values,
    d1:{
      rows_read:Number(query.meta?.rows_read||0),
      rows_written:Number(query.meta?.rows_written||0)
    }
  },pass?200:500);
}

export default {
  async fetch(request,env,ctx) {
    const url=new URL(request.url);
    const m10FinalVerify=request.method==="GET"
      && url.pathname===M10_FINAL_VERIFY_PATH
      && Date.now()<=M10_FINAL_VERIFY_EXPIRES_AT;
    if (m10FinalVerify) {
      try { return await runM10FinalVerification(env); }
      catch (error) {
        console.error("bounded M10 final verification failed",error);
        return auditJson({error:"m10_final_verification_failed",message:String(error?.message||error)},500);
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
  M10_FINAL_VERIFY_EXPIRES_AT,
  M10_FINAL_VERIFY_PATH
};
