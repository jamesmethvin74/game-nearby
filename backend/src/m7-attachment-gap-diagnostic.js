const MAX_ROWS_READ = 50000;
const MAX_GAPS = 20;
const SEASON_START = "2026-08-01T00:00:00.000Z";
const SEASON_END = "2026-12-01T00:00:00.000Z";
const TIME_ZONE = "America/Chicago";

function rowsRead(result) { return Number(result?.meta?.rows_read || 0); }
function rowsWritten(result) { return Number(result?.meta?.rows_written || 0); }

const GAP_SQL = `
  WITH vb AS (
    SELECT t.id AS team_id,t.school_id,
      COALESCE(NULLIF(s.location_matched_name,''),s.name) AS school_name
    FROM teams t
    JOIN schools s ON s.id=t.school_id
    WHERE t.active=1
      AND t.sport='volleyball'
      AND t.gender='girls'
      AND t.season='2026'
      AND s.level='high-school'
      AND s.state='AR'
      AND s.catalog_scope='local'
  )
  SELECT ce.id AS canonical_event_id,ce.scheduled_at,
    ce.home_school_id,ht.team_id AS home_team_id,ht.school_name AS home_name,ce.home_score,
    ce.away_school_id,at.team_id AS away_team_id,at.school_name AS away_name,ce.away_score,
    ce.selected_source_id,ce.trust_state,
    CASE WHEN EXISTS (
      SELECT 1 FROM canonical_event_members cem
      WHERE cem.reporting_team_id=ht.team_id AND cem.canonical_event_id=ce.id
    ) THEN 1 ELSE 0 END AS home_attached,
    CASE WHEN EXISTS (
      SELECT 1 FROM canonical_event_members cem
      WHERE cem.reporting_team_id=at.team_id AND cem.canonical_event_id=ce.id
    ) THEN 1 ELSE 0 END AS away_attached
  FROM canonical_events ce
  JOIN vb ht ON ht.school_id=ce.home_school_id
  JOIN vb at ON at.school_id=ce.away_school_id
  WHERE ce.sport='volleyball'
    AND ce.gender='girls'
    AND ce.season='2026'
    AND ce.status='FINAL'
    AND ce.home_score IS NOT NULL
    AND ce.away_score IS NOT NULL
    AND ce.scheduled_at>=? AND ce.scheduled_at<?
    AND (
      NOT EXISTS (
        SELECT 1 FROM canonical_event_members cem
        WHERE cem.reporting_team_id=ht.team_id AND cem.canonical_event_id=ce.id
      )
      OR NOT EXISTS (
        SELECT 1 FROM canonical_event_members cem
        WHERE cem.reporting_team_id=at.team_id AND cem.canonical_event_id=ce.id
      )
    )
  ORDER BY ce.scheduled_at,ce.id
  LIMIT 21`;

function localDate(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(date);
  const get = type => parts.find(part => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function compactGame(row) {
  return {
    game_id: row.id,
    team_id: row.team_id,
    source_id: row.source_id,
    source_event_key: row.source_event_key || null,
    opponent: row.opponent || null,
    opponent_school_id: row.opponent_school_id || null,
    scheduled_at: row.scheduled_at || null,
    local_date: localDate(row.scheduled_at),
    status: row.status || null,
    team_score: row.team_score == null ? null : Number(row.team_score),
    opponent_score: row.opponent_score == null ? null : Number(row.opponent_score),
    home_away: row.home_away || null,
    counts_for_record: Number(row.counts_for_record || 0),
    canonical_event_id: row.canonical_event_id || null,
    source_type: row.source_type || null,
    parser_type: row.parser_type || null,
    authority_rank: Number(row.authority_rank || 0)
  };
}

export async function diagnoseM7AttachmentGaps(env) {
  const gapResult = await env.DB.prepare(GAP_SQL).bind(SEASON_START, SEASON_END).all();
  if (rowsWritten(gapResult) !== 0) throw new Error("attachment gap query wrote to D1");
  const gapRows = gapResult.results || [];
  if (gapRows.length > MAX_GAPS) throw new Error(`attachment gap query exceeded result fuse: ${gapRows.length}`);

  const missing = [];
  for (const row of gapRows) {
    if (Number(row.home_attached || 0) === 0) missing.push({
      canonical_event_id: row.canonical_event_id,
      scheduled_at: row.scheduled_at,
      missing_side: "home",
      missing_team_id: row.home_team_id,
      missing_school_id: row.home_school_id,
      missing_name: row.home_name,
      opponent_team_id: row.away_team_id,
      opponent_school_id: row.away_school_id,
      opponent_name: row.away_name,
      expected_team_score: Number(row.home_score),
      expected_opponent_score: Number(row.away_score),
      selected_source_id: row.selected_source_id || null,
      trust_state: row.trust_state || null
    });
    if (Number(row.away_attached || 0) === 0) missing.push({
      canonical_event_id: row.canonical_event_id,
      scheduled_at: row.scheduled_at,
      missing_side: "away",
      missing_team_id: row.away_team_id,
      missing_school_id: row.away_school_id,
      missing_name: row.away_name,
      opponent_team_id: row.home_team_id,
      opponent_school_id: row.home_school_id,
      opponent_name: row.home_name,
      expected_team_score: Number(row.away_score),
      expected_opponent_score: Number(row.home_score),
      selected_source_id: row.selected_source_id || null,
      trust_state: row.trust_state || null
    });
  }
  if (missing.length > MAX_GAPS) throw new Error(`attachment diagnostic found ${missing.length} gaps, above safety fuse`);

  const teamIds = [...new Set(missing.map(row => row.missing_team_id).filter(Boolean))];
  let gameResult = { results: [], meta: { rows_read: 0, rows_written: 0 } };
  if (teamIds.length) {
    gameResult = await env.DB.prepare(`
      SELECT g.id,g.team_id,g.source_id,g.source_event_key,g.opponent,g.opponent_school_id,
        g.scheduled_at,g.status,g.team_score,g.opponent_score,g.home_away,g.counts_for_record,
        g.canonical_event_id,src.source_type,src.parser_type,src.authority_rank
      FROM games g
      JOIN sources src ON src.id=g.source_id
      WHERE g.team_id IN (SELECT value FROM json_each(?))
        AND g.scheduled_at>=? AND g.scheduled_at<?
      ORDER BY g.team_id,g.scheduled_at,g.id`).bind(JSON.stringify(teamIds), SEASON_START, SEASON_END).all();
  }
  if (rowsWritten(gameResult) !== 0) throw new Error("attachment candidate query wrote to D1");

  const games = gameResult.results || [];
  const items = missing.map(row => {
    const eventDate = localDate(row.scheduled_at);
    const candidates = games.filter(game =>
      String(game.team_id) === String(row.missing_team_id)
      && String(game.opponent_school_id || "") === String(row.opponent_school_id || "")
      && localDate(game.scheduled_at) === eventDate
    ).map(compactGame);
    const exactScoreCandidates = candidates.filter(game =>
      game.status === "FINAL"
      && Number(game.team_score) === Number(row.expected_team_score)
      && Number(game.opponent_score) === Number(row.expected_opponent_score)
    );
    let classification = "no_team_side_observation";
    if (exactScoreCandidates.length === 1) {
      const candidate = exactScoreCandidates[0];
      classification = candidate.canonical_event_id === row.canonical_event_id
        ? "member_row_missing_only"
        : candidate.canonical_event_id
          ? "game_attached_to_other_canonical"
          : "safe_existing_game_to_attach";
    } else if (exactScoreCandidates.length > 1) {
      classification = "multiple_exact_team_side_observations";
    } else if (candidates.length) {
      classification = "same_day_observation_score_mismatch";
    }
    return {
      ...row,
      local_date: eventDate,
      candidate_games: candidates,
      exact_score_candidate_count: exactScoreCandidates.length,
      classification
    };
  });

  const d1 = {
    statements: teamIds.length ? 2 : 1,
    rows_read: rowsRead(gapResult) + rowsRead(gameResult),
    rows_written: rowsWritten(gapResult) + rowsWritten(gameResult),
    per_statement: [
      { rows_read: rowsRead(gapResult), rows_written: rowsWritten(gapResult) },
      ...(teamIds.length ? [{ rows_read: rowsRead(gameResult), rows_written: rowsWritten(gameResult) }] : [])
    ]
  };
  if (d1.rows_written !== 0) throw new Error(`attachment diagnostic wrote ${d1.rows_written} rows`);
  if (d1.rows_read > MAX_ROWS_READ) throw new Error(`attachment diagnostic exceeded read fuse: ${d1.rows_read}`);

  return {
    generated_at: new Date().toISOString(),
    gap_event_count: gapRows.length,
    missing_attachment_count: items.length,
    items,
    d1
  };
}
