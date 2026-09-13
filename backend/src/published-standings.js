import { normalizeSchoolAlias } from "./schedule-authority-core.js";

const DEFAULT_STATE = "ar";
const DEFAULT_SEASON_PATH = "26-27";
const MEMBERSHIP_INDEX_TTL_MS = 6 * 60 * 60 * 1000;
const MEMBERSHIP_DISCOVERY_CONCURRENCY = 4;
const MEMBERSHIP_DISCOVERY_MAX_CONFERENCES = 48;
const membershipIndexCache = new Map();
const membershipIndexRequests = new Map();

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

function directoryUrl(sport, state = DEFAULT_STATE) {
  return `https://www.maxpreps.com/${state}/${sport}/`;
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
    const { html } = await fetchText(directoryUrl(sport), fetchFn);
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

async function fetchConferenceOption(option, { sport, fetchFn = fetch } = {}) {
  const config = sportConfig(sport);
  if (!config) throw new Error(`unsupported sport ${sport}`);
  const sourceUrl = option?.source_url || conferenceUrl(sport, option?.id, DEFAULT_STATE, config.seasonPath);
  const { html, finalUrl } = await fetchText(sourceUrl, fetchFn);
  const parsed = parsePublishedStandings(html, {
    sport,
    conferenceId: option.id,
    conferenceName: option.name,
    sourceUrl: finalUrl
  });
  if (!parsed.standings.length) throw new Error(`published standings unavailable for ${sport}/${option.id}`);
  return parsed;
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
  return fetchConferenceOption(conference, { sport, fetchFn });
}

async function buildPublishedMembershipIndex({ sport, fetchFn = fetch } = {}) {
  const options = await listPublishedStandingsOptions({ sport, fetchFn });
  const conferences = (options.conferences || []).slice(0, MEMBERSHIP_DISCOVERY_MAX_CONFERENCES);
  const bySchool = new Map();

  for (let start = 0; start < conferences.length; start += MEMBERSHIP_DISCOVERY_CONCURRENCY) {
    const batch = conferences.slice(start, start + MEMBERSHIP_DISCOVERY_CONCURRENCY);
    const payloads = await Promise.all(batch.map(async conference => {
      try {
        return await fetchConferenceOption(conference, { sport, fetchFn });
      } catch (error) {
        console.warn("published conference membership page failed", {
          sport,
          conferenceId: conference.id,
          error: String(error?.message || error)
        });
        return null;
      }
    }));

    for (const payload of payloads.filter(Boolean)) {
      for (const row of payload.standings || []) {
        const key = normalizeSchoolAlias(row.school_name);
        if (!key) continue;
        if (!bySchool.has(key)) bySchool.set(key, []);
        bySchool.get(key).push({
          conference: payload.conference,
          row,
          payload
        });
      }
    }
  }

  return { builtAt: Date.now(), bySchool, conferenceCount: conferences.length };
}

async function membershipIndex({ sport, fetchFn = fetch } = {}) {
  const cacheable = fetchFn === fetch;
  const cached = cacheable ? membershipIndexCache.get(sport) : null;
  if (cached && Date.now() - cached.builtAt < MEMBERSHIP_INDEX_TTL_MS) return cached;

  if (cacheable && membershipIndexRequests.has(sport)) return membershipIndexRequests.get(sport);
  const request = buildPublishedMembershipIndex({ sport, fetchFn });
  if (cacheable) membershipIndexRequests.set(sport, request);
  try {
    const built = await request;
    if (cacheable) membershipIndexCache.set(sport, built);
    return built;
  } finally {
    if (cacheable) membershipIndexRequests.delete(sport);
  }
}

export async function findPublishedConferenceMembership({ sport, schoolName, fetchFn = fetch } = {}) {
  const normalizedSport = String(sport || "").toLowerCase();
  if (!sportConfig(normalizedSport)) return null;
  const schoolKey = normalizeSchoolAlias(schoolName);
  if (!schoolKey) return null;

  const index = await membershipIndex({ sport: normalizedSport, fetchFn });
  const matches = index.bySchool.get(schoolKey) || [];
  if (matches.length !== 1) {
    if (matches.length > 1) {
      console.warn("published conference membership ambiguous; failing closed", {
        sport: normalizedSport,
        schoolName,
        conferences: matches.map(match => match.conference?.id).filter(Boolean)
      });
    }
    return null;
  }
  return matches[0];
}

export { MEMBERSHIP_DISCOVERY_MAX_CONFERENCES, SPORTS };
