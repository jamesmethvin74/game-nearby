import {
  TEAM_SNAPSHOT_SQL,
  CANONICAL_SNAPSHOT_SQL,
  SCHEDULE_CANDIDATE_SQL,
  SEASON_START,
  SEASON_END_EXCLUSIVE,
  collectPublishedVolleyballAuthority,
  collectMaxPrepsVolleyballAuthority,
  buildVolleyballCompletenessAudit,
  localDate
} from "./volleyball-completeness-audit.js";

const BROKEN_ORDER = "ORDER BY team_id,scheduled_at,COALESCE(canonical_event_id,'')";
const FIXED_ORDER = "ORDER BY team_id,scheduled_at,canonical_event_id";

export const FIXED_SCHEDULE_CANDIDATE_SQL = SCHEDULE_CANDIDATE_SQL.replace(BROKEN_ORDER, FIXED_ORDER);
if (FIXED_SCHEDULE_CANDIDATE_SQL === SCHEDULE_CANDIDATE_SQL) {
  throw new Error("volleyball audit SQL fix did not match expected compound ORDER BY");
}

function rowsRead(result) { return Number(result?.meta?.rows_read || 0); }
function rowsWritten(result) { return Number(result?.meta?.rows_written || 0); }

export async function loadFixedVolleyballAuditSnapshot(env) {
  const statements = [
    env.DB.prepare(TEAM_SNAPSHOT_SQL),
    env.DB.prepare(CANONICAL_SNAPSHOT_SQL).bind(SEASON_START, SEASON_END_EXCLUSIVE),
    env.DB.prepare(FIXED_SCHEDULE_CANDIDATE_SQL).bind(
      SEASON_START,
      SEASON_END_EXCLUSIVE,
      SEASON_START,
      SEASON_END_EXCLUSIVE
    )
  ];
  const results = await env.DB.batch(statements);
  const writes = results.reduce((sum, result) => sum + rowsWritten(result), 0);
  if (writes !== 0) {
    throw new Error(`volleyball completeness audit must be zero-write; observed rows_written=${writes}`);
  }
  return {
    teams: results[0]?.results || [],
    canonicals: results[1]?.results || [],
    candidates: results[2]?.results || [],
    d1: {
      statements: 3,
      rows_read: results.reduce((sum, result) => sum + rowsRead(result), 0),
      rows_written: writes,
      per_statement: results.map((result, index) => ({
        statement: index + 1,
        rows_read: rowsRead(result),
        rows_written: rowsWritten(result)
      }))
    }
  };
}

export async function runFixedVolleyballCompletenessAudit(env, { fetchFn = fetch, now = new Date() } = {}) {
  const published = await collectPublishedVolleyballAuthority(fetchFn);
  if (!published.discoveryComplete) {
    throw new Error(`published volleyball conference discovery incomplete: ${published.discoveredConferenceCount} conferences`);
  }
  const snapshot = await loadFixedVolleyballAuditSnapshot(env);
  const maxPreps = await collectMaxPrepsVolleyballAuthority(snapshot.teams, {
    fetchFn,
    startDate: SEASON_START,
    endDate: localDate(now)
  });
  return {
    ...buildVolleyballCompletenessAudit({
      teams: snapshot.teams,
      canonicals: snapshot.canonicals,
      candidates: snapshot.candidates,
      published,
      maxPreps,
      generatedAt: now.toISOString()
    }),
    d1: snapshot.d1,
    authority_fetch: {
      discovered_published_conferences: published.discoveredConferenceCount,
      published_conference_failures: published.failures,
      maxpreps_dates: maxPreps.dates.length,
      maxpreps_parsed_finals: maxPreps.parsedFinals,
      maxpreps_ambiguous_matches: maxPreps.ambiguous.length,
      maxpreps_failures: maxPreps.failures
    }
  };
}
