const FEARLESS_BASE = "https://fearlessfriday.com/schools";

const TEAM_SLUG_ALIASES = {
  "central": "little-rock-central",
  "little rock central": "little-rock-central",
  "little rock christian academy": "little-rock-christian",
  "little rock christian": "little-rock-christian",
  "northside": "fort-smith-northside",
  "fort smith northside": "fort-smith-northside",
  "har ber": "springdale-har-ber",
  "har-ber": "springdale-har-ber",
  "arkansas": "arkansas-high"
};

function cleanText(value = "") {
  return String(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTeamKey(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/\bhigh school\b/g, " ")
    .replace(/\bhs\b/g, " ")
    .replace(/[^a-z0-9-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(value = "") {
  return normalizeTeamKey(value)
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function slugCandidates(schoolName = "") {
  const key = normalizeTeamKey(schoolName);
  const candidates = [TEAM_SLUG_ALIASES[key], slugify(schoolName)].filter(Boolean);
  return [...new Set(candidates)];
}

function recordGames(value = "") {
  const parts = String(value).match(/\d+/g)?.map(Number) || [];
  return parts.reduce((sum, value) => sum + value, 0);
}

function recordPct(value = "") {
  const parts = String(value).match(/\d+/g)?.map(Number) || [];
  const [wins = 0, losses = 0, ties = 0] = parts;
  const games = wins + losses + ties;
  if (!games) return ".000";
  return ((wins + ties * 0.5) / games).toFixed(3).replace(/^0/, "");
}

function formatRecord(wins, losses, ties = 0) {
  return ties ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
}

export function parseFearlessFridaySeasonRecord(html, season = 2026) {
  const text = cleanText(html);
  const pattern = new RegExp(`\\b${season}\\b\\s+Record:\\s*(\\d+)\\s*-\\s*(\\d+)\\s*-\\s*(\\d+)`, "i");
  const match = text.match(pattern);
  if (!match) return null;
  const wins = Number(match[1]);
  const losses = Number(match[2]);
  const ties = Number(match[3]);
  return {
    wins,
    losses,
    ties,
    games: wins + losses + ties,
    record: formatRecord(wins, losses, ties)
  };
}

async function fetchFearlessRecord(schoolName, { fetchFn = fetch, season = 2026 } = {}) {
  for (const slug of slugCandidates(schoolName)) {
    const url = `${FEARLESS_BASE}/${encodeURIComponent(slug)}/`;
    try {
      const response = await fetchFn(url, {
        headers: {
          "user-agent": "LocalBleachersAR-standings/1.1 (+https://github.com/jamesmethvin74/game-nearby)",
          accept: "text/html,application/xhtml+xml"
        }
      });
      if (!response.ok) continue;
      const parsed = parseFearlessFridaySeasonRecord(await response.text(), season);
      if (!parsed) continue;
      return { ...parsed, source_url: response.url || url };
    } catch {}
  }
  return null;
}

export async function reconcileFootballOverallRecords(result, { sport, fetchFn = fetch, season = 2026 } = {}) {
  if (String(sport || "").toLowerCase() !== "football") return result;
  if (!result?.conference || !Array.isArray(result?.standings)) return result;

  const candidates = result.standings.filter(row => recordGames(row?.overall_record) === 0);
  if (!candidates.length) return result;

  const checks = await Promise.all(candidates.map(async row => ({
    row,
    secondary: await fetchFearlessRecord(row.school_name, { fetchFn, season })
  })));

  let reconciled = false;
  for (const { row, secondary } of checks) {
    if (!secondary || secondary.games <= recordGames(row.overall_record)) continue;
    row.overall_record = secondary.record;
    row.overall_pct = recordPct(secondary.record);
    row.method = "published+reconciled";
    row.overall_record_source = "Fearless Friday";
    row.overall_record_source_url = secondary.source_url;
    reconciled = true;
  }

  if (reconciled) {
    result.conference.standings_method = "published+reconciled";
    result.conference.secondary_source_name = "Fearless Friday";
    result.conference.secondary_source_url = "https://fearlessfriday.com/";
  }
  return result;
}
