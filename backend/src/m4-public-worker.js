import app from "./d1-usage-public-worker.js";
import core from "./index.js";
import { collegeProductionActivationPlan } from "./college-production-activation.js";
import { runScopedCadence } from "./scoped-cadence-runner.js";

const LEGACY_VOLLEYBALL_SUFFIX = "-volleyball-2026";
const COLLEGE_BOOTSTRAP_PATH = "/api/v1/m4/college-bootstrap";
const COLLEGE_BOOTSTRAP_SEASON = "2026";
const M4_PREP_DIAGNOSTIC_PATH = "/api/v1/m4/prep-state-7f4c2a91";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=300, stale-while-revalidate=900",
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
    status,
    team_score: teamScore,
    opponent_score: opponentScore,
    result,
    data_trust: row.data_trust || "SINGLE_SOURCE_LIVE",
    conflict_count: Number(row.conflict_count || 0)
  };
}

async function m4PreparationState(env) {
  const plan = collegeProductionActivationPlan(COLLEGE_BOOTSTRAP_SEASON);
  const schoolIds = plan.schools.map(row => row.id);
  const teamIds = plan.teams.map(row => row.id);
  const readyIds = plan.certifiedTargets.map(row => `${row.schoolId}-${row.sport}-${row.gender}-${row.season}`);

  const result = await env.DB.prepare(`
    WITH school_targets AS (
      SELECT value AS id FROM json_each(?)
    ), team_targets AS (
      SELECT value AS id FROM json_each(?)
    ), ready_targets AS (
      SELECT value AS id FROM json_each(?)
    ), desired AS (
      SELECT
        json_extract(value,'$.schoolId') AS school_id,
        json_extract(value,'$.sport') AS sport,
        json_extract(value,'$.gender') AS gender,
        json_extract(value,'$.season') AS season,
        json_extract(value,'$.sourceId') AS source_id,
        json_extract(value,'$.sourceUrl') AS source_url,
        json_extract(value,'$.parserType') AS parser_type
      FROM json_each(?)
    )
    SELECT
      (SELECT COUNT(*) FROM schools s JOIN school_targets x ON x.id=s.id
        WHERE s.level='college' AND s.catalog_scope='local') AS schools,
      (SELECT COUNT(*) FROM teams t JOIN team_targets x ON x.id=t.id) AS teams,
      (SELECT COUNT(*) FROM teams t JOIN ready_targets x ON x.id=t.id WHERE t.active=1) AS readyActive,
      (SELECT COUNT(*) FROM teams t JOIN team_targets x ON x.id=t.id
        WHERE t.id NOT IN (SELECT id FROM ready_targets) AND t.active=0) AS inactive,
      (SELECT COUNT(*)
        FROM desired d
        JOIN teams t
          ON t.school_id=d.school_id
         AND t.sport=d.sport
         AND t.gender=d.gender
         AND t.season=d.season
        WHERE EXISTS (
          SELECT 1 FROM sources s
          WHERE s.team_id=t.id
            AND s.source_url=d.source_url
            AND s.parser_type=d.parser_type
        )) AS sourceMatches,
      (SELECT COUNT(*)
        FROM desired d
        JOIN sources s ON s.id=d.source_id
        WHERE s.enabled=1) AS newSourceEnabled
  `).bind(
    JSON.stringify(schoolIds),
    JSON.stringify(teamIds),
    JSON.stringify(readyIds),
    JSON.stringify(plan.sourceRows)
  ).all();

  const row = result.results?.[0] || {};
  const counts = {
    schools:Number(row.schools || 0),
    teams:Number(row.teams || 0),
    readyActive:Number(row.readyActive || 0),
    inactive:Number(row.inactive || 0),
    sourceMatches:Number(row.sourceMatches || 0),
    newSourceEnabled:Number(row.newSourceEnabled || 0)
  };
  const expected = { schools:36, teams:130, readyActive:103, inactive:27, sourceMatches:103, newSourceEnabled:0 };
  const matches = Object.entries(expected).every(([key,value]) => counts[key] === value);

  return privateJson({
    status:"READ_ONLY",
    matches,
    counts,
    expected,
    rowsRead:Number(result.meta?.rows_read || 0),
    rowsWritten:Number(result.meta?.rows_written || 0),
    durationMs:Number(result.meta?.duration || 0) || null
  });
}

async function collegeSchoolSchedule(request, env, schoolId) {
  const school = await env.DB.prepare(`
    SELECT id,name,level,catalog_scope
    FROM schools
    WHERE id=?
  `).bind(schoolId).first();

  // This compatibility route is intentionally college-only. Existing high-school
  // volleyball requests continue through the proven M2 read path unchanged.
  if (!school || school.level !== "college" || school.catalog_scope !== "local") return null;

  const result = await env.DB.prepare(`
    SELECT
      g.*,
      t.id AS reporting_team_id,t.sport,t.gender,t.season,
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
    FROM teams t
    JOIN schools sch ON sch.id=t.school_id
    JOIN games g ON g.team_id=t.id
    JOIN sources src ON src.id=g.source_id AND src.enabled=1
    LEFT JOIN conferences c ON c.id=t.conference_id
    LEFT JOIN team_records r ON r.team_id=t.id
    LEFT JOIN canonical_events ce ON ce.id=g.canonical_event_id
    LEFT JOIN schools hs ON hs.id=ce.home_school_id
    LEFT JOIN schools aws ON aws.id=ce.away_school_id
    WHERE t.school_id=? AND t.active=1 AND t.season='2026'
    ORDER BY t.sport,t.gender,COALESCE(ce.scheduled_at,g.scheduled_at)
  `).bind(schoolId).all();

  const games = (result.results || [])
    .filter(row => Number(row.authority_row) === 1)
    .map(row => resolvedGameForSchool(row, schoolId));

  console.log("M4 college school schedule read", {
    schoolId,
    games: games.length,
    rowsRead: Number(result.meta?.rows_read || 0),
    rowsWritten: Number(result.meta?.rows_written || 0),
    durationMs: Number(result.meta?.duration || 0) || null
  });

  return json({ schoolId, games });
}

async function runCollegeBootstrap(request, env, ctx) {
  // Temporary M4 activation surface. It is intentionally not on the cron path.
  // Each explicit invocation selects at most eight enabled/current college
  // sources with zero game rows and routes them through the normal collector.
  // Remove this endpoint after the initial production population is complete.
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
    if (request.method === "GET" && url.pathname === M4_PREP_DIAGNOSTIC_PATH) {
      return m4PreparationState(env);
    }
    if (request.method === "GET") {
      const schoolId = legacyCollegeSchoolId(url.pathname);
      if (schoolId) {
        const response = await collegeSchoolSchedule(request, env, schoolId);
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
  M4_PREP_DIAGNOSTIC_PATH,
  collegeSchoolSchedule,
  legacyCollegeSchoolId,
  m4PreparationState,
  resolvedGameForSchool,
  runCollegeBootstrap
};
