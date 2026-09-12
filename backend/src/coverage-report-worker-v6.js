import app from "./coverage-report-worker-v5.js";
import { DRAGONFLY_STATEWIDE_REMOVED_NOTE, hasRetiredStatewideMarker } from "./current-schedule-truth.js";

const AUDIT_VERSION = "truthful-coverage-v6";
const STATUS_VALUES = ["Complete","Partial","Missing","Mismatch","Unverified"];

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function issueCount(exceptions = []) {
  const counts = {};
  for (const exception of exceptions) {
    for (const issue of exception.issues || []) counts[issue.code] = (counts[issue.code] || 0) + 1;
  }
  return counts;
}

function statusCount(teams, key) {
  return Object.fromEntries(STATUS_VALUES.map(status => [status, teams.filter(team => team[key] === status).length]));
}

function aggregateStatus(values = []) {
  if (!values.length) return "Unverified";
  if (values.every(value => value === "Complete")) return "Complete";
  if (values.every(value => value === "Missing")) return "Missing";
  if (values.every(value => value === "Unverified")) return "Unverified";
  if (values.some(value => value === "Mismatch")) return "Mismatch";
  return "Partial";
}

function sameRecord(left, right) {
  if (!left || !right) return false;
  return number(left.wins) === number(right.wins)
    && number(left.losses) === number(right.losses)
    && number(left.ties) === number(right.ties);
}

function hasIssue(team, code) {
  return (team.issues || []).some(issue => issue.code === code);
}

function removeIssue(team, code) {
  team.issues = (team.issues || []).filter(issue => issue.code !== code);
}

function addIssueOnce(team, issue) {
  team.issues ||= [];
  if (!hasIssue(team, issue.code)) team.issues.push(issue);
}

function exceptionFromTeam(team) {
  return {
    team_id:team.team_id,
    school_id:team.school_id,
    school_name:team.school_name,
    level:team.level,
    sport:team.sport,
    gender:team.gender,
    coverage_scope:team.coverage_scope,
    backend_team_present:team.backend_team_present,
    backend_team_active:team.backend_team_active,
    source_resolution:team.source_resolution || null,
    schedule_status:team.schedule_status,
    results_status:team.results_status,
    records_status:team.records_status,
    standings_status:team.standings_status,
    evidence:{
      audit_source_id:team.audit_source_id,
      audit_source_type:team.audit_source_type,
      audit_source_enabled:team.audit_source_enabled,
      audit_source_collection_mode:team.audit_source_collection_mode,
      audit_source_snapshot_count:team.audit_source_snapshot_count,
      audit_source_game_count:team.audit_source_game_count,
      audit_source_retired_game_count:team.audit_source_retired_game_count || 0,
      game_count:team.game_count,
      result_due_count:team.result_due_count,
      resolved_result_count:team.resolved_result_count,
      unresolved_due_count:team.unresolved_due_count,
      final_missing_score_count:team.final_missing_score_count,
      stored_record:team.stored_record,
      derived_record:team.derived_record
    },
    issues:team.issues || []
  };
}

function retiredMismatchCandidates(report) {
  return (report.teams || []).filter(team =>
    team.coverage_scope === "supported"
    && team.audit_source_collection_mode === "statewide"
    && Boolean(team.audit_source_id)
    && hasIssue(team, "schedule_snapshot_storage_mismatch")
  );
}

async function retiredSourceCounts(env, teams) {
  const sourceIds = [...new Set(teams.map(team => team.audit_source_id).filter(Boolean))];
  if (!sourceIds.length) return { bySource:new Map(), meta:{} };
  const result = await env.DB.prepare(`
    SELECT source_id,
      COUNT(*) AS total_count,
      SUM(CASE WHEN instr(COALESCE(notes,''),?)>0 THEN 1 ELSE 0 END) AS retired_count
    FROM games
    WHERE source_id IN (SELECT value FROM json_each(?))
    GROUP BY source_id
  `).bind(DRAGONFLY_STATEWIDE_REMOVED_NOTE, JSON.stringify(sourceIds)).all();
  return {
    bySource:new Map((result.results || []).map(row => [row.source_id, {
      total:number(row.total_count),
      retired:number(row.retired_count)
    }])),
    meta:result.meta || {}
  };
}

function reconcileRetiredTeam(team, counts) {
  if (!counts || counts.retired <= 0) return false;
  const snapshot = number(team.audit_source_snapshot_count);
  const activeStored = Math.max(0, counts.total - counts.retired);
  if (activeStored !== snapshot) return false;

  const previousStored = number(team.audit_source_game_count);
  team.audit_source_retired_game_count = counts.retired;
  team.audit_source_game_count = activeStored;
  if (number(team.game_count) === previousStored) team.game_count = activeStored;

  removeIssue(team, "schedule_snapshot_storage_mismatch");
  team.schedule_status = "Complete";
  team.schedule_basis = "fresh_source_snapshot_exact_match_after_retired_lineage_filter";
  addIssueOnce(team, {
    code:"retired_schedule_lineage_retained",
    category:"schedule-lineage",
    informational:true,
    detail:`${counts.retired} prior statewide DragonFly schedule observation${counts.retired === 1 ? " is" : "s are"} retained in D1 for lineage but excluded from current schedule truth.`
  });

  if (number(team.unresolved_due_count) > 0 || number(team.final_missing_score_count) > 0) {
    team.results_status = "Partial";
  } else {
    team.results_status = "Complete";
  }

  const stored = team.stored_record;
  const derived = team.derived_record;
  if (!stored) {
    team.records_status = "Missing";
  } else if (sameRecord(stored, derived)) {
    team.records_status = team.results_status === "Complete" ? "Complete" : "Unverified";
    removeIssue(team, "record_visible_final_disagreement");
  } else if (team.results_status === "Complete") {
    team.records_status = "Mismatch";
    removeIssue(team, "record_visible_final_disagreement");
    addIssueOnce(team, {
      code:"record_vs_final_mismatch",
      category:"record",
      detail:`Stored ${number(stored.wins)}-${number(stored.losses)}-${number(stored.ties)}; derived from current scored FINALs ${number(derived.wins)}-${number(derived.losses)}-${number(derived.ties)}.`
    });
  } else {
    team.records_status = "Unverified";
  }
  return true;
}

function rebuildScopedReport(report) {
  const teams = Array.isArray(report.teams) ? report.teams : [];
  const supported = teams.filter(team => team.coverage_scope === "supported");
  const productionOnly = teams.filter(team => team.coverage_scope === "production-only");
  const supportedExceptions = supported.filter(team => (team.issues || []).some(issue => issue.informational !== true)).map(exceptionFromTeam);
  const productionOnlyExceptions = productionOnly.map(exceptionFromTeam);
  const byId = new Map(teams.map(team => [team.team_id,team]));

  for (const school of report.schools || []) {
    school.teams = (school.teams || []).map(team => byId.get(team.team_id) || team);
    const schoolSupported = school.teams.filter(team => team.coverage_scope === "supported");
    school.conference_status = aggregateStatus(schoolSupported.map(team => team.conference_status));
    school.schedule_status = aggregateStatus(schoolSupported.map(team => team.schedule_status));
    school.results_status = aggregateStatus(schoolSupported.map(team => team.results_status));
    school.records_status = aggregateStatus(schoolSupported.map(team => team.records_status));
    school.standings_status = aggregateStatus(schoolSupported.map(team => team.standings_status));
  }

  report.exceptions = supportedExceptions;
  report.production_only_exceptions = productionOnlyExceptions;
  report.summary = {
    ...(report.summary || {}),
    teams:supported.length,
    supported_teams:supported.length,
    production_only_teams:productionOnly.length,
    exception_teams:supportedExceptions.length,
    supported_exception_teams:supportedExceptions.length,
    clean_teams:supported.length - supportedExceptions.length,
    supported_clean_teams:supported.length - supportedExceptions.length,
    production_only_exception_teams:productionOnlyExceptions.length,
    exception_counts:issueCount(supportedExceptions),
    production_only_exception_counts:issueCount(productionOnlyExceptions),
    team_status:{
      schedule:statusCount(supported,"schedule_status"),
      results:statusCount(supported,"results_status"),
      records:statusCount(supported,"records_status"),
      standings:statusCount(supported,"standings_status")
    },
    production_only_team_status:{
      schedule:statusCount(productionOnly,"schedule_status"),
      results:statusCount(productionOnly,"results_status"),
      records:statusCount(productionOnly,"records_status"),
      standings:statusCount(productionOnly,"standings_status")
    }
  };
  return report;
}

async function reconcileRetiredScheduleTruth(env, report) {
  const candidates = retiredMismatchCandidates(report);
  if (!candidates.length) {
    report.summary = { ...(report.summary || {}), retired_schedule_reconciliation:{ candidates:0, corrected:0, retained_rows:0 } };
    return report;
  }

  const { bySource, meta } = await retiredSourceCounts(env, candidates);
  let corrected = 0;
  let retainedRows = 0;
  for (const team of candidates) {
    const counts = bySource.get(team.audit_source_id);
    if (reconcileRetiredTeam(team, counts)) {
      corrected += 1;
      retainedRows += number(counts?.retired);
    }
  }

  report.d1 = {
    ...(report.d1 || {}),
    rows_read:number(report.d1?.rows_read) + number(meta.rows_read),
    rows_written:number(report.d1?.rows_written) + number(meta.rows_written),
    duration_ms:number(report.d1?.duration_ms) + number(meta.duration)
  };
  rebuildScopedReport(report);
  report.summary.retired_schedule_reconciliation = {
    candidates:candidates.length,
    corrected,
    retained_rows:retainedRows,
    rows_read:number(meta.rows_read),
    rows_written:number(meta.rows_written)
  };
  return report;
}

function exceptionView(report) {
  return {
    generated_at:report.generated_at,
    audit_contract:report.audit_contract,
    inventory_note:report.inventory_note,
    inventory:report.inventory,
    catalog_identity:report.catalog_identity,
    d1:report.d1,
    summary:report.summary,
    exceptions:report.exceptions,
    production_only_exceptions:report.production_only_exceptions
  };
}

function jsonResponse(upstream, body, extraHeaders = {}) {
  const headers = new Headers(upstream.headers);
  headers.set("content-type","application/json; charset=utf-8");
  headers.delete("content-length");
  for (const [key,value] of Object.entries(extraHeaders)) headers.set(key,String(value));
  return new Response(JSON.stringify(body), {
    status:upstream.status,
    statusText:upstream.statusText,
    headers
  });
}

async function filterScheduleResponse(request, response) {
  if (!response.ok) return response;
  const path = new URL(request.url).pathname;
  if (!/^\/api\/v1\/(?:schools\/[^/]+|teams\/[^/]+)\/schedule$/.test(path)) return response;
  let payload;
  try { payload = await response.clone().json(); }
  catch { return response; }
  if (!Array.isArray(payload?.games)) return response;
  const before = payload.games.length;
  payload.games = payload.games.filter(game => !hasRetiredStatewideMarker(game));
  const removed = before - payload.games.length;
  if (!removed) return response;
  return jsonResponse(response, payload, { "x-localbleachers-retired-schedule-rows-hidden":removed });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/api/v1/coverage-report") {
      const fullUrl = new URL(request.url);
      const wantsExceptions = fullUrl.searchParams.get("view") === "exceptions";
      fullUrl.searchParams.delete("view");
      const upstream = await app.fetch(new Request(fullUrl.toString(), request), env, ctx);
      if (!upstream.ok) return upstream;
      let report;
      try { report = await upstream.clone().json(); }
      catch { return upstream; }
      if (!Array.isArray(report?.teams) || !Array.isArray(report?.schools)) return upstream;

      await reconcileRetiredScheduleTruth(env, report);
      report.audit_contract = {
        ...(report.audit_contract || {}),
        version:AUDIT_VERSION,
        retained_lineage_rule:"Rows explicitly marked as removed from the current statewide DragonFly schedule are retained in D1 for lineage only. They are excluded from current schedule truth, schedule snapshot/storage equality, public schedule reads, result completeness, and record truth."
      };
      report.inventory_note = `${report.inventory_note || ""} Retired statewide DragonFly observations remain stored for lineage but are excluded from current schedule truth.`.trim();
      return jsonResponse(upstream, wantsExceptions ? exceptionView(report) : report);
    }

    const upstream = await app.fetch(request, env, ctx);
    return filterScheduleResponse(request, upstream);
  },
  async scheduled(controller, env, ctx) {
    return app.scheduled(controller, env, ctx);
  }
};

export { AUDIT_VERSION, exceptionView, rebuildScopedReport, reconcileRetiredScheduleTruth, filterScheduleResponse };
