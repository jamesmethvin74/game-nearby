import app from "./logo-bootstrap-worker.js";
import { buildResultGapAudit } from "./result-gap-audit.js";

const RESULT_GAP_VIEW = "result-gaps";
const TEMP_BAUXITE_MARKER_PATH = "/api/v1/internal/bauxite-evidence-marker-20260914";
const TEMP_BAUXITE_EVIDENCE_PATH = "/api/v1/internal/bauxite-evidence-20260914";

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

function privateJson(body,status=200) {
  return new Response(JSON.stringify(body),{
    status,
    headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === TEMP_BAUXITE_MARKER_PATH) {
      return privateJson({marker:"bauxite-evidence-20260914",d1_access:false,rows_written:0});
    }
    if (request.method === "GET" && url.pathname === TEMP_BAUXITE_EVIDENCE_PATH) {
      const result=await env.DB.prepare(`
        SELECT
          g.id AS game_id,g.team_id,g.source_id,g.canonical_event_id,
          g.scheduled_at AS raw_scheduled_at,g.status AS raw_status,
          g.team_score AS raw_team_score,g.opponent_score AS raw_opponent_score,
          g.result AS raw_result,g.opponent,g.opponent_school_id,
          g.counts_for_record,g.conference_game AS raw_conference_game,g.notes,
          src.source_type,src.parser_type,src.authority_rank,src.source_priority,
          ce.scheduled_at AS canonical_scheduled_at,ce.status AS canonical_status,
          ce.home_school_id AS canonical_home_school_id,ce.away_school_id AS canonical_away_school_id,
          ce.home_score AS canonical_home_score,ce.away_score AS canonical_away_score,
          ce.trust_state AS canonical_trust_state,ce.conflict_count AS canonical_conflict_count
        FROM games g INDEXED BY idx_games_team_time
        JOIN sources src ON src.id=g.source_id
        LEFT JOIN canonical_events ce ON ce.id=g.canonical_event_id
        WHERE g.team_id=? AND g.scheduled_at>=? AND g.scheduled_at<?
        ORDER BY g.scheduled_at,g.source_id,g.id
      `).bind(
        "df-vvme46-volleyball-2026",
        "2026-08-18T00:00:00.000Z",
        "2026-08-20T00:00:00.000Z"
      ).all();
      return privateJson({
        team_id:"df-vvme46-volleyball-2026",
        rows:result.results||[],
        d1:{rows_read:Number(result.meta?.rows_read||0),rows_written:Number(result.meta?.rows_written||0),duration_ms:Number(result.meta?.duration||0)}
      });
    }

    const wantsResultGaps = request.method === "GET"
      && url.pathname === "/api/v1/coverage-report"
      && url.searchParams.get("view") === RESULT_GAP_VIEW;

    if (!wantsResultGaps) return app.fetch(request, env, ctx);

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

export { RESULT_GAP_VIEW, TEMP_BAUXITE_EVIDENCE_PATH, TEMP_BAUXITE_MARKER_PATH };
