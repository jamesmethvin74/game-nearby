const DEFAULT_STATE = "ar";
const DEFAULT_SEASON_PATH = "26-27";

const SPORTS = [
  { id: "volleyball", label: "Volleyball", seasonPath: DEFAULT_SEASON_PATH },
  { id: "football", label: "Football", seasonPath: DEFAULT_SEASON_PATH }
];

const FALLBACK_CONFERENCES = {
  volleyball: [
    ["6a-central", "6A Central"],
    ["6a-west", "6A West"],
    ["5a-central", "5A Central"],
    ["5a-east", "5A East"],
    ["5a-south", "5A South"],
    ["5a-west", "5A West"]
  ],
  football: [
    ["7a-central", "7A Central"],
    ["7a-west", "7A West"],
    ["6a-east", "6A East"],
    ["6a-west", "6A West"],
    ["5a-central", "5A Central"],
    ["5a-east", "5A East"],
    ["5a-south", "5A South"],
    ["5a-west", "5A West"]
  ]
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

function titleFromSlug(slug = "") {
  return String(slug)
    .split("-")
    .filter(Boolean)
    .map(part => /^\d+a$/i.test(part) ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeConferenceName(value = "", slug = "") {
  let text = cleanText(value)
    .replace(/\bConference\b/gi, " ")
    .replace(/\bVolleyball\b|\bFootball\b/gi, " ")
    .replace(/\bStandings\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text || /^scores?$/i.test(text) || /^home$/i.test(text)) text = titleFromSlug(slug);
  return text;
}

function sportConfig(sport) {
  return SPORTS.find(item => item.id === sport) || null;
}

function baseUrl(sport, state = DEFAULT_STATE, seasonPath = DEFAULT_SEASON_PATH) {
  return `https://www.maxpreps.com/${state}/${sport}/${seasonPath}/`;
}

function conferenceUrl(sport, slug, state = DEFAULT_STATE, seasonPath = DEFAULT_SEASON_PATH) {
  return `${baseUrl(sport, state, seasonPath)}conference/${encodeURIComponent(slug)}/`;
}

function uniqueConferences(rows = []) {
  const map = new Map();
  for (const row of rows) {
    if (!row?.id) continue;
    const current = map.get(row.id);
    if (!current || current.name === titleFromSlug(row.id)) map.set(row.id, row);
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

export function parseConferenceLinks(html, { sport, state = DEFAULT_STATE, seasonPath = DEFAULT_SEASON_PATH } = {}) {
  const config = sportConfig(sport);
  if (!config) return [];
  const rows = [];
  const pattern = new RegExp(`<a\\b[^>]*href=["']([^"']*\\/${state}\\/${sport}\\/${seasonPath}\\/conference\\/([^\\/?#"']+)\\/?[^"']*)["'][^>]*>([\\s\\S]*?)<\\/a>`, "gi");
  let match;
  while ((match = pattern.exec(String(html || "")))) {
    const slug = decodeURIComponent(match[2]).toLowerCase();
    rows.push({
      id: slug,
      name: normalizeConferenceName(match[3], slug),
      sport,
      source_url: new URL(match[1], "https://www.maxpreps.com").toString()
    });
  }
  return uniqueConferences(rows);
}

function cellTexts(rowHtml = "") {
  return [...String(rowHtml).matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
    .map(match => cleanText(match[1]))
    .filter(Boolean);
}

function looksRecord(value = "") {
  return /^\d+\s*-\s*\d+(?:\s*-\s*\d+)?$/.test(value.trim());
}

function normalizeRecord(value = "") {
  return value.replace(/\s+/g, "").replace(/–|—/g, "-");
}

function looksPct(value = "") {
  return /^(?:0|1)?\.\d{3}$/.test(value) || /^(?:0|100|\d{1,2})(?:\.\d+)?%$/.test(value);
}

function teamNameFromCells(cells, firstRecordIndex) {
  const before = cells.slice(0, Math.max(firstRecordIndex, 0));
  for (let i = before.length - 1; i >= 0; i--) {
    const value = before[i]
      .replace(/^Image:\s*/i, "")
      .replace(/^\d+\s+/, "")
      .trim();
    if (!value || /^\d+$/.test(value) || looksPct(value) || looksRecord(value)) continue;
    return value;
  }
  return "";
}

export function parsePublishedStandings(html, { sport, conferenceId, conferenceName = "", sourceUrl = "" } = {}) {
  const rows = [];
  const body = String(html || "");
  for (const rowMatch of body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = cellTexts(rowMatch[1]);
    if (cells.length < 3) continue;
    const recordIndexes = cells.map((value, index) => looksRecord(value) ? index : -1).filter(index => index >= 0);
    if (recordIndexes.length < 2) continue;
    const team = teamNameFromCells(cells, recordIndexes[0]);
    if (!team || /^team$/i.test(team)) continue;
    const rankCandidate = cells.find(value => /^\d+$/.test(value));
    rows.push({
      rank: rankCandidate == null ? null : Number(rankCandidate),
      school_name: team,
      conference_record: normalizeRecord(cells[recordIndexes[0]]),
      overall_record: normalizeRecord(cells[recordIndexes[1]]),
      conference_pct: cells.slice(recordIndexes[0] + 1, recordIndexes[1]).find(looksPct) || null,
      overall_pct: cells.slice(recordIndexes[1] + 1).find(looksPct) || null,
      method: "published",
      source_url: sourceUrl || null
    });
  }
  const deduped = [];
  const seen = new Set();
  for (const row of rows) {
    const key = row.school_name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }
  deduped.sort((a, b) => {
    const ar = a.rank == null ? Number.MAX_SAFE_INTEGER : a.rank;
    const br = b.rank == null ? Number.MAX_SAFE_INTEGER : b.rank;
    return ar - br || a.school_name.localeCompare(b.school_name);
  });
  return {
    conference: {
      id: conferenceId,
      name: conferenceName || titleFromSlug(conferenceId),
      sport,
      standings_method: "published",
      source_url: sourceUrl || null
    },
    standings: deduped
  };
}

async function fetchText(url, fetchFn = fetch) {
  const response = await fetchFn(url, {
    headers: {
      "user-agent": "LocalBleachersAR-standings/1.0 (+https://github.com/jamesmethvin74/game-nearby)",
      accept: "text/html,application/xhtml+xml"
    }
  });
  if (!response.ok) throw new Error(`standings source HTTP ${response.status}`);
  return { html: await response.text(), finalUrl: response.url || url };
}

export async function listPublishedStandingsOptions({ sport = "volleyball", fetchFn = fetch } = {}) {
  const config = sportConfig(sport);
  if (!config) return { sports: SPORTS, conferences: [] };
  let conferences = [];
  try {
    const { html } = await fetchText(baseUrl(sport, DEFAULT_STATE, config.seasonPath), fetchFn);
    conferences = parseConferenceLinks(html, { sport, seasonPath: config.seasonPath });
  } catch {}
  if (!conferences.length) {
    conferences = (FALLBACK_CONFERENCES[sport] || []).map(([id, name]) => ({
      id,
      name,
      sport,
      source_url: conferenceUrl(sport, id, DEFAULT_STATE, config.seasonPath)
    }));
  }
  return { sports: SPORTS, conferences };
}

export async function fetchPublishedStandings({ sport = "volleyball", conferenceId, fetchFn = fetch } = {}) {
  const config = sportConfig(sport);
  if (!config) throw new Error(`unsupported sport ${sport}`);
  if (!/^[a-z0-9-]+$/i.test(conferenceId || "")) throw new Error("invalid conference id");
  const options = await listPublishedStandingsOptions({ sport, fetchFn });
  const conference = options.conferences.find(row => row.id === conferenceId) || {
    id: conferenceId,
    name: titleFromSlug(conferenceId),
    sport,
    source_url: conferenceUrl(sport, conferenceId, DEFAULT_STATE, config.seasonPath)
  };
  const sourceUrl = conference.source_url || conferenceUrl(sport, conferenceId, DEFAULT_STATE, config.seasonPath);
  const { html, finalUrl } = await fetchText(sourceUrl, fetchFn);
  const parsed = parsePublishedStandings(html, {
    sport,
    conferenceId,
    conferenceName: conference.name,
    sourceUrl: finalUrl
  });
  if (!parsed.standings.length) throw new Error(`published standings unavailable for ${sport}/${conferenceId}`);
  return parsed;
}

export { SPORTS };
