import { recordFromScheduleRows } from "./schedule-response-normalizer.js";

function teamKey(team) {
  return `${team.sport}|${team.gender}|${team.season}`;
}

function logD1QueryMeta(stage, result, { scopedTeamCount = null } = {}) {
  const meta = result?.meta || {};
  const rowsRead = Number(meta.rows_read || 0);
  const rowsWritten = Number(meta.rows_written || 0);
  if (!rowsRead && !rowsWritten) return;
  console.log("d1 record rebuild query", {
    stage,
    scope: scopedTeamCount == null ? "statewide" : "team-scoped",
    scopedTeamCount,
    rowsRead,
    rowsWritten,
    durationMs: Number(meta.duration || 0) || null
  });
}

function canonicalCandidate(event, team) {
  const isHome = event.home_school_id === team.school_id;
  const isAway = event.away_school_id === team.school_id;
  if (!isHome && !isAway) return null;
  const opponentSchoolId = isHome ? event.away_school_id : event.home_school_id;
  const opponentName = isHome ? event.away_name : event.home_name;
  return {
    school_id: team.school_id,
    team_id: team.id,
    sport: team.sport,
    gender: team.gender,
    opponent: opponentName || opponentSchoolId || "Opponent",
    opponent_school_id: opponentSchoolId || null,
    scheduled_at: event.scheduled_at,
    status: event.status,
    team_score: isHome ? event.home_score : event.away_score,
    opponent_score: isHome ? event.away_score : event.home_score,
    conference_game: Number(event.conference_game || 0),
    counts_for_record: Number(event.counts_for_record ?? 1),
    canonical_event_id: event.id,
    data_trust: event.trust_state || "SINGLE_SOURCE_LIVE",
    source_type: "official-conference",
    parser_type: "dragonfly-public"
  };
}

function rawCandidate(game, team) {
  return {
    ...game,
    school_id: team.school_id,
    team_id: team.id,
    sport: team.sport,
    gender: team.gender,
    opponent: game.opponent_name || game.opponent || game.opponent_school_id || "Opponent",
    opponent_school_id: game.opponent_school_id || null
  };
}

function upsertRecordStatement(env, teamId, record, calculatedAt) {
  return env.DB.prepare(`
    INSERT INTO team_records(team_id,wins,losses,ties,conference_wins,conference_losses,conference_ties,calculated_at)
    VALUES(?,?,?,?,?,?,?,?)
    ON CONFLICT(team_id) DO UPDATE SET
      wins=excluded.wins,losses=excluded.losses,ties=excluded.ties,
      conference_wins=excluded.conference_wins,conference_losses=excluded.conference_losses,
      conference_ties=excluded.conference_ties,calculated_at=excluded.calculated_at`)
    .bind(
      teamId,
      record.wins,
      record.losses,
      record.ties,
      record.conference_wins,
      record.conference_losses,
      record.conference_ties,
      calculatedAt
    );
}

async function loadRecordInputs(env, { teamIds = null } = {}) {
  const scopedTeamIds = teamIds?.length ? [...new Set(teamIds.filter(Boolean))] : null;
  const teamIdsJson = scopedTeamIds ? JSON.stringify(scopedTeamIds) : null;
  const metaContext = { scopedTeamCount: scopedTeamIds?.length ?? null };

  let teamQuery = `
    SELECT t.id,t.school_id,t.sport,t.gender,t.season,t.conference_id
    FROM teams t
    WHERE t.active=1`;
  let prepared = env.DB.prepare(teamQuery + (scopedTeamIds ? " AND t.id IN (SELECT value FROM json_each(?))" : ""));
  if (scopedTeamIds) prepared = prepared.bind(teamIdsJson);
  const teamResult = await prepared.all();
  logD1QueryMeta("teams", teamResult, metaContext);
  const teams = teamResult.results || [];
  if (!teams.length) return { teams: [], canonicals: [], raw: [] };

  // IMPORTANT: when rebuilding one/few teams, keep the restriction inside SQL.
  // The old implementation loaded every FINAL canonical/raw result statewide and
  // filtered in JavaScript, multiplying D1 rows_read once per refreshed source.
  let canonicalQuery = `
    SELECT DISTINCT ce.*,
      cem.reporting_team_id,
      hs.name AS home_name,
      aws.name AS away_name,
      1 AS counts_for_record
    FROM canonical_events ce
    JOIN canonical_event_members cem ON cem.canonical_event_id=ce.id
    JOIN games mg ON mg.id=cem.game_id AND mg.team_id=cem.reporting_team_id
    LEFT JOIN schools hs ON hs.id=ce.home_school_id
    LEFT JOIN schools aws ON aws.id=ce.away_school_id
    WHERE ce.status='FINAL'
      AND ce.home_score IS NOT NULL
      AND ce.away_score IS NOT NULL
      AND mg.counts_for_record=1`;
  if (scopedTeamIds) canonicalQuery += " AND cem.reporting_team_id IN (SELECT value FROM json_each(?))";
  let canonicalPrepared = env.DB.prepare(canonicalQuery);
  if (scopedTeamIds) canonicalPrepared = canonicalPrepared.bind(teamIdsJson);
  const canonicalResult = await canonicalPrepared.all();
  logD1QueryMeta("canonical-finals", canonicalResult, metaContext);
  const canonicals = canonicalResult.results || [];

  let rawQuery = `
    SELECT g.*,src.source_type,src.parser_type,os.name AS opponent_name
    FROM games g
    JOIN sources src ON src.id=g.source_id
    LEFT JOIN schools os ON os.id=g.opponent_school_id
    WHERE g.canonical_event_id IS NULL
      AND g.status='FINAL'
      AND g.team_score IS NOT NULL
      AND g.opponent_score IS NOT NULL`;
  if (scopedTeamIds) rawQuery += " AND g.team_id IN (SELECT value FROM json_each(?))";
  let rawPrepared = env.DB.prepare(rawQuery);
  if (scopedTeamIds) rawPrepared = rawPrepared.bind(teamIdsJson);
  const rawResult = await rawPrepared.all();
  logD1QueryMeta("raw-finals", rawResult, metaContext);
  const raw = rawResult.results || [];

  return { teams, canonicals, raw };
}

export function buildRecordsFromInputs({ teams = [], canonicals = [], raw = [] } = {}) {
  const canonicalByTeam = new Map();
  for (const event of canonicals) {
    if (!event.reporting_team_id) continue;
    if (!canonicalByTeam.has(event.reporting_team_id)) canonicalByTeam.set(event.reporting_team_id, []);
    canonicalByTeam.get(event.reporting_team_id).push(event);
  }
  const rawByTeam = new Map();
  for (const game of raw) {
    if (!rawByTeam.has(game.team_id)) rawByTeam.set(game.team_id, []);
    rawByTeam.get(game.team_id).push(game);
  }

  return teams.map(team => {
    const canon = (canonicalByTeam.get(team.id) || []).filter(event =>
      `${event.sport}|${event.gender}|${event.season}` === teamKey(team)
    );
    const candidates = [
      ...canon.map(event => canonicalCandidate(event, team)).filter(Boolean),
      ...(rawByTeam.get(team.id) || []).map(game => rawCandidate(game, team))
    ];
    const record = recordFromScheduleRows(candidates, { reportingSchoolId: team.school_id, maxMinutes: 15 });
    return { team, candidates, record };
  });
}

async function persistRecords(env, built, calculatedAt) {
  const statements = built.map(item => upsertRecordStatement(env, item.team.id, item.record, calculatedAt));
  const chunkSize = 50;
  for (let i = 0; i < statements.length; i += chunkSize) {
    await env.DB.batch(statements.slice(i, i + chunkSize));
  }
}

export async function rebuildTeamRecord(env, teamId, calculatedAt = new Date().toISOString()) {
  const inputs = await loadRecordInputs(env, { teamIds: [teamId] });
  const built = buildRecordsFromInputs(inputs);
  if (!built.length) return null;
  await persistRecords(env, built, calculatedAt);
  return built[0].record;
}

export async function rebuildStatewideRecords(env, calculatedAt = new Date().toISOString()) {
  const inputs = await loadRecordInputs(env);
  const built = buildRecordsFromInputs(inputs);
  await persistRecords(env, built, calculatedAt);
  return {
    teams: built.length,
    scoredFinals: built.reduce((sum, item) => sum + Number(item.record.scored_finals || 0), 0)
  };
}
