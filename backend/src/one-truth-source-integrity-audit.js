import {
  dedupeScheduleRows,
  enrichScheduleRowsWithResultEvidence,
  officialSeasonScheduleRows,
  recordFromScheduleRows,
  resultEvidenceMatchesScheduleRow
} from "./schedule-response-normalizer.js";
import { evaluateFinalResultTruth } from "./final-result-truth.js";
import { RESULT_ONLY_SOURCE_SUFFIX } from "./current-schedule-truth.js";

const LEGACY_RESULT_PARSERS = new Set(["mascot-media","rankone-public"]);

function clean(value) {
  return String(value ?? "").trim();
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function boolish(value) {
  return value === true || Number(value) === 1;
}

function sourceCandidate(row, { preferRawFinal = false } = {}) {
  const schoolId = row.school_id || null;
  const hasCanonical = Boolean(row.canonical_event_id);
  const isHome = hasCanonical && row.canonical_home_school_id === schoolId;
  const isAway = hasCanonical && row.canonical_away_school_id === schoolId;
  const canonicalTeamScore = isHome
    ? numberOrNull(row.canonical_home_score)
    : isAway
      ? numberOrNull(row.canonical_away_score)
      : null;
  const canonicalOpponentScore = isHome
    ? numberOrNull(row.canonical_away_score)
    : isAway
      ? numberOrNull(row.canonical_home_score)
      : null;
  const rawScoredFinal = clean(row.raw_status).toUpperCase() === "FINAL"
    && numberOrNull(row.raw_team_score) != null
    && numberOrNull(row.raw_opponent_score) != null;
  const canonicalScoredFinal = clean(row.canonical_status).toUpperCase() === "FINAL"
    && canonicalTeamScore != null
    && canonicalOpponentScore != null;
  const useRaw = preferRawFinal && rawScoredFinal && !canonicalScoredFinal;
  const canonicalTimeKnown = row.canonical_time_known == null ? null : boolish(row.canonical_time_known);

  return {
    id: row.game_id,
    team_id: row.team_id,
    school_id: schoolId,
    school_name: row.school_name || null,
    level: row.level || null,
    sport: row.sport || null,
    gender: row.gender || null,
    season: row.season || null,
    source_id: row.source_id || null,
    source_type: row.source_type || null,
    parser_type: row.parser_type || null,
    opponent: row.opponent || row.opponent_school_id || "Opponent",
    opponent_school_id: row.opponent_school_id || null,
    scheduled_at: row.canonical_scheduled_at || row.raw_scheduled_at,
    scheduled_time_known: canonicalTimeKnown == null ? boolish(row.raw_time_known) : canonicalTimeKnown,
    status: clean(useRaw ? row.raw_status : (row.canonical_status || row.raw_status)).toUpperCase() || "SCHEDULED",
    team_score: useRaw
      ? numberOrNull(row.raw_team_score)
      : canonicalTeamScore == null ? numberOrNull(row.raw_team_score) : canonicalTeamScore,
    opponent_score: useRaw
      ? numberOrNull(row.raw_opponent_score)
      : canonicalOpponentScore == null ? numberOrNull(row.raw_opponent_score) : canonicalOpponentScore,
    result: row.raw_result || null,
    counts_for_record: Number(row.counts_for_record ?? 1) === 0 ? 0 : 1,
    home_away: row.home_away || "unknown",
    conference_game: Number(row.conference_game || 0),
    canonical_event_id: row.canonical_event_id || null,
    data_trust: row.canonical_trust_state || null,
    conflict_count: Number(row.conflict_count || 0)
  };
}

function truthGameCandidate(row) {
  return {
    id: row.game_id || row.truth_id,
    team_id: row.team_id,
    school_id: row.school_id,
    school_name: row.school_name || null,
    level: row.school_level || null,
    sport: row.sport || null,
    gender: row.gender || null,
    season: row.season || null,
    source_id: row.source_id || null,
    source_type: row.source_type || null,
    parser_type: row.parser_type || null,
    opponent: row.opponent || "Opponent",
    opponent_school_id: row.opponent_school_id || null,
    scheduled_at: row.scheduled_at || null,
    scheduled_time_known: boolish(row.scheduled_time_known),
    status: clean(row.status).toUpperCase() || "SCHEDULED",
    team_score: numberOrNull(row.team_score),
    opponent_score: numberOrNull(row.opponent_score),
    result: row.result || null,
    counts_for_record: Number(row.counts_for_record ?? 1) === 0 ? 0 : 1,
    home_away: row.home_away || "unknown",
    conference_game: Number(row.conference_game || 0),
    canonical_event_id: row.canonical_event_id || null,
    data_trust: row.data_trust || null,
    conflict_count: Number(row.conflict_count || 0)
  };
}

function verifiedScoredFinal(row) {
  if (clean(row?.status).toUpperCase() !== "FINAL") return false;
  if (numberOrNull(row?.team_score) == null || numberOrNull(row?.opponent_score) == null) return false;
  return evaluateFinalResultTruth(row).state === "VERIFIED";
}

function sameFinal(a, b) {
  if (!verifiedScoredFinal(a) || !verifiedScoredFinal(b)) return false;
  const aa = evaluateFinalResultTruth(a).row;
  const bb = evaluateFinalResultTruth(b).row;
  return aa.result === bb.result
    && Number(aa.team_score) === Number(bb.team_score)
    && Number(aa.opponent_score) === Number(bb.opponent_score);
}

function recordMatchesSummary(record, summary) {
  return Number(record.wins || 0) === Number(summary.overall_wins || 0)
    && Number(record.losses || 0) === Number(summary.overall_losses || 0)
    && Number(record.ties || 0) === Number(summary.overall_ties || 0)
    && Number(record.conference_wins || 0) === Number(summary.conference_wins || 0)
    && Number(record.conference_losses || 0) === Number(summary.conference_losses || 0)
    && Number(record.conference_ties || 0) === Number(summary.conference_ties || 0);
}

function issue(code, row, detail, extra = {}) {
  return {
    code,
    severity: extra.severity || "blocking",
    team_id: row?.team_id || null,
    school_id: row?.school_id || null,
    school_name: row?.school_name || null,
    sport: row?.sport || null,
    gender: row?.gender || null,
    game_id: row?.id || null,
    canonical_event_id: row?.canonical_event_id || null,
    opponent: row?.opponent || null,
    scheduled_at: row?.scheduled_at || null,
    detail,
    ...extra
  };
}

function rankMismatches(teamSummaries) {
  const groups = new Map();
  for (const row of teamSummaries) {
    if (row.conference_membership_state !== "member" || !row.conference_id) continue;
    const key = [row.conference_id,row.sport,row.gender,row.season].join("|");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const mismatches = [];
  for (const rows of groups.values()) {
    const conferenceGames = rows.reduce((sum,row)=>sum + Number(row.conference_scored_finals || 0),0);
    const sorted = rows.slice().sort((a,b)=>{
      const ag=Number(a.conference_wins||0)+Number(a.conference_losses||0)+Number(a.conference_ties||0);
      const bg=Number(b.conference_wins||0)+Number(b.conference_losses||0)+Number(b.conference_ties||0);
      const ap=ag ? (Number(a.conference_wins||0)+0.5*Number(a.conference_ties||0))/ag : 0;
      const bp=bg ? (Number(b.conference_wins||0)+0.5*Number(b.conference_ties||0))/bg : 0;
      return bp-ap
        || Number(b.conference_wins||0)-Number(a.conference_wins||0)
        || Number(a.conference_losses||0)-Number(b.conference_losses||0)
        || Number(a.conference_ties||0)-Number(b.conference_ties||0)
        || clean(a.school_name).localeCompare(clean(b.school_name));
    });
    let previousKey = null;
    let previousRank = 0;
    sorted.forEach((row,index)=>{
      const games=Number(row.conference_wins||0)+Number(row.conference_losses||0)+Number(row.conference_ties||0);
      const pct=games ? (Number(row.conference_wins||0)+0.5*Number(row.conference_ties||0))/games : 0;
      const tieKey=[pct.toFixed(6),row.conference_wins||0,row.conference_losses||0,row.conference_ties||0].join("|");
      const expected = conferenceGames ? (tieKey === previousKey ? previousRank : index + 1) : null;
      if ((row.rank == null ? null : Number(row.rank)) !== expected) mismatches.push({ row, expected });
      previousKey=tieKey;
      previousRank=expected;
    });
  }
  return mismatches;
}

function groupByTeam(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = clean(row.team_id);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

function matchRow(rows, target, schoolId) {
  const sameId = clean(target.id)
    ? rows.find(row => clean(row.id) === clean(target.id))
    : null;
  if (sameId) return sameId;
  const exact = clean(target.canonical_event_id)
    ? rows.find(row => clean(row.canonical_event_id) === clean(target.canonical_event_id))
    : null;
  if (exact) return exact;
  return rows.find(row => resultEvidenceMatchesScheduleRow(row,target,{reportingSchoolId:schoolId})) || null;
}

export function auditOneTruthSourceCompleteness(scheduleSourceRows = [], resultOnlyRows = [], truthRows = []) {
  const scheduleByTeam = groupByTeam(scheduleSourceRows);
  const resultByTeam = groupByTeam(resultOnlyRows);
  const truthTeams = truthRows.filter(row => row.row_type === "TEAM");
  const truthGamesByTeam = groupByTeam(truthRows.filter(row => row.row_type === "GAME").map(truthGameCandidate));
  const summaryByTeam = new Map(truthTeams.map(row => [clean(row.team_id), row]));
  const teamIds = new Set([
    ...scheduleByTeam.keys(),
    ...resultByTeam.keys(),
    ...summaryByTeam.keys(),
    ...truthGamesByTeam.keys()
  ]);

  const issues = [];
  const legacyAffectedTeams = new Set();
  const legacyAffectedGames = [];
  const enrichmentAffectedTeams = new Set();
  const enrichmentAffectedGames = [];
  let sourceDerivedScoredFinals = 0;
  let truthScoredFinals = 0;
  let teamsWithFinalCountMismatch = 0;
  let matchedResultOnlyFinalEvidence = 0;
  let unmatchedResultOnlyFinalEvidence = 0;
  let resultEnrichmentRequiredGames = 0;
  let resultEnrichmentMissingFromTruth = 0;
  let resultOnlyStandaloneTruthRows = 0;
  let presentationRecordMismatches = 0;

  for (const summary of truthTeams) truthScoredFinals += Number(summary.scored_finals || 0);

  for (const teamId of teamIds) {
    const rawSchedule = (scheduleByTeam.get(teamId) || []).filter(row => row.game_id).map(row => sourceCandidate(row));
    const rawResults = (resultByTeam.get(teamId) || []).filter(row => row.game_id).map(row => sourceCandidate(row,{preferRawFinal:true}));
    const schoolId = rawSchedule[0]?.school_id || rawResults[0]?.school_id || summaryByTeam.get(teamId)?.school_id || null;
    const schedule = dedupeScheduleRows(officialSeasonScheduleRows(rawSchedule),{reportingSchoolId:schoolId});
    const resultEvidence = dedupeScheduleRows(officialSeasonScheduleRows(rawResults),{reportingSchoolId:schoolId});
    const enriched = dedupeScheduleRows(
      officialSeasonScheduleRows(enrichScheduleRowsWithResultEvidence(schedule,resultEvidence,{reportingSchoolId:schoolId})),
      {reportingSchoolId:schoolId}
    );
    const legacy = dedupeScheduleRows(
      officialSeasonScheduleRows(schedule.filter(row => !LEGACY_RESULT_PARSERS.has(clean(row.parser_type).toLowerCase()))),
      {reportingSchoolId:schoolId}
    );
    const truthGames = truthGamesByTeam.get(teamId) || [];
    const summary = summaryByTeam.get(teamId) || null;

    const derived = recordFromScheduleRows(enriched,{reportingSchoolId:schoolId});
    sourceDerivedScoredFinals += Number(derived.scored_finals || 0);

    if (summary && Number(summary.scored_finals || 0) !== Number(derived.scored_finals || 0)) {
      teamsWithFinalCountMismatch++;
      const sourceFinals=enriched.filter(verifiedScoredFinal);
      const truthFinals=truthGames.filter(verifiedScoredFinal);
      const compact=value=>({
        game_id:value.id || null,
        canonical_event_id:value.canonical_event_id || null,
        opponent:value.opponent || null,
        scheduled_at:value.scheduled_at || null,
        status:value.status || null,
        team_score:value.team_score ?? null,
        opponent_score:value.opponent_score ?? null,
        result:value.result || null,
        source_id:value.source_id || null,
        parser_type:value.parser_type || null,
        counts_for_record:Number(value.counts_for_record ?? 1)
      });
      const sourceOnly=sourceFinals.filter(value=>{
        const match=matchRow(truthFinals,value,schoolId);
        return !match || !sameFinal(match,value);
      }).map(compact);
      const truthOnly=truthFinals.filter(value=>{
        const match=matchRow(sourceFinals,value,schoolId);
        return !match || !sameFinal(match,value);
      }).map(compact);
      const row = enriched[0] || truthGames[0] || {
        team_id:teamId,school_id:summary.school_id,school_name:summary.school_name,
        sport:summary.sport,gender:summary.gender
      };
      issues.push(issue(
        "SOURCE_FINAL_COUNT_VS_ONE_TRUTH",
        row,
        "Source-derived scored finals=" + Number(derived.scored_finals || 0)
          + "; ONE_TRUTH scored_finals=" + Number(summary.scored_finals || 0) + ".",
        { source_only_finals:sourceOnly, truth_only_finals:truthOnly }
      ));
    }

    if (summary) {
      const truthRecord = recordFromScheduleRows(truthGames,{reportingSchoolId:summary.school_id});
      if (!recordMatchesSummary(truthRecord,summary)) {
        presentationRecordMismatches++;
        const row = truthGames[0] || {
          team_id:teamId,school_id:summary.school_id,school_name:summary.school_name,
          sport:summary.sport,gender:summary.gender
        };
        issues.push(issue(
          "ONE_TRUTH_TEAM_RECORD_VS_VISIBLE_FINALS",
          row,
          "ONE_TRUTH TEAM record arithmetic disagrees with its visible countable FINAL game rows."
        ));
      }
    }

    for (const current of enriched) {
      const legacyMatch = matchRow(legacy,current,schoolId);
      if (legacyMatch) continue;
      legacyAffectedTeams.add(teamId);
      const detail = {
        team_id:teamId,
        school_id:current.school_id || null,
        school_name:current.school_name || null,
        sport:current.sport || null,
        gender:current.gender || null,
        game_id:current.id || null,
        canonical_event_id:current.canonical_event_id || null,
        opponent:current.opponent || null,
        scheduled_at:current.scheduled_at || null,
        status:current.status || null,
        team_score:current.team_score ?? null,
        opponent_score:current.opponent_score ?? null,
        source_id:current.source_id || null,
        parser_type:current.parser_type || null
      };
      legacyAffectedGames.push(detail);
    }

    for (const evidence of resultEvidence) {
      if (!verifiedScoredFinal(evidence)) continue;
      const scheduleMatch = matchRow(schedule,evidence,schoolId);
      if (!scheduleMatch) {
        unmatchedResultOnlyFinalEvidence++;
        continue;
      }
      matchedResultOnlyFinalEvidence++;
      if (!verifiedScoredFinal(scheduleMatch)) {
        resultEnrichmentRequiredGames++;
        enrichmentAffectedTeams.add(teamId);
        enrichmentAffectedGames.push({
          team_id:teamId,
          school_id:evidence.school_id || null,
          school_name:evidence.school_name || null,
          sport:evidence.sport || null,
          gender:evidence.gender || null,
          game_id:scheduleMatch.id || null,
          canonical_event_id:scheduleMatch.canonical_event_id || evidence.canonical_event_id || null,
          opponent:evidence.opponent || scheduleMatch.opponent || null,
          scheduled_at:evidence.scheduled_at || scheduleMatch.scheduled_at || null,
          result:evidence.result || null,
          team_score:evidence.team_score,
          opponent_score:evidence.opponent_score,
          schedule_source_id:scheduleMatch.source_id || null,
          result_source_id:evidence.source_id || null
        });
      }

      const truthMatch = matchRow(truthGames,scheduleMatch,schoolId);
      if (!truthMatch || !sameFinal(truthMatch,evidence)) {
        resultEnrichmentMissingFromTruth++;
        issues.push(issue(
          "RESULT_ONLY_EVIDENCE_MISSING_FROM_ONE_TRUTH",
          evidence,
          "A legitimate result-only FINAL matches an independently established schedule game but is not represented by the same FINAL score in ONE_TRUTH.",
          { schedule_game_id:scheduleMatch.id || null, truth_game_id:truthMatch?.id || null }
        ));
      }
    }

    for (const truthGame of truthGames) {
      if (!clean(truthGame.source_id).toLowerCase().endsWith(RESULT_ONLY_SOURCE_SUFFIX)) continue;
      resultOnlyStandaloneTruthRows++;
      issues.push(issue(
        "RESULT_ONLY_SOURCE_CREATED_ONE_TRUTH_GAME",
        truthGame,
        "A result-only source is the schedule provenance of a ONE_TRUTH game row."
      ));
    }
  }

  const rankProblems = rankMismatches(truthTeams);
  for (const value of rankProblems) {
    const row = value.row;
    issues.push(issue(
      "ONE_TRUTH_RANK_MISMATCH",
      {
        team_id:row.team_id,school_id:row.school_id,school_name:row.school_name,
        sport:row.sport,gender:row.gender
      },
      "Stored rank=" + (row.rank == null ? "null" : Number(row.rank))
        + "; expected rank=" + (value.expected == null ? "null" : value.expected) + "."
    ));
  }

  const legacyFinals = legacyAffectedGames.filter(row => row.status === "FINAL"
    && row.team_score != null && row.opponent_score != null);

  const affectedTeams = [...new Set(issues.map(value=>value.team_id).filter(Boolean))].sort();
  return {
    clean: issues.filter(value=>value.severity === "blocking").length === 0,
    summary: {
      active_truth_teams: truthTeams.length,
      truth_game_rows: [...truthGamesByTeam.values()].reduce((sum,rows)=>sum+rows.length,0),
      source_derived_scored_finals: sourceDerivedScoredFinals,
      one_truth_scored_finals: truthScoredFinals,
      teams_with_final_count_mismatch: teamsWithFinalCountMismatch,
      matched_result_only_final_evidence: matchedResultOnlyFinalEvidence,
      unmatched_result_only_final_evidence: unmatchedResultOnlyFinalEvidence,
      result_enrichment_required_games: resultEnrichmentRequiredGames,
      result_enrichment_missing_from_truth: resultEnrichmentMissingFromTruth,
      result_only_standalone_truth_rows: resultOnlyStandaloneTruthRows,
      legacy_parser_filter_affected_teams: legacyAffectedTeams.size,
      legacy_parser_filter_missing_games: legacyAffectedGames.length,
      legacy_parser_filter_missing_finals: legacyFinals.length,
      presentation_record_mismatches: presentationRecordMismatches,
      presentation_rank_mismatches: rankProblems.length,
      blocking_issues: issues.filter(value=>value.severity === "blocking").length,
      affected_teams: affectedTeams.length
    },
    affected_teams: affectedTeams,
    legacy_parser_filter: {
      affected_teams:[...legacyAffectedTeams].sort(),
      affected_games:legacyAffectedGames,
      missing_finals:legacyFinals
    },
    result_enrichment: {
      affected_teams:[...enrichmentAffectedTeams].sort(),
      affected_games:enrichmentAffectedGames
    },
    issues
  };
}
