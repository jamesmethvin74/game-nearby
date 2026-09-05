import { runCompleteHootensStatewideResults } from "./hootens-complete-results.js";
import { normalizeSchoolAlias } from "./schedule-authority-core.js";
import { rebuildTeamRecords } from "./record-rebuild.js";

const STATE_ID = "hootens:football:current";
const USER_AGENT = "LocalBleachersAR/2.0 (+https://github.com/jamesmethvin74/game-nearby)";
const MAX_REPAIR_FINALS = 20;
const GAME_WINDOW_HOURS = 168;

function clean(value) {
  return String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function safe(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function score(value) {
  const text = clean(value);
  if (!/\d/.test(text)) return null;
  const parsed = Number(text.replace(/[^0-9-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function resultCode(teamScore, opponentScore) {
  return teamScore === opponentScore ? "T" : teamScore > opponentScore ? "W" : "L";
}

export function resilientAlias(value) {
  let text = normalizeSchoolAlias(value);
  text = text
    .replace(/^lr\s+/, "little rock ")
    .replace(/^fs\s+/, "fort smith ")
    .replace(/^hs\s+lakeside$/, "hot springs lakeside");
  if (text === "har ber springdale" || text === "springdale har ber") return "har ber";
  if (text === "fort smith northside") return "northside";
  if (text === "fort smith southside") return "southside";
  if (text === "southside batesville") return "batesville southside";
  if (text === "heritage rogers") return "rogers heritage";
  if (text === "harmony grove haskell") return "haskell harmony grove";
  if (text === "helena west helena") return "central west helena";
  return text;
}

function addUnique(map, key, value) {
  if (!key) return;
  if (!map.has(key)) map.set(key, value);
  else if (map.get(key)?.school_id !== value.school_id) map.set(key, null);
}

function schoolIndexes(schools, aliases) {
  const byAlias = new Map();
  const byNameCity = new Map();
  const byId = new Map(schools.map(school => [school.school_id, school]));
  for (const school of schools) {
    const name = resilientAlias(school.school_name);
    const city = resilientAlias(school.city);
    addUnique(byAlias, name, school);
    if (name && city) addUnique(byNameCity, `${name}|${city}`, school);
  }
  for (const alias of aliases) {
    const school = byId.get(alias.school_id);
    if (school) addUnique(byAlias, resilientAlias(alias.alias_text || alias.normalized_alias), school);
  }
  return { byAlias, byNameCity, byId };
}

export function resolveResilientSchool(name, indexes) {
  const raw = normalizeSchoolAlias(name);
  if (raw === "fort smith northside" || raw === "fs northside") {
    return indexes.byNameCity.get("northside|fort smith") || indexes.byAlias.get("northside") || null;
  }
  if (raw === "fort smith southside" || raw === "fs southside") {
    return indexes.byNameCity.get("southside|fort smith") || null;
  }
  if (raw === "southside batesville") {
    return indexes.byNameCity.get("southside|batesville") || indexes.byAlias.get("batesville southside") || null;
  }
  return indexes.byAlias.get(resilientAlias(name)) || null;
}

function chicagoDateParts(now) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short"
  }).formatToParts(now);
  const read = type => parts.find(part => part.type === type)?.value || "";
  return { year: Number(read("year")), month: Number(read("month")), day: Number(read("day")), weekday: read("weekday") };
}

export function recentGameDate(dayHint = "friday", now = new Date()) {
  const { year, month, day, weekday } = chicagoDateParts(now);
  const dayNumbers = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const targetNumbers = { thursday: 4, friday: 5, saturday: 6 };
  const current = dayNumbers[weekday];
  const target = targetNumbers[dayHint] ?? 5;
  const delta = (current - target + 7) % 7;
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  date.setUTCDate(date.getUTCDate() - delta);
  return date.toISOString();
}

function appendControl(row, index, value) {
  const text = clean(value);
  if (!row || index < 0 || !text) return;
  if (!Array.isArray(row.controls[index])) row.controls[index] = [];
  row.controls[index].push(text);
}

async function extractFinals(html, HTMLRewriterClass = globalThis.HTMLRewriter) {
  if (!HTMLRewriterClass) throw new Error("HTMLRewriter unavailable for Hooten resilient parse");
  const state = { current: null, rows: [] };
  const transformed = new HTMLRewriterClass()
    .on("tr", {
      element(el) {
        state.current = { cells: ["", "", "", "", ""], controls: [[], [], [], [], [], []], cellIndex: -1, teamLinks: [], activeLink: null };
        state.rows.push(state.current);
        el.onEndTag(() => { state.current = null; });
      }
    })
    .on("tr td", {
      element(el) {
        if (!state.current) return;
        state.current.cellIndex += 1;
        const i = state.current.cellIndex;
        appendControl(state.current, i, el.getAttribute("data-value"));
        appendControl(state.current, i, el.getAttribute("data-score"));
        appendControl(state.current, i, el.getAttribute("data-status"));
      },
      text(chunk) {
        if (state.current && state.current.cellIndex >= 0) state.current.cells[state.current.cellIndex] += `${chunk.text} `;
      }
    })
    .on("tr td input", { element(el) { if (state.current) appendControl(state.current, state.current.cellIndex, el.getAttribute("value")); } })
    .on("tr td select", { element(el) { if (state.current) appendControl(state.current, state.current.cellIndex, el.getAttribute("value")); } })
    .on("tr td option[selected]", { element(el) { if (state.current) appendControl(state.current, state.current.cellIndex, el.getAttribute("value")); } })
    .on("tr a[href*='/teams/']", {
      element(el) {
        if (!state.current) return;
        const link = { href: el.getAttribute("href") || "", text: "" };
        state.current.teamLinks.push(link);
        state.current.activeLink = link;
        el.onEndTag(() => { if (state.current) state.current.activeLink = null; });
      },
      text(chunk) { if (state.current?.activeLink) state.current.activeLink.text += `${chunk.text} `; }
    })
    .transform(new Response(html));
  await transformed.text();

  const finals = [];
  let dayHint = "friday";
  for (const row of state.rows) {
    const cells = Array.from({ length: Math.max(row.cells.length, row.controls.length, 5) }, (_, index) =>
      clean([row.cells[index] || "", ...(row.controls[index] || [])].join(" "))
    );
    const first = clean(cells[0]).toLowerCase();
    if (/^thurs(?:day)?\.?$/.test(first)) { dayHint = "thursday"; continue; }
    if (/^fri(?:day)?\.?$/.test(first)) { dayHint = "friday"; continue; }
    if (/^sat(?:urday)?\.?$/.test(first)) { dayHint = "saturday"; continue; }
    if (/\bteams\b/i.test(first) && dayHint === "thursday") dayHint = "friday";

    const links = row.teamLinks || [];
    if (links.length < 2 || !/\bfinal\b/i.test(cells[2] || "")) continue;
    const homeScore = score(cells[1]);
    const awayScore = score(cells[3]);
    const homeName = clean(links[0]?.text);
    const awayName = clean(links[1]?.text);
    if (homeScore == null || awayScore == null || !homeName || !awayName) continue;
    finals.push({
      homeName,
      awayName,
      homeScore,
      awayScore,
      dayHint,
      sourceEventKey: `hootens:${safe(homeName)}:${safe(awayName)}`
    });
  }
  return finals;
}

async function fetchFinals(scoreboardUrl, fetchFn, HTMLRewriterClass) {
  const response = await fetchFn(scoreboardUrl, {
    headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
    redirect: "follow"
  });
  if (!response.ok) throw new Error(`Hooten resilient scoreboard HTTP ${response.status}`);
  const finals = await extractFinals(await response.text(), HTMLRewriterClass);
  if (finals.length < 25) throw new Error(`Hooten resilient parser returned suspicious final count ${finals.length}`);
  return finals;
}

async function loadContext(env) {
  const [schoolsResult, aliasesResult, gamesResult] = await Promise.all([
    env.DB.prepare(`
      SELECT s.id AS school_id,s.name AS school_name,s.city,s.mascot,
             t.id AS team_id,t.conference_id,t.active AS team_active
      FROM schools s
      LEFT JOIN teams t ON t.school_id=s.id AND t.sport='football' AND t.gender='boys' AND t.season='2026'
      WHERE s.level='high-school' AND s.state='AR' AND s.catalog_scope='local'
    `).all(),
    env.DB.prepare(`
      SELECT sa.normalized_alias,sa.alias_text,sa.school_id
      FROM school_aliases sa JOIN schools s ON s.id=sa.school_id
      WHERE s.level='high-school' AND s.state='AR' AND s.catalog_scope='local'
    `).all(),
    env.DB.prepare(`
      SELECT g.*,t.school_id,ce.home_school_id AS canonical_home_school_id,ce.away_school_id AS canonical_away_school_id
      FROM games g
      JOIN teams t ON t.id=g.team_id
      JOIN schools s ON s.id=t.school_id
      LEFT JOIN canonical_events ce ON ce.id=g.canonical_event_id
      WHERE t.sport='football' AND t.gender='boys' AND t.season='2026'
        AND s.level='high-school' AND s.state='AR' AND s.catalog_scope='local'
        AND datetime(g.scheduled_at)>=datetime('now','-${GAME_WINDOW_HOURS} hours')
    `).all()
  ]);
  return {
    schools: schoolsResult.results || [],
    aliases: aliasesResult.results || [],
    games: gamesResult.results || [],
    rowsRead: Number(schoolsResult.meta?.rows_read || 0) + Number(aliasesResult.meta?.rows_read || 0) + Number(gamesResult.meta?.rows_read || 0)
  };
}

function exactFinalGame(games, opponentName, opponentSchoolId, teamScore, opponentScore) {
  return (games || []).find(game => {
    if (game.status !== "FINAL" || Number(game.team_score) !== Number(teamScore) || Number(game.opponent_score) !== Number(opponentScore)) return false;
    if (opponentSchoolId && game.opponent_school_id === opponentSchoolId) return true;
    return resilientAlias(game.opponent) === resilientAlias(opponentName);
  }) || null;
}

export function missingLocalFinalSides(sides = [], gamesBySchool = new Map()) {
  return sides.filter(side => !exactFinalGame(
    gamesBySchool.get(side.school.school_id),
    side.opponentName,
    side.opponentSchool?.school_id || null,
    side.teamScore,
    side.opponentScore
  ));
}

function exactAnchor(games, opponentName, opponentSchoolId) {
  return (games || []).find(game => {
    if (opponentSchoolId && game.opponent_school_id === opponentSchoolId) return true;
    return resilientAlias(game.opponent) === resilientAlias(opponentName);
  }) || null;
}

async function ensureTeam(env, school, checkedAt) {
  if (school.team_id && Number(school.team_active ?? 1) === 1) return school;
  const teamId = school.team_id || `${school.school_id}-football-2026`;
  await env.DB.prepare(`
    INSERT INTO teams(id,school_id,sport,gender,season,conference_id,active,created_at,updated_at)
    VALUES(?,?,'football','boys','2026',?,1,?,?)
    ON CONFLICT(school_id,sport,gender,season) DO UPDATE SET active=1,updated_at=excluded.updated_at
  `).bind(teamId, school.school_id, school.conference_id || null, checkedAt, checkedAt).run();
  school.team_id = teamId;
  school.team_active = 1;
  return school;
}

async function ensureSource(env, school, scoreboardUrl, checkedAt) {
  const id = `${school.team_id}-hootens-statewide`;
  await env.DB.prepare(`
    INSERT INTO sources(id,team_id,source_url,source_type,source_priority,parser_type,parser_version,timezone,expected_min_games,refresh_minutes,active_result_minutes,enabled,authority_rank,stale_after_minutes,collection_mode,updated_at)
    VALUES(?,?,?,'secondary',90,'hootens-statewide','4','America/Chicago',1,30,5,0,90,180,'statewide',?)
    ON CONFLICT(id) DO UPDATE SET source_url=excluded.source_url,parser_version=excluded.parser_version,collection_mode='statewide',updated_at=excluded.updated_at
  `).bind(id, school.team_id, scoreboardUrl, checkedAt).run();
  return id;
}

async function updateAnchor(env, anchor, school, teamScore, opponentScore, scoreboardUrl, checkedAt) {
  await env.DB.prepare(`
    UPDATE games SET status='FINAL',team_score=?,opponent_score=?,result=?,
      notes=CASE WHEN notes IS NULL OR notes='' THEN ? ELSE notes END,last_checked_at=?,updated_at=?
    WHERE id=?
  `).bind(teamScore, opponentScore, resultCode(teamScore, opponentScore), `Final score verified by Hooten's statewide scoreboard: ${scoreboardUrl}`, checkedAt, checkedAt, anchor.id).run();

  if (!anchor.canonical_event_id) return;
  let homeScore = null;
  let awayScore = null;
  if (anchor.canonical_home_school_id === school.school_id || anchor.home_away === "home") {
    homeScore = teamScore; awayScore = opponentScore;
  } else if (anchor.canonical_away_school_id === school.school_id || anchor.home_away === "away") {
    homeScore = opponentScore; awayScore = teamScore;
  }
  if (homeScore == null || awayScore == null) return;
  await env.DB.prepare(`
    UPDATE canonical_events SET status='FINAL',home_score=?,away_score=?,last_reconciled_at=?,updated_at=? WHERE id=?
  `).bind(homeScore, awayScore, checkedAt, checkedAt, anchor.canonical_event_id).run();
}

async function upsertFallback(env, school, opponentSchool, opponentName, final, teamScore, opponentScore, scoreboardUrl, checkedAt) {
  const sourceId = await ensureSource(env, school, scoreboardUrl, checkedAt);
  const scheduledAt = recentGameDate(final.dayHint, new Date(checkedAt));
  const sourceEventKey = `${final.sourceEventKey}:resilient:${scheduledAt.slice(0, 10)}:${school.school_id}`;
  const id = `${sourceId}:${sourceEventKey}`;
  const conferenceGame = Boolean(opponentSchool?.conference_id && school.conference_id && opponentSchool.conference_id === school.conference_id) ? 1 : 0;
  await env.DB.prepare(`
    INSERT INTO games(id,team_id,source_id,source_event_key,opponent,opponent_school_id,scheduled_at,scheduled_time_known,home_away,conference_game,counts_for_record,status,team_score,opponent_score,result,notes,source_url,source_updated_at,last_checked_at,updated_at,canonical_event_id)
    VALUES(?,?,?,?,?,?,?,0,'unknown',?,1,'FINAL',?,?,?,?,?,?,?,?,NULL)
    ON CONFLICT(source_id,source_event_key) DO UPDATE SET
      opponent=excluded.opponent,opponent_school_id=excluded.opponent_school_id,scheduled_at=excluded.scheduled_at,
      status='FINAL',team_score=excluded.team_score,opponent_score=excluded.opponent_score,result=excluded.result,
      notes=excluded.notes,source_url=excluded.source_url,source_updated_at=excluded.source_updated_at,
      last_checked_at=excluded.last_checked_at,updated_at=excluded.updated_at
  `).bind(
    id, school.team_id, sourceId, sourceEventKey, opponentName, opponentSchool?.school_id || null, scheduledAt,
    conferenceGame, teamScore, opponentScore, resultCode(teamScore, opponentScore),
    "Hooten's statewide scoreboard final; resilient schedule fallback", scoreboardUrl, checkedAt, checkedAt, checkedAt
  ).run();
}

async function saveState(env, stateRow, { checkedAt, scoreboardUrl, finals, matched, unmatched, unresolved, repaired, rowsRead }) {
  let details = {};
  try { details = JSON.parse(stateRow?.details_json || "{}"); } catch {}
  const next = {
    ...details,
    scoreboardUrl,
    finals,
    matched,
    unmatched,
    unmatchedSample: unresolved.slice(0, 20),
    resilientRecovery: { version: 2, repaired, rowsRead, checkedAt }
  };
  await env.DB.prepare(`
    UPDATE statewide_collection_state SET last_checked_at=?,last_event_count=?,details_json=?,updated_at=? WHERE id=?
  `).bind(checkedAt, finals, JSON.stringify(next), checkedAt, STATE_ID).run();
}

export async function finalizeHootensResults(env, {
  baseResult,
  fetchFn = fetch,
  HTMLRewriterClass = globalThis.HTMLRewriter,
  now = new Date()
} = {}) {
  const checkedAt = now.toISOString();
  const stateRow = await env.DB.prepare("SELECT feed_url,details_json FROM statewide_collection_state WHERE id=?").bind(STATE_ID).first();
  let stateDetails = {};
  try { stateDetails = JSON.parse(stateRow?.details_json || "{}"); } catch {}
  const scoreboardUrl = clean(baseResult?.scoreboardUrl || stateDetails.scoreboardUrl || stateRow?.feed_url);
  if (!scoreboardUrl) throw new Error("Hooten resilient finalizer missing scoreboard URL");

  const finals = await fetchFinals(scoreboardUrl, fetchFn, HTMLRewriterClass);
  const context = await loadContext(env);
  const indexes = schoolIndexes(context.schools, context.aliases);
  const gamesBySchool = new Map();
  for (const game of context.games) {
    if (!gamesBySchool.has(game.school_id)) gamesBySchool.set(game.school_id, []);
    gamesBySchool.get(game.school_id).push(game);
  }

  const missing = [];
  for (const final of finals) {
    const left = resolveResilientSchool(final.homeName, indexes);
    const right = resolveResilientSchool(final.awayName, indexes);
    const sides = [
      left && { school: left, opponentSchool: right, opponentName: final.awayName, teamScore: final.homeScore, opponentScore: final.awayScore },
      right && { school: right, opponentSchool: left, opponentName: final.homeName, teamScore: final.awayScore, opponentScore: final.homeScore }
    ].filter(Boolean);
    const missingSides = missingLocalFinalSides(sides, gamesBySchool);
    if (missingSides.length) missing.push({ final, sides: missingSides });
  }

  if (missing.length > MAX_REPAIR_FINALS) {
    throw new Error(`Hooten resilient finalizer found ${missing.length} missing finals; exceeds bounded repair limit ${MAX_REPAIR_FINALS}`);
  }

  const touchedTeams = new Set();
  const unresolved = [];
  let repaired = 0;
  for (const item of missing) {
    if (!item.sides.length) {
      unresolved.push({ home: item.final.homeName, away: item.final.awayName, reason: "no_local_school_match" });
      continue;
    }
    let successes = 0;
    const failures = [];
    for (const side of item.sides) {
      try {
        await ensureTeam(env, side.school, checkedAt);
        const anchor = exactAnchor(gamesBySchool.get(side.school.school_id), side.opponentName, side.opponentSchool?.school_id || null);
        if (anchor) await updateAnchor(env, anchor, side.school, side.teamScore, side.opponentScore, scoreboardUrl, checkedAt);
        else await upsertFallback(env, side.school, side.opponentSchool, side.opponentName, item.final, side.teamScore, side.opponentScore, scoreboardUrl, checkedAt);
        touchedTeams.add(side.school.team_id);
        successes += 1;
      } catch (error) {
        failures.push(`${side.school.school_name}:${String(error?.message || error).slice(0, 180)}`);
      }
    }
    if (successes === item.sides.length) repaired += 1;
    else unresolved.push({
      home: item.final.homeName,
      away: item.final.awayName,
      reason: "repair_failed",
      repairedSides: successes,
      requiredSides: item.sides.length,
      details: failures
    });
  }

  if (touchedTeams.size) await rebuildTeamRecords(env, [...touchedTeams], checkedAt);
  const unmatched = unresolved.length;
  const matched = finals.length - unmatched;
  await saveState(env, stateRow, {
    checkedAt,
    scoreboardUrl,
    finals: finals.length,
    matched,
    unmatched,
    unresolved,
    repaired,
    rowsRead: context.rowsRead
  });

  return {
    ...(baseResult || {}),
    status: unmatched === 0 ? "SUCCESS" : "PARTIAL",
    scoreboardUrl,
    finals: finals.length,
    matched,
    unmatched,
    resilientMissingBefore: missing.length,
    resilientRepaired: repaired,
    touchedTeams: touchedTeams.size,
    unmatchedSample: unresolved.slice(0, 20)
  };
}

export async function runResilientHootensStatewideResults(env, options = {}) {
  const baseResult = await runCompleteHootensStatewideResults(env, options);
  if (baseResult?.status === "FAILURE") return baseResult;
  try {
    return await finalizeHootensResults(env, {
      baseResult,
      fetchFn: options.fetchFn || fetch,
      HTMLRewriterClass: options.HTMLRewriterClass || globalThis.HTMLRewriter,
      now: options.now || new Date()
    });
  } catch (error) {
    const message = String(error?.message || error).slice(0, 1000);
    console.error("Hooten resilient finalizer failed", message);
    return { ...baseResult, resilientStatus: "FAILURE", resilientError: message };
  }
}
