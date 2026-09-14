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

function recordCount(record = {}) {
  return Number(record?.wins || 0) + Number(record?.losses || 0) + Number(record?.ties || 0);
}

function hasNewerEvidenceProof(team) {
  return (team.issues || []).some(issue => issue.code === "STALE_RECORD_ROW");
}

function storedDriftIsExplained(team, issue) {
  if (Number(team.orientation_corrections || 0) > 0 || hasNewerEvidenceProof(team)) return true;

  // A stored row that simply trails a larger, fully verified normalized FINAL set is
  // stale materialization, not an unexplained record contradiction. This is only
  // safe for the explicit lower-count lag code: same-count W/L disagreement and
  // conference disagreement still require independent evidence.
  if (issue?.code === "STALE_STORED_RECORD" && team.public_record_verified === true) {
    const storedGames = recordCount(team.stored_record);
    const trustedGames = recordCount(team.trusted_record);
    const evidenceGames = Number(team.evidence_games || 0);
    return trustedGames > storedGames && trustedGames === evidenceGames;
  }

  return false;
}

export function finalizeRecordTruthAudit(audit = {}) {
  const teams = Array.isArray(audit.teams) ? audit.teams : [];

  for (const team of teams) {
    for (const issue of Array.isArray(team.issues) ? team.issues : []) {
      if (PUBLISHED_CONTRADICTION_CODES.has(issue.code)) {
        issue.severity = issue.severity === "blocking" ? "blocking" : "warning";
        issue.resolved = false;
      } else if (STORED_DRIFT_CODES.has(issue.code)) {
        const explained = storedDriftIsExplained(team, issue);
        issue.severity = explained ? "info" : "warning";
        issue.resolved = explained;
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
    unexplained_rule:"Published/materialized record contradictions remain unexplained until reconciled. Stored same-count/conference drift is explained only by score-orientation repair or newer evidence; a lower stored game count is treated as stale materialization only when the normalized trusted record is verified and covers the complete audited FINAL evidence set."
  };
  return audit;
}
