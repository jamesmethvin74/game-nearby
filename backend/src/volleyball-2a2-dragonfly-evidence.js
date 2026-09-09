const TEAM_IDS = [
  "df-sz3b5e-volleyball-2026",
  "df-ltv6cw-volleyball-2026",
  "df-mr3rj5-volleyball-2026",
  "df-st7tzg-volleyball-2026"
];

export async function load2a2DragonFlyEvidence(env) {
  const { results } = await env.DB.prepare(`
    SELECT
      g.team_id,
      s.name AS school_name,
      g.opponent,
      g.opponent_school_id,
      os.name AS opponent_school_name,
      g.scheduled_at,
      g.conference_game,
      g.status,
      g.source_id,
      src.source_type,
      src.parser_type,
      g.last_checked_at
    FROM games g
    JOIN teams t ON t.id=g.team_id
    JOIN schools s ON s.id=t.school_id
    JOIN sources src ON src.id=g.source_id
    LEFT JOIN schools os ON os.id=g.opponent_school_id
    WHERE g.team_id IN (SELECT value FROM json_each(?))
      AND src.source_type='official-conference'
      AND src.parser_type='dragonfly-public'
      AND g.scheduled_at >= '2026-08-01T00:00:00.000Z'
      AND g.scheduled_at < '2026-11-01T00:00:00.000Z'
    ORDER BY g.team_id,g.scheduled_at,g.id
  `).bind(JSON.stringify(TEAM_IDS)).all();

  return {
    team_ids: TEAM_IDS,
    row_count: (results || []).length,
    rows: results || []
  };
}
