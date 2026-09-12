import { normalizeSchoolAlias } from "./schedule-authority-core.js";
import { buildSchoolIdentityIndex, resolveSchoolIdentity } from "./school-identity-resolution.js";

const MAX_EXCEPTIONS_PER_TYPE = 50;

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function placeholderOpponent(value) {
  const key = normalizeSchoolAlias(value);
  return !key || /^(?:tbd|tba|open|bye|unknown)$/.test(key)
    || /\b(?:to be determined|to be announced|winner of|loser of)\b/.test(key);
}

function auditSchools(teams = []) {
  const byId = new Map();
  for (const team of teams) {
    const schoolId = clean(team.school_id);
    if (!schoolId) continue;
    const current = byId.get(schoolId) || { id:schoolId, name:clean(team.raw_school_name || team.school_name), mascot:clean(team.mascot), alternate_names:[] };
    for (const name of [team.school_name, team.raw_school_name, team.location_matched_name]) {
      const cleaned = clean(name);
      if (cleaned && !current.alternate_names.includes(cleaned)) current.alternate_names.push(cleaned);
    }
    if (!current.mascot && clean(team.mascot)) current.mascot = clean(team.mascot);
    byId.set(schoolId, current);
  }
  return [...byId.values()];
}

function finding({ team, row, type, resolution }) {
  const opponent = clean(row.opponent);
  const base = {
    school: team?.school_name || null,
    team_id: team?.team_id || row.team_id || null,
    conference: team?.conference_name || null,
    conference_id: team?.conference_id || null,
    deficiency_type: type,
    details: {
      opponent_name: opponent || null,
      normalized_opponent: normalizeSchoolAlias(opponent) || null,
      stored_opponent_school_id: row.opponent_school_id || null,
      resolution_status: resolution.status,
      resolution_method: resolution.method || null,
      candidate_school_ids: resolution.candidateSchoolIds || []
    }
  };

  if (type === "school_identity_alias_gap") {
    return {
      ...base,
      local_state: `${row.status || "UNKNOWN"} observation vs ${opponent || "unknown"} has no opponent_school_id`,
      authority_state: `deterministic ${resolution.method} match -> ${resolution.schoolId}`,
      recommended_repair: "persist the deterministic alias/external identity and re-run canonical reconciliation"
    };
  }
  if (type === "ambiguous_school_identity") {
    return {
      ...base,
      local_state: `${row.status || "UNKNOWN"} observation vs ${opponent || "unknown"} has no unique opponent_school_id`,
      authority_state: `${resolution.candidateSchoolIds.length} canonical schools share this normalized identity`,
      recommended_repair: "curate the identity mapping; do not fuzzy-merge ambiguous schools"
    };
  }
  if (type === "school_identity_conflict") {
    return {
      ...base,
      local_state: `stored opponent_school_id=${row.opponent_school_id}`,
      authority_state: `deterministic ${resolution.method} match -> ${resolution.schoolId}`,
      recommended_repair: "review the conflicting identity evidence before changing the stored school mapping"
    };
  }
  return {
    ...base,
    local_state: `${row.status || "UNKNOWN"} observation vs ${opponent || "unknown"} has no opponent_school_id`,
    authority_state: "source opponent does not resolve to a canonical school_id",
    recommended_repair: "add a deterministic alias or provider identity; do not fuzzy-merge unresolved schools"
  };
}

function addGrouped(grouped, row) {
  const type = row.deficiency_type;
  if (!grouped[type]) grouped[type] = { count:0, exceptions:[] };
  grouped[type].count += 1;
  if (grouped[type].exceptions.length < MAX_EXCEPTIONS_PER_TYPE) grouped[type].exceptions.push(row);
}

export function schoolIdentityAuditFindings({ teams = [], candidates = [] } = {}) {
  const teamById = new Map(teams.map(team => [team.team_id, team]));
  const index = buildSchoolIdentityIndex({ schools:auditSchools(teams) });
  const findings = [];
  const seen = new Set();

  for (const row of candidates) {
    const opponent = clean(row.opponent);
    if (placeholderOpponent(opponent)) continue;
    const resolution = resolveSchoolIdentity({ observedName:opponent }, index);
    let type = null;

    if (!row.opponent_school_id) {
      if (resolution.status === "resolved") type = "school_identity_alias_gap";
      else if (resolution.status === "ambiguous") type = "ambiguous_school_identity";
      else type = "unresolved_school_identity";
    } else if (resolution.status === "resolved" && resolution.schoolId !== row.opponent_school_id) {
      type = "school_identity_conflict";
    }

    if (!type) continue;
    const normalized = normalizeSchoolAlias(opponent) || opponent.toLowerCase();
    const key = `${type}|${row.team_id || ""}|${normalized}|${row.opponent_school_id || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    findings.push(finding({ team:teamById.get(row.team_id), row, type, resolution }));
  }

  return findings;
}

export function augmentAuditWithSchoolIdentityFindings(audit, { teams = [], candidates = [] } = {}) {
  const findings = schoolIdentityAuditFindings({ teams, candidates });
  const grouped = {};
  for (const [type, group] of Object.entries(audit?.exceptions_by_deficiency || {})) {
    grouped[type] = { count:Number(group?.count || 0), exceptions:[...(group?.exceptions || [])] };
  }
  for (const row of findings) addGrouped(grouped, row);

  const count = type => findings.filter(row => row.deficiency_type === type).length;
  const affectedTeams = new Set(findings.map(row => row.team_id).filter(Boolean));
  return {
    ...audit,
    summary: {
      ...(audit?.summary || {}),
      school_identity_exception_count: findings.length,
      school_identity_alias_gap_count: count("school_identity_alias_gap"),
      unresolved_school_identity_count: count("unresolved_school_identity"),
      ambiguous_school_identity_count: count("ambiguous_school_identity"),
      school_identity_conflict_count: count("school_identity_conflict"),
      teams_with_school_identity_exceptions: affectedTeams.size,
      exception_count: Number(audit?.summary?.exception_count || 0) + findings.length
    },
    exceptions_by_deficiency: grouped
  };
}
