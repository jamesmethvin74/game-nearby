import app from "./d1-usage-public-worker.js";
import core from "./index.js";
import { runScopedCadence } from "./scoped-cadence-runner.js";
import { recordFromScheduleRows } from "./schedule-response-normalizer.js";
import { normalizeSchoolAlias } from "./schedule-authority-core.js";
import { findPublishedConferenceMembership } from "./published-standings.js";
import { loadStandingsTruth } from "./standings-truth.js";
import { attachEffectiveConferenceGames } from "./conference-game-inference.js";

const LEGACY_VOLLEYBALL_SUFFIX = "-volleyball-2026";
const COLLEGE_BOOTSTRAP_PATH = "/api/v1/m4/college-bootstrap";
const COLLEGE_BOOTSTRAP_SEASON = "2026";
const STANDINGS_SPORTS = new Set(["football", "volleyball"]);

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=120, stale-while-revalidate=300",
      "access-control-allow-origin": "*"
    }
  });
}

function privateJson(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function authorizedWrite(request, env) {
  return Boolean(env.REFRESH_TOKEN) && request.headers.get("x-refresh-token") === env.REFRESH_TOKEN;
}

function localSchoolId(pathname) {
  const match = pathname.match(/^\/api\/v1\/schools\/([^/]+)\/schedule$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function legacyCollegeSchoolId(pathname) {
  const match = pathname.match(/^\/api\/v1\/teams\/([^/]+)\/schedule$/);
  if (!match) return null;
  const teamId = decodeURIComponent(match[1]);
  if (!teamId.endsWith(LEGACY_VOLLEYBALL_SUFFIX)) return null;
  return teamId.slice(0, -LEGACY_VOLLEYBALL_SUFFIX.length) || null;
}

function resolvedGameForSchool(row, schoolId) {
  if (!row.canonical_event_id) {
    return {
      ...row,
      conference_game: Number(row.effective_conference_game ?? row.conference_game ?? 0),
      data_trust: row.data_trust || "SINGLE_SOURCE_LIVE",
      conflict_count: Number(row.conflict_count || 0)
    };
  }

  const isHome = row.canonical_home_school_id === schoolId;
  const isAway = row.canonical_away_school_id === schoolId;
  const teamScore = isHome ? row.canonical_home_score : isAway ? row.canonical_away_score : row.team_score;
  const opponentScore = isHome ? row.canonical_away_score : isAway ? row.canonical_home_score : row.opponent_score;
  const status = row.canonical_status || row.status;
  const result = status === "FINAL" && teamScore != null && opponentScore != null
    ? (Number(teamScore) === Number(opponentScore) ? "T" : Number(teamScore) > Number(opponentScore) ? "W" : "L")
    : null;

  return {
    ...row,
    id: row.canonical_event_id,
    canonical_event_id: row.canonical_event_id,
    opponent: isHome ? row.canonical_away_name : isAway ? row.canonical_home_name : row.opponent,
    scheduled_at: row.canonical_scheduled_at || row.scheduled_at,
    scheduled_time_known: row.canonical_time_known ?? row.scheduled_time_known,
    venue: row.canonical_venue || row.venue,
    location_text: row.canonical_location_text || row.location_text,
    latitude: row.canonical_latitude ?? row.latitude,
    longitude: row.canonical_longitude ?? row.longitude,
    home_away: isHome ? "home" : isAway ? "away" : row.home_away,
    conference_game: Number(row.effective_conference_game ?? row.canonical_conference_game ?? row.conference_game ?? 0),
    status,
    team_score: teamScore,
    opponent_score: opponentScore,
    result,
    data_trust: row.data_trust || "SINGLE_SOURCE_LIVE",
    conflict_count: Number(row.conflict_count || 0)
  };
}

function recordGameCount(record = {}) {
  return Number(record.wins || 0) + Number(record.losses || 0) + Number(record.ties || 0);
}

function conferenceGameCount(record = {}) {
  return Number(record.conference_wins || 0) + Number(record.conference_losses || 0) + Number(record.conference_ties || 0);
}

function recordText(wins, losses, ties = 0) {
  const w = Number(wins || 0);
  const l = Number(losses || 0);
  const t = Number(ties || 0);
  return t > 0 ? `${w}-${l}-${t}` : `${w}-${l}`;
}

function recordTextGameCount(value) {
  const parts = String(value || "").match(/\d+/g)?.map(Number) || [];
  return parts.reduce((sum, part) => sum + part, 0);
}

export function publishedConferenceId(conferenceId, conferenceName, sport) {
  const normalizedSport = String(sport || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  let id = String(conferenceId || "").trim().toLowerCase();
  if (id) {
    const suffix = new RegExp(`-${normalizedSport}(?:-\\d{4})?$`, "i");
    id = id.replace(suffix, "");
    if (/^[a-z0-9-]+$/.test(id)) return id;
  }
  return String(conferenceName || "")
    .toLowerCase()
    .replace(/\bconference\b/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function standingsRowForTeam(payload, team) {
  const rows = Array.isArray(payload?.standings) ? payload.standings : [];
  const exact = rows.find(row => row?.team_id && String(row.team_id) === String(team.team_id));
  if (exact) return exact;
  const schoolKey = normalizeSchoolAlias(team.school_name);
  if (!schoolKey) return null;
  return rows.find(row => normalizeSchoolAlias(row?.school_name) === schoolKey) || null;
}

export function attachScheduleDerivedRecords(games = []) {
  const byTeam = new Map();
  for (const game of games) {
    const teamId = game.reporting_team_id || game.team_id;
    if (!teamId) continue;
    if (!byTeam.has(teamId)) byTeam.set(teamId, []);
    byTeam.get(teamId).push(game);
  }

  const recordByTeam = new Map();
  for (const [teamId, rows] of byTeam) {
    const derived = recordFromScheduleRows(rows, {
      reportingSchoolId: rows[0]?.school_id || null,
      maxMinutes: 15
    });
    if (Number(derived.scored_finals || 0) <= 0) continue;

    const stored = rows[0] || {};
    const storedCount = stored.wins == null && stored.losses == null && stored.ties == null
      ? -1
      : recordGameCount(stored);
    const derivedCount = recordGameCount(derived);

    if (storedCount > derivedCount) continue;
    recordByTeam.set(teamId, derived);
  }

  if (!recordByTeam.size) return games;
  return games.map(game => {
    const teamId = game.reporting_team_id || game.team_id;
    const record = recordByTeam.get(teamId);
    if (!record) return game;
    return {
      ...game,
      wins: record.wins,
      losses: record.losses,
      ties: record.ties,
      conference_wins: record.conference_wins,
      conference_losses: record.conference_losses,
      conference_ties: record.conference_ties,
      scored_finals: record.scored_finals,
      conference_scored_finals: conferenceGameCount(record),
      record_source: "schedule-derived"
    };
  });
}

async function discoverMissingConferenceMemberships(statuses) {
  await Promise.all(statuses.map(async status => {
    const sport = String(status.sport || "").toLowerCase();
    const hasMembership = Boolean(status.conference_id || status.conference_name);
    if (hasMembership || status.level !== "high-school" || !STANDINGS_SPORTS.has(sport) || !status.school_name) return;

    try {
      const membership = await findPublishedConferenceMembership({
        sport,
        schoolName: status.school_name
      });
      if (!membership?.conference?.id) return;
      status.conference_id = membership.conference.id;
      status.conference_name = membership.conference.name || null;
      status.published_conference_id = membership.conference.id;
      status.membership_source = "published-roster";
      status.standing_state = "not-started";
    } catch (error) {
      console.warn("published conference membership discovery failed", {
        teamId: status.team_id,
        sport,
        schoolName: status.school_name,
        error: String(error?.message || error)
      });
    }
  }));
}

export async function buildUnifiedTeamStatuses(env, games = []) {
  const byTeam = new Map();
  for (const game of games) {
    const teamId = String(game.reporting_team_id || game.team_id || "");
    if (!teamId) continue;
    if (!byTeam.has(teamId)) byTeam.set(teamId, []);
    byTeam.get(teamId).push(game);
  }

  const statuses = [];
  for (const [teamId, rows] of byTeam) {
    const seed = rows[0] || {};
    const overallGames = recordGameCount(seed);
    const conferenceGames = conferenceGameCount(seed);
    const conferenceId = seed.conference_id || null;
    const conferenceName = seed.conference_name || null;
    statuses.push({
      team_id: teamId,
      school_id: seed.school_id || null,
      school_name: seed.school_name || null,
      level: seed.level || null,
      sport: seed.sport || null,
      gender: seed.gender || null,
      season: seed.season || null,
      conference_id: conferenceId,
      conference_name: conferenceName,
      overall_record: seed.wins == null && seed.losses == null && seed.ties == null
        ? null
        : recordText(seed.wins, seed.losses, seed.ties),
      conference_record: conferenceId && conferenceGames > 0
        ? recordText(seed.conference_wins, seed.conference_losses, seed.conference_ties)
        : null,
      overall_games: overallGames,
      conference_games: conferenceGames,
      rank: null,
      standing_state: conferenceId || conferenceName ? (conferenceGames > 0 ? "unavailable" : "not-started") : "no-conference",
      source: seed.record_source || (overallGames > 0 ? "team-record" : "schedule")
    });
  }

  await discoverMissingConferenceMemberships(statuses);

  const lookups = new Map();
  for (const status of statuses) {
    const sport = String(status.sport || "").toLowerCase();
    if (status.level !== "high-school" || !STANDINGS_SPORTS.has(sport)) continue;
    const conferenceId = publishedConferenceId(status.conference_id, status.conference_name, sport);
    if (!conferenceId) continue;
    const key = `${sport}|${conferenceId}`;
    if (!lookups.has(key)) {
      lookups.set(key, loadStandingsTruth(env, {
        sport,
        conferenceId,
        season: status.season || "2026"
      }).catch(error => {
        console.warn("team status standings lookup failed", {
          sport,
          conferenceId,
          error: String(error?.message || error)
        });
        return null;
      }));
    }
    status.published_conference_id = conferenceId;
    status.standings_key = key;
  }

  const resolved = new Map();
  await Promise.all([...lookups].map(async ([key, promise]) => resolved.set(key, await promise)));

  for (const status of statuses) {
    const payload = status.standings_key ? resolved.get(status.standings_key) : null;
    if (!payload) {
      delete status.standings_key;
      continue;
    }
    const row = standingsRowForTeam(payload, status);
    if (!row) {
      delete status.standings_key;
      continue;
    }

    const conferenceGames = recordTextGameCount(row.conference_record);
    const rank = Number(row.rank);
    status.conference_id = status.conference_id || status.published_conference_id || payload?.conference?.id || null;
    status.conference_name = payload?.conference?.name || status.conference_name;
    status.overall_record = row.overall_record || status.overall_record;
    status.overall_games = recordTextGameCount(status.overall_record);
    status.conference_games = conferenceGames;
    status.conference_record = conferenceGames > 0 ? (row.conference_record || status.conference_record) : null;
    status.rank = conferenceGames > 0 && Number.isFinite(rank) && rank > 0 ? rank : null;
    status.standing_state = conferenceGames > 0
      ? (status.rank ? "ranked" : "unavailable")
      : "not-started";
    status.source = row.method || payload?.conference?.standings_method || "standings";
    delete status.standings_key;
  }

  return statuses;
}

async function localSchoolSchedule(request, env, schoolId, { requiredLevel = null } = {}) {
  const school = await env.DB.prepare(`
    SELECT id,name,level,catalog_scope
    FROM schools
    WHERE id=?
  `).bind(schoolId).first();

  if (!school || school.catalog_scope !== "local") return null;
  if (requiredLevel && school.level !== requiredLevel) return null;

  const result = await env.DB.prepare(`
    SELECT
      g.*,
      t.id AS reporting_team_id,t.sport,t.gender,t.season,t.conference_id,
      sch.id AS school_id,sch.name AS school_name,sch.level,
      c.name AS conference_name,
      r.wins,r.losses,r.ties,r.conference_wins,r.conference_losses,r.conference_ties,r.calculated_at,
      src.source_type,src.parser_type,src.authority_rank,src.source_priority,
      src.last_successful_fetch_at AS source_last_successful_fetch_at,
      ce.scheduled_at AS canonical_scheduled_at,
      ce.scheduled_time_known AS canonical_time_known,
      ce.venue AS canonical_venue,
      ce.location_text AS canonical_location_text,
      ce.latitude AS canonical_latitude,
      ce.longitude AS canonical_longitude,
      ce.conference_game AS canonical_conference_game,
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
        PARTITION BY t.id,COALESCE(g.canonical_event_id,g.id)
        ORDER BY src.authority_rank,src.source_priority,src.id
      ) AS authority_row
    FROM teams t INDEXED BY idx_teams_school_active_season
    JOIN schools sch ON sch.id=t.school_id
    LEFT JOIN games g INDEXED BY idx_games_team_record_lookup ON g.team_id=t.id
    LEFT JOIN sources src ON src.id=g.source_id
    LEFT JOIN conferences c ON c.id=t.conference_id
    LEFT JOIN team_records r ON r.team_id=t.id
    LEFT JOIN canonical_events ce ON ce.id=g.canonical_event_id
    LEFT JOIN schools hs ON hs.id=ce.home_school_id
    LEFT JOIN schools aws ON aws.id=ce.away_school_id
    WHERE t.school_id=? AND t.active=1 AND t.season='2026'
    ORDER BY t.sport,t.gender,COALESCE(ce.scheduled_at,g.scheduled_at)
  `).bind(schoolId).all();

  const authorityRows = (result.results || []).filter(row => Number(row.authority_row) === 1);
  const conferenceRows = await attachEffectiveConferenceGames(env, authorityRows, { reportingSchoolId: schoolId });
  const resolvedRows = attachScheduleDerivedRecords(conferenceRows.map(row => resolvedGameForSchool(row, schoolId)));
  const teamStatuses = await buildUnifiedTeamStatuses(env, resolvedRows);
  const games = resolvedRows.filter(row => Boolean(row.id) && Boolean(row.scheduled_at || row.canonical_scheduled_at));

  console.log("school schedule read", {
    schoolId,
    schoolLevel: school.level,
    games: games.length,
    teamStatuses: teamStatuses.length,
    rowsRead: Number(result.meta?.rows_read || 0),
    rowsWritten: Number(result.meta?.rows_written || 0),
    durationMs: Number(result.meta?.duration || 0) || null
  });

  return json({ schoolId, schoolLevel: school.level, games, team_statuses: teamStatuses });
}

async function collegeSchoolSchedule(request, env, schoolId) {
  return localSchoolSchedule(request, env, schoolId, { requiredLevel: "college" });
}

async function runCollegeBootstrap(request, env, ctx) {
  if (!authorizedWrite(request, env)) return privateJson({ error:"not_found" }, 404);
  const result = await runScopedCadence({
    core,
    env,
    ctx,
    controller:null,
    plan:{
      kind:"m4-college-initial-ingestion",
      scope:"college-bootstrap",
      season:COLLEGE_BOOTSTRAP_SEASON
    }
  });
  return privateJson(result || { status:"SKIPPED" });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === COLLEGE_BOOTSTRAP_PATH) {
      return runCollegeBootstrap(request, env, ctx);
    }
    if (request.method === "GET") {
      const directSchoolId = localSchoolId(url.pathname);
      if (directSchoolId) {
        const response = await localSchoolSchedule(request, env, directSchoolId);
        if (response) return response;
      }

      const legacySchoolId = legacyCollegeSchoolId(url.pathname);
      if (legacySchoolId) {
        const response = await collegeSchoolSchedule(request, env, legacySchoolId);
        if (response) return response;
      }
    }
    return app.fetch(request, env, ctx);
  },
  async scheduled(controller, env, ctx) {
    return app.scheduled(controller, env, ctx);
  }
};

export {
  COLLEGE_BOOTSTRAP_PATH,
  COLLEGE_BOOTSTRAP_SEASON,
  collegeSchoolSchedule,
  legacyCollegeSchoolId,
  localSchoolId,
  localSchoolSchedule,
  resolvedGameForSchool,
  runCollegeBootstrap
};