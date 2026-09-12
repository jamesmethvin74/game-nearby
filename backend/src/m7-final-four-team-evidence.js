const PEA_TEAM = "df-7x4sxh-volleyball-2026";
const HARRISON_TEAM = "df-ht8yyh-volleyball-2026";
const WINDOW_START = "2026-08-23T05:00:00.000Z";
const WINDOW_END = "2026-08-27T05:00:00.000Z";
const MAX_READS = 5000;

function rowsRead(result) {
  return Number(result?.meta?.rows_read || 0);
}

function rowsWritten(result) {
  return Number(result?.meta?.rows_written || 0);
}

function normalize(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function resolveTeam(rows, prefix) {
  const matches = rows.filter((row) => normalize(row.name).startsWith(prefix));
  return matches.length === 1 ? matches[0] : null;
}

export async function readM7FinalFourTeamEvidence(env) {
  const teamLookup = await env.DB.prepare(`SELECT s.id AS school_id, s.name, t.id AS team_id
    FROM teams t
    JOIN schools s ON s.id = t.school_id
    WHERE t.sport='volleyball'
      AND t.gender='girls'
      AND t.season='2026'
      AND t.active=1
      AND s.state='AR'
      AND (lower(s.name) LIKE 'providence%' OR lower(s.name) LIKE 'valley springs%')
    ORDER BY s.name, t.id`).all();

  const lookupRows = teamLookup.results || [];
  const providence = resolveTeam(lookupRows, "providence");
  const valleySprings = resolveTeam(lookupRows, "valley springs");
  if (!providence || !valleySprings) {
    throw new Error(`exact team resolution failed: providence=${Boolean(providence)} valley=${Boolean(valleySprings)}`);
  }

  const teamIds = [PEA_TEAM, HARRISON_TEAM, providence.team_id, valleySprings.team_id];
  const [directGames, canonicalMemberships] = await env.DB.batch([
    env.DB.prepare(`SELECT id, team_id, source_id, source_event_key, opponent, opponent_school_id,
      scheduled_at, status, team_score, opponent_score, result, counts_for_record,
      canonical_event_id, home_away
      FROM games
      WHERE team_id IN (?,?,?,?)
        AND status='FINAL'
        AND scheduled_at>=?
        AND scheduled_at<?
      ORDER BY team_id, scheduled_at, id`)
      .bind(...teamIds, WINDOW_START, WINDOW_END),
    env.DB.prepare(`SELECT cem.reporting_team_id, cem.game_id,
      ce.id AS canonical_event_id, ce.scheduled_at AS canonical_scheduled_at,
      ce.status AS canonical_status, ce.home_school_id, ce.away_school_id,
      ce.home_score, ce.away_score, ce.conflict_count,
      g.team_id, g.source_id, g.source_event_key, g.opponent, g.opponent_school_id,
      g.scheduled_at AS game_scheduled_at, g.status AS game_status,
      g.team_score, g.opponent_score, g.result, g.counts_for_record, g.home_away
      FROM canonical_event_members cem
      JOIN canonical_events ce ON ce.id=cem.canonical_event_id
      JOIN games g ON g.id=cem.game_id
      WHERE cem.reporting_team_id IN (?,?,?,?)
        AND ce.scheduled_at>=?
        AND ce.scheduled_at<?
      ORDER BY cem.reporting_team_id, ce.scheduled_at, cem.game_id`)
      .bind(...teamIds, WINDOW_START, WINDOW_END)
  ]);

  const statements = [teamLookup, directGames, canonicalMemberships];
  const d1 = {
    statements: statements.length,
    rows_read: statements.reduce((sum, result) => sum + rowsRead(result), 0),
    rows_written: statements.reduce((sum, result) => sum + rowsWritten(result), 0),
    per_statement: statements.map((result) => ({
      rows_read: rowsRead(result),
      rows_written: rowsWritten(result)
    }))
  };
  if (d1.rows_written !== 0) throw new Error(`read-only evidence wrote ${d1.rows_written}`);
  if (d1.rows_read > MAX_READS) throw new Error(`four-team evidence read fuse exceeded ${d1.rows_read}`);

  return {
    fingerprint: "m7-final-four-team-evidence-v1",
    window: { start: WINDOW_START, end: WINDOW_END },
    teams: { pea_ridge: PEA_TEAM, harrison: HARRISON_TEAM, providence, valley_springs: valleySprings },
    direct_games: directGames.results || [],
    canonical_memberships: canonicalMemberships.results || [],
    d1
  };
}
