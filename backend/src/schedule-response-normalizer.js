import { dateKeyInZone, normalizeSchoolAlias } from "./schedule-authority-core.js";
import { evaluateFinalResultTruth, normalizeFinalResultTruth, resultFromTeamScores } from "./final-result-truth.js";

const EVENT_DESCRIPTOR_RE = /\b(?:senior night|early bird|invitational|invite|tournament|tourney|classic|jamboree|benefit(?: game)?|exhibition|scrimmage)\b/g;
const TRAILING_STATE_QUALIFIER_RE = /\s*\((?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\)\s*$/i;
const GENERIC_SCHOOL_QUALIFIER_RE = /\b(?:senior|sr|academy)\b/g;
const VENUE_DETAIL_RE = /\b(?:arena|gym|gymnasium|fieldhouse|field house|stadium|center|centre|complex|court)\b/i;
const NON_RECORD_TEXT_RE = /\b(?:benefit game|exhibition|scrimmage|jamboree|meet the cats)\b/i;
const EXPLICIT_COUNT_FLAG_PARSERS = new Set(["dragonfly-public","sidearm"]);

const FOOTBALL_NON_GAME_STATUSES = new Set(["CANCELED","CANCELLED","POSTPONED"]);
const DISPLAY_TERMINAL_STATUSES = new Set(["FINAL","CANCELED","CANCELLED","POSTPONED"]);

function localDateForRow(row,timeZone="America/Chicago") {
  const cached=clean(row?.schedule_local_date);
  if(cached) return cached;
  const value=row?.scheduled_at||row?.canonical_scheduled_at;
  return value?dateKeyInZone(value,timeZone):"";
}

function footballSameLocalDate(a,b,{reportingSchoolId=null,timeZone="America/Chicago"}={}) {
  if (!a || !b) return false;
  if (clean(a.sport).toLowerCase()!=="football" || clean(b.sport).toLowerCase()!=="football") return false;
  if (clean(a.gender).toLowerCase()!==clean(b.gender).toLowerCase()) return false;
  if (!reportingSchoolId && a.school_id && b.school_id && a.school_id!==b.school_id) return false;
  if (FOOTBALL_NON_GAME_STATUSES.has(clean(a.status).toUpperCase()) || FOOTBALL_NON_GAME_STATUSES.has(clean(b.status).toUpperCase())) return false;
  const aDate=localDateForRow(a,timeZone);
  const bDate=localDateForRow(b,timeZone);
  return Boolean(aDate && bDate && aDate===bDate);
}

export function footballRowsConflictSameDay(a,b,options={}) {
  return footballSameLocalDate(a,b,options);
}

const HIGH_SCHOOL_FIRST_OFFICIAL = new Map([
  ["football|2026", "2026-08-27"],
  ["volleyball|2026", "2026-08-24"],
  ["basketball|2026", "2026-11-05"]
]);


export function highSchoolOfficialSeasonBoundary(row = {}) {
  const level=clean(row.level).toLowerCase();
  if (level && level !== "high-school") return null;
  const sport=clean(row.sport).toLowerCase();
  const season=clean(row.season);
  return HIGH_SCHOOL_FIRST_OFFICIAL.get(`${sport}|${season}`) || null;
}

export function rowIsOfficialSeasonContest(row = {}, { timeZone="America/Chicago" } = {}) {
  if (row.countsForRecord === false) return false;
  const parserType=clean(row.parser_type).toLowerCase();
  if (Number(row.counts_for_record) === 0 && EXPLICIT_COUNT_FLAG_PARSERS.has(parserType)) return false;
  const descriptiveText=[row.notes,row.opponent,row.venue,row.location_text]
    .map(clean)
    .filter(Boolean)
    .join(" ");
  if (NON_RECORD_TEXT_RE.test(descriptiveText)) return false;

  const boundary=highSchoolOfficialSeasonBoundary(row);
  if (!boundary) return true;
  const scheduledAt=row.scheduled_at||row.canonical_scheduled_at;
  if (!scheduledAt) return true;
  const localDate=dateKeyInZone(scheduledAt,timeZone);
  return !localDate || localDate >= boundary;
}

function collegeScheduleGroupKey(row = {}) {
  return [
    clean(row.reporting_team_id || row.team_id || row.school_id),
    clean(row.sport).toLowerCase(),
    clean(row.gender).toLowerCase(),
    clean(row.season)
  ].join("|");
}

function terminalScheduleStatus(row = {}) {
  return DISPLAY_TERMINAL_STATUSES.has(clean(row.status).toUpperCase());
}

function verifiedScoredFinal(row = {}) {
  if (clean(row.status).toUpperCase() !== "FINAL") return false;
  if (row.team_score == null || row.opponent_score == null) return false;
  return evaluateFinalResultTruth(row).state === "VERIFIED";
}

export function rowIsCollegePreseasonGhost(row = {}, { firstVerifiedFinalAt = null } = {}) {
  if (clean(row.level).toLowerCase() !== "college") return false;

  const firstFinal=typeof firstVerifiedFinalAt === "number"
    ? firstVerifiedFinalAt
    : Date.parse(firstVerifiedFinalAt || "");
  if (!Number.isFinite(firstFinal)) return false;

  const when=Date.parse(row.scheduled_at || row.canonical_scheduled_at);
  if (!Number.isFinite(when) || when >= firstFinal) return false;
  if (terminalScheduleStatus(row)) return false;
  if (row.team_score != null || row.opponent_score != null || clean(row.result)) return false;

  return true;
}

function removeCollegePreseasonGhostRows(rows = []) {
  const firstVerifiedFinalByGroup = new Map();

  for (const row of rows) {
    if (clean(row.level).toLowerCase() !== "college" || !verifiedScoredFinal(row)) continue;
    const when=Date.parse(row.scheduled_at || row.canonical_scheduled_at);
    if (!Number.isFinite(when)) continue;
    const key=collegeScheduleGroupKey(row);
    const current=firstVerifiedFinalByGroup.get(key);
    if (current == null || when < current) firstVerifiedFinalByGroup.set(key,when);
  }

  return rows.filter(row => !rowIsCollegePreseasonGhost(row, {
    firstVerifiedFinalAt:firstVerifiedFinalByGroup.get(collegeScheduleGroupKey(row))
  }));
}

export function officialSeasonScheduleRows(rows = [], options = {}) {
  const official=(Array.isArray(rows)?rows:[]).filter(row=>rowIsOfficialSeasonContest(row,options));
  return removeCollegePreseasonGhostRows(official);
}

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function opponentKey(value) {
  const withoutStateQualifier = clean(value).replace(TRAILING_STATE_QUALIFIER_RE, " ");
  return normalizeSchoolAlias(withoutStateQualifier)
    .replace(/^the\s+/, "")
    .replace(/\bpreparatory\b/g, "prep")
    .replace(EVENT_DESCRIPTOR_RE, " ")
    .replace(GENERIC_SCHOOL_QUALIFIER_RE, " ")
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



function scoredFinalSnapshot(row) {
  return clean(row?.status).toUpperCase()==="FINAL"
    && row?.team_score!=null
    && row?.opponent_score!=null;
}

function sameLocalScheduleDate(a,b,{timeZone="America/Chicago"}={}) {
  const aDate=localDateForRow(a,timeZone);
  const bDate=localDateForRow(b,timeZone);
  return Boolean(aDate&&bDate&&aDate===bDate);
}

function opponentIdentityLikelySame(a,b) {
  const aId=clean(a?.opponent_school_id);
  const bId=clean(b?.opponent_school_id);
  if(aId&&bId&&aId===bId) return true;
  return opponentNamesLikelySame(a?.opponent,b?.opponent);
}

export function staleSameDayOpponentTwin(a,b,{reportingSchoolId=null,timeZone="America/Chicago"}={}) {
  if(!a||!b) return false;
  if(clean(a.sport).toLowerCase()!==clean(b.sport).toLowerCase()) return false;
  if(clean(a.gender).toLowerCase()!==clean(b.gender).toLowerCase()) return false;
  if(!reportingSchoolId&&a.school_id&&b.school_id&&a.school_id!==b.school_id) return false;
  if(!sameLocalScheduleDate(a,b,{timeZone})) return false;
  if(!opponentIdentityLikelySame(a,b)) return false;
  const aFinal=scoredFinalSnapshot(a);
  const bFinal=scoredFinalSnapshot(b);
  if(aFinal===bFinal) return false;
  const stale=aFinal?b:a;
  return !DISPLAY_TERMINAL_STATUSES.has(clean(stale.status).toUpperCase());
}

function minutesBetween(a, b) {
  const aa = Date.parse(a);
  const bb = Date.parse(b);
  return Number.isFinite(aa) && Number.isFinite(bb) ? Math.abs(aa - bb) / 60000 : Infinity;
}

function scheduleRowsShareSlot(a, b, { reportingSchoolId = null, maxMinutes = 15 } = {}) {
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

function knownTimedRowsShareExactSlot(a, b, options = {}) {
  if (!Number(a?.scheduled_time_known) || !Number(b?.scheduled_time_known)) return false;
  const requestedMax = Number(options?.maxMinutes);
  const maxMinutes = Number.isFinite(requestedMax) ? Math.min(requestedMax, 5) : 5;
  return scheduleRowsShareSlot(a, b, { ...options, maxMinutes });
}

export function scheduleRowsLikelySameLogicalGame(a, b, options = {}) {
  if (!scheduleRowsShareSlot(a, b, options)) return false;

  const aCanonical=clean(a.canonical_event_id);
  const bCanonical=clean(b.canonical_event_id);
  if (aCanonical && bCanonical && aCanonical !== bCanonical) {
    // Distinct canonical IDs can still be duplicate provider observations when both
    // sources publish the same real clock time. Keep the old fail-closed behavior
    // for date-only/TBA rows so tournament rematches are never collapsed merely
    // because both were assigned the same placeholder timestamp.
    return knownTimedRowsShareExactSlot(a, b, options);
  }
  return true;
}

export function scheduleRowsLikelyDuplicate(a, b, options = {}) {
  return footballSameLocalDate(a,b,options)
    || staleSameDayOpponentTwin(a,b,options)
    || sameDayVerifiedFinalObservationTwin(a,b,options)
    || scheduleRowsLikelySameLogicalGame(a,b,options);
}

function sameDayVerifiedFinalObservationTwin(a, b, options = {}) {
  if (!sameLocalScheduleDate(a,b,options)) return false;
  if (!opponentIdentityLikelySame(a,b)) return false;

  const aCanonical=clean(a?.canonical_event_id);
  const bCanonical=clean(b?.canonical_event_id);
  if (aCanonical && bCanonical && aCanonical !== bCanonical) return false;

  const aSource=clean(a?.source_id);
  const bSource=clean(b?.source_id);
  const crossObservation = Boolean(aCanonical) !== Boolean(bCanonical)
    || (aSource && bSource && aSource !== bSource);
  if (!crossObservation) return false;

  if (String(a.status || "").toUpperCase() !== "FINAL" || String(b.status || "").toUpperCase() !== "FINAL") return false;
  const aTruth=evaluateFinalResultTruth(a);
  const bTruth=evaluateFinalResultTruth(b);
  if (aTruth.state !== "VERIFIED" || bTruth.state !== "VERIFIED") return false;
  return aTruth.row.result === bTruth.row.result
    && Number(aTruth.row.team_score) === Number(bTruth.row.team_score)
    && Number(aTruth.row.opponent_score) === Number(bTruth.row.opponent_score);
}

export function resultEvidenceMatchesScheduleRow(scheduleRow, evidenceRow, options = {}) {
  if (!scheduleRow || !evidenceRow) return false;
  if (clean(scheduleRow.sport).toLowerCase() !== clean(evidenceRow.sport).toLowerCase()) return false;
  if (clean(scheduleRow.gender).toLowerCase() !== clean(evidenceRow.gender).toLowerCase()) return false;

  const scheduleTeam = clean(scheduleRow.team_id || scheduleRow.reporting_team_id);
  const evidenceTeam = clean(evidenceRow.team_id || evidenceRow.reporting_team_id);
  if (scheduleTeam && evidenceTeam && scheduleTeam !== evidenceTeam) return false;

  const scheduleCanonical = clean(scheduleRow.canonical_event_id);
  const evidenceCanonical = clean(evidenceRow.canonical_event_id);
  if (scheduleCanonical && evidenceCanonical) {
    if (scheduleCanonical === evidenceCanonical) return true;
    return scheduleRowsLikelySameLogicalGame(scheduleRow, evidenceRow, {
      ...options,
      maxMinutes: Number(options.maxMinutes || 5)
    });
  }

  return sameLocalScheduleDate(scheduleRow, evidenceRow, options)
    && opponentIdentityLikelySame(scheduleRow, evidenceRow);
}

export function enrichScheduleRowsWithResultEvidence(scheduleRows = [], resultRows = [], options = {}) {
  const rows = (Array.isArray(scheduleRows) ? scheduleRows : []).map(row => ({ ...row }));

  for (const sourceEvidence of Array.isArray(resultRows) ? resultRows : []) {
    const evaluated = evaluateFinalResultTruth(sourceEvidence);
    if (evaluated.state !== "VERIFIED") continue;
    const evidence = evaluated.row;
    if (clean(evidence.status).toUpperCase() !== "FINAL") continue;
    if (nullableScore(evidence.team_score) == null || nullableScore(evidence.opponent_score) == null) continue;

    const candidates = [];
    for (let index = 0; index < rows.length; index += 1) {
      if (!resultEvidenceMatchesScheduleRow(rows[index], evidence, options)) continue;
      const exactCanonical = clean(rows[index].canonical_event_id)
        && clean(rows[index].canonical_event_id) === clean(evidence.canonical_event_id);
      candidates.push({ index, exactCanonical: exactCanonical ? 1 : 0, score: rowScore(rows[index]) });
    }
    if (!candidates.length) continue;
    candidates.sort((a, b) => b.exactCanonical - a.exactCanonical || b.score - a.score || a.index - b.index);

    const index = candidates[0].index;
    const schedule = rows[index];
    const scheduleTruth = evaluateFinalResultTruth(schedule);
    const scheduleAlreadyVerified = clean(schedule.status).toUpperCase() === "FINAL"
      && nullableScore(schedule.team_score) != null
      && nullableScore(schedule.opponent_score) != null
      && scheduleTruth.state === "VERIFIED";

    if (scheduleAlreadyVerified) continue;

    rows[index] = {
      ...schedule,
      status: "FINAL",
      team_score: nullableScore(evidence.team_score),
      opponent_score: nullableScore(evidence.opponent_score),
      result: evidence.result || resultFromTeamScores(evidence.team_score, evidence.opponent_score),
      data_trust: evidence.data_trust || schedule.data_trust,
      conflict_count: Math.max(Number(schedule.conflict_count || 0), Number(evidence.conflict_count || 0)),
      result_evidence_source_id: evidence.source_id || null,
      result_evidence_parser_type: evidence.parser_type || null
    };
  }

  return rows;
}

function nullableScore(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function identicalVerifiedFinalSnapshot(a, b, options = {}) {
  const aCanonical=clean(a?.canonical_event_id);
  const bCanonical=clean(b?.canonical_event_id);
  if (!aCanonical || !bCanonical || aCanonical === bCanonical) return false;
  if (!scheduleRowsShareSlot(a, b, options)) return false;
  if (String(a.status || "").toUpperCase() !== "FINAL" || String(b.status || "").toUpperCase() !== "FINAL") return false;

  const aTruth=evaluateFinalResultTruth(a);
  const bTruth=evaluateFinalResultTruth(b);
  if (aTruth.state !== "VERIFIED" || bTruth.state !== "VERIFIED") return false;
  return aTruth.row.result === bTruth.row.result
    && Number(aTruth.row.team_score) === Number(bTruth.row.team_score)
    && Number(aTruth.row.opponent_score) === Number(bTruth.row.opponent_score);
}

function verifiedFinal(row) {
  if (String(row?.status || "").toUpperCase() !== "FINAL") return false;
  return evaluateFinalResultTruth(row).state === "VERIFIED";
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

export function choosePreferredScheduleRow(a,b) {
  const aVerifiedFinal = verifiedFinal(a);
  const bVerifiedFinal = verifiedFinal(b);
  if (aVerifiedFinal !== bVerifiedFinal) return aVerifiedFinal ? a : b;
  return rowScore(a) >= rowScore(b) ? a : b;
}

function mergeDuplicateRows(a, b) {
  const preferred = choosePreferredScheduleRow(a,b);
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
  const buckets=new Map();
  for (const sourceRow of rows) {
    const row=sourceRow?.schedule_local_date
      ? sourceRow
      : {...sourceRow,schedule_local_date:localDateForRow(sourceRow,options.timeZone||"America/Chicago")};
    const bucketKey=[
      clean(row.sport).toLowerCase(),
      clean(row.gender).toLowerCase(),
      row.schedule_local_date||String(row.scheduled_at||row.canonical_scheduled_at||row.id||"")
    ].join("|");
    if(!buckets.has(bucketKey)) buckets.set(bucketKey,[]);
    const merged=buckets.get(bucketKey);
    const index = merged.findIndex(existing =>
      scheduleRowsLikelyDuplicate(existing, row, options)
      || scheduleRowsLikelySameLogicalGame(existing, row, options)
      || staleSameDayOpponentTwin(existing, row, options)
      || footballRowsConflictSameDay(existing, row, options)
      || identicalVerifiedFinalSnapshot(existing, row, options)
    );
    if (index === -1) merged.push({ ...row, schedule_observation_count: Number(row.schedule_observation_count || 1) });
    else merged[index] = mergeDuplicateRows(merged[index], row);
  }
  return [...buckets.values()].flat().sort((a, b) =>
    Date.parse(a.scheduled_at || a.canonical_scheduled_at) - Date.parse(b.scheduled_at || b.canonical_scheduled_at)
  );
}

function highSchoolPreOfficialSeason(row) {
  const boundary=highSchoolOfficialSeasonBoundary(row);
  if(!boundary) return false;
  const scheduledAt=row.scheduled_at||row.canonical_scheduled_at;
  if(!scheduledAt) return false;
  const localDate=dateKeyInZone(scheduledAt,"America/Chicago");
  return Boolean(localDate && localDate < boundary);
}

export function rowCountsForRecord(row = {}) {
  if (row.countsForRecord === false) return false;

  const descriptiveText = [row.notes, row.opponent, row.venue, row.location_text]
    .map(clean)
    .filter(Boolean)
    .join(" ");
  if (NON_RECORD_TEXT_RE.test(descriptiveText)) return false;

  if (highSchoolPreOfficialSeason(row)) return false;

  if (Number(row.counts_for_record) !== 0) return true;

  if (clean(row.parser_type).toLowerCase() === "dragonfly-public") return false;

  return true;
}

function emptyRecord() {
  return {
    wins: 0,
    losses: 0,
    ties: 0,
    conference_wins: 0,
    conference_losses: 0,
    conference_ties: 0,
    scored_finals: 0
  };
}

export function recordFromScheduleRows(games, options = {}) {
  const normalized = (Array.isArray(games) ? games : []).map(normalizeFinalResultTruth);
  const rows = dedupeScheduleRows(normalized, options);
  const record = emptyRecord();

  for (const row of rows) {
    if (String(row.status || "").toUpperCase() !== "FINAL" || !rowCountsForRecord(row)) continue;
    const evaluated = evaluateFinalResultTruth(row);
    if (evaluated.state !== "VERIFIED") continue;
    const normalizedRow = evaluated.row;
    const result = normalizedRow.result || resultFromTeamScores(normalizedRow.team_score, normalizedRow.opponent_score);
    if (!result) continue;
    record.scored_finals++;
    if (result === "W") record.wins++;
    else if (result === "L") record.losses++;
    else record.ties++;
    if (Number(normalizedRow.conference_game || 0) === 1 || normalizedRow.conferenceGame === true) {
      if (result === "W") record.conference_wins++;
      else if (result === "L") record.conference_losses++;
      else record.conference_ties++;
    }
  }

  return record;
}

function numericRecordObject(value) {
  if (!value || typeof value !== "object") return null;
  if (["wins", "losses", "ties"].every(key => value[key] == null)) return null;
  const n = key => Number(value[key] || 0);
  return {
    wins: n("wins"),
    losses: n("losses"),
    ties: n("ties"),
    conference_wins: n("conference_wins"),
    conference_losses: n("conference_losses"),
    conference_ties: n("conference_ties")
  };
}

export function parseRecordText(value) {
  if (value && typeof value === "object") return numericRecordObject(value);
  const parts = String(value || "").match(/\d+/g)?.map(Number) || [];
  if (parts.length < 2) return null;
  return {
    wins: parts[0] || 0,
    losses: parts[1] || 0,
    ties: parts[2] || 0,
    conference_wins: 0,
    conference_losses: 0,
    conference_ties: 0
  };
}

export function recordGameCount(record = {}) {
  return Number(record.wins || 0) + Number(record.losses || 0) + Number(record.ties || 0);
}

export function conferenceGameCount(record = {}) {
  return Number(record.conference_wins || 0) + Number(record.conference_losses || 0) + Number(record.conference_ties || 0);
}

export function sameOverallRecord(a, b) {
  return Boolean(a && b)
    && Number(a.wins || 0) === Number(b.wins || 0)
    && Number(a.losses || 0) === Number(b.losses || 0)
    && Number(a.ties || 0) === Number(b.ties || 0);
}

export function sameConferenceRecord(a, b) {
  return Boolean(a && b)
    && Number(a.conference_wins || 0) === Number(b.conference_wins || 0)
    && Number(a.conference_losses || 0) === Number(b.conference_losses || 0)
    && Number(a.conference_ties || 0) === Number(b.conference_ties || 0);
}

function pushIssue(issues, code, detail, extra = {}) {
  if (issues.some(issue => issue.code === code && issue.detail === detail)) return;
  issues.push({ code, detail, ...extra });
}

export function evaluateScheduleRecordTruth(games, options = {}) {
  // Collapse proven duplicate observations before unresolved-final accounting.
  // This lets verified canonical truth supersede a stale source placeholder while
  // date-only distinct canonical events remain protected as possible rematches.
  const rawRows = dedupeScheduleRows(Array.isArray(games) ? games : [], options);
  const evaluations = rawRows.map(row => ({ original: row, ...evaluateFinalResultTruth(row) }));
  const normalizedRows = dedupeScheduleRows(evaluations.map(item => item.row), options);
  const derived = recordFromScheduleRows(normalizedRows, options);
  const issues = [];
  let orientationCorrections = 0;
  let unresolvedFinals = 0;

  for (const item of evaluations) {
    if (item.corrected) orientationCorrections++;
    const row = item.row;
    if (String(row.status || "").toUpperCase() !== "FINAL" || !rowCountsForRecord(row)) continue;
    if (item.state === "UNRESOLVED" || item.state === "CONTRADICTORY") {
      unresolvedFinals++;
      pushIssue(
        issues,
        item.reason || "FINAL_RESULT_UNRESOLVED",
        `${row.opponent || row.id || "Final game"}: ${item.reason || "result truth unresolved"}`,
        { game_id: row.id || null, opponent: row.opponent || null }
      );
    }
  }

  const stored = numericRecordObject(options.storedRecord);
  const published = parseRecordText(options.publishedRecord);
  const evidenceGames = recordGameCount(derived);
  const evidenceConferenceGames = conferenceGameCount(derived);
  const storedGames = stored ? recordGameCount(stored) : null;
  const storedConferenceGames = stored ? conferenceGameCount(stored) : null;
  const publishedGames = published ? recordGameCount(published) : null;

  let state = unresolvedFinals > 0
    ? "UNRESOLVED"
    : evidenceGames > 0
      ? "VERIFIED"
      : "NO_RECORD_EVIDENCE";
  let auditClass = unresolvedFinals > 0 ? "UNRESOLVED" : "VERIFIED";

  if (stored && storedGames > evidenceGames) {
    if (auditClass !== "UNRESOLVED") auditClass = "CONTRADICTORY";
    pushIssue(issues, "STORED_RECORD_EXCEEDS_FINAL_EVIDENCE", `Stored record covers ${storedGames} games; normalized final evidence covers ${evidenceGames}.`, { informational: true });
  } else if (stored && storedGames === evidenceGames && evidenceGames > 0 && !sameOverallRecord(stored, derived)) {
    auditClass = "CONTRADICTORY";
    pushIssue(issues, "STALE_STORED_RECORD_CONTRADICTS_FINAL_EVIDENCE", `Stored ${stored.wins}-${stored.losses}-${stored.ties}; normalized finals ${derived.wins}-${derived.losses}-${derived.ties}.`, { informational: true });
  } else if (stored && storedGames < evidenceGames) {
    auditClass = "CONTRADICTORY";
    pushIssue(issues, "STALE_STORED_RECORD", `Stored record covers ${storedGames} games; normalized final evidence covers ${evidenceGames}.`, { informational: true });
  }

  if (stored && storedConferenceGames > evidenceConferenceGames) {
    if (auditClass !== "UNRESOLVED") auditClass = "CONTRADICTORY";
    pushIssue(issues, "STORED_CONFERENCE_RECORD_EXCEEDS_FINAL_EVIDENCE", `Stored conference record covers ${storedConferenceGames} games; normalized conference final evidence covers ${evidenceConferenceGames}.`, { informational: true });
  } else if (stored && storedConferenceGames === evidenceConferenceGames && evidenceConferenceGames > 0 && !sameConferenceRecord(stored, derived)) {
    if (auditClass === "VERIFIED") auditClass = "CONTRADICTORY";
    pushIssue(issues, "STALE_STORED_CONFERENCE_RECORD_CONTRADICTS_FINAL_EVIDENCE", "Stored conference record disagrees with normalized conference finals.", { informational: true });
  }

  if (published && publishedGames > evidenceGames) {
    if (state !== "UNRESOLVED") state = "INCOMPLETE";
    if (auditClass !== "UNRESOLVED") auditClass = "INCOMPLETE";
    pushIssue(issues, "PUBLISHED_RECORD_EXCEEDS_FINAL_EVIDENCE", `Published record covers ${publishedGames} games; normalized final evidence covers ${evidenceGames}.`);
  } else if (published && publishedGames === evidenceGames && evidenceGames > 0 && !sameOverallRecord(published, derived)) {
    if (auditClass === "VERIFIED") auditClass = "CONTRADICTORY";
    pushIssue(issues, "PUBLISHED_RECORD_CONTRADICTS_FINAL_EVIDENCE", `Published ${published.wins}-${published.losses}-${published.ties}; normalized finals ${derived.wins}-${derived.losses}-${derived.ties}.`, { informational: true });
  } else if (published && publishedGames < evidenceGames) {
    if (auditClass === "VERIFIED") auditClass = "CONTRADICTORY";
    pushIssue(issues, "PUBLISHED_RECORD_BEHIND_FINAL_EVIDENCE", `Published record covers ${publishedGames} games; normalized final evidence covers ${evidenceGames}.`, { informational: true });
  }

  const verified = state === "VERIFIED" && evidenceGames > 0;
  return {
    state,
    audit_class: auditClass,
    verified,
    trusted_record: verified ? derived : null,
    derived_record: derived,
    evidence_games: evidenceGames,
    evidence_conference_games: evidenceConferenceGames,
    unresolved_finals: unresolvedFinals,
    orientation_corrections: orientationCorrections,
    issues,
    normalized_rows: normalizedRows
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
