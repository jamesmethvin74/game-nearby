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

function membershipUpsertStatement(env, rows, now) {
  return env.DB.prepare(`
    WITH payload AS (
      SELECT
        json_extract(value,'$.team_id') AS team_id,
        json_extract(value,'$.conference_id') AS conference_id,
        json_extract(value,'$.membership_state') AS membership_state,
        json_extract(value,'$.classification') AS classification,
        json_extract(value,'$.division') AS division,
        json_extract(value,'$.authority_provider') AS authority_provider,
        json_extract(value,'$.authority_key') AS authority_key,
        json_extract(value,'$.source_url') AS source_url,
        json_extract(value,'$.verified_at') AS verified_at
      FROM json_each(?)
    )
    INSERT INTO conference_memberships(
      team_id,conference_id,membership_state,classification,division,
      authority_provider,authority_key,source_url,verified_at,updated_at
    )
    SELECT team_id,conference_id,membership_state,classification,division,
      authority_provider,authority_key,source_url,verified_at,?
    FROM payload WHERE true
    ON CONFLICT(team_id) DO UPDATE SET
      conference_id=excluded.conference_id,
      membership_state=excluded.membership_state,
      classification=excluded.classification,
      division=excluded.division,
      authority_provider=excluded.authority_provider,
      authority_key=excluded.authority_key,
      source_url=excluded.source_url,
      verified_at=excluded.verified_at,
      updated_at=excluded.updated_at
    WHERE COALESCE(conference_memberships.conference_id,'')<>COALESCE(excluded.conference_id,'')
       OR conference_memberships.membership_state<>excluded.membership_state
       OR COALESCE(conference_memberships.classification,'')<>COALESCE(excluded.classification,'')
       OR COALESCE(conference_memberships.division,'')<>COALESCE(excluded.division,'')
       OR conference_memberships.authority_provider<>excluded.authority_provider
       OR COALESCE(conference_memberships.authority_key,'')<>COALESCE(excluded.authority_key,'')
       OR COALESCE(conference_memberships.source_url,'')<>COALESCE(excluded.source_url,'')
       OR conference_memberships.verified_at<>excluded.verified_at
  `).bind(JSON.stringify(rows), now);
}

function teamConferencePointerStatement(env, rows, now) {
  return env.DB.prepare(`
    WITH payload AS (
      SELECT
        json_extract(value,'$.team_id') AS team_id,
        CASE WHEN json_extract(value,'$.membership_state')='member'
          THEN json_extract(value,'$.conference_id') ELSE NULL END AS conference_id
      FROM json_each(?)
    )
    UPDATE teams AS t
    SET conference_id=p.conference_id,
        updated_at=?
    FROM payload AS p
    WHERE t.id=p.team_id
      AND COALESCE(t.conference_id,'')<>COALESCE(p.conference_id,'')
  `).bind(JSON.stringify(rows), now);
}

export async function syncConferenceMembershipTruth(env, memberships = [], {
  dryRun = false,
  maxRows = DEFAULT_MAX_SYNC_ROWS,
  now = new Date()
} = {}) {
  const rows = memberships.map(normalizeConferenceMembership);
  const limit = Number(maxRows);
  if (!Number.isInteger(limit) || limit < 0) throw new Error("maxRows must be a non-negative integer");
  if (rows.length > limit) throw new Error(`conference membership row fuse exceeded: ${rows.length} > ${limit}`);
  const duplicateIds = rows.map(row => row.team_id).filter((id, index, all) => all.indexOf(id) !== index);
  if (duplicateIds.length) throw new Error(`duplicate conference membership team_id: ${[...new Set(duplicateIds)].join(",")}`);

  const coverage = membershipCoverageReport(rows);
  if (dryRun || !rows.length) {
    return { status: dryRun ? "DRY_RUN" : "NO_CHANGES", rows: rows.length, coverage, d1_statements: 0, membership_writes: 0, team_pointer_writes: 0 };
  }

  const checkedAt = now.toISOString();
  const result = await env.DB.batch([
    membershipUpsertStatement(env, rows, checkedAt),
    teamConferencePointerStatement(env, rows, checkedAt)
  ]);
  return {
    status: "SUCCESS",
    rows: rows.length,
    coverage,
    d1_statements: 2,
    membership_writes: Number(result?.[0]?.meta?.changes || result?.[0]?.changes || 0),
    team_pointer_writes: Number(result?.[1]?.meta?.changes || result?.[1]?.changes || 0)
  };
}

export async function auditConferenceMembershipTruth(env, { season = "2026" } = {}) {
  const result = await env.DB.prepare(`
    SELECT t.id AS team_id,t.sport,t.gender,t.season,s.level,s.name AS school_name,
      cm.membership_state,cm.conference_id,cm.classification,cm.division,
      cm.authority_provider,cm.authority_key,cm.source_url,cm.verified_at,
      c.name AS conference_name
    FROM teams t
    JOIN schools s ON s.id=t.school_id
    LEFT JOIN conference_memberships cm ON cm.team_id=t.id
    LEFT JOIN conferences c ON c.id=cm.conference_id
    WHERE t.active=1 AND t.season=? AND s.catalog_scope='local'
    ORDER BY s.level,t.sport,t.gender,s.name,t.id
  `).bind(season).all();
  const rows = (result.results || []).map(row => row.membership_state ? row : {
    ...row,
    membership_state:"unknown",
    authority_provider:"missing",
    verified_at:"missing"
  });
  return {
    season,
    coverage: membershipCoverageReport(rows),
    rows,
    d1: {
      rows_read:Number(result.meta?.rows_read || 0),
      rows_written:Number(result.meta?.rows_written || 0)
    }
  };
}

export { DEFAULT_MAX_SYNC_ROWS, VALID_STATES };
