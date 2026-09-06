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

export function conferenceRecordsFromRosterFinals(finals = []) {
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

export function buildVolleyballLiveCalculatedStandings(published, recordRows = []) {
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
    // Same-conference opponents can also meet in tournaments. Without a reliable
    // provider conference-game flag, only advance the published conference record
    // when LocalBleachersAR is exactly one final ahead. Larger gaps are ambiguous
    // and safely remain published until that authority catches up.
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
      sport: "volleyball",
      standings_method: "calculated",
      coverage_complete: false
    },
    standings
  };
}

export async function overlayVolleyballLiveRecords(env, published, {
  sport = "volleyball",
  season = "2026"
} = {}) {
  if (String(sport).toLowerCase() !== "volleyball") return published;
  const publishedRows = Array.isArray(published?.standings) ? published.standings : [];
  const aliases = [...new Set(publishedRows
    .map(row => normalizeSchoolAlias(row.school_name))
    .filter(Boolean))];
  if (!aliases.length) return published;

  // The published conference page supplies membership. This first set-based lookup
  // resolves only those roster schools to LocalBleachersAR teams and overall records,
  // so statewide teams do not need conference_id populated before they can contribute.
  const result = await env.DB.prepare(`
    SELECT a.normalized_alias,s.id AS school_id,t.id AS team_id,
      r.wins,r.losses,r.ties,r.calculated_at
    FROM school_aliases a
    JOIN schools s ON s.id=a.school_id
    JOIN teams t ON t.school_id=s.id
    JOIN team_records r ON r.team_id=t.id
    WHERE a.normalized_alias IN (SELECT value FROM json_each(?))
      AND t.active=1
      AND t.sport=?
      AND t.gender='girls'
      AND t.season=?
      AND s.level='high-school'
      AND s.catalog_scope='local'
  `).bind(JSON.stringify(aliases), sport, season).all();

  const recordRows = result.results || [];
  const teamIds = [...new Set(recordRows.map(row => row.team_id).filter(Boolean))];
  const schoolIds = [...new Set(recordRows.map(row => row.school_id).filter(Boolean))];

  if (teamIds.length >= 2 && schoolIds.length >= 2) {
    // DragonFly does not consistently expose an explicit conference-game flag.
    // The published roster is already our conference-membership authority, so a
    // scored canonical final between two roster members is a conference-result
    // candidate. Restrict through reporting_team_id so the existing D1 index keeps
    // this read bounded to the teams on the displayed conference page.
    const finals = await env.DB.prepare(`
      SELECT DISTINCT ce.id,ce.home_school_id,ce.away_school_id,ce.home_score,ce.away_score
      FROM canonical_event_members cem
      JOIN games mg ON mg.id=cem.game_id AND mg.counts_for_record=1
      JOIN canonical_events ce ON ce.id=cem.canonical_event_id
      WHERE cem.reporting_team_id IN (SELECT value FROM json_each(?))
        AND ce.sport=?
        AND ce.gender='girls'
        AND ce.season=?
        AND ce.status='FINAL'
        AND ce.home_score IS NOT NULL
        AND ce.away_score IS NOT NULL
        AND ce.home_school_id IN (SELECT value FROM json_each(?))
        AND ce.away_school_id IN (SELECT value FROM json_each(?))
    `).bind(
      JSON.stringify(teamIds),
      sport,
      season,
      JSON.stringify(schoolIds),
      JSON.stringify(schoolIds)
    ).all();

    const conferenceBySchool = conferenceRecordsFromRosterFinals(finals.results || []);
    for (const row of recordRows) {
      const record = conferenceBySchool.get(row.school_id) || { wins:0, losses:0, ties:0 };
      row.conference_wins = record.wins;
      row.conference_losses = record.losses;
      row.conference_ties = record.ties;
    }
  }

  const calculated = buildVolleyballLiveCalculatedStandings(published, recordRows);
  return calculated ? overlayCalculatedStandings(published, calculated) : published;
}
