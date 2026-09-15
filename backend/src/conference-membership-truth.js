const VALID_STATES = new Set(["member", "independent", "unknown"]);
const DEFAULT_MAX_SYNC_ROWS = 1500;

function clean(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

export function normalizeConferenceMembership(row = {}) {
  const state = clean(row.membership_state)?.toLowerCase() || "unknown";
  if (!VALID_STATES.has(state)) throw new Error(`invalid conference membership state: ${state}`);
  const teamId = clean(row.team_id);
  const conferenceId = clean(row.conference_id);
  const provider = clean(row.authority_provider);
  const verifiedAt = clean(row.verified_at);
  if (!teamId) throw new Error("conference membership requires team_id");
  if (!provider) throw new Error("conference membership requires authority_provider");
  if (!verifiedAt) throw new Error("conference membership requires verified_at");
  if (state === "member" && !conferenceId) throw new Error("member conference membership requires conference_id");
  if (state !== "member" && conferenceId) throw new Error(`${state} conference membership cannot carry conference_id`);
  return {
    team_id: teamId,
    membership_state: state,
    conference_id: state === "member" ? conferenceId : null,
    conference_name: state === "member" ? clean(row.conference_name) : null,
    classification: clean(row.classification),
    division: clean(row.division),
    authority_provider: provider,
    authority_key: clean(row.authority_key),
    source_url: clean(row.source_url),
    verified_at: verifiedAt
  };
}

export function membershipCoverageReport(rows = []) {
  const counts = { member: 0, independent: 0, unknown: 0 };
  const problems = [];
  for (const row of rows) {
    try {
      const truth = normalizeConferenceMembership(row);
      counts[truth.membership_state] += 1;
    } catch (error) {
      problems.push({ team_id: clean(row?.team_id), reason: String(error?.message || error) });
    }
  }
  return {
    teams: rows.length,
    ...counts,
    invalid: problems.length,
    explicit: rows.length - problems.length,
    complete: problems.length === 0 && counts.unknown === 0,
    unresolved: counts.unknown + problems.length,
    problems
  };
}

export { DEFAULT_MAX_SYNC_ROWS, VALID_STATES };
