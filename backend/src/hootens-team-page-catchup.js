import { resilientAlias } from "./hootens-resilient-results.js";
import { resolveCanonicalEvent } from "./schedule-authority-core.js";
import { rebuildTeamRecords } from "./record-rebuild.js";

const USER_AGENT = "LocalBleachersAR-Hootens-Team-Page/1.0 (+https://github.com/jamesmethvin74/game-nearby)";
const HOOTENS_ROOT = "https://hootens.com/";
const LOOKBACK_DAYS = 14;
const RESULT_GRACE_HOURS = 6;
const CANDIDATE_LIMIT = 48;
const MAX_TEAM_PAGES = 8;
const MAX_REPAIRS = 12;

function clean(value) {
  return String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function safe(value) {
  return clean(value).toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function resultCode(teamScore, opponentScore) {
  return teamScore === opponentScore ? "T" : teamScore > opponentScore ? "W" : "L";
}

export function hootensTeamSlug(name) {
  let value = safe(name);
  if (value.startsWith("little-rock-")) value = `lr-${value.slice("little-rock-".length)}`;
  return value;
}

export function parseHootensTeamPageResult(value) {
  const match = clean(value).match(/^([WLT])\s+(\d+)\s*[-–]\s*(\d+)$/i);
  if (!match) return null;
  const teamScore = Number(match[2]);
  const opponentScore = Number(match[3]);
  const result = match[1].toUpperCase();
  if (resultCode(teamScore, opponentScore) !== result) return null;
  return { status: "FINAL", result, teamScore, opponentScore };
}

function localMonthDay(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const month = parts.find(part => part.type === "month")?.value;
  const day = parts.find(part => part.type === "day")?.value;
  return month && day ? `${month}/${day}` : null;
}

export function teamPageFinalForCandidate(rows = [], candidate = {}) {
  const targetDate = localMonthDay(candidate.scheduled_at || candidate.canonical_scheduled_at);
  const targetOpponent = resilientAlias(candidate.opponent_school_name || candidate.opponent);
  if (!targetDate || !targetOpponent) return null;

  // Hooten team pages can contain the prior season followed by the current one.
  // Select the LAST exact date+opponent row first, then inspect its result. This
  // prevents an old scored row from being reused when the current-season row is
  // still an em dash.
  const exactRows = rows.filter(cells => {
    if (!Array.isArray(cells) || cells.length < 2) return false;
    return clean(cells[0]) === targetDate && resilientAlias(cells[1]) === targetOpponent;
  });
  if (!exactRows.length) return null;
  const selected = exactRows[exactRows.length - 1];
  const parsed = parseHootensTeamPageResult(selected[4]);
  if (!parsed) return null;
  return { ...parsed, date: targetDate, opponent: clean(selected[1]), row: selected };
}

export function selectBoundedTeamPageGroups(candidates = [], maxTeamPages = MAX_TEAM_PAGES) {
  const sorted = [...candidates].sort((a, b) => {
    const dateDelta = Date.parse(a.scheduled_at || a.canonical_scheduled_at || 0) - Date.parse(b.scheduled_at || b.canonical_scheduled_at || 0);
    if (dateDelta) return dateDelta;
    return String(a.team_id || "").localeCompare(String(b.team_id || ""));
  });
  const groups = [];
  const byTeam = new Map();
  for (const candidate of sorted) {
    if (!candidate?.team_id || !candidate?.school_name) continue;
    let group = byTeam.get(candidate.team_id);
    if (!group) {
      if (groups.length >= maxTeamPages) continue;
      group = {
        teamId: candidate.team_id,
        schoolId: candidate.school_id,
        schoolName: candidate.school_name,
        pageUrl: new URL(`/teams/${hootensTeamSlug(candidate.school_name)}/`, HOOTENS_ROOT).toString(),
        candidates: []
      };
      groups.push(group);
      byTeam.set(candidate.team_id, group);
    }
    group.candidates.push(candidate);
  }
  return groups;
}

async function extractTeamScheduleRows(html, HTMLRewriterClass = globalThis.HTMLRewriter) {
  if (!HTMLRewriterClass) throw new Error("HTMLRewriter unavailable for Hooten team-page catchup");
  const state = { current: null, rows: [] };
  const response = new HTMLRewriterClass()
    .on("tr", {
      element(el) {
        state.current = { cells: [], cellIndex: -1 };
        state.rows.push(state.current);
        el.onEndTag(() => { state.current = null; });
      }
    })
    .on("tr td", {
      element() {
        if (!state.current) return;
        state.current.cellIndex += 1;
        if (state.current.cells[state.current.cellIndex] == null) state.current.cells[state.current.cellIndex] = "";
      },
      text(chunk) {
        if (state.current && state.current.cellIndex >= 0) state.current.cells[state.current.cellIndex] += `${chunk.text} `;
      }
    })
    .transform(new Response(html));
  await response.text();
  return state.rows.map(row => row.cells.map(clean)).filter(cells => cells.length >= 2);
}

async function loadCandidates(env, checkedAt) {
  const result = await env.DB.prepare(`
    WITH ranked AS (
      SELECT
        g.id AS anchor_id,g.team_id,g.source_id,g.opponent,g.opponent_school_id,g.scheduled_time_known,
        g.venue,g.location_text,g.latitude,g.longitude,g.home_away,g.conference_game,g.counts_for_record,
        g.canonical_event_id,ce.scheduled_at,
        t.school_id,s.name AS school_name,os.name AS opponent_school_name,
        ROW_NUMBER() OVER (
          PARTITION BY g.canonical_event_id
          ORDER BY src.authority_rank,src.source_priority,src.id,g.id
        ) AS rn
      FROM games g
      JOIN canonical_events ce ON ce.id=g.canonical_event_id
      JOIN sources src ON src.id=g.source_id
      JOIN teams t ON t.id=g.team_id
      JOIN schools s ON s.id=t.school_id
      JOIN schools os ON os.id=g.opponent_school_id
      WHERE ce.status='SCHEDULED'
        AND g.counts_for_record=1
        AND g.canonical_event_id IS NOT NULL
        AND g.opponent_school_id IS NOT NULL
        AND t.sport='football' AND t.gender='boys' AND t.season='2026'
        AND s.level='high-school' AND s.state='AR' AND s.catalog_scope='local'
        AND os.level='high-school' AND os.state='AR' AND os.catalog_scope='local'
        AND datetime(ce.scheduled_at) BETWEEN datetime(?,'-${LOOKBACK_DAYS} days') AND datetime(?,'-${RESULT_GRACE_HOURS} hours')
    )
    SELECT * FROM ranked WHERE rn=1
    ORDER BY datetime(scheduled_at),team_id
    LIMIT ${CANDIDATE_LIMIT}
  `).bind(checkedAt, checkedAt).all();
  return { rows: result.results || [], rowsRead: Number(result.meta?.rows_read || 0) };
}

async function ensureTeamPageSource(env, candidate, pageUrl, checkedAt) {
  const sourceId = `${candidate.team_id}-hootens-team-page`;
  await env.DB.prepare(`
    INSERT INTO sources(id,team_id,source_url,source_type,source_priority,parser_type,parser_version,timezone,expected_min_games,refresh_minutes,active_result_minutes,enabled,authority_rank,stale_after_minutes,collection_mode,updated_at)
    VALUES(?,?,?,'secondary',90,'hootens-team-page','1','America/Chicago',1,1440,30,0,90,2880,'statewide',?)
    ON CONFLICT(id) DO UPDATE SET source_url=excluded.source_url,parser_version=excluded.parser_version,updated_at=excluded.updated_at
  `).bind(sourceId,candidate.team_id,pageUrl,checkedAt).run();
  return {
    id: sourceId,
    team_id: candidate.team_id,
    source_url: pageUrl,
    source_type: "secondary",
    source_priority: 90,
    parser_type: "hootens-team-page",
    parser_version: "1",
    timezone: "America/Chicago",
    authority_rank: 90
  };
}

async function upsertTeamPageObservation(env, source, candidate, final, checkedAt) {
  const dateKey = clean(candidate.scheduled_at).slice(0, 10);
  const sourceEventKey = `team-page:${safe(candidate.canonical_event_id)}:${dateKey}:${safe(candidate.opponent_school_id)}`;
  const id = `${source.id}:${sourceEventKey}`;
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
    id,source.team_id,source.id,sourceEventKey,candidate.opponent_school_name || candidate.opponent,candidate.opponent_school_id,candidate.scheduled_at,
    Number(candidate.scheduled_time_known || 0),candidate.venue || null,candidate.location_text || null,candidate.latitude ?? null,candidate.longitude ?? null,
    candidate.home_away || "unknown",Number(candidate.conference_game || 0),1,"FINAL",final.teamScore,final.opponentScore,final.result,
    `Historical final verified from Hooten's team page: ${source.source_url}`,source.source_url,checkedAt,checkedAt,checkedAt,candidate.canonical_event_id
  ).run();
  await env.DB.prepare(`
    INSERT OR REPLACE INTO canonical_event_members(canonical_event_id,game_id,source_id,reporting_team_id,added_at)
    VALUES(?,?,?,?,?)
  `).bind(candidate.canonical_event_id,id,source.id,source.team_id,checkedAt).run();
  return id;
}

async function reconcileCanonical(env, canonicalId, checkedAt) {
  const result = await env.DB.prepare(`
    SELECT g.*,t.sport,t.gender,t.season,t.id AS reporting_team_id,sch.id AS reporting_school_id,sch.name AS reporting_school_name,
      src.source_type,src.parser_type,src.source_priority,src.authority_rank,src.timezone
    FROM games g
    JOIN teams t ON t.id=g.team_id
    JOIN schools sch ON sch.id=t.school_id
    JOIN sources src ON src.id=g.source_id
    WHERE g.canonical_event_id=?
    ORDER BY src.authority_rank,src.source_priority,src.id
  `).bind(canonicalId).all();
  const observations = result.results || [];
  if (!observations.length) return { resolved: null, reportingTeamIds: [] };

  const resolved = resolveCanonicalEvent(observations,{timeZone:"America/Chicago",now:checkedAt});
  const selected = observations.find(row => row.id === resolved.resolutionEvidence.selectedObservationId) || observations[0];
  const venueObservation = observations.find(row => row.id === resolved.resolutionEvidence.venueObservationId) || selected;
  const geoObservation = observations.find(row => row.latitude != null && row.longitude != null) || selected;

  await env.DB.prepare(`
    UPDATE canonical_events SET
      home_school_id=?,away_school_id=?,scheduled_at=?,scheduled_time_known=?,venue=?,location_text=?,latitude=?,longitude=?,conference_game=?,
      status=?,home_score=?,away_score=?,selected_source_id=?,trust_state=?,conflict_count=?,resolution_json=?,last_reconciled_at=?,updated_at=?
    WHERE id=?
  `).bind(
    resolved.homeSchoolId,resolved.awaySchoolId,resolved.scheduledAt,resolved.scheduledTimeKnown?1:0,resolved.venue||null,
    venueObservation?.location_text||resolved.venue||null,geoObservation?.latitude??null,geoObservation?.longitude??null,Number(selected?.conference_game||0),
    resolved.status,resolved.homeScore??null,resolved.awayScore??null,resolved.selectedSourceId,resolved.trustState,resolved.conflicts.length,
    JSON.stringify(resolved.resolutionEvidence),checkedAt,checkedAt,canonicalId
  ).run();

  await env.DB.prepare("UPDATE event_conflicts SET resolved_at=? WHERE canonical_event_id=? AND resolved_at IS NULL").bind(checkedAt,canonicalId).run();
  for (const conflict of resolved.conflicts) {
    await env.DB.prepare("INSERT INTO event_conflicts(canonical_event_id,conflict_type,values_json,evidence_json,detected_at) VALUES(?,?,?,?,?)")
      .bind(canonicalId,conflict.type,JSON.stringify(conflict.values),JSON.stringify({gameIds:observations.map(row=>row.id),sourceIds:observations.map(row=>row.source_id)}),checkedAt).run();
  }
  return { resolved, reportingTeamIds: [...new Set(observations.map(row=>row.reporting_team_id).filter(Boolean))] };
}

export async function runHootensTeamPageCatchup(env, {
  now = new Date(),
  fetchFn = fetch,
  HTMLRewriterClass = globalThis.HTMLRewriter,
  maxTeamPages = MAX_TEAM_PAGES,
  maxRepairs = MAX_REPAIRS
} = {}) {
  const checkedAt = (now instanceof Date ? now : new Date(now)).toISOString();
  const loaded = await loadCandidates(env,checkedAt);
  const groups = selectBoundedTeamPageGroups(loaded.rows,maxTeamPages);
  if (!groups.length) {
    return { status:"NO_GAPS",candidates:loaded.rows.length,eligibleCandidates:0,pagesAttempted:0,pagesFetched:0,repaired:0,touchedTeams:0,touchedTeamIds:[],rowsRead:loaded.rowsRead,failures:[] };
  }

  let pagesAttempted = 0;
  let pagesFetched = 0;
  let repaired = 0;
  const touchedTeams = new Set();
  const failures = [];

  for (const group of groups) {
    if (repaired >= maxRepairs) break;
    pagesAttempted += 1;
    let rows;
    try {
      const response = await fetchFn(group.pageUrl,{
        headers:{"user-agent":USER_AGENT,accept:"text/html,application/xhtml+xml"},
        redirect:"follow"
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      rows = await extractTeamScheduleRows(await response.text(),HTMLRewriterClass);
      pagesFetched += 1;
    } catch (error) {
      failures.push({school:group.schoolName,pageUrl:group.pageUrl,error:String(error?.message||error).slice(0,300)});
      continue;
    }

    let source = null;
    for (const candidate of group.candidates) {
      if (repaired >= maxRepairs) break;
      const final = teamPageFinalForCandidate(rows,candidate);
      if (!final) continue;
      try {
        source ||= await ensureTeamPageSource(env,candidate,group.pageUrl,checkedAt);
        await upsertTeamPageObservation(env,source,candidate,final,checkedAt);
        const reconciled = await reconcileCanonical(env,candidate.canonical_event_id,checkedAt);
        for (const teamId of reconciled.reportingTeamIds) touchedTeams.add(teamId);
        repaired += 1;
      } catch (error) {
        failures.push({school:group.schoolName,opponent:candidate.opponent_school_name||candidate.opponent,scheduledAt:candidate.scheduled_at,error:String(error?.message||error).slice(0,300)});
      }
    }
  }

  if (touchedTeams.size) await rebuildTeamRecords(env,[...touchedTeams],checkedAt);
  return {
    status: failures.length ? (repaired ? "PARTIAL" : "FAILURE") : "SUCCESS",
    candidates: loaded.rows.length,
    eligibleCandidates: groups.reduce((sum,group)=>sum+group.candidates.length,0),
    pagesAttempted,
    pagesFetched,
    repaired,
    touchedTeams:touchedTeams.size,
    touchedTeamIds:[...touchedTeams].sort(),
    rowsRead:loaded.rowsRead,
    failures
  };
}

export { MAX_TEAM_PAGES, MAX_REPAIRS };
