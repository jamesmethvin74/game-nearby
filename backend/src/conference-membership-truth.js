const VALID_STATES = new Set(["member", "independent", "unknown"]);

function clean(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

export function normalizeConferenceMembership(row = {}) {
  const state = clean(row.membership_state)?.toLowerCase() || "unknown";
  if (!VALID_STATES.has(state)) throw new Error(`invalid conference membership state: ${state}`);

  const conferenceId = clean(row.conference_id);
  const provider = clean(row.authority_provider);
  const verifiedAt = clean(row.verified_at);

  if (!provider) throw new Error("conference membership requires authority_provider");
  if (!verifiedAt) throw new Error("conference membership requires verified_at");
  if (state === "member" && !conferenceId) throw new Error("member conference membership requires conference_id");
  if (state !== "member" && conferenceId) throw new Error(`${state} conference membership cannot carry conference_id`);

  return {
    team_id: clean(row.team_id),
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

export function membershipPublicStatus(row = {}) {
  const truth = normalizeConferenceMembership(row);
  const knownMember = truth.membership_state === "member";
  return {
    conference_membership_state: truth.membership_state,
    conference_id: knownMember ? truth.conference_id : null,
    conference_name: knownMember ? truth.conference_name : null,
    conference_classification: truth.classification,
    conference_division: truth.division,
    membership_source: truth.authority_provider,
    membership_authority_key: truth.authority_key,
    membership_source_url: truth.source_url,
    membership_verified_at: truth.verified_at,
    standing_state: knownMember ? "unavailable" : truth.membership_state
  };
}

export function membershipCoverageReport(rows = []) {
  const counts = { member: 0, independent: 0, unknown: 0 };
  const missing = [];
  for (const row of rows) {
    try {
      const truth = normalizeConferenceMembership(row);
      counts[truth.membership_state] += 1;
      if (!truth.team_id) missing.push({ team_id: null, reason: "missing_team_id" });
    } catch (error) {
      missing.push({ team_id: clean(row?.team_id), reason: String(error?.message || error) });
    }
  }
  return {
    teams: rows.length,
    ...counts,
    invalid: missing.length,
    explicit: rows.length - missing.length,
    complete: missing.length === 0 && counts.unknown === 0,
    unresolved: counts.unknown + missing.length,
    problems: missing
  };
}

export function membershipFromSeed(seed = {}) {
  if (!seed.conference_membership_state) return null;
  return membershipPublicStatus({
    team_id: seed.reporting_team_id || seed.team_id,
    membership_state: seed.conference_membership_state,
    conference_id: seed.verified_conference_id,
    conference_name: seed.verified_conference_name,
    classification: seed.conference_classification,
    division: seed.conference_division,
    authority_provider: seed.membership_authority_provider,
    authority_key: seed.membership_authority_key,
    source_url: seed.membership_source_url,
    verified_at: seed.membership_verified_at
  });
}

export function conferenceMembershipSeedColumns() {
  return `cm.membership_state AS conference_membership_state,
    cm.conference_id AS verified_conference_id,
    vc.name AS verified_conference_name,
    COALESCE(cm.classification,vc.classification) AS conference_classification,
    cm.division AS conference_division,
    cm.authority_provider AS membership_authority_provider,
    cm.authority_key AS membership_authority_key,
    cm.source_url AS membership_source_url,
    cm.verified_at AS membership_verified_at`;
}

export { VALID_STATES };
