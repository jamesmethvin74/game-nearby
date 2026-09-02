import app from "./worker.js";
import { applySchoolDisplayNames, dedupeScheduleRows } from "./schedule-response-normalizer.js";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=120, stale-while-revalidate=300"
    }
  });
}

function emptyRecord(teamId) {
  return {
    team_id: teamId,
    wins: 0,
    losses: 0,
    ties: 0,
    conference_wins: 0,
    conference_losses: 0,
    conference_ties: 0,
    calculated_at: null
  };
}

function resolvedGameForTeam(row, team) {
  const base = {
    ...row,
    school_id: team.school_id,
    school_name: team.school_name,
    sport: row.sport || team.sport,
    gender: row.gender || team.gender,
    season: row.season || team.season,
    level: row.level || team.level,
    conference_name: row.conference_name || team.conference_name || null
  };

  if (!row.canonical_event_id) {
    return {
      ...base,
      data_trust: row.data_trust || "SINGLE_SOURCE_LIVE",
      conflict_count: Number(row.conflict_count || 0)
    };
  }

  const isHome = row.canonical_home_school_id === team.school_id;
  const isAway = row.canonical_away_school_id === team.school_id;
  const teamScore = isHome ? row.canonical_home_score : isAway ? row.canonical_away_score : row.team_score;
  const opponentScore = isHome ? row.canonical_away_score : isAway ? row.canonical_home_score : row.opponent_score;
  const status = row.canonical_status || row.status;
  const result = status === "FINAL" && teamScore != null && opponentScore != null
    ? (Number(teamScore) === Number(opponentScore) ? "T" : Number(teamScore) > Number(opponentScore) ? "W" : "L")
    : null;

  return {
    ...base,
    id: row.canonical_event_id,
    canonical_event_id: row.canonical_event_id,
    opponent: isHome ? row.canonical_away_name : isAway ? row.canonical_home_name : row.opponent,
    scheduled_at: row.canonical_scheduled_at || row.scheduled_at,
    scheduled_time_known: row.canonical_time_known ?? row.scheduled_time_known,
    venue: row.canonical_venue || row.venue,
    home_away: isHome ? "home" : isAway ? "away" : row.home_away,
    status,
    team_score: teamScore,
    opponent_score: opponentScore,
    result,
    data_trust: row.data_trust || "SINGLE_SOURCE_LIVE",
    conflict_count: Number(row.conflict_count || 0)
  };
}

async function displayNamesForGames(env, games, reportingSchoolId) {
  const ids = new Set([reportingSchoolId].filter(Boolean));
  for (const game of games || []) {
    for (const id of [game.school_id, game.canonical_home_school_id, game.canonical_away_school_id]) {
      if (id) ids.add(id);
    }
  }
  if (!ids.size) return new Map();
  const { results } = await env.DB.prepare(`
    SELECT id, COALESCE(NULLIF(location_matched_name,''),name) AS display_name
    FROM schools
    WHERE id IN (SELECT value FROM json_each(?))
  `).bind(JSON.stringify([...ids])).all();
  return new Map(results.map(row => [row.id, row.display_name]));
}

async function normalizeGames(env, games, reportingSchoolId) {
  const names = await displayNamesForGames(env, games, reportingSchoolId);
  const cleaned = games.map(game => applySchoolDisplayNames(game, names, { reportingSchoolId }));
  return dedupeScheduleRows(cleaned, { reportingSchoolId });
}

async function readTeamSchedule(env, teamId) {
  const team = await env.DB.prepare(`
    SELECT t.*, s.name AS school_name, s.level,
      c.name AS conference_name
    FROM teams t
    JOIN schools s ON s.id=t.school_id
    LEFT JOIN conferences c ON c.id=t.conference_id
    WHERE t.id=? AND t.active=1 AND s.catalog_scope='local'
  `).bind(teamId).first();
  if (!team) return json({ error: "team_not_found" }, 404);

  const record = await env.DB.prepare("SELECT * FROM team_records WHERE team_id=?").bind(teamId).first();
  const { results } = await env.DB.prepare(`
    SELECT g.*, s.source_type, s.parser_type, s.authority_rank,
      s.last_successful_fetch_at AS source_last_successful_fetch_at,
      ce.scheduled_at AS canonical_scheduled_at,
      ce.scheduled_time_known AS canonical_time_known,
      ce.venue AS canonical_venue,
      ce.status AS canonical_status,
      ce.home_score AS canonical_home_score,
      ce.away_score AS canonical_away_score,
      ce.home_school_id AS canonical_home_school_id,
      ce.away_school_id AS canonical_away_school_id,
      ce.trust_state AS data_trust,
      ce.conflict_count,
      hs.name AS canonical_home_name,
      aws.name AS canonical_away_name,
      ROW_NUMBER() OVER (
        PARTITION BY COALESCE(g.canonical_event_id,g.id)
        ORDER BY s.authority_rank,s.source_priority,s.id
      ) AS authority_row
    FROM games g
    JOIN sources s ON s.id=g.source_id
    LEFT JOIN canonical_events ce ON ce.id=g.canonical_event_id
    LEFT JOIN schools hs ON hs.id=ce.home_school_id
    LEFT JOIN schools aws ON aws.id=ce.away_school_id
    WHERE g.team_id=?
    ORDER BY COALESCE(ce.scheduled_at,g.scheduled_at)
  `).bind(teamId).all();

  const resolved = results
    .filter(row => Number(row.authority_row) === 1)
    .map(row => resolvedGameForTeam(row, team));
  const games = await normalizeGames(env, resolved, team.school_id);

  return json({
    teamId,
    games,
    record: {
      ...emptyRecord(teamId),
      ...(record || {}),
      conference_id: team.conference_id || null,
      conference_name: team.conference_name || null
    }
  });
}

async function readTeamRecord(env, teamId) {
  const row = await env.DB.prepare(`
    SELECT t.id AS team_id, t.conference_id, c.name AS conference_name,
      r.wins, r.losses, r.ties,
      r.conference_wins, r.conference_losses, r.conference_ties,
      r.calculated_at
    FROM teams t
    JOIN schools s ON s.id=t.school_id
    LEFT JOIN team_records r ON r.team_id=t.id
    LEFT JOIN conferences c ON c.id=t.conference_id
    WHERE t.id=? AND t.active=1 AND s.catalog_scope='local'
  `).bind(teamId).first();
  if (!row) return json({ error: "team_not_found" }, 404);
  return json({ record: { ...emptyRecord(teamId), ...row } });
}

async function handleTeamRead(request, env) {
  if (request.method !== "GET") return null;
  const path = new URL(request.url).pathname;
  let match = path.match(/^\/api\/v1\/teams\/([^/]+)\/schedule$/);
  if (match) return readTeamSchedule(env, decodeURIComponent(match[1]));
  match = path.match(/^\/api\/v1\/teams\/([^/]+)\/record$/);
  if (match) return readTeamRecord(env, decodeURIComponent(match[1]));
  return null;
}

export default {
  async fetch(request, env, ctx) {
    try {
      const teamResponse = await handleTeamRead(request, env);
      if (teamResponse) return teamResponse;
    } catch (error) {
      console.error("read-only team detail failed", error);
      return json({ error: "team_detail_failed", message: "Team schedule could not be loaded." }, 500);
    }
    return app.fetch(request, env, ctx);
  },
  async scheduled(controller, env, ctx) {
    return app.scheduled(controller, env, ctx);
  }
};
