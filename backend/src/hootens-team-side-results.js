import { runResilientHootensStatewideResults } from "./hootens-resilient-results.js";
import { rebuildTeamRecords } from "./record-rebuild.js";

const STATE_ID = "hootens:football:current";
const WINDOW_HOURS = 168;
const MAX_MIRRORS = 20;

function clean(value) {
  return String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function safe(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function resultCode(teamScore, opponentScore) {
  return teamScore === opponentScore ? "T" : teamScore > opponentScore ? "W" : "L";
}

export function reverseHomeAway(value) {
  if (value === "home") return "away";
  if (value === "away") return "home";
  return value === "neutral" ? "neutral" : "unknown";
}

function reciprocalOpponentMatches(candidate, row) {
  if (candidate.opponent_school_id && candidate.opponent_school_id === row.reporting_school_id) return true;
  return safe(candidate.opponent) === safe(row.reporting_school_name);
}

export function findMissingReciprocalSides(sourceRows = [], finalRows = []) {
  const seen = new Set();
  const missing = [];
  for (const row of sourceRows) {
    if (!row?.reporting_school_id || !row?.opponent_school_id) continue;
    const reciprocal = finalRows.some(candidate =>
      candidate.school_id === row.opponent_school_id &&
      reciprocalOpponentMatches(candidate, row) &&
      Number(candidate.team_score) === Number(row.opponent_score) &&
      Number(candidate.opponent_score) === Number(row.team_score)
    );
    if (reciprocal) continue;
    const key = [row.opponent_school_id, row.reporting_school_id, row.scheduled_at, row.opponent_score, row.team_score].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    missing.push(row);
  }
  return missing;
}

async function loadRecentContext(env) {
  const [sourceResult, finalResult] = await Promise.all([
    env.DB.prepare(`
      SELECT g.*,t.school_id AS reporting_school_id,s.name AS reporting_school_name,
             os.name AS opponent_school_name,
             ot.id AS opponent_team_id,ot.active AS opponent_team_active,ot.conference_id AS opponent_conference_id
      FROM games g
      JOIN sources src ON src.id=g.source_id
      JOIN teams t ON t.id=g.team_id
      JOIN schools s ON s.id=t.school_id
      JOIN schools os ON os.id=g.opponent_school_id
      LEFT JOIN teams ot ON ot.school_id=os.id AND ot.sport='football' AND ot.gender='boys' AND ot.season='2026'
      WHERE g.status='FINAL'
        AND g.team_score IS NOT NULL AND g.opponent_score IS NOT NULL
        AND t.sport='football' AND t.gender='boys' AND t.season='2026'
        AND s.level='high-school' AND s.state='AR' AND s.catalog_scope='local'
        AND os.level='high-school' AND os.state='AR' AND os.catalog_scope='local'
        AND datetime(g.scheduled_at)>=datetime('now','-${WINDOW_HOURS} hours')
        AND (src.parser_type='hootens-statewide' OR lower(COALESCE(g.notes,'')) LIKE '%hooten%statewide%scoreboard%')
    `).all(),
    env.DB.prepare(`
      SELECT g.id,g.team_id,t.school_id,g.opponent_school_id,g.opponent,g.team_score,g.opponent_score,g.scheduled_at
      FROM games g JOIN teams t ON t.id=g.team_id JOIN schools s ON s.id=t.school_id
      WHERE g.status='FINAL'
        AND g.team_score IS NOT NULL AND g.opponent_score IS NOT NULL
        AND t.sport='football' AND t.gender='boys' AND t.season='2026'
        AND s.level='high-school' AND s.state='AR' AND s.catalog_scope='local'
        AND datetime(g.scheduled_at)>=datetime('now','-${WINDOW_HOURS} hours')
    `).all()
  ]);
  return {
    sourceRows: sourceResult.results || [],
    finalRows: finalResult.results || [],
    rowsRead: Number(sourceResult.meta?.rows_read || 0) + Number(finalResult.meta?.rows_read || 0)
  };
}

async function ensureOpponentTeam(env, row, checkedAt) {
  if (row.opponent_team_id) {
    if (Number(row.opponent_team_active ?? 1) !== 1) {
      await env.DB.prepare("UPDATE teams SET active=1,updated_at=? WHERE id=?")
        .bind(checkedAt, row.opponent_team_id).run();
    }
    return row.opponent_team_id;
  }
  const teamId = `${row.opponent_school_id}-football-2026`;
  await env.DB.prepare(`
    INSERT INTO teams(id,school_id,sport,gender,season,conference_id,active,created_at,updated_at)
    VALUES(?,?,'football','boys','2026',?,1,?,?)
    ON CONFLICT(school_id,sport,gender,season) DO UPDATE SET active=1,updated_at=excluded.updated_at
  `).bind(teamId,row.opponent_school_id,row.opponent_conference_id || null,checkedAt,checkedAt).run();
  return teamId;
}

async function ensureHootenSource(env, teamId, scoreboardUrl, checkedAt) {
  const sourceId = `${teamId}-hootens-statewide`;
  await env.DB.prepare(`
    INSERT INTO sources(id,team_id,source_url,source_type,source_priority,parser_type,parser_version,timezone,expected_min_games,refresh_minutes,active_result_minutes,enabled,authority_rank,stale_after_minutes,collection_mode,updated_at)
    VALUES(?,?,?,'secondary',90,'hootens-statewide','5','America/Chicago',1,30,5,0,90,180,'statewide',?)
    ON CONFLICT(id) DO UPDATE SET source_url=excluded.source_url,parser_version=excluded.parser_version,collection_mode='statewide',updated_at=excluded.updated_at
  `).bind(sourceId,teamId,scoreboardUrl,checkedAt).run();
  return sourceId;
}

async function upsertReciprocal(env, row, scoreboardUrl, checkedAt) {
  const teamId = await ensureOpponentTeam(env,row,checkedAt);
  const sourceId = await ensureHootenSource(env,teamId,scoreboardUrl,checkedAt);
  const sourceEventKey = `reciprocal:${safe(row.reporting_school_id)}:${safe(row.scheduled_at)}:${row.opponent_score}-${row.team_score}`;
  const id = `${sourceId}:${sourceEventKey}`;
  const teamScore = Number(row.opponent_score);
  const opponentScore = Number(row.team_score);
  await env.DB.prepare(`
    INSERT INTO games(id,team_id,source_id,source_event_key,opponent,opponent_school_id,scheduled_at,scheduled_time_known,venue,location_text,latitude,longitude,home_away,conference_game,counts_for_record,status,team_score,opponent_score,result,notes,source_url,source_updated_at,last_checked_at,updated_at,canonical_event_id)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(source_id,source_event_key) DO UPDATE SET
      opponent=excluded.opponent,opponent_school_id=excluded.opponent_school_id,scheduled_at=excluded.scheduled_at,
      scheduled_time_known=excluded.scheduled_time_known,venue=excluded.venue,location_text=excluded.location_text,
      latitude=excluded.latitude,longitude=excluded.longitude,home_away=excluded.home_away,conference_game=excluded.conference_game,
      counts_for_record=excluded.counts_for_record,status='FINAL',team_score=excluded.team_score,opponent_score=excluded.opponent_score,
      result=excluded.result,notes=excluded.notes,source_url=excluded.source_url,source_updated_at=excluded.source_updated_at,
      last_checked_at=excluded.last_checked_at,updated_at=excluded.updated_at,canonical_event_id=excluded.canonical_event_id
  `).bind(
    id,teamId,sourceId,sourceEventKey,row.reporting_school_name,row.reporting_school_id,row.scheduled_at,
    Number(row.scheduled_time_known ?? 0),row.venue || null,row.location_text || null,row.latitude ?? null,row.longitude ?? null,
    reverseHomeAway(row.home_away),Number(row.conference_game || 0),Number(row.counts_for_record ?? 1),"FINAL",
    teamScore,opponentScore,resultCode(teamScore,opponentScore),"Hooten statewide final reciprocal team completion",
    scoreboardUrl,checkedAt,checkedAt,checkedAt,row.canonical_event_id || null
  ).run();
  if (row.canonical_event_id) {
    await env.DB.prepare(`INSERT OR REPLACE INTO canonical_event_members(canonical_event_id,game_id,source_id,reporting_team_id,added_at) VALUES(?,?,?,?,?)`)
      .bind(row.canonical_event_id,id,sourceId,teamId,checkedAt).run();
  }
  return teamId;
}

export async function completeHootensTeamSides(env, { now = new Date() } = {}) {
  const checkedAt = now.toISOString();
  const state = await env.DB.prepare("SELECT feed_url,details_json FROM statewide_collection_state WHERE id=?").bind(STATE_ID).first();
  let details = {};
  try { details = JSON.parse(state?.details_json || "{}"); } catch {}
  const scoreboardUrl = clean(details.scoreboardUrl || state?.feed_url);
  if (!scoreboardUrl) throw new Error("Hooten team-side completion missing scoreboard URL");

  const context = await loadRecentContext(env);
  const missing = findMissingReciprocalSides(context.sourceRows,context.finalRows);
  if (missing.length > MAX_MIRRORS) {
    throw new Error(`Hooten team-side completion found ${missing.length} missing reciprocal rows; exceeds bounded limit ${MAX_MIRRORS}`);
  }

  const touched = new Set();
  const failures = [];
  for (const row of missing) {
    try {
      touched.add(await upsertReciprocal(env,row,scoreboardUrl,checkedAt));
    } catch (error) {
      failures.push({
        reportingSchool: row.reporting_school_name,
        opponentSchool: row.opponent_school_name,
        error: String(error?.message || error).slice(0,300)
      });
    }
  }
  if (touched.size) await rebuildTeamRecords(env,[...touched],checkedAt);
  return {
    candidates: missing.length,
    created: missing.length - failures.length,
    unresolved: failures.length,
    failures,
    touchedTeams: touched.size,
    rowsRead: context.rowsRead
  };
}

export async function runHootensPerTeamComplete(env, options = {}) {
  const baseResult = await runResilientHootensStatewideResults(env,options);
  if (baseResult?.status === "FAILURE" || baseResult?.resilientStatus === "FAILURE") return baseResult;
  try {
    const teamSides = await completeHootensTeamSides(env,{now: options.now || new Date()});
    return {
      ...baseResult,
      status: teamSides.unresolved === 0 ? baseResult.status : "PARTIAL",
      teamSideCandidates: teamSides.candidates,
      teamSidesCreated: teamSides.created,
      teamSideUnresolved: teamSides.unresolved,
      teamSideTouchedTeams: teamSides.touchedTeams,
      teamSideRowsRead: teamSides.rowsRead,
      teamSideFailures: teamSides.failures.slice(0,20)
    };
  } catch (error) {
    const message = String(error?.message || error).slice(0,1000);
    console.error("Hooten team-side completion failed",message);
    return {...baseResult,teamSideStatus:"FAILURE",teamSideError:message};
  }
}
