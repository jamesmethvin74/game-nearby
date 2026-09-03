import app from "./standings-worker.js";

function publicJson(request, body, status = 200) {
  const origin = request.headers.get("origin");
  const allowed = !origin || origin === "https://jamesmethvin74.github.io" || origin.startsWith("http://localhost:")
    ? (origin || "*")
    : "null";
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=300",
      "access-control-allow-origin": allowed,
      "vary": "Origin"
    }
  });
}

function aggregateStatus(values = []) {
  if (!values.length) return "Missing";
  if (values.every(value => value === "Complete")) return "Complete";
  if (values.every(value => value === "Missing")) return "Missing";
  if (values.every(value => value === "Unverified")) return "Unverified";
  return "Partial";
}

export function summarizeCoverageRows(rows = []) {
  const bySchool = new Map();
  const teams = [];

  for (const row of rows) {
    if (!bySchool.has(row.school_id)) {
      bySchool.set(row.school_id, {
        school_id: row.school_id,
        school_name: row.school_name,
        city: row.city,
        state: row.state,
        level: row.level,
        backend_present: true,
        logo_url: row.logo_url || null,
        logo_status: row.logo_url ? "Complete" : "Missing",
        known_team_count: 0,
        team_inventory_status: "Needs discovery",
        project_catalog_status: "Complete",
        conference_status: "Missing",
        schedule_status: "Missing",
        results_status: "Missing",
        records_status: "Missing",
        standings_status: "Missing",
        teams: []
      });
    }

    const school = bySchool.get(row.school_id);
    if (!row.team_id) continue;

    const sourceCount = Number(row.source_count || 0);
    const gameCount = Number(row.game_count || 0);
    const resultDueCount = Number(row.result_due_count || 0);
    const resolvedResultCount = Number(row.resolved_result_count || 0);
    const recordExists = Number(row.record_exists || 0) > 0;
    const standingsCount = Number(row.standings_count || 0);
    const standingsMethod = String(row.standings_method || "unavailable");

    const conferenceStatus = row.conference_id ? "Complete" : "Missing";
    const scheduleStatus = sourceCount > 0 && gameCount > 0 ? "Complete" : sourceCount > 0 ? "Partial" : "Missing";
    const resultsStatus = scheduleStatus === "Missing"
      ? "Missing"
      : resultDueCount === 0
        ? "Unverified"
        : resolvedResultCount >= resultDueCount ? "Complete" : "Partial";
    const recordsStatus = recordExists ? "Complete" : "Missing";
    const standingsStatus = row.conference_id && (standingsCount > 0 || standingsMethod !== "unavailable") ? "Complete" : "Missing";

    const team = {
      team_id: row.team_id,
      school_id: row.school_id,
      sport: row.sport,
      gender: row.gender,
      season: row.season,
      conference_id: row.conference_id || null,
      conference_name: row.conference_name || null,
      source_count: sourceCount,
      game_count: gameCount,
      result_due_count: resultDueCount,
      resolved_result_count: resolvedResultCount,
      record_exists: recordExists,
      standings_count: standingsCount,
      conference_status: conferenceStatus,
      schedule_status: scheduleStatus,
      results_status: resultsStatus,
      records_status: recordsStatus,
      standings_status: standingsStatus,
      last_source_check_at: row.last_source_check_at || null,
      last_game_check_at: row.last_game_check_at || null
    };

    school.teams.push(team);
    teams.push(team);
  }

  const schools = [...bySchool.values()];
  for (const school of schools) {
    school.known_team_count = school.teams.length;
    if (school.known_team_count === 0) {
      school.team_inventory_status = "Missing";
      continue;
    }
    school.conference_status = aggregateStatus(school.teams.map(team => team.conference_status));
    school.schedule_status = aggregateStatus(school.teams.map(team => team.schedule_status));
    school.results_status = aggregateStatus(school.teams.map(team => team.results_status));
    school.records_status = aggregateStatus(school.teams.map(team => team.records_status));
    school.standings_status = aggregateStatus(school.teams.map(team => team.standings_status));
  }

  const statusKeys = ["logo_status","conference_status","schedule_status","results_status","records_status","standings_status"];
  const summary = {
    schools: schools.length,
    teams: teams.length,
    high_schools: schools.filter(school => school.level === "high-school").length,
    colleges: schools.filter(school => school.level === "college").length,
    complete: Object.fromEntries(statusKeys.map(key => [key, schools.filter(school => school[key] === "Complete").length]))
  };

  return { summary, schools, teams };
}

async function coverageSnapshot(env) {
  const { results = [] } = await env.DB.prepare(`
    WITH source_counts AS (
      SELECT team_id,
        COUNT(*) AS source_count,
        MAX(last_checked_at) AS last_source_check_at
      FROM sources
      WHERE enabled=1
      GROUP BY team_id
    ),
    game_counts AS (
      SELECT team_id,
        COUNT(*) AS game_count,
        SUM(CASE WHEN counts_for_record=1 AND datetime(scheduled_at) < datetime('now','-6 hours') THEN 1 ELSE 0 END) AS result_due_count,
        SUM(CASE WHEN counts_for_record=1 AND datetime(scheduled_at) < datetime('now','-6 hours') AND status IN ('FINAL','CANCELED','POSTPONED') THEN 1 ELSE 0 END) AS resolved_result_count,
        MAX(last_checked_at) AS last_game_check_at
      FROM games
      GROUP BY team_id
    ),
    standing_counts AS (
      SELECT team_id, COUNT(*) AS standings_count
      FROM standings
      GROUP BY team_id
    )
    SELECT
      sch.id AS school_id,
      COALESCE(NULLIF(sch.location_matched_name,''),sch.name) AS school_name,
      sch.city,
      sch.state,
      sch.level,
      COALESCE(NULLIF(brand.logo_url,''),NULLIF(sch.logo_url,'')) AS logo_url,
      t.id AS team_id,
      t.sport,
      t.gender,
      t.season,
      t.conference_id,
      c.name AS conference_name,
      c.standings_method,
      COALESCE(src.source_count,0) AS source_count,
      src.last_source_check_at,
      COALESCE(g.game_count,0) AS game_count,
      COALESCE(g.result_due_count,0) AS result_due_count,
      COALESCE(g.resolved_result_count,0) AS resolved_result_count,
      g.last_game_check_at,
      CASE WHEN r.team_id IS NULL THEN 0 ELSE 1 END AS record_exists,
      COALESCE(st.standings_count,0) AS standings_count
    FROM schools sch
    LEFT JOIN school_brand_assets brand ON brand.school_id=sch.id AND brand.status IN ('matched','curated')
    LEFT JOIN teams t ON t.school_id=sch.id AND t.active=1
    LEFT JOIN conferences c ON c.id=t.conference_id
    LEFT JOIN source_counts src ON src.team_id=t.id
    LEFT JOIN game_counts g ON g.team_id=t.id
    LEFT JOIN team_records r ON r.team_id=t.id
    LEFT JOIN standing_counts st ON st.team_id=t.id
    WHERE sch.catalog_scope='local'
    ORDER BY sch.level,school_name,t.sport,t.gender,t.id
  `).all();

  return {
    generated_at: new Date().toISOString(),
    inventory_note: "Known production teams only. Expected-team discovery is tracked separately and remains incomplete until reconciled.",
    ...summarizeCoverageRows(results)
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/api/v1/coverage-report") {
      try {
        return publicJson(request, await coverageSnapshot(env));
      } catch (error) {
        console.error("coverage report failed", error);
        return publicJson(request, { error:"coverage_report_failed", message:String(error?.message || error) }, 500);
      }
    }
    return app.fetch(request, env, ctx);
  },
  async scheduled(controller, env, ctx) {
    return app.scheduled(controller, env, ctx);
  }
};
