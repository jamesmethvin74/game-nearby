import { normalizeSchoolAlias } from "./schedule-authority-core.js";

const EVENT_DESCRIPTOR_RE = /\b(?:senior night|early bird|invitational|invite|tournament|tourney|classic|jamboree)\b/g;
const VENUE_DETAIL_RE = /\b(?:arena|gym|gymnasium|fieldhouse|field house|stadium|center|centre|complex|court)\b/i;

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function opponentKey(value) {
  return normalizeSchoolAlias(value)
    .replace(EVENT_DESCRIPTOR_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSubset(shorter, longer) {
  const a = shorter.split(" ").filter(Boolean);
  const b = new Set(longer.split(" ").filter(Boolean));
  return a.length > 0 && a.every(token => b.has(token));
}

export function opponentNamesLikelySame(a, b) {
  const aa = opponentKey(a);
  const bb = opponentKey(b);
  if (!aa || !bb) return false;
  if (aa === bb) return true;
  const [shorter, longer] = aa.length <= bb.length ? [aa, bb] : [bb, aa];
  if (shorter.length < 4) return false;
  return tokenSubset(shorter, longer);
}

function minutesBetween(a, b) {
  const aa = Date.parse(a);
  const bb = Date.parse(b);
  return Number.isFinite(aa) && Number.isFinite(bb) ? Math.abs(aa - bb) / 60000 : Infinity;
}

export function scheduleRowsLikelyDuplicate(a, b, { reportingSchoolId = null, maxMinutes = 15 } = {}) {
  if (!a || !b) return false;
  if (clean(a.sport).toLowerCase() !== clean(b.sport).toLowerCase()) return false;
  if (clean(a.gender).toLowerCase() !== clean(b.gender).toLowerCase()) return false;
  if (!reportingSchoolId && a.school_id && b.school_id && a.school_id !== b.school_id) return false;
  const aTime = a.scheduled_at || a.canonical_scheduled_at;
  const bTime = b.scheduled_at || b.canonical_scheduled_at;
  if (minutesBetween(aTime, bTime) > maxMinutes) return false;
  const aOpponentId = clean(a.opponent_school_id);
  const bOpponentId = clean(b.opponent_school_id);
  if (aOpponentId && bOpponentId) return aOpponentId === bOpponentId;
  return opponentNamesLikelySame(a.opponent, b.opponent);
}

function trustScore(value) {
  switch (clean(value).toUpperCase()) {
    case "CORROBORATED": return 40;
    case "AUTHORITATIVE_LIVE": return 35;
    case "CONFLICT": return 25;
    case "SINGLE_SOURCE_LIVE": return 15;
    default: return 0;
  }
}

function rowScore(row) {
  let score = 0;
  if (row.canonical_event_id) score += 100;
  if (row.parser_type === "dragonfly-public") score += 45;
  if (row.source_type === "official-conference") score += 25;
  if (row.source_type === "official-school" || row.source_type === "official-athletics") score += 20;
  score += trustScore(row.data_trust);
  if (row.scheduled_time_known) score += 5;
  if (row.status === "FINAL" && row.team_score != null && row.opponent_score != null) score += 12;
  return score;
}

function venueSpecificity(row) {
  const venue = clean(row.venue || row.canonical_venue);
  if (!venue) return -100;
  let score = 0;
  if (VENUE_DETAIL_RE.test(venue)) score += 30;
  const venueKey = normalizeSchoolAlias(venue);
  const participantKeys = [row.canonical_home_name, row.canonical_away_name, row.school_name, row.opponent]
    .map(normalizeSchoolAlias)
    .filter(Boolean);
  if (venueKey && participantKeys.includes(venueKey)) score -= 15;
  if (/\btba\b/i.test(venue)) score -= 40;
  if (row.source_type === "official-school" || row.source_type === "official-athletics") score += 8;
  return score;
}

function mergeDuplicateRows(a, b) {
  const preferred = rowScore(a) >= rowScore(b) ? a : b;
  const alternate = preferred === a ? b : a;
  const venueSource = venueSpecificity(alternate) > venueSpecificity(preferred) ? alternate : preferred;
  return {
    ...alternate,
    ...preferred,
    venue: clean(venueSource.venue || venueSource.canonical_venue) || preferred.venue || alternate.venue,
    schedule_observation_count: Number(a.schedule_observation_count || 1) + Number(b.schedule_observation_count || 1),
    schedule_confirmed_by_school: Boolean(
      a.source_type === "official-school" || a.source_type === "official-athletics"
      || b.source_type === "official-school" || b.source_type === "official-athletics"
    )
  };
}

export function dedupeScheduleRows(games, options = {}) {
  const rows = Array.isArray(games) ? games : [];
  const merged = [];
  for (const row of rows) {
    const index = merged.findIndex(existing => scheduleRowsLikelyDuplicate(existing, row, options));
    if (index === -1) merged.push({ ...row, schedule_observation_count: Number(row.schedule_observation_count || 1) });
    else merged[index] = mergeDuplicateRows(merged[index], row);
  }
  return merged.sort((a, b) => Date.parse(a.scheduled_at || a.canonical_scheduled_at) - Date.parse(b.scheduled_at || b.canonical_scheduled_at));
}

export function recordFromScheduleRows(games, options = {}) {
  const rows = dedupeScheduleRows(games, options);
  let wins = 0;
  let losses = 0;
  let ties = 0;
  let conferenceWins = 0;
  let conferenceLosses = 0;
  let conferenceTies = 0;
  let scoredFinals = 0;

  for (const row of rows) {
    if (row.status !== "FINAL" || row.counts_for_record === 0 || row.countsForRecord === false) continue;
    if (row.team_score == null || row.opponent_score == null) continue;
    const teamScore = Number(row.team_score);
    const opponentScore = Number(row.opponent_score);
    if (!Number.isFinite(teamScore) || !Number.isFinite(opponentScore)) continue;
    scoredFinals++;
    const result = teamScore === opponentScore ? "T" : teamScore > opponentScore ? "W" : "L";
    if (result === "W") wins++;
    else if (result === "L") losses++;
    else ties++;
    if (Number(row.conference_game || 0) === 1 || row.conferenceGame === true) {
      if (result === "W") conferenceWins++;
      else if (result === "L") conferenceLosses++;
      else conferenceTies++;
    }
  }

  return {
    wins,
    losses,
    ties,
    conference_wins: conferenceWins,
    conference_losses: conferenceLosses,
    conference_ties: conferenceTies,
    scored_finals: scoredFinals
  };
}

export function humanizeScheduleText(value) {
  const text = clean(value);
  if (!text) return text;
  const letters = text.replace(/[^A-Za-z]/g, "");
  if (!letters || letters !== letters.toUpperCase()) return text;
  return text.toLowerCase().replace(/(^|[\s(\-])([a-z])/g, (_, prefix, letter) => `${prefix}${letter.toUpperCase()}`);
}

export function applySchoolDisplayNames(row, displayNameById = new Map(), { reportingSchoolId = null } = {}) {
  const next = { ...row };
  const schoolId = next.school_id || reportingSchoolId || null;
  const homeId = next.canonical_home_school_id || null;
  const awayId = next.canonical_away_school_id || null;
  const schoolName = schoolId ? displayNameById.get(schoolId) : null;
  const homeName = homeId ? displayNameById.get(homeId) : null;
  const awayName = awayId ? displayNameById.get(awayId) : null;

  if (schoolName) next.school_name = schoolName;
  if (homeName) next.canonical_home_name = homeName;
  else if (next.canonical_home_name) next.canonical_home_name = humanizeScheduleText(next.canonical_home_name);
  if (awayName) next.canonical_away_name = awayName;
  else if (next.canonical_away_name) next.canonical_away_name = humanizeScheduleText(next.canonical_away_name);

  if (schoolId && homeId && awayId) {
    if (schoolId === homeId) next.opponent = awayName || next.canonical_away_name || next.opponent;
    else if (schoolId === awayId) next.opponent = homeName || next.canonical_home_name || next.opponent;
  }
  next.opponent = humanizeScheduleText(next.opponent);

  const rawVenue = clean(next.venue || next.canonical_venue);
  const venueKey = normalizeSchoolAlias(rawVenue);
  const participantNames = [
    [homeId, homeName || next.canonical_home_name],
    [awayId, awayName || next.canonical_away_name]
  ];
  const participantVenue = participantNames.find(([, name]) => name && normalizeSchoolAlias(name) === venueKey)?.[1];
  next.venue = participantVenue || humanizeScheduleText(rawVenue) || next.venue;
  if (next.canonical_venue) next.canonical_venue = participantVenue || humanizeScheduleText(next.canonical_venue);
  return next;
}
