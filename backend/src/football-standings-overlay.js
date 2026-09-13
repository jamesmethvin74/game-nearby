import { overlayCalculatedStandings, recordText } from "./calculated-standings.js";
import { normalizeSchoolAlias } from "./schedule-authority-core.js";

function recordGames(value = "") {
  const parts = String(value).match(/\d+/g)?.map(Number) || [];
  return parts.reduce((sum, part) => sum + part, 0);
}

function numeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function footballConferenceRecordsFromRosterFinals(finals = []) {
  const records = new Map();
  const ensure = schoolId => {
    if (!records.has(schoolId)) records.set(schoolId, { wins:0, losses:0, ties:0 });
    return records.get(schoolId);
  };

  for (const game of finals) {
    const homeId = String(game.home_school_id || "");
    const awayId = String(game.away_school_id || "");
    const homeScore = Number(game.home_score);
    const awayScore = Number(game.away_score);
    if (!homeId || !awayId || !Number.isFinite(homeScore) || !Number.isFinite(awayScore)) continue;
    const home = ensure(homeId);
    const away = ensure(awayId);
    if (homeScore === awayScore) {
      home.ties += 1;
      away.ties += 1;
    } else if (homeScore > awayScore) {
      home.wins += 1;
      away.losses += 1;
    } else {
      away.wins += 1;
      home.losses += 1;
    }
  }
  return records;
}

export function uniqueFootballRecordRows(rows = []) {
  const byTeam = new Map();
  for (const row of rows) {
    const teamId = String(row.team_id || "");
    if (!teamId) continue;
    if (!byTeam.has(teamId)) byTeam.set(teamId, []);
    byTeam.get(teamId).push(row);
  }

  const unique = [];
  for (const teamRows of byTeam.values()) {
    const aliases = [...new Set(teamRows.map(row => String(row.normalized_alias || "")).filter(Boolean))];
    if (aliases.length !== 1) continue;
    unique.push(teamRows[0]);
  }
  return unique;
}

export function buildFootballLiveCalculatedStandings(published, recordRows = []) {
  const publishedRows = Array.isArray(published?.standings) ? published.standings : [];
  if (!publishedRows.length || !recordRows.length) return null;

  const publishedByAlias = new Map();
  for (const row of publishedRows) {
    const alias = normalizeSchoolAlias(row.school_name);
    if (alias && !publishedByAlias.has(alias)) publishedByAlias.set(alias, row);
  }

  const standings = [];
  for (const row of recordRows) {
    const publishedRow = publishedByAlias.get(String(row.normalized_alias || ""));
    if (!publishedRow) continue;

    const wins = numeric(row.wins);
    const losses = numeric(row.losses);
    const ties = numeric(row.ties);
    const conferenceWins = numeric(row.conference_wins);
    const conferenceLosses = numeric(row.conference_losses);
    const conferenceTies = numeric(row.conference_ties);
    const localOverallGames = wins + losses + ties;
    const localConferenceGames = conferenceWins + conferenceLosses + conferenceTies;
    const publishedOverallGames = recordGames(publishedRow.overall_record);
    const publishedConferenceGames = recordGames(publishedRow.conference_record);

    const useOverall = localOverallGames > 0 && localOverallGames >= publishedOverallGames;
    // Published roster membership is authoritative. Advance a conference record
    // only one final beyond the published table; larger gaps remain published so
    // postseason/rematch ambiguity cannot silently become conference truth.
    const useConference = localConferenceGames === publishedConferenceGames + 1;
    if (!useOverall && !useConference) continue;

    standings.push({
      team_id: row.team_id,
      school_name: publishedRow.school_name,
      overall_record: useOverall
        ? recordText(wins, losses, ties)
        : (publishedRow.overall_record || "0-0"),
      conference_record: useConference
        ? recordText(conferenceWins, conferenceLosses, conferenceTies)
        : (publishedRow.conference_record || "0-0"),
      method: "calculated",
      calculated_at: row.calculated_at || null
    });
  }

  if (!standings.length) return null;
  return {
    conference: {
      id: published?.conference?.id || null,
      name: published?.conference?.name || "",
      sport: "football",
      standings_method: "calculated",
      coverage_complete: false
    },
    standings
  };
}

export async function overlayFootballLiveRecords(env, published, {
  sport = "football",
  season = "2026"
} = {}) {
  if (String(sport).toLowerCase() !== "football") return published;
  const publishedRows = Array.isArray(published?.standings) ? published.standings : [];
  const aliases = [...new Set(publishedRows
    .map(row => normalizeSchoolAlias(row.school_name))
    .filter(Boolean))];
  if (!aliases.length) return published;

  const result = await env.DB.prepare(`
    SELECT a.normalized_alias,s.id AS school_id,t.id AS team_id,
      r.wins,r.losses,r.ties,r.calculated_at
    FROM school_aliases a
    JOIN schools s ON s.id=a.school_id
    JOIN teams t INDEXED BY idx_teams_school_active_season ON t.school_id=s.id
    JOIN team_records r ON r.team_id=t.id
    WHERE a.normalized_alias IN (SELECT value FROM json_each(?))
      AND t.active=1
      AND t.sport=?
      AND t.gender='boys'
      AND t.season=?
      AND s.level='high-school'
      AND s.catalog_scope='local'
    ORDER BY t.id,a.normalized_alias
  `).bind(JSON.stringify(aliases), sport, season).all();

  const recordRows = uniqueFootballRecordRows(result.results || []);
  const teamIds = [...new Set(recordRows.map(row => row.team_id).filter(Boolean))];
  const schoolIds = [...new Set(recordRows.map(row => row.school_id).filter(Boolean))];

  if (teamIds.length >= 2 && schoolIds.length >= 2) {
    const finals = await env.DB.prepare(`
      SELECT DISTINCT ce.id,ce.home_school_id,ce.away_school_id,ce.home_score,ce.away_score
      FROM canonical_event_members cem INDEXED BY idx_canonical_members_reporting_team
      JOIN games mg ON mg.id=cem.game_id
      JOIN canonical_events ce ON ce.id=cem.canonical_event_id
      WHERE cem.reporting_team_id IN (SELECT value FROM json_each(?))
        AND ce.sport=?
        AND ce.gender='boys'
        AND ce.season=?
        AND ce.status='FINAL'
        AND ce.home_score IS NOT NULL
        AND ce.away_score IS NOT NULL
        AND ce.home_school_id IN (SELECT value FROM json_each(?))
        AND ce.away_school_id IN (SELECT value FROM json_each(?))
        AND COALESCE(mg.notes,'') NOT LIKE '%scrimmage%'
        AND COALESCE(mg.notes,'') NOT LIKE '%jamboree%'
        AND COALESCE(mg.notes,'') NOT LIKE '%exhibition%'
        AND COALESCE(mg.notes,'') NOT LIKE '%benefit%'
    `).bind(
      JSON.stringify(teamIds),
      sport,
      season,
      JSON.stringify(schoolIds),
      JSON.stringify(schoolIds)
    ).all();

    const conferenceBySchool = footballConferenceRecordsFromRosterFinals(finals.results || []);
    for (const row of recordRows) {
      const record = conferenceBySchool.get(String(row.school_id)) || { wins:0, losses:0, ties:0 };
      row.conference_wins = record.wins;
      row.conference_losses = record.losses;
      row.conference_ties = record.ties;
    }
  }

  const calculated = buildFootballLiveCalculatedStandings(published, recordRows);
  return calculated ? overlayCalculatedStandings(published, calculated) : published;
}