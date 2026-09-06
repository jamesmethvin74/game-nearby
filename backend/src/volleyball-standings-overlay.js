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
    const useConference = localConferenceGames > 0 && localConferenceGames >= publishedConferenceGames;
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

  // The published conference page supplies membership. This one set-based lookup
  // finds only those schools in LocalBleachersAR, so statewide teams do not need
  // conference_id populated before their canonical records can improve standings.
  const result = await env.DB.prepare(`
    SELECT a.normalized_alias,t.id AS team_id,
      r.wins,r.losses,r.ties,
      r.conference_wins,r.conference_losses,r.conference_ties,r.calculated_at
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

  const calculated = buildVolleyballLiveCalculatedStandings(published, result.results || []);
  return calculated ? overlayCalculatedStandings(published, calculated) : published;
}
