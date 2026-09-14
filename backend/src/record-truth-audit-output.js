const PUBLISHED_CONTRADICTION_CODES = new Set([
  "PUBLISHED_RECORD_CONTRADICTS_FINAL_EVIDENCE",
  "PUBLISHED_RECORD_BEHIND_FINAL_EVIDENCE",
  "PUBLISHED_CONFERENCE_RECORD_CONTRADICTION",
  "MATERIALIZED_STANDING_RECORD_CONTRADICTION",
  "MATERIALIZED_CONFERENCE_RECORD_CONTRADICTION"
]);

const STORED_DRIFT_CODES = new Set([
  "STALE_STORED_RECORD_CONTRADICTS_FINAL_EVIDENCE",
  "STALE_STORED_RECORD",
  "STALE_STORED_CONFERENCE_RECORD_CONTRADICTS_FINAL_EVIDENCE"
]);

function hasExplainedStoredDrift(team) {
  return Number(team.orientation_corrections || 0) > 0
    || (team.issues || []).some(issue => issue.code === "STALE_RECORD_ROW");
}

export function finalizeRecordTruthAudit(audit = {}) {
  const teams = Array.isArray(audit.teams) ? audit.teams : [];

  for (const team of teams) {
    const explainedStoredDrift = hasExplainedStoredDrift(team);
    for (const issue of Array.isArray(team.issues) ? team.issues : []) {
      if (PUBLISHED_CONTRADICTION_CODES.has(issue.code)) {
        issue.severity = issue.severity === "blocking" ? "blocking" : "warning";
        issue.resolved = false;
      } else if (STORED_DRIFT_CODES.has(issue.code)) {
        issue.severity = explainedStoredDrift ? "info" : "warning";
        issue.resolved = explainedStoredDrift;
      }
    }
    team.unexplained_issue_count = (team.issues || []).filter(issue => issue.severity !== "info" && !issue.resolved).length;
  }

  const nonVerified = teams.filter(team => team.classification !== "VERIFIED");
  const summary = audit.summary || {};
  summary.unexplained_record_contradictions = teams.filter(team =>
    team.classification === "CONTRADICTORY" && Number(team.unexplained_issue_count || 0) > 0
  ).length;
  summary.non_verified = nonVerified.length;

  audit.summary = summary;
  audit.non_verified_teams = nonVerified;
  audit.audit_contract = {
    ...(audit.audit_contract || {}),
    unexplained_rule:"Published/materialized record contradictions remain unexplained until reconciled. Stored-record drift is considered explained only when score-orientation repair or newer evidence proves why storage is stale."
  };
  return audit;
}
