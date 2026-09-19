import { currentScheduleTruthSql } from "./current-schedule-truth.js";
import { dedupeScheduleRows, officialSeasonScheduleRows, rowIsCollegePreseasonGhost } from "./schedule-response-normalizer.js";

const TABLE = "ONE_TRUTH_TB";
const META_ID = "META:CURRENT";
const DEFAULT_SEASON = "2026";
const WRITE_CHUNK = 180;

const COLUMNS = [
  "truth_id","row_type","team_id","school_id","school_name","school_level",
  "sport","gender","season","conference_id","conference_name","conference_membership_state",
  "rank","overall_wins","overall_losses","overall_ties",
  "conference_wins","conference_losses","conference_ties",
  "overall_record","conference_record","scored_finals","conference_scored_finals","truth_state",
  "game_id","canonical_event_id","canonical_home_school_id","canonical_away_school_id",
  "canonical_home_name","canonical_away_name","opponent_school_id","opponent","scheduled_at",
  "scheduled_time_known","venue","latitude","longitude","home_away","conference_game",
  "counts_for_record","status","team_score","opponent_score","result",
  "source_id","source_type","parser_type","source_url","data_trust","conflict_count",
  "row_hash","truth_generation","refreshed_at"
];

let schemaPromise = null;
let rebuildPromise = null;

function numeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function recordText(wins, losses, ties = 0) {
  if (wins == null || losses == null) return null;
  return Number(ties || 0) ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
}

function rowHash(row) {
  const text = JSON.stringify(COLUMNS
    .filter(column => !["row_hash","truth_generation","refreshed_at"].includes(column))
    .map(column => row[column] ?? null));
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function keyForSchoolTeam(schoolId, sport, gender, season) {
  return `${schoolId}|${String(sport || "").toLowerCase()}|${String(gender || "").toLowerCase()}|${season}`;
}

function resultFromScores(status, teamScore, opponentScore) {
  if (String(status || "").toUpperCase() !== "FINAL" || teamScore == null || opponentScore == null) return null;
  const team = Number(teamScore);
  const opponent = Number(opponentScore);
  if (!Number.isFinite(team) || !Number.isFinite(opponent)) return null;
  return team === opponent ? "T" : team > opponent ? "W" : "L";
}

function winPct(row) {
  const games = Number(row.conference_wins || 0) + Number(row.conference_losses || 0) + Number(row.conference_ties || 0);
  return games ? (Number(row.conference_wins || 0) + 0.5 * Number(row.conference_ties || 0)) / games : 0;
}

function rankSummaries(summaries) {
  const cohorts = new Map();
  for (const row of summaries) {
    if (!row.conference_id || row.conference_membership_state !== "member") continue;
    const key = `${row.conference_id}|${row.sport}|${row.gender}|${row.season}`;
    if (!cohorts.has(key)) cohorts.set(key, []);
    cohorts.get(key).push(row);
  }

  for (const rows of cohorts.values()) {
    const conferenceGames = rows.reduce((sum, row) => sum + Number(row.conference_scored_finals || 0), 0);
    if (!conferenceGames) {
      rows.forEach(row => { row.rank = null; });
      continue;
    }

    rows.sort((a, b) =>
      winPct(b) - winPct(a)
      || Number(b.conference_wins || 0) - Number(a.conference_wins || 0)
      || Number(a.conference_losses || 0) - Number(b.conference_losses || 0)
      || Number(a.conference_ties || 0) - Number(b.conference_ties || 0)
      || String(a.school_name || "").localeCompare(String(b.school_name || ""))
    );

    let previousKey = null;
    let previousRank = 0;
    rows.forEach((row, index) => {
      const tieKey = [
        winPct(row).toFixed(6),
        row.conference_wins || 0,
        row.conference_losses || 0,
        row.conference_ties || 0
      ].join("|");
      const rank = tieKey === previousKey ? previousRank : index + 1;
      row.rank = rank;
      previousKey = tieKey;
      previousRank = rank;
    });
  }
}

export async function ensureOneTruthSchema(env) {
  if (schemaPromise) return schemaPromise;
  schemaPromise = env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS ${TABLE} (
      truth_id TEXT PRIMARY KEY,
      row_type TEXT NOT NULL CHECK(row_type IN ('META','TEAM','GAME')),
      team_id TEXT,
      school_id TEXT,
      school_name TEXT,
      school_level TEXT,
      sport TEXT,
      gender TEXT,
      season TEXT,
      conference_id TEXT,
      conference_name TEXT,
      conference_membership_state TEXT,
      rank INTEGER,
      overall_wins INTEGER,
      overall_losses INTEGER,
      overall_ties INTEGER,
      conference_wins INTEGER,
      conference_losses INTEGER,
      conference_ties INTEGER,
      overall_record TEXT,
      conference_record TEXT,
      scored_finals INTEGER,
      conference_scored_finals INTEGER,
      truth_state TEXT,
      game_id TEXT,
      canonical_event_id TEXT,
      canonical_home_school_id TEXT,
      canonical_away_school_id TEXT,
      canonical_home_name TEXT,
      canonical_away_name TEXT,
      opponent_school_id TEXT,
      opponent TEXT,
      scheduled_at TEXT,
      scheduled_time_known INTEGER,
      venue TEXT,
      latitude REAL,
      longitude REAL,
      home_away TEXT,
      conference_game INTEGER,
      counts_for_record INTEGER,
      status TEXT,
      team_score INTEGER,
      opponent_score INTEGER,
      result TEXT,
      source_id TEXT,
      source_type TEXT,
      parser_type TEXT,
      source_url TEXT,
      data_trust TEXT,
      conflict_count INTEGER,
      row_hash TEXT,
      truth_generation TEXT NOT NULL,
      refreshed_at TEXT NOT NULL
    )`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_one_truth_team ON ${TABLE}(row_type,team_id)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_one_truth_school ON ${TABLE}(row_type,school_id,sport,gender,season)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_one_truth_schedule ON ${TABLE}(row_type,scheduled_at,school_id)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_one_truth_conference ON ${TABLE}(row_type,conference_id,sport,gender,season,rank)`)
  ]).finally(() => { schemaPromise = null; });
  return schemaPromise;
}

async function loadTeams(env, season, teamIds = []) {
  const ids=[...new Set((teamIds || []).map(String).filter(Boolean))];
  const teamFilter=ids.length ? " AND t.id IN (SELECT value FROM json_each(?))" : "";
  const statement=env.DB.prepare(`
    SELECT
      t.id AS team_id,
      t.school_id,
      COALESCE(NULLIF(sch.location_matched_name,''),sch.name) AS school_name,
      sch.level AS school_level,
      t.sport,t.gender,t.season,
      COALESCE(cm.conference_id,t.conference_id) AS conference_id,
      COALESCE(vc.name,c.name) AS conference_name,
      COALESCE(cm.membership_state,
        CASE WHEN COALESCE(cm.conference_id,t.conference_id) IS NOT NULL THEN 'member' ELSE 'unknown' END
      ) AS conference_membership_state
    FROM teams t
    JOIN schools sch ON sch.id=t.school_id
    LEFT JOIN conference_memberships cm ON cm.team_id=t.id
    LEFT JOIN conferences vc ON vc.id=cm.conference_id
    LEFT JOIN conferences c ON c.id=t.conference_id
    WHERE t.active=1
      AND t.season=?
      AND sch.catalog_scope='local'
      ${teamFilter}
    ORDER BY t.id
  `);
  const {results=[]}=await (ids.length
    ? statement.bind(season,JSON.stringify(ids)).all()
    : statement.bind(season).all());
  return results;
}

async function loadAuthorityGames(env, season, teamIds = []) {
  const ids=[...new Set((teamIds || []).map(String).filter(Boolean))];
  const teamFilter=ids.length ? " AND t.id IN (SELECT value FROM json_each(?))" : "";
  const statement=env.DB.prepare(`
    SELECT *
    FROM (
      SELECT
        g.id AS game_id,g.team_id,g.source_id,g.source_event_key,
        g.opponent AS raw_opponent,g.opponent_school_id AS raw_opponent_school_id,
        g.scheduled_at,g.scheduled_time_known,g.venue,g.location_text,g.latitude,g.longitude,
        g.home_away,g.conference_game,g.counts_for_record,g.status,g.team_score,g.opponent_score,
        g.result,g.notes,g.source_url,g.canonical_event_id,
        t.school_id,t.sport,t.gender,t.season,
        sch.level AS school_level,
        COALESCE(NULLIF(sch.location_matched_name,''),sch.name) AS school_name,
        src.source_type,src.parser_type,src.authority_rank,src.source_priority,
        ce.scheduled_at AS canonical_scheduled_at,
        ce.scheduled_time_known AS canonical_time_known,
        ce.venue AS canonical_venue,
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
        COALESCE(NULLIF(hs.location_matched_name,''),hs.name) AS canonical_home_name,
        COALESCE(NULLIF(aws.location_matched_name,''),aws.name) AS canonical_away_name,
        COALESCE(NULLIF(opp.location_matched_name,''),opp.name,g.opponent) AS raw_opponent_name,
        COALESCE(ocm.conference_id,ot.conference_id) AS opponent_conference_id,
        ROW_NUMBER() OVER (
          PARTITION BY g.team_id,COALESCE(g.canonical_event_id,g.id)
          ORDER BY src.authority_rank,src.source_priority,src.id
        ) AS authority_row
      FROM games g
      JOIN teams t ON t.id=g.team_id
      JOIN schools sch ON sch.id=t.school_id
      JOIN sources src ON src.id=g.source_id
      LEFT JOIN canonical_events ce ON ce.id=g.canonical_event_id
      LEFT JOIN schools hs ON hs.id=ce.home_school_id
      LEFT JOIN schools aws ON aws.id=ce.away_school_id
      LEFT JOIN schools opp ON opp.id=g.opponent_school_id
      LEFT JOIN teams ot
        ON ot.school_id=CASE
          WHEN ce.id IS NOT NULL AND ce.home_school_id=t.school_id THEN ce.away_school_id
          WHEN ce.id IS NOT NULL AND ce.away_school_id=t.school_id THEN ce.home_school_id
          ELSE g.opponent_school_id
        END
       AND ot.sport=t.sport
       AND ot.gender=t.gender
       AND ot.season=t.season
       AND ot.active=1
      LEFT JOIN conference_memberships ocm ON ocm.team_id=ot.id
      WHERE t.active=1
        AND t.season=?
        AND sch.catalog_scope='local'
        ${teamFilter}
        AND ${currentScheduleTruthSql("g","src")}
    ) ranked
    WHERE authority_row=1
    ORDER BY team_id,COALESCE(canonical_scheduled_at,scheduled_at),COALESCE(canonical_event_id,game_id)
  `);
  const {results=[]}=await (ids.length
    ? statement.bind(season,JSON.stringify(ids)).all()
    : statement.bind(season).all());
  return results;
}

function resolveGame(row, team, conferenceBySchoolTeam) {
  const hasCanonical = Boolean(row.canonical_event_id);
  const isHome = hasCanonical && row.canonical_home_school_id === team.school_id;
  const isAway = hasCanonical && row.canonical_away_school_id === team.school_id;
  const opponentSchoolId = hasCanonical
    ? (isHome ? row.canonical_away_school_id : isAway ? row.canonical_home_school_id : row.raw_opponent_school_id)
    : row.raw_opponent_school_id;
  const opponent = hasCanonical
    ? (isHome ? row.canonical_away_name : isAway ? row.canonical_home_name : row.raw_opponent_name)
    : row.raw_opponent_name;
  const status = hasCanonical ? (row.canonical_status || row.status) : row.status;
  const teamScore = hasCanonical
    ? (isHome ? row.canonical_home_score : isAway ? row.canonical_away_score : row.team_score)
    : row.team_score;
  const opponentScore = hasCanonical
    ? (isHome ? row.canonical_away_score : isAway ? row.canonical_home_score : row.opponent_score)
    : row.opponent_score;

  const opponentConferenceId = row.opponent_conference_id
    || (opponentSchoolId
      ? conferenceBySchoolTeam.get(keyForSchoolTeam(opponentSchoolId, team.sport, team.gender, team.season))
      : null);
  const conferenceGame = Number(row.canonical_conference_game ?? row.conference_game ?? 0) === 1
    || Boolean(team.conference_id && opponentConferenceId && team.conference_id === opponentConferenceId);

  return {
    id: row.canonical_event_id || row.game_id,
    game_id: row.game_id,
    canonical_event_id: row.canonical_event_id || null,
    canonical_home_school_id: row.canonical_home_school_id || (row.home_away === "home" ? team.school_id : row.raw_opponent_school_id) || null,
    canonical_away_school_id: row.canonical_away_school_id || (row.home_away === "away" ? team.school_id : row.raw_opponent_school_id) || null,
    canonical_home_name: row.canonical_home_name || (row.home_away === "home" ? team.school_name : row.raw_opponent_name) || null,
    canonical_away_name: row.canonical_away_name || (row.home_away === "away" ? team.school_name : row.raw_opponent_name) || null,
    team_id: team.team_id,
    school_id: team.school_id,
    school_name: team.school_name,
    level: team.school_level,
    sport: team.sport,
    gender: team.gender,
    season: team.season,
    conference_id: team.conference_id,
    conference_name: team.conference_name,
    opponent_school_id: opponentSchoolId || null,
    opponent: opponent || row.raw_opponent || "Opponent TBD",
    scheduled_at: row.canonical_scheduled_at || row.scheduled_at,
    scheduled_time_known: Number(row.canonical_time_known ?? row.scheduled_time_known ?? 1),
    venue: row.canonical_venue || row.venue || null,
    location_text: row.location_text || null,
    latitude: numeric(row.canonical_latitude ?? row.latitude),
    longitude: numeric(row.canonical_longitude ?? row.longitude),
    home_away: hasCanonical ? (isHome ? "home" : isAway ? "away" : row.home_away) : row.home_away,
    conference_game: conferenceGame ? 1 : 0,
    counts_for_record: Number(row.counts_for_record ?? 1) === 0 ? 0 : 1,
    status: String(status || "SCHEDULED").toUpperCase(),
    team_score: numeric(teamScore),
    opponent_score: numeric(opponentScore),
    result: resultFromScores(status, teamScore, opponentScore),
    notes: row.notes || null,
    source_id: row.source_id || null,
    source_type: row.source_type || null,
    parser_type: row.parser_type || null,
    source_url: row.source_url || null,
    data_trust: row.data_trust || "SINGLE_SOURCE_LIVE",
    conflict_count: Number(row.conflict_count || 0)
  };
}

function finalRecord(games) {
  let wins = 0, losses = 0, ties = 0;
  let conferenceWins = 0, conferenceLosses = 0, conferenceTies = 0;
  let scoredFinals = 0, conferenceScoredFinals = 0, unresolvedFinals = 0;

  for (const game of games) {
    if (Number(game.counts_for_record ?? 1) === 0) continue;
    if (String(game.status || "").toUpperCase() !== "FINAL") continue;
    if (game.team_score == null || game.opponent_score == null) {
      unresolvedFinals += 1;
      continue;
    }
    scoredFinals += 1;
    const result = game.result || resultFromScores(game.status, game.team_score, game.opponent_score);
    if (result === "W") wins += 1;
    else if (result === "L") losses += 1;
    else if (result === "T") ties += 1;

    if (Number(game.conference_game || 0) === 1) {
      conferenceScoredFinals += 1;
      if (result === "W") conferenceWins += 1;
      else if (result === "L") conferenceLosses += 1;
      else if (result === "T") conferenceTies += 1;
    }
  }

  return {
    wins,losses,ties,
    conference_wins:conferenceWins,
    conference_losses:conferenceLosses,
    conference_ties:conferenceTies,
    scored_finals:scoredFinals,
    conference_scored_finals:conferenceScoredFinals,
    unresolved_finals:unresolvedFinals
  };
}

function buildTruthRows(teams, rawGames, refreshedAt) {
  const teamById = new Map(teams.map(team => [team.team_id, team]));
  const conferenceBySchoolTeam = new Map();
  for (const team of teams) {
    if (team.conference_id && team.conference_membership_state === "member") {
      conferenceBySchoolTeam.set(
        keyForSchoolTeam(team.school_id, team.sport, team.gender, team.season),
        team.conference_id
      );
    }
  }

  const gamesByTeam = new Map();
  for (const row of rawGames) {
    const team = teamById.get(row.team_id);
    if (!team) continue;
    if (!gamesByTeam.has(team.team_id)) gamesByTeam.set(team.team_id, []);
    gamesByTeam.get(team.team_id).push(resolveGame(row, team, conferenceBySchoolTeam));
  }

  const summaries = [];
  const visibleGamesByTeam = new Map();

  for (const team of teams) {
    const resolved = gamesByTeam.get(team.team_id) || [];
    const official = dedupeScheduleRows(
      officialSeasonScheduleRows(resolved),
      { reportingSchoolId: team.school_id }
    );

    const firstVerifiedFinalAt = official
      .filter(game =>
        String(game.status || "").toUpperCase() === "FINAL"
        && game.team_score != null
        && game.opponent_score != null
        && Number(game.counts_for_record ?? 1) !== 0
      )
      .map(game => game.scheduled_at)
      .filter(Boolean)
      .sort()[0] || null;

    const visible = official.filter(game =>
      !rowIsCollegePreseasonGhost(game, { firstVerifiedFinalAt })
    );
    visibleGamesByTeam.set(team.team_id, visible);

    const record = finalRecord(visible);
    const summary = {
      truth_id:`TEAM:${team.team_id}`,
      row_type:"TEAM",
      team_id:team.team_id,
      school_id:team.school_id,
      school_name:team.school_name,
      school_level:team.school_level,
      sport:team.sport,
      gender:team.gender,
      season:team.season,
      conference_id:team.conference_id || null,
      conference_name:team.conference_name || null,
      conference_membership_state:team.conference_membership_state || "unknown",
      rank:null,
      overall_wins:record.wins,
      overall_losses:record.losses,
      overall_ties:record.ties,
      conference_wins:record.conference_wins,
      conference_losses:record.conference_losses,
      conference_ties:record.conference_ties,
      overall_record:record.scored_finals ? recordText(record.wins,record.losses,record.ties) : null,
      conference_record:team.conference_id
        ? recordText(record.conference_wins,record.conference_losses,record.conference_ties)
        : null,
      scored_finals:record.scored_finals,
      conference_scored_finals:record.conference_scored_finals,
      truth_state:record.unresolved_finals ? "INCOMPLETE" : (record.scored_finals ? "VERIFIED" : "NOT_STARTED"),
      game_id:null,canonical_event_id:null,canonical_home_school_id:null,canonical_away_school_id:null,
      canonical_home_name:null,canonical_away_name:null,opponent_school_id:null,opponent:null,scheduled_at:null,
      scheduled_time_known:null,venue:null,latitude:null,longitude:null,home_away:null,conference_game:null,
      counts_for_record:null,status:null,team_score:null,opponent_score:null,result:null,
      source_id:null,source_type:null,parser_type:null,source_url:null,data_trust:null,conflict_count:null,
      truth_generation:refreshedAt,
      refreshed_at:refreshedAt
    };
    summaries.push(summary);
  }

  const summaryByTeam = new Map(summaries.map(row => [row.team_id, row]));
  const rows = [];

  for (const summary of summaries) {
    summary.row_hash = rowHash(summary);
    rows.push(summary);
  }

  for (const team of teams) {
    const summary = summaryByTeam.get(team.team_id);
    for (const game of visibleGamesByTeam.get(team.team_id) || []) {
      const row = {
        ...summary,
        truth_id:`GAME:${team.team_id}:${game.canonical_event_id || game.game_id || game.id}`,
        row_type:"GAME",
        game_id:game.game_id || game.id || null,
        canonical_event_id:game.canonical_event_id || null,
        canonical_home_school_id:game.canonical_home_school_id || null,
        canonical_away_school_id:game.canonical_away_school_id || null,
        canonical_home_name:game.canonical_home_name || null,
        canonical_away_name:game.canonical_away_name || null,
        opponent_school_id:game.opponent_school_id || null,
        opponent:game.opponent || null,
        scheduled_at:game.scheduled_at || null,
        scheduled_time_known:Number(game.scheduled_time_known ?? 1),
        venue:game.venue || null,
        latitude:game.latitude ?? null,
        longitude:game.longitude ?? null,
        home_away:game.home_away || "unknown",
        conference_game:Number(game.conference_game || 0),
        counts_for_record:Number(game.counts_for_record ?? 1) === 0 ? 0 : 1,
        status:game.status || "SCHEDULED",
        team_score:game.team_score ?? null,
        opponent_score:game.opponent_score ?? null,
        result:game.result || null,
        source_id:game.source_id || null,
        source_type:game.source_type || null,
        parser_type:game.parser_type || null,
        source_url:game.source_url || null,
        data_trust:game.data_trust || null,
        conflict_count:Number(game.conflict_count || 0)
      };
      row.row_hash = rowHash(row);
      rows.push(row);
    }
  }

  return rows;
}

async function refreshRanksForCohorts(env, summaries = []) {
  const seen=new Set();
  const cohorts=[];
  for(const row of summaries){
    if(!row.conference_id || row.conference_membership_state!=="member") continue;
    const key=[row.conference_id,row.sport,row.gender,row.season].join("|");
    if(seen.has(key)) continue;
    seen.add(key);
    cohorts.push({
      conference_id:row.conference_id,
      sport:row.sport,
      gender:row.gender,
      season:row.season
    });
  }
  if(!cohorts.length) return { rows_written:0, cohorts:0 };

  const result=await env.DB.prepare(`
    WITH requested AS (
      SELECT
        json_extract(value,'$.conference_id') AS conference_id,
        json_extract(value,'$.sport') AS sport,
        json_extract(value,'$.gender') AS gender,
        json_extract(value,'$.season') AS season
      FROM json_each(?)
    ),
    base AS (
      SELECT
        t.team_id,t.conference_id,t.sport,t.gender,t.season,
        COALESCE(t.conference_wins,0) AS cw,
        COALESCE(t.conference_losses,0) AS cl,
        COALESCE(t.conference_ties,0) AS ct,
        SUM(COALESCE(t.conference_scored_finals,0)) OVER (
          PARTITION BY t.conference_id,t.sport,t.gender,t.season
        ) AS cohort_games
      FROM ${TABLE} t
      JOIN requested r
        ON r.conference_id=t.conference_id
       AND r.sport=t.sport
       AND r.gender=t.gender
       AND r.season=t.season
      WHERE t.row_type='TEAM'
        AND t.conference_membership_state='member'
    ),
    ranked AS (
      SELECT team_id,
        CASE WHEN cohort_games=0 THEN NULL ELSE
          RANK() OVER (
            PARTITION BY conference_id,sport,gender,season
            ORDER BY
              CASE WHEN (cw+cl+ct)>0 THEN (CAST(cw AS REAL)+0.5*ct)/(cw+cl+ct) ELSE 0 END DESC,
              cw DESC,cl ASC,ct ASC
          )
        END AS new_rank
      FROM base
    )
    UPDATE ${TABLE} AS target
    SET rank=(SELECT new_rank FROM ranked WHERE ranked.team_id=target.team_id)
    WHERE target.row_type IN ('TEAM','GAME')
      AND target.team_id IN (SELECT team_id FROM ranked)
      AND target.rank IS NOT (SELECT new_rank FROM ranked WHERE ranked.team_id=target.team_id)
  `).bind(JSON.stringify(cohorts)).run();

  return {
    rows_written:Number(result?.meta?.changes || result?.changes || 0),
    cohorts:cohorts.length
  };
}

function upsertStatement(env, rows) {
  const select = COLUMNS.map(column => `json_extract(value,'$.${column}')`).join(",");
  const assignments = COLUMNS
    .filter(column => column !== "truth_id")
    .map(column => `${column}=excluded.${column}`)
    .join(",");
  return env.DB.prepare(`
    WITH payload AS (SELECT value FROM json_each(?))
    INSERT INTO ${TABLE}(${COLUMNS.join(",")})
    SELECT ${select}
    FROM payload WHERE true
    ON CONFLICT(truth_id) DO UPDATE SET ${assignments}
    WHERE COALESCE(${TABLE}.row_hash,'')<>COALESCE(excluded.row_hash,'')
  `).bind(JSON.stringify(rows));
}

export async function rebuildOneTruth(env, { season = DEFAULT_SEASON, teamIds = [] } = {}) {
  await ensureOneTruthSchema(env);
  const requested=[...new Set((teamIds || []).map(String).filter(Boolean))];
  const refreshedAt = new Date().toISOString();
  const [teams, rawGames] = await Promise.all([
    loadTeams(env, season, requested),
    loadAuthorityGames(env, season, requested)
  ]);
  const rows = buildTruthRows(teams, rawGames, refreshedAt);
  const summaries = rows.filter(row => row.row_type === "TEAM");
  const ids = rows.map(row => row.truth_id);
  const statements = [];

  for (let index = 0; index < rows.length; index += WRITE_CHUNK) {
    statements.push(upsertStatement(env, rows.slice(index, index + WRITE_CHUNK)));
  }

  if (requested.length) {
    statements.push(env.DB.prepare(`
      DELETE FROM ${TABLE}
      WHERE row_type<>'META'
        AND team_id IN (SELECT value FROM json_each(?))
        AND truth_id NOT IN (SELECT value FROM json_each(?))
    `).bind(JSON.stringify(requested),JSON.stringify(ids)));
  } else {
    statements.push(env.DB.prepare(`
      DELETE FROM ${TABLE}
      WHERE truth_id<>?
        AND truth_id NOT IN (SELECT value FROM json_each(?))
    `).bind(META_ID, JSON.stringify(ids)));
  }

  const meta = {
    truth_id:META_ID,row_type:"META",team_id:null,school_id:null,school_name:null,school_level:null,
    sport:null,gender:null,season,conference_id:null,conference_name:null,conference_membership_state:null,
    rank:null,overall_wins:null,overall_losses:null,overall_ties:null,conference_wins:null,conference_losses:null,
    conference_ties:null,overall_record:null,conference_record:null,scored_finals:null,conference_scored_finals:null,
    truth_state:"READY",game_id:null,canonical_event_id:null,canonical_home_school_id:null,canonical_away_school_id:null,
    canonical_home_name:null,canonical_away_name:null,opponent_school_id:null,opponent:null,scheduled_at:null,
    scheduled_time_known:null,venue:null,latitude:null,longitude:null,home_away:null,conference_game:null,
    counts_for_record:null,status:null,team_score:null,opponent_score:null,result:null,source_id:null,source_type:null,
    parser_type:null,source_url:null,data_trust:null,conflict_count:null,row_hash:refreshedAt,
    truth_generation:refreshedAt,refreshed_at:refreshedAt
  };
  statements.push(upsertStatement(env, [meta]));

  const results = await env.DB.batch(statements);
  const rankRefresh=await refreshRanksForCohorts(env, summaries);
  return {
    status:"SUCCESS",
    season,
    requested_teams:requested.length,
    teams:teams.length,
    games:rows.filter(row => row.row_type === "GAME").length,
    rows:rows.length + 1,
    statements:statements.length,
    rows_written:results.reduce((sum, result) => sum + Number(result?.meta?.changes || result?.changes || 0), 0)
      + Number(rankRefresh.rows_written || 0),
    rank_cohorts:rankRefresh.cohorts,
    refreshed_at:refreshedAt
  };
}

async function staleRequestedTeamIds(env, teamIds = [], { season = DEFAULT_SEASON, limit = 128 } = {}) {
  const ids=[...new Set((teamIds || []).map(String).filter(Boolean))];
  const binds=[season];
  let requestedSql="";
  if (ids.length) {
    requestedSql=" AND t.id IN (SELECT value FROM json_each(?))";
    binds.push(JSON.stringify(ids));
  }
  binds.push(Number(limit));
  const {results=[]}=await env.DB.prepare(`
    SELECT t.id AS team_id,
      MAX(COALESCE(src.last_successful_fetch_at,src.updated_at,src.created_at)) AS newest_source_at,
      ot.refreshed_at AS truth_refreshed_at
    FROM teams t
    JOIN schools sch ON sch.id=t.school_id
    LEFT JOIN sources src ON src.team_id=t.id AND src.enabled=1
    LEFT JOIN ${TABLE} ot ON ot.truth_id='TEAM:'||t.id
    WHERE t.active=1
      AND t.season=?
      AND sch.catalog_scope='local'
      ${requestedSql}
    GROUP BY t.id,ot.refreshed_at
    HAVING ot.refreshed_at IS NULL
       OR MAX(COALESCE(src.last_successful_fetch_at,src.updated_at,src.created_at)) > ot.refreshed_at
    ORDER BY t.id
    LIMIT ?
  `).bind(...binds).all();
  return results.map(row=>String(row.team_id||"")).filter(Boolean);
}

export async function staleOneTruthTeamIds(env, options = {}) {
  await ensureOneTruthSchema(env);
  return staleRequestedTeamIds(env, [], options);
}

export async function ensureOneTruthFresh(env, { season = DEFAULT_SEASON, teamIds = [], force = false } = {}) {
  await ensureOneTruthSchema(env);
  const ids=[...new Set((teamIds || []).map(String).filter(Boolean))];
  if (!ids.length) return { status:"SCHEMA_READY", teams:0 };

  const stale=force ? ids : await staleRequestedTeamIds(env,ids,{season,limit:Math.max(ids.length,1)});
  if (!stale.length) return { status:"FRESH", teams:ids.length };

  const key=stale.slice().sort().join(",");
  if (!rebuildPromise || rebuildPromise.key!==key) {
    const promise=rebuildOneTruth(env,{season,teamIds:stale}).finally(()=>{
      if (rebuildPromise?.key===key) rebuildPromise=null;
    });
    promise.key=key;
    rebuildPromise=promise;
  }
  return rebuildPromise;
}

export function oneTruthTableName() {
  return TABLE;
}

export { DEFAULT_SEASON, META_ID };
