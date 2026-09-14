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

function hasNewerEvidenceProof(team) {
  return (team.issues || []).some(issue => issue.code === "STALE_RECORD_ROW");
}

function storedDriftIsExplained(team, issue) {
  if (Number(team.orientation_corrections || 0) > 0 || hasNewerEvidenceProof(team)) return true;

  // A lower-count stored record is, by definition, lagging materialization rather
  // than an opposing result claim. It remains useful as an audit issue, but it must
  // not count as an unexplained contradiction even when unrelated schedule gaps
  // make the team's public record INCOMPLETE. Same-count W/L disagreement and
  // conference-record disagreement still require independent proof.
  if (issue?.code === "STALE_STORED_RECORD") return true;

  return false;
}

function unresolvedContradiction(issue) {
  if (!issue || issue.severity === "info" || issue.resolved === true) return false;
  const code=String(issue.code || "");
  return /CONTRADICTION/.test(code)
    || PUBLISHED_CONTRADICTION_CODES.has(code)
    || STORED_DRIFT_CODES.has(code);
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
    team.unexplained_contradiction_count = (team.issues || []).filter(unresolvedContradiction).length;
  }

  const nonVerified = teams.filter(team => team.classification !== "VERIFIED");
  const summary = audit.summary || {};
  summary.unexplained_record_contradictions = teams.filter(team => Number(team.unexplained_contradiction_count || 0) > 0).length;
  summary.non_verified = nonVerified.length;

  audit.summary = summary;
  audit.non_verified_teams = nonVerified;
  audit.audit_contract = {
    ...(audit.audit_contract || {}),
    unexplained_rule:"Published/materialized record contradictions remain unexplained until reconciled. A lower-count stored overall record is stale materialization, not a contradictory result claim. Stored same-count and conference-record disagreements are explained only by score-orientation repair or newer evidence. Contradictions are counted independently of the team's primary VERIFIED/INCOMPLETE/CONTRADICTORY/UNRESOLVED classification so incompleteness cannot hide a contradictory result claim."
  };
  return audit;
}
