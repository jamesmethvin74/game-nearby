const IDENTITY_BLOCKING_CODES = new Set([
  "ambiguous_school_identity",
  "unresolved_school_identity",
  "school_identity_conflict"
]);

const RESULT_RELEVANT_CATEGORIES = new Set([
  "inventory",
  "schedule",
  "source",
  "results",
  "record",
  "identity"
]);

const SPORT_PRIORITY = Object.freeze({
  football:1,
  volleyball:2,
  basketball:3,
  soccer:4
});

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function evidenceValue(team, key) {
  if (team?.[key] != null) return team[key];
  if (team?.evidence?.[key] != null) return team.evidence[key];
  return null;
}

function issueCodes(team) {
  return new Set((team?.issues || []).map(issue => issue.code).filter(Boolean));
}

function sourceProvider(team) {
  const id = String(evidenceValue(team,"audit_source_id") || "").toLowerCase();
  const type = String(evidenceValue(team,"audit_source_type") || "").toLowerCase();
  const haystack = `${id} ${type}`;
  for (const provider of ["dragonfly","hootens","maxpreps","prestosports","presto","sidearm","rankone"]) {
    if (haystack.includes(provider)) return provider === "presto" ? "prestosports" : provider;
  }
  return type || (id ? "other" : "none");
}

function authorityState(team, codes = issueCodes(team)) {
  if (team?.source_resolution === "blocked" || codes.has("college_source_blocked") || codes.has("source_resolution_blocked")) return "blocked";
  if (team?.source_resolution === "pending" || codes.has("college_source_pending") || codes.has("source_resolution_pending")) return "pending";
  if ([...IDENTITY_BLOCKING_CODES].some(code => codes.has(code))) return "identity-blocked";
  if (team?.backend_team_present === false) return "team-missing";
  if (!evidenceValue(team,"audit_source_id")) return "source-missing";
  if (codes.has("source_collection_failures") || codes.has("schedule_source_stale")) return "degraded";
  if (team?.schedule_status === "Complete") return "available";
  return "unverified";
}

function exceptionTypes(team) {
  const types = [];
  const unresolved = number(evidenceValue(team,"unresolved_due_count"));
  const missingScore = number(evidenceValue(team,"final_missing_score_count"));
  if (unresolved > 0) types.push("past_due_unresolved");
  if (missingScore > 0) types.push("final_missing_score");
  if (!unresolved && !missingScore && team?.results_status !== "Complete") types.push("result_coverage_unverified");
  if (team?.results_status === "Complete" && team?.records_status === "Mismatch") types.push("record_truth_mismatch");
  const codes = issueCodes(team);
  if ([...IDENTITY_BLOCKING_CODES].some(code => codes.has(code))) types.push("identity_blocker");
  return [...new Set(types)];
}

function relevantCauses(team) {
  return (team?.issues || [])
    .filter(issue => RESULT_RELEVANT_CATEGORIES.has(issue.category) || IDENTITY_BLOCKING_CODES.has(issue.code))
    .map(issue => ({
      code:issue.code,
      category:issue.category || null,
      count:issue.count == null ? null : number(issue.count),
      detail:issue.detail || null
    }));
}

function workItem(team) {
  const codes = issueCodes(team);
  return {
    team_id:team.team_id,
    school_id:team.school_id,
    school_name:team.school_name,
    level:team.level,
    sport:team.sport,
    gender:team.gender,
    season:team.season || "2026",
    priority:SPORT_PRIORITY[team.sport] || 9,
    source_provider:sourceProvider(team),
    source_type:evidenceValue(team,"audit_source_type"),
    source_id:evidenceValue(team,"audit_source_id"),
    source_resolution:team.source_resolution || null,
    authority_state:authorityState(team,codes),
    schedule_status:team.schedule_status,
    results_status:team.results_status,
    records_status:team.records_status,
    result_due_count:number(evidenceValue(team,"result_due_count")),
    resolved_result_count:number(evidenceValue(team,"resolved_result_count")),
    unresolved_due_count:number(evidenceValue(team,"unresolved_due_count")),
    final_missing_score_count:number(evidenceValue(team,"final_missing_score_count")),
    exception_types:exceptionTypes(team),
    causes:relevantCauses(team)
  };
}

function dimension(items, key, { explode = false } = {}) {
  const grouped = new Map();
  for (const item of items) {
    const values = explode ? item[key] : [item[key]];
    for (const raw of values || []) {
      const value = String(raw || "unknown");
      if (!grouped.has(value)) grouped.set(value,{value,team_ids:new Set(),unresolved_due_contests:0,final_missing_score_contests:0});
      const row = grouped.get(value);
      row.team_ids.add(item.team_id);
      row.unresolved_due_contests += item.unresolved_due_count;
      row.final_missing_score_contests += item.final_missing_score_count;
    }
  }
  return [...grouped.values()]
    .map(row => ({
      value:row.value,
      teams:row.team_ids.size,
      unresolved_due_contests:row.unresolved_due_contests,
      final_missing_score_contests:row.final_missing_score_contests
    }))
    .sort((a,b) => b.teams-a.teams || a.value.localeCompare(b.value));
}

function supportedRows(report) {
  if (Array.isArray(report?.teams)) {
    return report.teams.filter(team => team.coverage_scope === "supported");
  }
  // Saved/read-only `view=exceptions` artifacts intentionally omit the full team
  // array. In truthful-coverage-v5+ the `exceptions` array is already scoped to
  // supported teams; older approved artifacts predate coverage_scope but still
  // contain only the auditable exception rows that were captured at that time.
  if (Array.isArray(report?.exceptions)) {
    return report.exceptions.filter(team => team.coverage_scope !== "production-only");
  }
  return [];
}

export function buildResultGapAudit(report = {}) {
  const supported = supportedRows(report);
  const items = supported
    .filter(team => team.results_status !== "Complete" || team.records_status === "Mismatch" || exceptionTypes(team).includes("identity_blocker"))
    .map(workItem)
    .sort((a,b) => a.priority-b.priority || b.unresolved_due_count-a.unresolved_due_count || String(a.school_name||"").localeCompare(String(b.school_name||"")) || String(a.team_id||"").localeCompare(String(b.team_id||"")));

  const dueGapTeams = items.filter(item => item.unresolved_due_count > 0 || item.final_missing_score_count > 0);
  const coverageUnverified = items.filter(item => item.exception_types.includes("result_coverage_unverified"));
  const identityBlocked = items.filter(item => item.exception_types.includes("identity_blocker"));
  const recordMismatch = items.filter(item => item.exception_types.includes("record_truth_mismatch"));

  return {
    generated_at:report.generated_at || new Date().toISOString(),
    audit_contract:{
      version:"m8-result-gaps-v1",
      upstream_version:report.audit_contract?.version || null,
      rule:"Every supported past-due record-counting contest must resolve to scored FINAL, CANCELED, POSTPONED, or an explicit authority-backed exception. Unknown evidence stays unresolved; identity ambiguity fails closed.",
      scope:"In-memory classification of the existing truthful coverage snapshot; no additional D1 query or write is performed."
    },
    d1:report.d1 || null,
    summary:{
      supported_rows_examined:supported.length,
      input_view:Array.isArray(report?.teams)?"full":"exceptions",
      result_gap_teams:items.length,
      due_gap_teams:dueGapTeams.length,
      unresolved_due_contests:items.reduce((sum,item)=>sum+item.unresolved_due_count,0),
      final_missing_score_contests:items.reduce((sum,item)=>sum+item.final_missing_score_count,0),
      result_coverage_unverified_teams:coverageUnverified.length,
      identity_blocked_teams:identityBlocked.length,
      record_truth_mismatch_teams:recordMismatch.length
    },
    grouped:{
      by_sport:dimension(items,"sport"),
      by_source_provider:dimension(items,"source_provider"),
      by_exception_type:dimension(items,"exception_types",{explode:true}),
      by_authority_state:dimension(items,"authority_state")
    },
    work_items:items
  };
}

export { authorityState, exceptionTypes, sourceProvider, supportedRows };
