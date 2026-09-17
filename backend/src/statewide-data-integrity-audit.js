import { dedupeScheduleRows, scheduleRowsLikelyDuplicate } from "./schedule-response-normalizer.js";
import { evaluateFinalResultTruth } from "./final-result-truth.js";

const DEFAULT_SEASON = "2026";
const PAST_DUE_GRACE_HOURS = 6;
const TERMINAL_STATUSES = new Set(["FINAL", "CANCELED", "POSTPONED"]);

function text(value) {
  return String(value ?? "").trim();
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function boolish(value) {
  return value === true || Number(value) === 1;
}

function effectiveCandidate(row) {
  const schoolId = row.school_id || null;
  const hasCanonical = Boolean(row.canonical_event_id);
  const isHome = hasCanonical && row.canonical_home_school_id === schoolId;
  const isAway = hasCanonical && row.canonical_away_school_id === schoolId;
  const canonicalTeamScore = isHome
    ? nullableNumber(row.canonical_home_score)
    : isAway
      ? nullableNumber(row.canonical_away_score)
      : null;
  const canonicalOpponentScore = isHome
    ? nullableNumber(row.canonical_away_score)
    : isAway
      ? nullableNumber(row.canonical_home_score)
      : null;
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
    status: text(row.canonical_status || row.raw_status).toUpperCase() || "SCHEDULED",
    team_score: canonicalTeamScore == null ? nullableNumber(row.raw_team_score) : canonicalTeamScore,
    opponent_score: canonicalOpponentScore == null ? nullableNumber(row.raw_opponent_score) : canonicalOpponentScore,
    result: row.raw_result || null,
    counts_for_record: Number(row.counts_for_record || 0),
    home_away: row.home_away || "unknown",
    canonical_event_id: row.canonical_event_id || null,
    data_trust: row.canonical_trust_state || null
  };
}

function teamKey(row) {
  return row.team_id || [row.school_id, row.sport, row.gender, row.season].map(text).join("|");
}

function issue(code, row, detail, {
  severity = "blocking",
  other = null
} = {}) {
  return {
    code,
    severity,
    team_id: row.team_id || null,
    school_id: row.school_id || null,
    school_name: row.school_name || null,
    level: row.level || null,
    sport: row.sport || null,
    gender: row.gender || null,
    season: row.season || null,
    game_id: row.id || null,
    other_game_id: other?.id || null,
    canonical_event_id: row.canonical_event_id || null,
    other_canonical_event_id: other?.canonical_event_id || null,
    opponent: row.opponent || null,
    scheduled_at: row.scheduled_at || null,
    detail
  };
}

function issueKey(value) {
  const gameIds = [value.game_id || "", value.other_game_id || ""].sort().join("|");
  return `${value.code}|${value.team_id || ""}|${gameIds}|${value.detail}`;
}

function addIssue(list, next) {
  const key = issueKey(next);
  if (!list.some(existing => issueKey(existing) === key)) list.push(next);
}

function isScoredFinal(row) {
  return text(row?.status).toUpperCase() === "FINAL"
    && nullableNumber(row?.team_score) != null
    && nullableNumber(row?.opponent_score) != null;
}

function statusesDifferFinalVsNonterminal(a, b) {
  return (isScoredFinal(a) && !TERMINAL_STATUSES.has(text(b.status).toUpperCase()))
    || (isScoredFinal(b) && !TERMINAL_STATUSES.has(text(a.status).toUpperCase()));
}

function verifiedFinalsContradict(a, b) {
  if (!isScoredFinal(a) || !isScoredFinal(b)) return false;
  const aTruth = evaluateFinalResultTruth(a);
  const bTruth = evaluateFinalResultTruth(b);
  if (aTruth.state !== "VERIFIED" || bTruth.state !== "VERIFIED") return false;
  const aa = aTruth.row;
  const bb = bTruth.row;
  return aa.result !== bb.result
    || Number(aa.team_score) !== Number(bb.team_score)
    || Number(aa.opponent_score) !== Number(bb.opponent_score);
}

function pairLooksLikeOneDisplayedGame(a, b) {
  return scheduleRowsLikelyDuplicate(a, b, {
    reportingSchoolId: a.school_id,
    maxMinutes: 5
  });
}

function auditTeam(rows, { now = new Date() } = {}) {
  const candidates = rows.filter(row => row?.game_id).map(effectiveCandidate);
  const issues = [];
  const graceBoundary = now.getTime() - PAST_DUE_GRACE_HOURS * 60 * 60 * 1000;

  for (const candidate of candidates) {
    if (candidate.status === "FINAL") {
      if (candidate.team_score == null || candidate.opponent_score == null) {
        addIssue(issues, issue(
          "DISPLAY_FINAL_MISSING_SCORE",
          candidate,
          `${candidate.opponent}: the app-visible FINAL does not have both scores. This is a presentation defect even when the row does not count for the record.`
        ));
      } else {
        const truth = evaluateFinalResultTruth(candidate);
        if (truth.state === "CONTRADICTORY" || truth.state === "UNRESOLVED") {
          addIssue(issues, issue(
            "DISPLAY_FINAL_TRUTH_UNVERIFIED",
            candidate,
            `${candidate.opponent}: the app-visible FINAL has unresolved/contradictory result truth (${truth.reason || truth.state}).`
          ));
        } else if (truth.state === "QUARANTINED") {
          addIssue(issues, issue(
            "DISPLAY_FINAL_SOURCE_QUARANTINED",
            candidate,
            `${candidate.opponent}: the app-visible FINAL comes from a quarantined result source (${truth.reason || truth.state}).`,
            { severity: "warning" }
          ));
        }
      }
    }

    const scheduled = Date.parse(candidate.scheduled_at);
    if (Number.isFinite(scheduled) && scheduled < graceBoundary && !TERMINAL_STATUSES.has(candidate.status)) {
      addIssue(issues, issue(
        "PAST_DUE_NONTERMINAL_DISPLAY",
        candidate,
        `${candidate.opponent}: this app-visible game is more than ${PAST_DUE_GRACE_HOURS} hours past its scheduled time but is still ${candidate.status}.`,
        { severity: candidate.counts_for_record === 1 ? "blocking" : "warning" }
      ));
    }
  }

  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i];
      const b = candidates[j];
      if (!pairLooksLikeOneDisplayedGame(a, b)) continue;

      const aCanonical = text(a.canonical_event_id);
      const bCanonical = text(b.canonical_event_id);
      const splitCanonical = aCanonical && bCanonical && aCanonical !== bCanonical;
      if (splitCanonical) {
        addIssue(issues, issue(
          "SPLIT_CANONICAL_LOGICAL_GAME",
          a,
          `${a.opponent}: two observations that look like the same displayed game are assigned to different canonical events.`,
          { other: b }
        ));
      }

      if (statusesDifferFinalVsNonterminal(a, b)) {
        const finalRow = isScoredFinal(a) ? a : b;
        const staleRow = finalRow === a ? b : a;
        addIssue(issues, issue(
          "STALE_NONTERMINAL_TWIN_OF_FINAL",
          staleRow,
          `${staleRow.opponent}: a stale ${staleRow.status} row exists beside a scored FINAL for the same logical game.`,
          { other: finalRow }
        ));
      } else if (verifiedFinalsContradict(a, b)) {
        addIssue(issues, issue(
          "DUPLICATE_FINAL_CONTRADICTION",
          a,
          `${a.opponent}: duplicate verified finals disagree on the displayed score/result.`,
          { other: b }
        ));
      } else if (splitCanonical && !TERMINAL_STATUSES.has(a.status) && !TERMINAL_STATUSES.has(b.status)) {
        addIssue(issues, issue(
          "DUPLICATE_SCHEDULE_ENTRY",
          a,
          `${a.opponent}: the same future/nonterminal game is represented by multiple canonical events and can appear twice in the schedule.`,
          { other: b }
        ));
      }
    }
  }

  const normalized = dedupeScheduleRows(candidates, {
    reportingSchoolId: candidates[0]?.school_id || null,
    maxMinutes: 5
  });

  return {
    team_id: rows[0]?.team_id || null,
    school_id: rows[0]?.school_id || null,
    school_name: rows[0]?.school_name || null,
    level: rows[0]?.level || null,
    sport: rows[0]?.sport || null,
    gender: rows[0]?.gender || null,
    season: rows[0]?.season || null,
    raw_schedule_rows: candidates.length,
    normalized_schedule_rows: normalized.length,
    issues
  };
}

export function auditPresentationRows(rows, {
  now = new Date(),
  season = DEFAULT_SEASON,
  sampleLimit = 100,
  d1 = null
} = {}) {
  const groups = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = teamKey(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const teams = [...groups.values()].map(teamRows => auditTeam(teamRows, { now }));
  const allIssues = teams.flatMap(team => team.issues);
  const blockingIssues = allIssues.filter(value => value.severity === "blocking");
  const warningIssues = allIssues.filter(value => value.severity === "warning");
  const codeCounts = {};
  for (const value of allIssues) codeCounts[value.code] = Number(codeCounts[value.code] || 0) + 1;
  const teamsWithIssues = new Set(allIssues.map(value => value.team_id).filter(Boolean));
  const sportsExamined = [...new Set(teams.map(team => team.sport).filter(Boolean))].sort();
  const levelsExamined = [...new Set(teams.map(team => team.level).filter(Boolean))].sort();

  return {
    audit_version: "statewide-data-integrity-v1",
    generated_at: now.toISOString(),
    season: String(season),
    clean: blockingIssues.length === 0,
    contract: {
      scope: "Every active local-catalog team and every stored current-season schedule row that can feed the production app.",
      rules: [
        "A logical game must not be split across canonical event IDs when the participants and known game time identify one contest.",
        "A stale scheduled/nonterminal observation must not survive beside a scored final for the same displayed game.",
        "App-visible finals must contain both scores even when a row does not count toward record math.",
        "App-visible final result contradictions are blocking; quarantined result sources are surfaced as warnings rather than silently ignored.",
        "Duplicate future/nonterminal schedule entries are production data defects, not harmless record-audit noise.",
        "Possible date-only/TBA rematches remain separate unless the evidence safely identifies one contest."
      ]
    },
    summary: {
      total_active_teams_examined: teams.length,
      total_schedule_rows_examined: teams.reduce((sum, team) => sum + team.raw_schedule_rows, 0),
      total_normalized_schedule_rows: teams.reduce((sum, team) => sum + team.normalized_schedule_rows, 0),
      teams_with_issues: teamsWithIssues.size,
      blocking_issues: blockingIssues.length,
      warning_issues: warningIssues.length,
      issues_by_code: codeCounts,
      sports_examined: sportsExamined,
      levels_examined: levelsExamined
    },
    issues: allIssues.slice(0, Math.max(1, Number(sampleLimit) || 100)),
    d1: d1 || { rows_read: null, rows_written: 0 }
  };
}

export async function buildStatewideDataIntegrityAudit(env, {
  season = DEFAULT_SEASON,
  now = new Date(),
  sampleLimit = 100
} = {}) {
  const query = await env.DB.prepare(`
    WITH active_teams AS (
      SELECT t.id AS team_id,t.school_id,t.sport,t.gender,t.season,
        sch.name AS school_name,sch.level
      FROM teams t
      JOIN schools sch ON sch.id=t.school_id
      WHERE t.active=1 AND t.season=? AND sch.catalog_scope='local'
    )
    SELECT
      at.team_id,at.school_id,at.school_name,at.level,at.sport,at.gender,at.season,
      g.id AS game_id,g.source_id,g.opponent,g.opponent_school_id,
      g.scheduled_at AS raw_scheduled_at,g.scheduled_time_known AS raw_time_known,
      g.status AS raw_status,g.team_score AS raw_team_score,g.opponent_score AS raw_opponent_score,
      g.result AS raw_result,g.counts_for_record,g.home_away,g.canonical_event_id,
      src.source_type,src.parser_type,
      ce.scheduled_at AS canonical_scheduled_at,ce.scheduled_time_known AS canonical_time_known,
      ce.status AS canonical_status,ce.home_score AS canonical_home_score,ce.away_score AS canonical_away_score,
      ce.home_school_id AS canonical_home_school_id,ce.away_school_id AS canonical_away_school_id,
      ce.trust_state AS canonical_trust_state
    FROM active_teams at
    LEFT JOIN games g INDEXED BY idx_games_team_time ON g.team_id=at.team_id
    LEFT JOIN sources src ON src.id=g.source_id
    LEFT JOIN canonical_events ce ON ce.id=g.canonical_event_id
    ORDER BY at.team_id,g.scheduled_at,g.id
  `).bind(String(season)).all();

  const meta = query?.meta || {};
  return auditPresentationRows(query?.results || [], {
    now,
    season,
    sampleLimit,
    d1: {
      rows_read: meta.rows_read == null ? null : Number(meta.rows_read),
      rows_written: meta.rows_written == null ? 0 : Number(meta.rows_written),
      duration_ms: meta.duration == null ? null : Number(meta.duration)
    }
  });
}
