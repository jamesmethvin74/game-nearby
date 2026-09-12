import app from "./coverage-report-worker-v3.js";

const AUDIT_VERSION = "truthful-coverage-v5";
const STATUS_VALUES = ["Complete","Partial","Missing","Mismatch","Unverified"];

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

function addIssueOnce(team, issue) {
  team.issues ||= [];
  if (!team.issues.some(existing => existing.code === issue.code)) team.issues.push(issue);
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

export function scopeCoverageReport(report) {
  const teams = Array.isArray(report?.teams) ? report.teams : [];
  const byId = new Map();

  for (const team of teams) {
    team.coverage_scope = team.expected_target ? "supported" : "production-only";
    if (team.coverage_scope === "production-only") {
      addIssueOnce(team, {
        code:"unexpected_production_team",
        category:"inventory",
        detail:"Active production team is outside the independent supported-team denominator. Diagnose catalog scope separately; do not count it as a missing supported schedule/result/record."
      });
    }
    byId.set(team.team_id, team);
  }

  const supported = teams.filter(team => team.coverage_scope === "supported");
  const productionOnly = teams.filter(team => team.coverage_scope === "production-only");
  const supportedExceptions = supported.filter(team => (team.issues || []).length).map(exceptionFromTeam);
  const productionOnlyExceptions = productionOnly.map(exceptionFromTeam);

  for (const school of report.schools || []) {
    school.teams = (school.teams || []).map(team => byId.get(team.team_id) || team);
    const supportedSchoolTeams = school.teams.filter(team => team.coverage_scope === "supported");
    const productionOnlySchoolTeams = school.teams.filter(team => team.coverage_scope === "production-only");
    school.coverage_scope = supportedSchoolTeams.length ? "supported" : "production-only";
    school.supported_team_count = supportedSchoolTeams.length;
    school.production_only_team_count = productionOnlySchoolTeams.length;
    school.conference_status = aggregateStatus(supportedSchoolTeams.map(team => team.conference_status));
    school.schedule_status = aggregateStatus(supportedSchoolTeams.map(team => team.schedule_status));
    school.results_status = aggregateStatus(supportedSchoolTeams.map(team => team.results_status));
    school.records_status = aggregateStatus(supportedSchoolTeams.map(team => team.records_status));
    school.standings_status = aggregateStatus(supportedSchoolTeams.map(team => team.standings_status));
  }

  report.audit_contract = {
    ...(report.audit_contract || {}),
    version:AUDIT_VERSION,
    supported_denominator_rule:"Headline coverage, status counts and the primary exception list include only independently expected supported teams. Production-only rows are retained in a separate catalog-anomaly list and can never create a missing supported schedule/result/record exception.",
    production_only_rule:"An active production team absent from the certified high-school or college supported inventory is a catalog-scope anomaly, not evidence that a supported schedule is missing."
  };
  report.inventory_note = `${report.inventory_note || ""} Headline status and exception counts are scoped to the ${report.inventory?.total_expected_teams || supported.length} independently expected supported teams; production-only rows are reported separately.`.trim();
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

function jsonResponse(upstream, body) {
  const headers = new Headers(upstream.headers);
  headers.set("content-type","application/json; charset=utf-8");
  headers.delete("content-length");
  return new Response(JSON.stringify(body), {
    status:upstream.status,
    statusText:upstream.statusText,
    headers
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method !== "GET" || url.pathname !== "/api/v1/coverage-report") {
      return app.fetch(request, env, ctx);
    }

    // Always ask v4 for its full one-query report, then scope it in memory. This
    // avoids a second D1 read when callers request only the exception view.
    const fullUrl = new URL(request.url);
    const wantsExceptions = fullUrl.searchParams.get("view") === "exceptions";
    fullUrl.searchParams.delete("view");
    const fullRequest = new Request(fullUrl.toString(), request);
    const upstream = await app.fetch(fullRequest, env, ctx);
    if (!upstream.ok) return upstream;

    let payload;
    try { payload = await upstream.clone().json(); }
    catch { return upstream; }
    if (!Array.isArray(payload?.teams) || !Array.isArray(payload?.schools)) return upstream;

    const scoped = scopeCoverageReport(payload);
    return jsonResponse(upstream, wantsExceptions ? exceptionView(scoped) : scoped);
  },
  async scheduled(controller, env, ctx) {
    return app.scheduled(controller, env, ctx);
  }
};

export { AUDIT_VERSION, exceptionView };
