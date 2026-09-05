import { runHootensStatewideResults, expandedAlias } from "./hootens-statewide-results.js";
import { normalizeSchoolAlias, resolveCanonicalEvent } from "./schedule-authority-core.js";
import { rebuildTeamRecords } from "./record-rebuild.js";

const STATE_ID = "hootens:football:current";
const USER_AGENT = "LocalBleachersAR/2.0 (+https://github.com/jamesmethvin74/game-nearby)";
const RECOVERY_LOOKBACK_HOURS = 96;
const ORIGINAL_LOOKBACK_HOURS = 42;
const LOOKAHEAD_HOURS = 8;
const TEAM_PAGE_DATE_WINDOW_DAYS = 14;

function clean(value) {
  return String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function safe(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function resultCode(teamScore, opponentScore) {
  return teamScore === opponentScore ? "T" : teamScore > opponentScore ? "W" : "L";
}

function chicagoYear(value = new Date()) {
  return Number(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric"
  }).format(value));
}

export function recoveryAlias(value) {
  let text = normalizeSchoolAlias(value);
  text = text
    .replace(/^lr\s+/, "little rock ")
    .replace(/^fs\s+/, "fort smith ")
    .replace(/^hs\s+lakeside$/, "hot springs lakeside");
  if (text === "har ber springdale" || text === "springdale har ber") return "har ber";
  if (text === "heritage rogers") return "rogers heritage";
  if (text === "southside batesville") return "batesville southside";
  if (text === "harmony grove haskell") return "haskell harmony grove";
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
    const nameKey = recoveryAlias(school.school_name);
    const cityKey = recoveryAlias(school.city);
    addUnique(byAlias, nameKey, school);
    if (nameKey && cityKey) addUnique(byNameCity, `${nameKey}|${cityKey}`, school);
  }
  for (const alias of aliases) {
    const school = byId.get(alias.school_id);
    if (!school) continue;
    addUnique(byAlias, recoveryAlias(alias.alias_text || alias.normalized_alias), school);
  }
  return { byAlias, byNameCity, byId };
}

export function resolveRecoverySchool(name, indexes) {
  const key = recoveryAlias(name);
  if (!key) return null;
  if (key === "fort smith northside") return indexes.byNameCity.get("northside|fort smith") || indexes.byAlias.get("northside") || indexes.byAlias.get(key) || null;
  if (key === "fort smith southside") return indexes.byNameCity.get("southside|fort smith") || indexes.byAlias.get(key) || null;
  if (key === "batesville southside") return indexes.byNameCity.get("southside|batesville") || indexes.byAlias.get(key) || null;
  return indexes.byAlias.get(key) || null;
}

function oldAliasIndex(schools, aliases) {
  const map = new Map();
  const activeSchools = schools.filter(school => school.team_id);
  const byId = new Map(activeSchools.map(school => [school.school_id, school]));
  const add = (alias, school) => {
    const key = expandedAlias(alias);
    if (!key) return;
    if (!map.has(key)) map.set(key, school);
    else if (map.get(key)?.school_id !== school.school_id) map.set(key, null);
  };
  for (const school of activeSchools) {
    add(school.school_name, school);
    add(`${school.school_name} ${school.mascot || ""}`, school);
  }
  for (const alias of aliases) {
    const school = byId.get(alias.school_id);
    if (school) add(alias.alias_text || alias.normalized_alias, school);
  }
  return map;
}

function originalPickSchool(name, index) {
  return index.get(expandedAlias(name)) || null;
}

function strictAnchor(candidates, opponentName, opponentSchoolId) {
  if (!candidates?.length) return null;
  if (opponentSchoolId) {
    const exactById = candidates.find(game => game.opponent_school_id === opponentSchoolId);
    if (exactById) return exactById;
  }
  const target = recoveryAlias(opponentName);
  const exactByName = candidates.find(game => recoveryAlias(game.opponent) === target);
  return exactByName || null;
}

function originalWouldMatch(final, originalIndex, gamesBySchool, cutoffMs) {
  const left = originalPickSchool(final.homeName, originalIndex);
  const right = originalPickSchool(final.awayName, originalIndex);
  const reporting = left || right;
  if (!reporting) return false;
  const candidates = (gamesBySchool.get(reporting.school_id) || []).filter(game => {
    const when = Date.parse(game.scheduled_at);
    return Number.isFinite(when) && when >= cutoffMs;
  });
  return candidates.length > 0;
}

function appendControlValue(row, cellIndex, value) {
  const text = clean(value);
  if (!row || cellIndex < 0 || !text) return;
  if (!Array.isArray(row.controls[cellIndex])) row.controls[cellIndex] = [];
  row.controls[cellIndex].push(text);
}

async function extractScoreboardFinals(html, HTMLRewriterClass = globalThis.HTMLRewriter) {
  if (!HTMLRewriterClass) throw new Error("HTMLRewriter unavailable for Hooten recovery parse");
  const state = { current: null, rows: [] };
  const response = new HTMLRewriterClass()
    .on("tr", {
      element(el) {
        state.current = { cells: ["", "", "", "", ""], controls: [[], [], [], [], [], []], cellIndex: -1, teamLinks: [], activeLink: null, activeSelectedOption: null };
        state.rows.push(state.current);
        el.onEndTag(() => { state.current = null; });
      }
    })
    .on("tr td", {
      element(el) {
        if (!state.current) return;
        state.current.cellIndex += 1;
        const index = state.current.cellIndex;
        appendControlValue(state.current, index, el.getAttribute("data-value"));
        appendControlValue(state.current, index, el.getAttribute("data-score"));
        appendControlValue(state.current, index, el.getAttribute("data-status"));
      },
      text(chunk) {
        if (state.current && state.current.cellIndex >= 0 && state.current.cellIndex < state.current.cells.length) {
          state.current.cells[state.current.cellIndex] += `${chunk.text} `;
        }
      }
    })
    .on("tr td input", { element(el) { if (state.current) appendControlValue(state.current, state.current.cellIndex, el.getAttribute("value")); } })
    .on("tr td select", { element(el) { if (state.current) appendControlValue(state.current, state.current.cellIndex, el.getAttribute("value")); } })
    .on("tr td option[selected]", {
      element(el) {
        if (!state.current) return;
        const selected = { cellIndex: state.current.cellIndex, text: "" };
        state.current.activeSelectedOption = selected;
        appendControlValue(state.current, selected.cellIndex, el.getAttribute("value"));
        el.onEndTag(() => {
          if (!state.current || state.current.activeSelectedOption !== selected) return;
          appendControlValue(state.current, selected.cellIndex, selected.text);
          state.current.activeSelectedOption = null;
        });
      },
      text(chunk) { if (state.current?.activeSelectedOption) state.current.activeSelectedOption.text += `${chunk.text} `; }
    })
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
  await response.text();

  const finals = [];
  for (const row of state.rows) {
    const cells = Array.from({ length: Math.max(row.cells.length, row.controls.length, 5) }, (_, index) =>
      clean([row.cells[index] || "", ...(row.controls[index] || [])].join(" "))
    );
    const links = row.teamLinks || [];
    if (links.length < 2 || !/\bfinal\b/i.test(cells[2] || "")) continue;
    const homeText = clean(cells[1]);
    const awayText = clean(cells[3]);
    if (!/\d/.test(homeText) || !/\d/.test(awayText)) continue;
    const homeScore = Number(homeText.replace(/[^0-9-]/g, ""));
    const awayScore = Number(awayText.replace(/[^0-9-]/g, ""));
    if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) continue;
    const homeName = clean(links[0]?.text);
    const awayName = clean(links[1]?.text);
    if (!homeName || !awayName) continue;
    finals.push({
      homeName,
      awayName,
      homeScore,
      awayScore,
      homeHref: clean(links[0]?.href) || null,
      awayHref: clean(links[1]?.href) || null,
      sourceEventKey: `hootens:${safe(homeName)}:${safe(awayName)}`
    });
  }
  return finals;
}

async function fetchFinals(scoreboardUrl, fetchFn = fetch, HTMLRewriterClass = globalThis.HTMLRewriter) {
  const response = await fetchFn(scoreboardUrl, {
    headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
    redirect: "follow"
  });
  if (!response.ok) throw new Error(`Hooten recovery scoreboard HTTP ${response.status}`);
  const finals = await extractScoreboardFinals(await response.text(), HTMLRewriterClass);
  if (!finals.length) throw new Error("Hooten recovery parsed zero finals");
  return finals;
}

async function extractTeamScheduleRows(html, HTMLRewriterClass = globalThis.HTMLRewriter) {
  if (!HTMLRewriterClass) throw new Error("HTMLRewriter unavailable for Hooten team schedule parse");
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

export function scheduleDateFromRows(rows, opponentName, now = new Date()) {
  const target = recoveryAlias(opponentName);
  const year = chicagoYear(now);
  const nowMs = now.getTime();
  const candidates = [];
  rows.forEach((cells, index) => {
    const dateText = clean(cells[0]);
    const opponentText = clean(cells[1]);
    const match = dateText.match(/^(\d{1,2})\/(\d{1,2})$/);
    if (!match || recoveryAlias(opponentText) !== target) return;
    const month = Number(match[1]);
    const day = Number(match[2]);
    const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T12:00:00.000Z`;
    const when = Date.parse(iso);
    if (!Number.isFinite(when)) return;
    const deltaDays = Math.abs(when - nowMs) / 86400000;
    if (deltaDays <= TEAM_PAGE_DATE_WINDOW_DAYS) candidates.push({ iso, deltaDays, index, locationText: clean(cells[3]) || null });
  });
  candidates.sort((a, b) => a.deltaDays - b.deltaDays || b.index - a.index);
  return candidates[0] || null;
}

async function recoverScheduleDate({ href, opponentName, scoreboardUrl, now, fetchFn, HTMLRewriterClass, pageCache }) {
  if (!href) return null;
  const pageUrl = new URL(href, scoreboardUrl).toString();
  let rows = pageCache.get(pageUrl);
  if (!rows) {
    const response = await fetchFn(pageUrl, {
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
      redirect: "follow"
    });
    if (!response.ok) return null;
    rows = await extractTeamScheduleRows(await response.text(), HTMLRewriterClass);
    pageCache.set(pageUrl, rows);
  }
  return scheduleDateFromRows(rows, opponentName, now);
}

async function loadRecoveryContext(env) {
  const [schoolsResult, aliasesResult, gamesResult] = await Promise.all([
    env.DB.prepare(`
      SELECT s.id AS school_id,s.name AS school_name,s.city,s.mascot,
        t.id AS team_id,t.conference_id
      FROM schools s
      LEFT JOIN teams t ON t.school_id=s.id
        AND t.sport='football' AND t.gender='boys' AND t.season='2026'
      WHERE s.level='high-school' AND s.state='AR' AND s.catalog_scope='local'
    `).all(),
    env.DB.prepare(`
      SELECT sa.normalized_alias,sa.alias_text,sa.school_id
      FROM school_aliases sa
      JOIN schools s ON s.id=sa.school_id
      WHERE s.level='high-school' AND s.state='AR' AND s.catalog_scope='local'
    `).all(),
    env.DB.prepare(`
      SELECT g.*,src.authority_rank,src.source_priority,src.parser_type,
        t.school_id,s.name AS school_name
      FROM games g
      JOIN sources src ON src.id=g.source_id
      JOIN teams t ON t.id=g.team_id
      JOIN schools s ON s.id=t.school_id
      WHERE t.sport='football' AND t.gender='boys' AND t.season='2026'
        AND s.level='high-school' AND s.state='AR' AND s.catalog_scope='local'
        AND datetime(g.scheduled_at) BETWEEN datetime('now','-${RECOVERY_LOOKBACK_HOURS} hours') AND datetime('now','+${LOOKAHEAD_HOURS} hours')
      ORDER BY src.authority_rank,src.source_priority,src.id
    `).all()
  ]);
  return {
    schools: schoolsResult.results || [],
    aliases: aliasesResult.results || [],
    games: gamesResult.results || [],
    rowsRead: Number(schoolsResult.meta?.rows_read || 0) + Number(aliasesResult.meta?.rows_read || 0) + Number(gamesResult.meta?.rows_read || 0)
  };
}

async function ensureMissingFootballTeams(env, schools, checkedAt) {
  const missingIds = [...new Set(schools.filter(school => school && !school.team_id).map(school => school.school_id))];
  if (!missingIds.length) return schools;
  const statements = missingIds.map(schoolId => env.DB.prepare(`
    INSERT INTO teams(id,school_id,sport,gender,season,conference_id,active,created_at,updated_at)
    VALUES(?,?,'football','boys','2026',NULL,1,?,?)
    ON CONFLICT(school_id,sport,gender,season) DO UPDATE SET active=1,updated_at=excluded.updated_at
  `).bind(`${schoolId}-football-2026`, schoolId, checkedAt, checkedAt));
  await env.DB.batch(statements);
  const result = await env.DB.prepare(`
    SELECT id AS team_id,school_id,conference_id
    FROM teams
    WHERE sport='football' AND gender='boys' AND season='2026'
      AND school_id IN (SELECT value FROM json_each(?))
  `).bind(JSON.stringify(missingIds)).all();
  const bySchool = new Map((result.results || []).map(row => [row.school_id, row]));
  for (const school of schools) {
    const row = bySchool.get(school.school_id);
    if (row) {
      school.team_id = row.team_id;
      school.conference_id = row.conference_id || null;
    }
  }
  return schools;
}

async function persistHootenAliases(env, indexes, checkedAt) {
  const targets = [
    { aliasText: "Springdale Har-Ber", school: indexes.byAlias.get("har ber") || null },
    { aliasText: "Fort Smith Northside", school: indexes.byNameCity.get("northside|fort smith") || null },
    { aliasText: "Fort Smith Southside", school: indexes.byNameCity.get("southside|fort smith") || null }
  ].filter(item => item.school);
  if (!targets.length) return 0;
  const statements = targets.map(item => env.DB.prepare(`
    INSERT INTO school_aliases(normalized_alias,school_id,alias_text,created_at)
    VALUES(?,?,?,?)
    ON CONFLICT(normalized_alias) DO UPDATE SET school_id=excluded.school_id,alias_text=excluded.alias_text
  `).bind(normalizeSchoolAlias(item.aliasText), item.school.school_id, item.aliasText, checkedAt));
  await env.DB.batch(statements);
  return targets.length;
}

async function ensureHootenSource(env, school, scoreboardUrl, checkedAt) {
  const sourceId = `${school.team_id}-hootens-statewide`;
  await env.DB.prepare(`
    INSERT INTO sources(id,team_id,source_url,source_type,source_priority,parser_type,parser_version,timezone,expected_min_games,refresh_minutes,active_result_minutes,enabled,authority_rank,stale_after_minutes,collection_mode,updated_at)
    VALUES(?,?,?,'secondary',90,'hootens-statewide','3','America/Chicago',1,30,5,0,90,180,'statewide',?)
    ON CONFLICT(id) DO UPDATE SET source_url=excluded.source_url,source_type=excluded.source_type,parser_version=excluded.parser_version,collection_mode=excluded.collection_mode,updated_at=excluded.updated_at
  `).bind(sourceId, school.team_id, scoreboardUrl, checkedAt).run();
  return { ...school, id: sourceId, source_url: scoreboardUrl, source_type: "secondary", source_priority: 90, parser_type: "hootens-statewide", parser_version: "3", timezone: "America/Chicago", authority_rank: 90 };
}

async function upsertAnchoredObservation(env, source, anchor, final, teamScore, opponentScore, checkedAt) {
  const sourceEventKey = `${final.sourceEventKey}:${safe(anchor.scheduled_at)}`;
  const id = `${source.id}:${sourceEventKey}`;
  await env.DB.prepare(`
    INSERT INTO games(id,team_id,source_id,source_event_key,opponent,opponent_school_id,scheduled_at,scheduled_time_known,venue,location_text,latitude,longitude,home_away,conference_game,counts_for_record,status,team_score,opponent_score,result,notes,source_url,source_updated_at,last_checked_at,updated_at,canonical_event_id)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(source_id,source_event_key) DO UPDATE SET
      opponent=excluded.opponent,opponent_school_id=excluded.opponent_school_id,scheduled_at=excluded.scheduled_at,scheduled_time_known=excluded.scheduled_time_known,
      venue=excluded.venue,location_text=excluded.location_text,latitude=excluded.latitude,longitude=excluded.longitude,home_away=excluded.home_away,
      conference_game=excluded.conference_game,counts_for_record=excluded.counts_for_record,status=excluded.status,team_score=excluded.team_score,
      opponent_score=excluded.opponent_score,result=excluded.result,notes=excluded.notes,source_url=excluded.source_url,
      source_updated_at=excluded.source_updated_at,last_checked_at=excluded.last_checked_at,updated_at=excluded.updated_at,canonical_event_id=excluded.canonical_event_id
  `).bind(
    id, source.team_id, source.id, sourceEventKey, anchor.opponent, anchor.opponent_school_id, anchor.scheduled_at, anchor.scheduled_time_known,
    anchor.venue || null, anchor.location_text || null, anchor.latitude ?? null, anchor.longitude ?? null, anchor.home_away, Number(anchor.conference_game || 0),
    Number(anchor.counts_for_record ?? 1), "FINAL", teamScore, opponentScore, resultCode(teamScore, opponentScore), "Hooten's statewide scoreboard final (recovered)",
    source.source_url, checkedAt, checkedAt, checkedAt, anchor.canonical_event_id
  ).run();
  await env.DB.prepare(`
    INSERT OR REPLACE INTO canonical_event_members(canonical_event_id,game_id,source_id,reporting_team_id,added_at)
    VALUES(?,?,?,?,?)
  `).bind(anchor.canonical_event_id, id, source.id, source.team_id, checkedAt).run();
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
  if (!observations.length) return null;
  const resolved = resolveCanonicalEvent(observations, { timeZone: "America/Chicago", now: checkedAt });
  const selected = observations.find(o => o.id === resolved.resolutionEvidence.selectedObservationId) || observations[0];
  const venueObservation = observations.find(o => o.id === resolved.resolutionEvidence.venueObservationId) || selected;
  const geoObservation = observations.find(o => o.latitude != null && o.longitude != null) || selected;
  await env.DB.prepare(`
    UPDATE canonical_events SET
      home_school_id=?,away_school_id=?,scheduled_at=?,scheduled_time_known=?,venue=?,location_text=?,latitude=?,longitude=?,conference_game=?,
      status=?,home_score=?,away_score=?,selected_source_id=?,trust_state=?,conflict_count=?,resolution_json=?,last_reconciled_at=?,updated_at=?
    WHERE id=?
  `).bind(
    resolved.homeSchoolId, resolved.awaySchoolId, resolved.scheduledAt, resolved.scheduledTimeKnown ? 1 : 0, resolved.venue || null,
    venueObservation?.location_text || resolved.venue || null, geoObservation?.latitude ?? null, geoObservation?.longitude ?? null, Number(selected?.conference_game || 0),
    resolved.status, resolved.homeScore ?? null, resolved.awayScore ?? null, resolved.selectedSourceId, resolved.trustState, resolved.conflicts.length,
    JSON.stringify(resolved.resolutionEvidence), checkedAt, checkedAt, canonicalId
  ).run();
  await env.DB.prepare("UPDATE event_conflicts SET resolved_at=? WHERE canonical_event_id=? AND resolved_at IS NULL").bind(checkedAt, canonicalId).run();
  for (const conflict of resolved.conflicts) {
    await env.DB.prepare("INSERT INTO event_conflicts(canonical_event_id,conflict_type,values_json,evidence_json,detected_at) VALUES(?,?,?,?,?)")
      .bind(canonicalId, conflict.type, JSON.stringify(conflict.values), JSON.stringify({ gameIds: observations.map(o => o.id), sourceIds: observations.map(o => o.source_id) }), checkedAt).run();
  }
  return resolved;
}

async function updateRawAnchor(env, anchor, teamScore, opponentScore, checkedAt, scoreboardUrl) {
  await env.DB.prepare(`
    UPDATE games SET status='FINAL',team_score=?,opponent_score=?,result=?,
      notes=CASE WHEN notes IS NULL OR notes='' THEN ? ELSE notes END,last_checked_at=?,updated_at=?
    WHERE id=?
  `).bind(
    teamScore, opponentScore, resultCode(teamScore, opponentScore),
    `Final score verified from Hooten's statewide scoreboard recovery: ${scoreboardUrl}`,
    checkedAt, checkedAt, anchor.id
  ).run();
}

async function upsertFallbackFinal(env, source, { final, school, opponentSchool, opponentName, teamScore, opponentScore, schedule, checkedAt }) {
  const dateKey = schedule.iso.slice(0, 10);
  const sourceEventKey = `${final.sourceEventKey}:fallback:${dateKey}:${school.school_id}`;
  const id = `${source.id}:${sourceEventKey}`;
  const conferenceGame = Boolean(opponentSchool?.conference_id && school.conference_id && opponentSchool.conference_id === school.conference_id) ? 1 : 0;
  await env.DB.prepare(`
    INSERT INTO games(id,team_id,source_id,source_event_key,opponent,opponent_school_id,scheduled_at,scheduled_time_known,venue,location_text,latitude,longitude,home_away,conference_game,counts_for_record,status,team_score,opponent_score,result,notes,source_url,source_updated_at,last_checked_at,updated_at,canonical_event_id)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)
    ON CONFLICT(source_id,source_event_key) DO UPDATE SET
      opponent=excluded.opponent,opponent_school_id=excluded.opponent_school_id,scheduled_at=excluded.scheduled_at,scheduled_time_known=excluded.scheduled_time_known,
      venue=excluded.venue,location_text=excluded.location_text,home_away=excluded.home_away,conference_game=excluded.conference_game,
      counts_for_record=excluded.counts_for_record,status=excluded.status,team_score=excluded.team_score,opponent_score=excluded.opponent_score,
      result=excluded.result,notes=excluded.notes,source_url=excluded.source_url,source_updated_at=excluded.source_updated_at,
      last_checked_at=excluded.last_checked_at,updated_at=excluded.updated_at
  `).bind(
    id, school.team_id, source.id, sourceEventKey, opponentName, opponentSchool?.school_id || null, schedule.iso, 0,
    null, schedule.locationText || null, null, null, "unknown", conferenceGame, 1, "FINAL", teamScore, opponentScore,
    resultCode(teamScore, opponentScore), "Hooten's statewide scoreboard final; schedule date recovered from Hooten team page",
    source.source_url, checkedAt, checkedAt, checkedAt
  ).run();
  return id;
}

async function saveRecoveryState(env, stateRow, { checkedAt, scoreboardUrl, finals, matched, unmatched, unresolved, recoveredGames, createdTeams, aliasesWritten }) {
  let details = {};
  try { details = JSON.parse(stateRow?.details_json || "{}"); } catch {}
  const next = {
    ...details,
    scoreboardUrl,
    finals,
    matched,
    unmatched,
    unmatchedSample: unresolved.slice(0, 20),
    recovery: { recoveredGames, createdTeams, aliasesWritten, checkedAt }
  };
  await env.DB.prepare(`
    UPDATE statewide_collection_state
    SET last_checked_at=?,last_event_count=?,details_json=?,updated_at=?
    WHERE id=?
  `).bind(checkedAt, finals, JSON.stringify(next), checkedAt, STATE_ID).run();
}

export async function recoverHootensUnmatched(env, {
  baseResult,
  fetchFn = fetch,
  HTMLRewriterClass = globalThis.HTMLRewriter,
  now = new Date()
} = {}) {
  if (!baseResult || Number(baseResult.unmatched || 0) <= 0) return baseResult;
  const checkedAt = now.toISOString();
  const stateRow = await env.DB.prepare("SELECT feed_url,details_json FROM statewide_collection_state WHERE id=?").bind(STATE_ID).first();
  let stateDetails = {};
  try { stateDetails = JSON.parse(stateRow?.details_json || "{}"); } catch {}
  const scoreboardUrl = clean(baseResult.scoreboardUrl || stateDetails.scoreboardUrl || stateRow?.feed_url);
  if (!scoreboardUrl) throw new Error("Hooten recovery missing scoreboard URL");

  const finals = await fetchFinals(scoreboardUrl, fetchFn, HTMLRewriterClass);
  const context = await loadRecoveryContext(env);
  const gamesBySchool = new Map();
  for (const game of context.games) {
    if (!gamesBySchool.has(game.school_id)) gamesBySchool.set(game.school_id, []);
    gamesBySchool.get(game.school_id).push(game);
  }

  const originalIndex = oldAliasIndex(context.schools, context.aliases);
  const cutoffMs = now.getTime() - ORIGINAL_LOOKBACK_HOURS * 3600000;
  const candidates = finals.filter(final => !originalWouldMatch(final, originalIndex, gamesBySchool, cutoffMs));
  const expectedUnmatched = Number(baseResult.unmatched || 0);
  if (candidates.length !== expectedUnmatched) {
    throw new Error(`Hooten recovery selector mismatch ${candidates.length}/${expectedUnmatched}; refusing ambiguous repair`);
  }

  let indexes = schoolIndexes(context.schools, context.aliases);
  const involvedSchools = [];
  for (const final of candidates) {
    const left = resolveRecoverySchool(final.homeName, indexes);
    const right = resolveRecoverySchool(final.awayName, indexes);
    if (left) involvedSchools.push(left);
    if (right) involvedSchools.push(right);
  }
  const beforeMissing = new Set(involvedSchools.filter(school => !school.team_id).map(school => school.school_id));
  await ensureMissingFootballTeams(env, involvedSchools, checkedAt);
  indexes = schoolIndexes(context.schools, context.aliases);
  const aliasesWritten = await persistHootenAliases(env, indexes, checkedAt);

  const pageCache = new Map();
  const touchedTeams = new Set();
  const unresolved = [];
  let recoveredGames = 0;

  for (const final of candidates) {
    const left = resolveRecoverySchool(final.homeName, indexes);
    const right = resolveRecoverySchool(final.awayName, indexes);
    const sides = [
      left && { school: left, opponentSchool: right, opponentName: final.awayName, teamScore: final.homeScore, opponentScore: final.awayScore, href: final.homeHref },
      right && { school: right, opponentSchool: left, opponentName: final.homeName, teamScore: final.awayScore, opponentScore: final.homeScore, href: final.awayHref }
    ].filter(Boolean);
    if (!sides.length) {
      unresolved.push({ home: final.homeName, away: final.awayName, reason: "no_local_school_match" });
      continue;
    }

    let gameRecovered = false;
    const sideFailures = [];
    for (const side of sides) {
      if (!side.school.team_id) {
        sideFailures.push(`${side.school.school_name}:missing-football-team`);
        continue;
      }
      const anchor = strictAnchor(gamesBySchool.get(side.school.school_id), side.opponentName, side.opponentSchool?.school_id || null);
      try {
        if (anchor) {
          if (anchor.opponent_school_id && anchor.canonical_event_id) {
            const source = await ensureHootenSource(env, side.school, scoreboardUrl, checkedAt);
            await upsertAnchoredObservation(env, source, anchor, final, side.teamScore, side.opponentScore, checkedAt);
            await reconcileCanonical(env, anchor.canonical_event_id, checkedAt);
          } else {
            await updateRawAnchor(env, anchor, side.teamScore, side.opponentScore, checkedAt, scoreboardUrl);
          }
          touchedTeams.add(side.school.team_id);
          gameRecovered = true;
          continue;
        }

        const schedule = await recoverScheduleDate({
          href: side.href,
          opponentName: side.opponentName,
          scoreboardUrl,
          now,
          fetchFn,
          HTMLRewriterClass,
          pageCache
        });
        if (!schedule) {
          sideFailures.push(`${side.school.school_name}:no-schedule-date`);
          continue;
        }
        const source = await ensureHootenSource(env, side.school, scoreboardUrl, checkedAt);
        await upsertFallbackFinal(env, source, { final, ...side, schedule, checkedAt });
        touchedTeams.add(side.school.team_id);
        gameRecovered = true;
      } catch (error) {
        sideFailures.push(`${side.school.school_name}:${String(error?.message || error).slice(0, 160)}`);
      }
    }

    if (gameRecovered) recoveredGames += 1;
    else unresolved.push({ home: final.homeName, away: final.awayName, reason: "recovery_failed", details: sideFailures });
  }

  if (touchedTeams.size) await rebuildTeamRecords(env, [...touchedTeams], checkedAt);
  const matched = Math.min(finals.length, Number(baseResult.matched || 0) + recoveredGames);
  const unmatched = Math.max(0, finals.length - matched);
  await saveRecoveryState(env, stateRow, {
    checkedAt,
    scoreboardUrl,
    finals: finals.length,
    matched,
    unmatched,
    unresolved,
    recoveredGames,
    createdTeams: beforeMissing.size,
    aliasesWritten
  });

  console.log("Hooten unmatched recovery", {
    finals: finals.length,
    baseMatched: Number(baseResult.matched || 0),
    baseUnmatched: Number(baseResult.unmatched || 0),
    recoveredGames,
    matched,
    unmatched,
    createdTeams: beforeMissing.size,
    aliasesWritten,
    touchedTeams: touchedTeams.size,
    selectorRowsRead: context.rowsRead
  });

  return {
    ...baseResult,
    status: unmatched === 0 ? "SUCCESS" : baseResult.status,
    finals: finals.length,
    matched,
    unmatched,
    recoveredGames,
    createdTeams: beforeMissing.size,
    aliasesWritten,
    touchedTeams: Math.max(Number(baseResult.touchedTeams || 0), touchedTeams.size),
    unmatchedSample: unresolved.slice(0, 20)
  };
}

export async function runCompleteHootensStatewideResults(env, options = {}) {
  const baseResult = await runHootensStatewideResults(env, options);
  if (baseResult?.status === "FAILURE" || Number(baseResult?.unmatched || 0) <= 0) return baseResult;
  try {
    return await recoverHootensUnmatched(env, {
      baseResult,
      fetchFn: options.fetchFn || fetch,
      HTMLRewriterClass: options.HTMLRewriterClass || globalThis.HTMLRewriter,
      now: options.now || new Date()
    });
  } catch (error) {
    const message = String(error?.message || error).slice(0, 1000);
    console.error("Hooten unmatched recovery failed", message);
    return { ...baseResult, recoveryStatus: "FAILURE", recoveryError: message };
  }
}
