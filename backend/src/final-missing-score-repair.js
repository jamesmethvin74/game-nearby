import { rebuildTeamRecords } from "./record-rebuild.js";

const FINGERPRINT_PREFIX = "final-missing-score-two-games-v1";
const MAX_PLAN_READS = 500;
const MAX_DIRECT_WRITES = 6;

export const FINAL_MISSING_SCORE_CASES = Object.freeze([
  Object.freeze({
    key:"central-forrest-city-20260825",
    canonicalId:"ce:volleyball:girls:2026:df-7kza8c:df-cqpax3:20260825:df-695fcf130e0845562900001c",
    eventId:"695fcf130e0845562900001c",
    scheduledAt:"2026-08-25T21:30:00.000Z",
    homeSchoolId:"df-cqpax3",
    awaySchoolId:"df-7kza8c",
    homeTeamId:"df-cqpax3-volleyball-2026",
    awayTeamId:"df-7kza8c-volleyball-2026",
    homeScore:0,
    awayScore:3,
    evidence:"DragonFly authoritative result says Central W / Forrest City L with Central score 3; MaxPreps independently reports Central 3-0 Forrest City with set scores 25-23, 25-14, 25-21."
  }),
  Object.freeze({
    key:"farmington-huntsville-20260825",
    canonicalId:"ce:volleyball:girls:2026:df-8pkud7:df-qgka87:20260825:df-69babe474fd8441434000004",
    eventId:"69babe474fd8441434000004",
    scheduledAt:"2026-08-25T23:30:00.000Z",
    homeSchoolId:"df-8pkud7",
    awaySchoolId:"df-qgka87",
    homeTeamId:"df-8pkud7-volleyball-2026",
    awayTeamId:"df-qgka87-volleyball-2026",
    homeScore:0,
    awayScore:3,
    evidence:"DragonFly authoritative result says Farmington W / Huntsville L with Farmington score 3; Huntsville official athletics and MaxPreps independently report Huntsville 0-3 Farmington."
  })
]);

function rowsRead(result) { return Number(result?.meta?.rows_read || 0); }
function rowsWritten(result) { return Number(result?.meta?.rows_written || 0); }
function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function hashText(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function caseSnapshot(rows, item) {
  const matches = rows.filter(row => row.canonical_id === item.canonicalId);
  const base = matches[0] || null;
  const home = matches.find(row => row.reporting_team_id === item.homeTeamId) || null;
  const away = matches.find(row => row.reporting_team_id === item.awayTeamId) || null;
  return { matches, base, home, away };
}

export function classifyFinalMissingScoreRows(rows = []) {
  const reasons = [];
  const cases = [];

  for (const item of FINAL_MISSING_SCORE_CASES) {
    const { matches, base, home, away } = caseSnapshot(rows, item);
    const localReasons = [];
    if (matches.length !== 2) localReasons.push(`expected exactly 2 canonical member rows, found ${matches.length}`);
    if (!base) localReasons.push("canonical event is missing");
    if (base && base.canonical_status !== "FINAL") localReasons.push(`canonical status is ${base.canonical_status || "null"}, not FINAL`);
    if (base && base.home_school_id !== item.homeSchoolId) localReasons.push(`home school changed to ${base.home_school_id || "null"}`);
    if (base && base.away_school_id !== item.awaySchoolId) localReasons.push(`away school changed to ${base.away_school_id || "null"}`);
    if (base && Number(base.active_conflicts || 0) !== 0) localReasons.push(`active conflicts=${Number(base.active_conflicts || 0)}`);
    if (!home) localReasons.push("home-team member is missing");
    if (!away) localReasons.push("away-team member is missing");
    if (home && home.game_status !== "FINAL") localReasons.push(`home member status is ${home.game_status || "null"}`);
    if (away && away.game_status !== "FINAL") localReasons.push(`away member status is ${away.game_status || "null"}`);

    const complete = Boolean(base && home && away)
      && numberOrNull(base.home_score) === item.homeScore
      && numberOrNull(base.away_score) === item.awayScore
      && numberOrNull(home.team_score) === item.homeScore
      && numberOrNull(home.opponent_score) === item.awayScore
      && String(home.game_result || "") === "L"
      && numberOrNull(away.team_score) === item.awayScore
      && numberOrNull(away.opponent_score) === item.homeScore
      && String(away.game_result || "") === "W";

    const exactPartial = Boolean(base && home && away)
      && numberOrNull(base.home_score) === null
      && numberOrNull(base.away_score) === item.awayScore
      && numberOrNull(home.team_score) === null
      && numberOrNull(home.opponent_score) === item.awayScore
      && !String(home.game_result || "")
      && numberOrNull(away.team_score) === item.awayScore
      && numberOrNull(away.opponent_score) === null
      && !String(away.game_result || "");

    let action = "unsafe";
    if (!localReasons.length && complete) action = "already_complete";
    else if (!localReasons.length && exactPartial) action = "apply";
    else if (!localReasons.length) localReasons.push("score state no longer matches the exact proven partial or complete state");

    if (localReasons.length) reasons.push(...localReasons.map(reason => `${item.key}: ${reason}`));
    cases.push({
      key:item.key,
      canonical_id:item.canonicalId,
      event_id:item.eventId,
      scheduled_at:item.scheduledAt,
      action,
      evidence:item.evidence,
      current:{
        home_score:numberOrNull(base?.home_score),
        away_score:numberOrNull(base?.away_score),
        home_game_id:home?.game_id || null,
        home_team_score:numberOrNull(home?.team_score),
        home_opponent_score:numberOrNull(home?.opponent_score),
        home_result:home?.game_result || null,
        away_game_id:away?.game_id || null,
        away_team_score:numberOrNull(away?.team_score),
        away_opponent_score:numberOrNull(away?.opponent_score),
        away_result:away?.game_result || null
      },
      target:{ home_score:item.homeScore, away_score:item.awayScore }
    });
  }

  return { safe:reasons.length === 0, reasons, cases };
}

async function loadRepairState(env) {
  const canonicalIds = FINAL_MISSING_SCORE_CASES.map(item => item.canonicalId);
  const teamIds = FINAL_MISSING_SCORE_CASES.flatMap(item => [item.homeTeamId, item.awayTeamId]);
  const [eventRows, recordRows] = await env.DB.batch([
    env.DB.prepare(`
      SELECT ce.id AS canonical_id,ce.status AS canonical_status,ce.home_school_id,ce.away_school_id,
        ce.home_score,ce.away_score,ce.conflict_count,
        (SELECT COUNT(*) FROM event_conflicts ec WHERE ec.canonical_event_id=ce.id AND ec.resolved_at IS NULL) AS active_conflicts,
        cem.game_id,cem.reporting_team_id,
        g.source_id,g.status AS game_status,g.team_score,g.opponent_score,g.result AS game_result
      FROM canonical_events ce
      LEFT JOIN canonical_event_members cem ON cem.canonical_event_id=ce.id
      LEFT JOIN games g ON g.id=cem.game_id
      WHERE ce.id IN (?,?)
      ORDER BY ce.id,cem.reporting_team_id,cem.game_id
    `).bind(...canonicalIds),
    env.DB.prepare(`
      SELECT team_id,wins,losses,ties,conference_wins,conference_losses,conference_ties,calculated_at
      FROM team_records
      WHERE team_id IN (?,?,?,?)
      ORDER BY team_id
    `).bind(...teamIds)
  ]);
  const d1 = {
    statements:2,
    rows_read:rowsRead(eventRows) + rowsRead(recordRows),
    rows_written:rowsWritten(eventRows) + rowsWritten(recordRows),
    per_statement:[
      { rows_read:rowsRead(eventRows), rows_written:rowsWritten(eventRows) },
      { rows_read:rowsRead(recordRows), rows_written:rowsWritten(recordRows) }
    ]
  };
  return { eventRows:eventRows.results || [], recordRows:recordRows.results || [], d1 };
}

function fingerprintFor(classified) {
  const payload = classified.cases.map(item => ({
    key:item.key,
    action:item.action,
    current:item.current,
    target:item.target
  }));
  return `${FINGERPRINT_PREFIX}-${hashText(JSON.stringify(payload))}`;
}

export async function planFinalMissingScoreRepair(env) {
  const state = await loadRepairState(env);
  const classified = classifyFinalMissingScoreRows(state.eventRows);
  const reasons = [...classified.reasons];
  if (state.d1.rows_written !== 0) reasons.push(`plan unexpectedly wrote ${state.d1.rows_written} rows`);
  if (state.d1.rows_read > MAX_PLAN_READS) reasons.push(`plan read fuse exceeded: ${state.d1.rows_read} > ${MAX_PLAN_READS}`);
  const safe = reasons.length === 0;
  return {
    fingerprint:fingerprintFor(classified),
    safe,
    reasons,
    cases:classified.cases,
    records_before:state.recordRows,
    write_scope:{
      canonical_events_max:2,
      game_rows_max:4,
      record_rebuild_teams_max:4,
      direct_writes_max:MAX_DIRECT_WRITES
    },
    d1:state.d1
  };
}

function updateClauseForCases(cases) {
  return cases.map(() => "(id=? AND home_school_id=? AND away_school_id=? AND status='FINAL' AND home_score IS NULL AND away_score=3)").join(" OR ");
}

function gameClauseForCases(cases) {
  return cases.map(() => "(canonical_event_id=? AND team_id IN (?,?))").join(" OR ");
}

export async function executeFinalMissingScoreRepair(env, { fingerprint, now = new Date() } = {}) {
  const plan = await planFinalMissingScoreRepair(env);
  if (!fingerprint || fingerprint !== plan.fingerprint) throw new Error("final-score repair fingerprint mismatch");
  if (!plan.safe) throw new Error(`final-score repair preflight unsafe: ${plan.reasons.join("; ")}`);

  const applyCases = FINAL_MISSING_SCORE_CASES.filter(item => plan.cases.find(row => row.key === item.key)?.action === "apply");
  if (!applyCases.length) return { status:"ALREADY_COMPLETE", fingerprint:plan.fingerprint, plan };

  const checkedAt = now.toISOString();
  const canonicalBindings = applyCases.flatMap(item => [item.canonicalId, item.homeSchoolId, item.awaySchoolId]);
  const canonicalWrite = await env.DB.prepare(`
    UPDATE canonical_events
    SET home_score=0,away_score=3,status='FINAL',last_reconciled_at=?,updated_at=?
    WHERE ${updateClauseForCases(applyCases)}
  `).bind(checkedAt, checkedAt, ...canonicalBindings).run();

  const gameBindings = applyCases.flatMap(item => [item.canonicalId, item.homeTeamId, item.awayTeamId]);
  const gameWrite = await env.DB.prepare(`
    UPDATE games
    SET team_score=CASE
          WHEN team_id IN ('df-cqpax3-volleyball-2026','df-8pkud7-volleyball-2026') THEN 0
          WHEN team_id IN ('df-7kza8c-volleyball-2026','df-qgka87-volleyball-2026') THEN 3
          ELSE team_score END,
        opponent_score=CASE
          WHEN team_id IN ('df-cqpax3-volleyball-2026','df-8pkud7-volleyball-2026') THEN 3
          WHEN team_id IN ('df-7kza8c-volleyball-2026','df-qgka87-volleyball-2026') THEN 0
          ELSE opponent_score END,
        result=CASE
          WHEN team_id IN ('df-cqpax3-volleyball-2026','df-8pkud7-volleyball-2026') THEN 'L'
          WHEN team_id IN ('df-7kza8c-volleyball-2026','df-qgka87-volleyball-2026') THEN 'W'
          ELSE result END,
        status='FINAL',last_checked_at=?,updated_at=?
    WHERE ${gameClauseForCases(applyCases)}
  `).bind(checkedAt, checkedAt, ...gameBindings).run();

  const directRowsWritten = rowsWritten(canonicalWrite) + rowsWritten(gameWrite);
  const expectedDirectRows = applyCases.length * 3;
  if (rowsWritten(canonicalWrite) !== applyCases.length) {
    throw new Error(`canonical write count mismatch: expected ${applyCases.length}, got ${rowsWritten(canonicalWrite)}`);
  }
  if (rowsWritten(gameWrite) !== applyCases.length * 2) {
    throw new Error(`game write count mismatch: expected ${applyCases.length * 2}, got ${rowsWritten(gameWrite)}`);
  }
  if (directRowsWritten > MAX_DIRECT_WRITES || directRowsWritten !== expectedDirectRows) {
    throw new Error(`direct write fuse tripped: expected ${expectedDirectRows}, got ${directRowsWritten}`);
  }

  const touchedTeamIds = applyCases.flatMap(item => [item.homeTeamId, item.awayTeamId]);
  const recordResult = await rebuildTeamRecords(env, touchedTeamIds, checkedAt);
  if (Number(recordResult?.teams || 0) !== touchedTeamIds.length) {
    throw new Error(`record rebuild team count mismatch: expected ${touchedTeamIds.length}, got ${recordResult?.teams || 0}`);
  }

  const verification = await planFinalMissingScoreRepair(env);
  const bad = verification.cases.filter(item => item.action !== "already_complete");
  if (!verification.safe || bad.length) {
    throw new Error(`final-score repair verification failed: ${verification.reasons.join("; ")} ${bad.map(item => `${item.key}:${item.action}`).join(",")}`.trim());
  }

  return {
    status:"SUCCESS",
    fingerprint,
    corrected_cases:applyCases.map(item => item.key),
    direct_write_telemetry:{
      statements:2,
      rows_read:rowsRead(canonicalWrite) + rowsRead(gameWrite),
      rows_written:directRowsWritten,
      canonical_rows_written:rowsWritten(canonicalWrite),
      game_rows_written:rowsWritten(gameWrite)
    },
    record_result:recordResult,
    verification
  };
}

export { FINGERPRINT_PREFIX as FINAL_MISSING_SCORE_FINGERPRINT_PREFIX, MAX_PLAN_READS, MAX_DIRECT_WRITES };
