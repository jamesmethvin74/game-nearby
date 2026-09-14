import {
  conferenceGameCount,
  evaluateScheduleRecordTruth,
  parseRecordText,
  recordGameCount,
  sameConferenceRecord,
  sameOverallRecord,
  scheduleRowsLikelyDuplicate
} from "./schedule-response-normalizer.js";
import { evaluateFinalResultTruth, resultFromTeamScores } from "./final-result-truth.js";

const DEFAULT_SEASON = "2026";
const RESULT_GRACE_HOURS = 6;

function n(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function recordFromRow(row, prefix = "stored") {
  const keys = [`${prefix}_wins`,`${prefix}_losses`,`${prefix}_ties`];
  if (keys.every(key => row?.[key] == null)) return null;
  return {
    wins:n(row[`${prefix}_wins`]),
    losses:n(row[`${prefix}_losses`]),
    ties:n(row[`${prefix}_ties`]),
    conference_wins:n(row[`${prefix}_conference_wins`]),
    conference_losses:n(row[`${prefix}_conference_losses`]),
    conference_ties:n(row[`${prefix}_conference_ties`])
  };
}

function effectiveCandidate(row) {
  const reportingSchoolId = row.school_id;
  const hasCanonical = Boolean(row.canonical_event_id);
  const isHome = hasCanonical && row.canonical_home_school_id === reportingSchoolId;
  const isAway = hasCanonical && row.canonical_away_school_id === reportingSchoolId;
  const teamScore = isHome
    ? nullableNumber(row.canonical_home_score)
    : isAway
      ? nullableNumber(row.canonical_away_score)
      : nullableNumber(row.raw_team_score);
  const opponentScore = isHome
    ? nullableNumber(row.canonical_away_score)
    : isAway
      ? nullableNumber(row.canonical_home_score)
      : nullableNumber(row.raw_opponent_score);
  const conferenceGame = row.canonical_conference_game == null
    ? n(row.raw_conference_game)
    : n(row.canonical_conference_game);

  return {
    id:row.game_id,
    team_id:row.team_id,
    school_id:row.school_id,
    sport:row.sport,
    gender:row.gender,
    season:row.season,
    opponent:row.opponent || row.opponent_school_id || "Opponent",
    opponent_school_id:row.opponent_school_id || null,
    scheduled_at:row.canonical_scheduled_at || row.raw_scheduled_at,
    status:row.canonical_status || row.raw_status,
    team_score:teamScore,
    opponent_score:opponentScore,
    result:row.raw_result || null,
    counts_for_record:n(row.counts_for_record),
    conference_game:conferenceGame,
    notes:row.notes || null,
    canonical_event_id:row.canonical_event_id || null,
    source_id:row.source_id || null,
    source_type:row.source_type || null,
    parser_type:row.parser_type || null,
    data_trust:row.canonical_trust_state || null
  };
}

function rawCandidate(row) {
  return {
    ...effectiveCandidate(row),
    scheduled_at:row.raw_scheduled_at,
    status:row.raw_status,
    team_score:nullableNumber(row.raw_team_score),
    opponent_score:nullableNumber(row.raw_opponent_score),
    conference_game:n(row.raw_conference_game)
  };
}

function issue(code, detail, {
  severity="warning",
  resolved=false,
  gameId=null,
  sourceId=null,
  canonicalEventId=null
}={}) {
  return {
    code,detail,severity,resolved,
    ...(gameId ? {game_id:gameId} : {}),
    ...(sourceId ? {source_id:sourceId} : {}),
    ...(canonicalEventId ? {canonical_event_id:canonicalEventId} : {})
  };
}

function addIssue(list, next) {
  const key = `${next.code}|${next.game_id||""}|${next.source_id||""}|${next.canonical_event_id||""}|${next.detail}`;
  if (!list.some(existing => `${existing.code}|${existing.game_id||""}|${existing.source_id||""}|${existing.canonical_event_id||""}|${existing.detail}` === key)) list.push(next);
}

function teamMeta(row) {
  return {
    team_id:row.team_id,
    school_id:row.school_id,
    school_name:row.school_name,
    level:row.level,
    sport:row.sport,
    gender:row.gender,
    season:row.season,
    conference_id:row.conference_id || null
  };
}

function firstValue(rows, primaryField, fallbackMethod, fallbackField) {
  const direct=rows.find(row=>row?.[primaryField])?.[primaryField];
  if (direct) return direct;
  const fallback=rows.find(row=>row.standing_method===fallbackMethod && row?.[fallbackField])?.[fallbackField];
  return fallback || null;
}

function publishedRecordFromRows(rows) {
  return firstValue(rows,"published_standing_overall_record","published","standing_overall_record");
}

function publishedConferenceRecordFromRows(rows) {
  return firstValue(rows,"published_standing_conference_record","published","standing_conference_record");
}

function calculatedStandingRecordFromRows(rows) {
  return firstValue(rows,"calculated_standing_overall_record","calculated","standing_overall_record");
}

function calculatedStandingConferenceRecordFromRows(rows) {
  return firstValue(rows,"calculated_standing_conference_record","calculated","standing_conference_record");
}

function sourceCompletenessIssues(rows) {
  const issues=[];
  const seen=new Set();
  for (const row of rows) {
    if (!row.source_id || seen.has(row.source_id)) continue;
    seen.add(row.source_id);
    const snapshot=nullableNumber(row.source_snapshot_count);
    const stored=nullableNumber(row.source_stored_game_count);
    if (snapshot != null && stored != null && snapshot > stored) {
      addIssue(issues, issue(
        "SOURCE_COMPLETENESS_GAP",
        `${row.source_id} last successful snapshot reported ${snapshot} games but ${stored} rows are currently stored for that source.`,
        {severity:"blocking",sourceId:row.source_id}
      ));
    }
  }
  return issues;
}

function duplicateAndCrossSourceIssues(candidates) {
  const issues=[];
  for (let i=0;i<candidates.length;i++) {
    for (let j=i+1;j<candidates.length;j++) {
      const a=candidates[i], b=candidates[j];
      if (!scheduleRowsLikelyDuplicate(a,b,{reportingSchoolId:a.school_id,maxMinutes:15})) continue;
      const aEval=evaluateFinalResultTruth(a), bEval=evaluateFinalResultTruth(b);
      const sameNormalized = aEval.state === "VERIFIED" && bEval.state === "VERIFIED"
        && aEval.row.result === bEval.row.result
        && Number(aEval.row.team_score) === Number(bEval.row.team_score)
        && Number(aEval.row.opponent_score) === Number(bEval.row.opponent_score);
      if (sameNormalized) {
        addIssue(issues,issue(
          "DUPLICATE_FINAL_OBSERVATIONS",
          `Multiple observations describe the same final; record calculation deduplicates them.`,
          {severity:"info",resolved:true,canonicalEventId:a.canonical_event_id||b.canonical_event_id||null}
        ));
      } else {
        addIssue(issues,issue(
          "SAME_GAME_SOURCE_CONTRADICTION",
          `Multiple sources represent the same game with different normalized result/score truth.`,
          {severity:"blocking",canonicalEventId:a.canonical_event_id||b.canonical_event_id||null}
        ));
      }
    }
  }
  return issues;
}

function classificationFrom({truth,issues}) {
  if (truth.state === "UNRESOLVED" || issues.some(item => item.severity === "blocking" && /MISSING_SCORE|ORIENTATION_UNRESOLVED|TIE_SCORE/.test(item.code))) return "UNRESOLVED";
  if (truth.state === "INCOMPLETE" || issues.some(item => item.code === "SOURCE_COMPLETENESS_GAP" || item.code === "PAST_DUE_NONTERMINAL" || item.code.includes("EXCEEDS_FINAL_EVIDENCE"))) return "INCOMPLETE";
  if (truth.audit_class === "CONTRADICTORY" || issues.some(item => item.severity === "blocking" && item.code.includes("CONTRADICTION"))) return "CONTRADICTORY";
  return "VERIFIED";
}

function parsedRecordGameCount(value) {
  const parsed=parseRecordText(value);
  return parsed ? recordGameCount(parsed) : 0;
}

function conferenceTextMatchesDerived(value,derived) {
  const parsed=parseRecordText(value);
  if (!parsed || !derived) return false;
  return sameConferenceRecord({
    conference_wins:parsed.wins,
    conference_losses:parsed.losses,
    conference_ties:parsed.ties
  },derived);
}

function classifyTeam(rows,{now=new Date()}={}) {
  const seed=rows[0];
  const meta=teamMeta(seed);
  const storedRecord=recordFromRow(seed,"stored");
  const publishedRecord=publishedRecordFromRows(rows);
  const publishedConferenceRecord=publishedConferenceRecordFromRows(rows);
  const candidates=rows.filter(row=>row.game_id).map(effectiveCandidate);
  const truth=evaluateScheduleRecordTruth(candidates,{
    reportingSchoolId:seed.school_id,
    storedRecord,
    publishedRecord,
    maxMinutes:15
  });
  const issues=[...truth.issues.map(item=>issue(item.code,item.detail,{
    severity:item.informational?"info":truth.state === "INCOMPLETE" || truth.state === "UNRESOLVED"?"blocking":"warning",
    resolved:Boolean(item.informational)
  }))];

  for (const row of rows.filter(row=>row.game_id)) {
    const raw=rawCandidate(row);
    const effective=effectiveCandidate(row);
    const rawEval=evaluateFinalResultTruth(raw);
    const effectiveEval=evaluateFinalResultTruth(effective);

    if (String(raw.status||"").toUpperCase()==="FINAL" && rawEval.corrected) {
      addIssue(issues,issue(
        "EXPLICIT_RESULT_SCORE_ORIENTATION_CONTRADICTION",
        `${raw.result} ${row.raw_team_score}-${row.raw_opponent_score} required normalization to ${rawEval.row.team_score}-${rawEval.row.opponent_score} for the reporting team.`,
        {severity:"warning",resolved:true,gameId:row.game_id,sourceId:row.source_id,canonicalEventId:row.canonical_event_id}
      ));
    }
    if (String(effective.status||"").toUpperCase()==="FINAL" && effectiveEval.state === "UNRESOLVED") {
      addIssue(issues,issue(
        "FINAL_MISSING_SCORE",
        `${effective.opponent}: FINAL row does not contain both scores.`,
        {severity:"blocking",gameId:row.game_id,sourceId:row.source_id,canonicalEventId:row.canonical_event_id}
      ));
    }
    if (String(effective.status||"").toUpperCase()==="FINAL" && effectiveEval.state === "CONTRADICTORY") {
      addIssue(issues,issue(
        effectiveEval.reason || "FINAL_RESULT_CONTRADICTION",
        `${effective.opponent}: explicit result cannot be reconciled safely with final score evidence.`,
        {severity:"blocking",gameId:row.game_id,sourceId:row.source_id,canonicalEventId:row.canonical_event_id}
      ));
    }
    if (String(effective.status||"").toUpperCase()==="FINAL" && !row.raw_result && nullableNumber(effective.team_score)!=null && nullableNumber(effective.opponent_score)!=null) {
      addIssue(issues,issue(
        "NUMERIC_ONLY_FINAL_ORIENTATION",
        `${effective.opponent}: final result is inferred from team-oriented numeric score because the source supplied no explicit W/L/T.`,
        {severity:"info",resolved:true,gameId:row.game_id,sourceId:row.source_id,canonicalEventId:row.canonical_event_id}
      ));
    }
    if (row.canonical_event_id && row.raw_result && nullableNumber(row.canonical_home_score)!=null && nullableNumber(row.canonical_away_score)!=null) {
      const canonicalNumeric=resultFromTeamScores(effective.team_score,effective.opponent_score);
      if (canonicalNumeric && canonicalNumeric !== String(row.raw_result).toUpperCase()) {
        addIssue(issues,issue(
          "CANONICAL_EVENT_RESULT_CONTRADICTION",
          `${effective.opponent}: canonical numeric score implies ${canonicalNumeric} while authoritative reporting observation says ${String(row.raw_result).toUpperCase()}.`,
          {severity:"blocking",gameId:row.game_id,sourceId:row.source_id,canonicalEventId:row.canonical_event_id}
        ));
      }
    }

    const scheduled=Date.parse(effective.scheduled_at);
    const graceBoundary=now.getTime()-RESULT_GRACE_HOURS*3600000;
    const terminal=new Set(["FINAL","CANCELED","POSTPONED"]);
    if (n(row.counts_for_record)!==0 && Number.isFinite(scheduled) && scheduled<graceBoundary && !terminal.has(String(effective.status||"").toUpperCase())) {
      addIssue(issues,issue(
        "PAST_DUE_NONTERMINAL",
        `${effective.opponent}: record-counting game is past due but is not FINAL/CANCELED/POSTPONED.`,
        {severity:"blocking",gameId:row.game_id,sourceId:row.source_id,canonicalEventId:row.canonical_event_id}
      ));
    }
  }

  for (const next of sourceCompletenessIssues(rows)) addIssue(issues,next);
  for (const next of duplicateAndCrossSourceIssues(candidates)) addIssue(issues,next);

  const publishedConferenceGames=parsedRecordGameCount(publishedConferenceRecord);
  if (publishedConferenceGames > truth.evidence_conference_games) {
    addIssue(issues,issue(
      "PUBLISHED_CONFERENCE_RECORD_EXCEEDS_FINAL_EVIDENCE",
      `Published conference record covers ${publishedConferenceGames} games; normalized conference final evidence covers ${truth.evidence_conference_games}.`,
      {severity:"blocking"}
    ));
  } else if (publishedConferenceGames > 0 && publishedConferenceGames === truth.evidence_conference_games && !conferenceTextMatchesDerived(publishedConferenceRecord,truth.derived_record)) {
    addIssue(issues,issue(
      "PUBLISHED_CONFERENCE_RECORD_CONTRADICTION",
      `Published conference record ${publishedConferenceRecord} disagrees with normalized conference final-game truth.`,
      {severity:"blocking"}
    ));
  }

  const calculatedStanding=calculatedStandingRecordFromRows(rows);
  if (calculatedStanding) {
    const calculated=parseRecordText(calculatedStanding);
    if (calculated && truth.derived_record && recordGameCount(calculated) === truth.evidence_games && !sameOverallRecord(calculated,truth.derived_record)) {
      addIssue(issues,issue(
        "MATERIALIZED_STANDING_RECORD_CONTRADICTION",
        `Materialized standings record ${calculatedStanding} disagrees with normalized final-game record ${truth.derived_record.wins}-${truth.derived_record.losses}-${truth.derived_record.ties}.`,
        {severity:"blocking"}
      ));
    }
  }

  const calculatedConference=calculatedStandingConferenceRecordFromRows(rows);
  if (calculatedConference && parsedRecordGameCount(calculatedConference) === truth.evidence_conference_games && truth.evidence_conference_games > 0 && !conferenceTextMatchesDerived(calculatedConference,truth.derived_record)) {
    addIssue(issues,issue(
      "MATERIALIZED_CONFERENCE_RECORD_CONTRADICTION",
      `Materialized conference record ${calculatedConference} disagrees with normalized conference final-game truth.`,
      {severity:"blocking"}
    ));
  }

  const latestEvidenceAt=rows.reduce((latest,row)=>{
    const value=Date.parse(row.source_updated_at||row.game_updated_at||row.last_checked_at||"");
    return Number.isFinite(value)?Math.max(latest,value):latest;
  },0);
  const storedCalculatedAt=Date.parse(seed.stored_calculated_at||"");
  if (storedRecord && latestEvidenceAt && Number.isFinite(storedCalculatedAt) && storedCalculatedAt<latestEvidenceAt && !sameOverallRecord(storedRecord,truth.derived_record)) {
    addIssue(issues,issue(
      "STALE_RECORD_ROW",
      `Stored team_records was calculated before newer final-game evidence and no longer matches normalized truth.`,
      {severity:"info",resolved:true}
    ));
  }

  const classification=classificationFrom({truth,issues});
  const unexplained=issues.filter(item=>item.severity!=="info" && !item.resolved);
  return {
    ...meta,
    classification,
    public_record_state:truth.state,
    public_record_verified:truth.verified,
    stored_record:storedRecord,
    derived_record:truth.derived_record,
    trusted_record:truth.trusted_record,
    published_record:publishedRecord,
    published_conference_record:publishedConferenceRecord,
    evidence_games:truth.evidence_games,
    evidence_conference_games:truth.evidence_conference_games,
    orientation_corrections:truth.orientation_corrections,
    unresolved_finals:truth.unresolved_finals,
    unexplained_issue_count:unexplained.length,
    issues
  };
}

function teamRequiresRecordAudit(team) {
  const storedGames=team.stored_record ? recordGameCount(team.stored_record) : 0;
  const publishedGames=parsedRecordGameCount(team.published_record);
  const publishedConferenceGames=parsedRecordGameCount(team.published_conference_record);
  return team.evidence_games>0
    || team.unresolved_finals>0
    || storedGames>0
    || publishedGames>0
    || publishedConferenceGames>0
    || team.issues.some(item=>item.severity==="blocking");
}

export function classifyRecordTruthRows(rows=[],options={}) {
  const byTeam=new Map();
  for (const row of rows) {
    if (!row?.team_id) continue;
    if (!byTeam.has(row.team_id)) byTeam.set(row.team_id,[]);
    byTeam.get(row.team_id).push(row);
  }
  const teams=[...byTeam.values()].map(teamRows=>classifyTeam(teamRows,options));
  const withFinals=teams.filter(team=>team.evidence_games>0 || team.unresolved_finals>0);
  const audited=teams.filter(teamRequiresRecordAudit);
  const counts=Object.fromEntries(["VERIFIED","INCOMPLETE","CONTRADICTORY","UNRESOLVED"].map(value=>[value,audited.filter(team=>team.classification===value).length]));
  const nonVerified=audited.filter(team=>team.classification!=="VERIFIED");
  return {
    generated_at:(options.now instanceof Date?options.now:new Date()).toISOString(),
    audit_contract:{
      version:"record-truth-v1",
      rule:"Explicit authoritative W/L/T orients final scores. Records derive only from normalized, deduplicated, countable FINAL games. Published or stored records may prove missing evidence but cannot silently override individual game truth.",
      incomplete_rule:"If stored or published record evidence covers more completed games than normalized final-game evidence, the public record is unverified rather than undercounted.",
      dedupe_rule:"Logical duplicate finals count once; conflicting representations remain audit contradictions."
    },
    summary:{
      total_active_teams_examined:teams.length,
      total_active_teams_with_finals:withFinals.length,
      total_active_teams_requiring_record_audit:audited.length,
      verified:counts.VERIFIED,
      incomplete:counts.INCOMPLETE,
      contradictory:counts.CONTRADICTORY,
      unresolved:counts.UNRESOLVED,
      non_verified:nonVerified.length,
      orientation_corrections:audited.reduce((sum,team)=>sum+team.orientation_corrections,0),
      unexplained_record_contradictions:audited.filter(team=>team.classification==="CONTRADICTORY" && team.unexplained_issue_count>0).length
    },
    non_verified_teams:nonVerified,
    teams
  };
}

export async function buildStatewideRecordTruthAudit(env,{
  season=DEFAULT_SEASON,
  now=new Date()
}={}) {
  const result=await env.DB.prepare(`
    WITH active_teams AS (
      SELECT t.id AS team_id,t.school_id,t.sport,t.gender,t.season,t.conference_id,
        sch.name AS school_name,sch.level,
        r.wins AS stored_wins,r.losses AS stored_losses,r.ties AS stored_ties,
        r.conference_wins AS stored_conference_wins,r.conference_losses AS stored_conference_losses,r.conference_ties AS stored_conference_ties,
        r.calculated_at AS stored_calculated_at
      FROM teams t
      JOIN schools sch ON sch.id=t.school_id
      LEFT JOIN team_records r ON r.team_id=t.id
      WHERE t.active=1 AND t.season=? AND sch.catalog_scope='local'
    ),
    source_counts AS (
      SELECT g.source_id,COUNT(*) AS source_stored_game_count
      FROM games g INDEXED BY idx_games_team_time
      JOIN active_teams at ON at.team_id=g.team_id
      GROUP BY g.source_id
    ),
    standings_summary AS (
      SELECT team_id,conference_id,
        MAX(CASE WHEN method='published' THEN overall_record END) AS published_standing_overall_record,
        MAX(CASE WHEN method='published' THEN conference_record END) AS published_standing_conference_record,
        MAX(CASE WHEN method='calculated' THEN overall_record END) AS calculated_standing_overall_record,
        MAX(CASE WHEN method='calculated' THEN conference_record END) AS calculated_standing_conference_record,
        MAX(calculated_at) AS standing_calculated_at
      FROM standings
      GROUP BY team_id,conference_id
    )
    SELECT at.*,
      g.id AS game_id,g.source_id,g.source_event_key,g.opponent,g.opponent_school_id,
      g.scheduled_at AS raw_scheduled_at,g.status AS raw_status,g.team_score AS raw_team_score,g.opponent_score AS raw_opponent_score,
      g.result AS raw_result,g.counts_for_record,g.conference_game AS raw_conference_game,g.notes,
      g.source_updated_at,g.last_checked_at,g.updated_at AS game_updated_at,g.canonical_event_id,
      src.source_type,src.parser_type,src.authority_rank,src.source_priority,
      src.last_successful_fetch_at,src.last_game_count AS source_snapshot_count,
      sc.source_stored_game_count,
      ce.scheduled_at AS canonical_scheduled_at,ce.status AS canonical_status,
      ce.home_score AS canonical_home_score,ce.away_score AS canonical_away_score,
      ce.home_school_id AS canonical_home_school_id,ce.away_school_id AS canonical_away_school_id,
      ce.conference_game AS canonical_conference_game,ce.trust_state AS canonical_trust_state,ce.conflict_count AS canonical_conflict_count,
      ss.published_standing_overall_record,ss.published_standing_conference_record,
      ss.calculated_standing_overall_record,ss.calculated_standing_conference_record,ss.standing_calculated_at
    FROM active_teams at
    LEFT JOIN games g INDEXED BY idx_games_team_time ON g.team_id=at.team_id
      AND (
        g.status='FINAL'
        OR datetime(g.scheduled_at) <= datetime(?,'-${RESULT_GRACE_HOURS} hours')
      )
    LEFT JOIN sources src ON src.id=g.source_id
    LEFT JOIN source_counts sc ON sc.source_id=g.source_id
    LEFT JOIN canonical_events ce ON ce.id=g.canonical_event_id
    LEFT JOIN standings_summary ss ON ss.team_id=at.team_id AND ss.conference_id=at.conference_id
    ORDER BY at.team_id,COALESCE(ce.scheduled_at,g.scheduled_at),g.id
  `).bind(season,now.toISOString()).all();

  const audit=classifyRecordTruthRows(result.results||[],{now});
  audit.d1={
    rows_read:n(result.meta?.rows_read),
    rows_written:n(result.meta?.rows_written),
    duration_ms:n(result.meta?.duration)
  };
  return audit;
}

export { DEFAULT_SEASON, RESULT_GRACE_HOURS, classifyTeam, effectiveCandidate };