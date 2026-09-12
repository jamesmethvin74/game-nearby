import app, { summarizeCoverageRows } from "./coverage-report-worker.js";
import { isSchoolCatalogVisible, reviewedHighSchoolIdentitySummary } from "./high-school-catalog-identity.js";
import { blockedPrestoAuthorityTargets, pendingPrestoFallbackTargets } from "./college-source-resolution.js";

const SEASON = "2026";
const RESULT_GRACE_HOURS = 6;

const AUDIT_CONTRACT_V4 = Object.freeze({
  version:"truthful-coverage-v4",
  rule:"Present is not Complete.",
  schedule:"Complete only when a fresh successful authoritative/materialized source has a nonzero schedule snapshot, that snapshot meets its configured minimum, and D1 contains exactly the same number of rows for that source. A retained statewide source may remain valid evidence even when disabled for ordinary per-source collection.",
  results:"Complete only when the schedule is Complete and every past-due record-counting contest is terminal; FINAL contests must have both scores.",
  records:"Complete or Mismatch only when result evidence is Complete. Otherwise a stored-versus-visible-final disagreement is Unverified, never asserted as a bad record.",
  standings:"Calculated standings are Complete only when their underlying audited record is Complete and the materialized standing is current and internally consistent. Published-but-not-materialized standings remain Unverified.",
  inventory:"Expected-team coverage uses the certified 295-school AAA/DragonFly varsity inventory plus the Arkansas college supported-team inventory, not the rows that happen to exist in D1. A present-but-inactive expected team is reported as Inactive, never as Missing.",
  retained_source_rule:"Source enabled/disabled state controls collection cadence, not whether already-materialized schedule evidence exists. The audit and school read path therefore retain materialized rows from disabled statewide sources.",
  inactive_team_rule:"College team rows deliberately materialized inactive while their authority/source is unresolved remain visible to the audit. They are classified as pending, blocked, or unclassified source-resolution exceptions instead of being synthesized as missing teams."
});

const targetKey = row => `${row.schoolId || row.school_id}|${row.sport}|${row.gender}|${row.season || SEASON}`;
const PENDING_COLLEGE_TARGETS = new Set(pendingPrestoFallbackTargets(SEASON).map(targetKey));
const BLOCKED_COLLEGE_TARGETS = new Set(blockedPrestoAuthorityTargets(SEASON).map(targetKey));

function publicJson(request, body, status = 200) {
  const origin = request.headers.get("origin");
  const allowed = !origin || origin === "https://jamesmethvin74.github.io" || origin.startsWith("http://localhost:")
    ? (origin || "*")
    : "null";
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type":"application/json; charset=utf-8",
      "cache-control":"public, max-age=300",
      "access-control-allow-origin":allowed,
      "vary":"Origin"
    }
  });
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function aggregateStatus(values = []) {
  if (!values.length) return "Missing";
  if (values.every(value => value === "Complete")) return "Complete";
  if (values.every(value => value === "Missing")) return "Missing";
  if (values.every(value => value === "Unverified")) return "Unverified";
  if (values.some(value => value === "Mismatch")) return "Mismatch";
  return "Partial";
}

function replaceIssue(team, oldCode, nextIssue = null) {
  team.issues = (team.issues || []).filter(issue => issue.code !== oldCode);
  if (nextIssue) team.issues.push(nextIssue);
}

function hasIssue(team, code) {
  return (team.issues || []).some(issue => issue.code === code);
}

function addIssueOnce(team, issue) {
  if (!hasIssue(team, issue.code)) team.issues.push(issue);
}

function collegeSourceResolution(row) {
  if (!row || row.level !== "college" || number(row.team_active) !== 0) return null;
  const key = targetKey(row);
  if (PENDING_COLLEGE_TARGETS.has(key)) return "pending";
  if (BLOCKED_COLLEGE_TARGETS.has(key)) return "blocked";
  return "unclassified";
}

function hardenTeam(team, row) {
  if (!team || !row) return team;

  // V2's text referred to enabled sources. V3+ counts all retained schedule sources;
  // enabled is a cadence control, not a materialization-validity predicate.
  if (team.schedule_basis === "enabled_source_missing") {
    team.schedule_basis = "schedule_source_missing";
    replaceIssue(team, "schedule_source_missing", {
      code:"schedule_source_missing",
      category:"schedule",
      detail:"No materialized schedule source is attached to this supported team."
    });
  }

  team.backend_team_active = row.team_active == null ? true : Boolean(number(row.team_active));
  team.audit_source_enabled = row.audit_source_enabled == null ? null : Boolean(number(row.audit_source_enabled));
  team.audit_source_collection_mode = row.audit_source_collection_mode || null;
  team.enabled_source_count = number(row.enabled_source_count);

  if (team.expected_target && team.backend_team_present && !team.backend_team_active) {
    const resolution = collegeSourceResolution(row);
    team.source_resolution = resolution;
    addIssueOnce(team, {
      code:"expected_team_inactive",
      category:"inventory",
      detail:"Expected supported team exists in production D1 but is inactive; it is not a missing team."
    });
    if (resolution === "pending") {
      addIssueOnce(team, {
        code:"college_source_pending",
        category:"source",
        detail:"Official/fallback authority is known, but the current target-season feed has not produced a certifiable schedule yet."
      });
    } else if (resolution === "blocked") {
      addIssueOnce(team, {
        code:"college_source_blocked",
        category:"source",
        detail:"The supported college team is materialized, but no server-fetchable certified production source is currently available."
      });
    } else {
      addIssueOnce(team, {
        code:"inactive_team_source_unclassified",
        category:"source",
        detail:"Expected team is inactive but does not match the reviewed pending/blocked college source-resolution inventory."
      });
    }
  }

  const visibleRecordDisagreement = team.records_status === "Mismatch";
  if (visibleRecordDisagreement && team.results_status !== "Complete") {
    team.records_status = "Unverified";
    replaceIssue(team, "record_vs_final_mismatch", {
      code:"record_visible_final_disagreement",
      category:"record",
      detail:`Stored record ${team.stored_record?.wins ?? 0}-${team.stored_record?.losses ?? 0}-${team.stored_record?.ties ?? 0} differs from currently auditable scored FINALs ${team.derived_record?.wins ?? 0}-${team.derived_record?.losses ?? 0}-${team.derived_record?.ties ?? 0}, but schedule/result evidence is not Complete, so this is not asserted as a bad record.`
    });
    replaceIssue(team, "conference_record_vs_final_mismatch", {
      code:"conference_record_needs_verification",
      category:"record",
      detail:"Stored conference record disagrees with currently auditable conference FINALs, but result evidence is not Complete."
    });
  }

  const standingsMethod = String(row.standings_method || "unavailable");
  if (standingsMethod === "calculated" && team.standings_status === "Complete" && team.records_status !== "Complete") {
    team.standings_status = "Unverified";
    addIssueOnce(team, {
      code:"standings_depends_on_unverified_record",
      category:"standings",
      detail:"Calculated standings agree with the stored row, but the underlying record is not independently Complete."
    });
  } else if (standingsMethod === "published" && team.standings_status === "Complete") {
    team.standings_status = "Unverified";
    addIssueOnce(team, {
      code:"published_standings_not_authority_reconciled",
      category:"standings",
      detail:"A materialized published standing exists, but this audit does not have an independent current authority snapshot to certify it Complete."
    });
  }

  return team;
}

function rebuildReport(report, sourceRows) {
  const rowByTeam = new Map(sourceRows.filter(row => row.team_id).map(row => [row.team_id, row]));
  const teamById = new Map();

  for (const team of report.teams || []) {
    hardenTeam(team, rowByTeam.get(team.team_id));
    teamById.set(team.team_id, team);
  }

  for (const school of report.schools || []) {
    school.teams = (school.teams || []).map(team => teamById.get(team.team_id) || team);
    school.conference_status = aggregateStatus(school.teams.map(team => team.conference_status));
    school.schedule_status = aggregateStatus(school.teams.map(team => team.schedule_status));
    school.results_status = aggregateStatus(school.teams.map(team => team.results_status));
    school.records_status = aggregateStatus(school.teams.map(team => team.records_status));
    school.standings_status = aggregateStatus(school.teams.map(team => team.standings_status));
  }

  const exceptions = (report.teams || [])
    .filter(team => (team.issues || []).length > 0)
    .map(team => ({
      team_id:team.team_id,
      school_id:team.school_id,
      school_name:team.school_name,
      level:team.level,
      sport:team.sport,
      gender:team.gender,
      backend_team_present:team.backend_team_present,
      backend_team_active:team.backend_team_active,
      source_resolution:team.source_resolution || null,
      schedule_status:team.schedule_status,
      results_status:team.results_status,
      records_status:team.records_status,
      standings_status:team.standings_status,
      evidence:{
        audit_source_id:team.audit_source_id,
        audit_source_type:team.audit_source_type,
        audit_source_enabled:team.audit_source_enabled,
        audit_source_collection_mode:team.audit_source_collection_mode,
        audit_source_snapshot_count:team.audit_source_snapshot_count,
        audit_source_game_count:team.audit_source_game_count,
        game_count:team.game_count,
        result_due_count:team.result_due_count,
        resolved_result_count:team.resolved_result_count,
        unresolved_due_count:team.unresolved_due_count,
        final_missing_score_count:team.final_missing_score_count,
        stored_record:team.stored_record,
        derived_record:team.derived_record
      },
      issues:team.issues
    }));

  const exceptionCounts = {};
  for (const exception of exceptions) {
    for (const issue of exception.issues) exceptionCounts[issue.code] = (exceptionCounts[issue.code] || 0) + 1;
  }
  const statusCount = key => Object.fromEntries(
    ["Complete","Partial","Missing","Mismatch","Unverified"].map(status => [status, (report.teams || []).filter(team => team[key] === status).length])
  );

  report.audit_contract = AUDIT_CONTRACT_V4;
  report.exceptions = exceptions;
  report.summary = {
    ...report.summary,
    expected_targets_missing:(report.teams || []).filter(team => team.expected_target && !team.backend_team_present).length,
    expected_targets_inactive:(report.teams || []).filter(team => team.expected_target && team.backend_team_present && team.backend_team_active === false).length,
    college_source_pending:(report.teams || []).filter(team => team.expected_target && team.source_resolution === "pending").length,
    college_source_blocked:(report.teams || []).filter(team => team.expected_target && team.source_resolution === "blocked").length,
    inactive_source_unclassified:(report.teams || []).filter(team => team.expected_target && team.source_resolution === "unclassified").length,
    exception_teams:exceptions.length,
    clean_teams:(report.teams || []).length - exceptions.length,
    exception_counts:exceptionCounts,
    team_status:{
      schedule:statusCount("schedule_status"),
      results:statusCount("results_status"),
      records:statusCount("records_status"),
      standings:statusCount("standings_status")
    }
  };
  return report;
}

async function coverageSnapshotV4(env) {
  const queryResult = await env.DB.prepare(`
    WITH target_teams AS (
      SELECT t.id AS team_id,t.school_id,t.sport,t.gender,t.season,t.conference_id,t.active AS team_active
      FROM teams t
      JOIN schools sch ON sch.id=t.school_id
      WHERE t.season='${SEASON}' AND sch.catalog_scope='local'
        AND (t.active=1 OR sch.level='college')
    ),
    dragonfly_ids AS (
      SELECT school_id,GROUP_CONCAT(UPPER(external_school_id),'|') AS dragonfly_school_ids
      FROM school_external_identities
      WHERE provider='dragonfly'
      GROUP BY school_id
    ),
    source_counts AS (
      SELECT src.team_id,
        COUNT(*) AS source_count,
        SUM(CASE WHEN src.enabled=1 THEN 1 ELSE 0 END) AS enabled_source_count,
        MAX(src.last_checked_at) AS last_source_check_at
      FROM sources src
      JOIN target_teams tt ON tt.team_id=src.team_id
      GROUP BY src.team_id
    ),
    ranked_sources AS (
      SELECT src.*,
        ROW_NUMBER() OVER (
          PARTITION BY src.team_id
          ORDER BY
            CASE WHEN src.last_successful_fetch_at IS NOT NULL AND src.last_game_count IS NOT NULL THEN 0 ELSE 1 END,
            COALESCE(src.authority_rank,100),
            CASE WHEN src.collection_mode='statewide' THEN 0 ELSE 1 END,
            CASE WHEN src.enabled=1 THEN 0 ELSE 1 END,
            src.source_priority,src.id
        ) AS audit_source_rank
      FROM sources src
      JOIN target_teams tt ON tt.team_id=src.team_id
    ),
    audit_sources AS (
      SELECT * FROM ranked_sources WHERE audit_source_rank=1
    ),
    game_evidence AS (
      SELECT
        g.team_id,g.source_id,g.id AS game_id,g.canonical_event_id,
        COALESCE(g.canonical_event_id,g.id) AS evidence_event_id,
        g.counts_for_record,g.last_checked_at,
        COALESCE(ce.scheduled_at,g.scheduled_at) AS effective_scheduled_at,
        COALESCE(ce.status,g.status) AS effective_status,
        CASE
          WHEN ce.id IS NULL THEN g.team_score
          WHEN ce.home_school_id=tt.school_id THEN ce.home_score
          WHEN ce.away_school_id=tt.school_id THEN ce.away_score
          ELSE g.team_score
        END AS effective_team_score,
        CASE
          WHEN ce.id IS NULL THEN g.opponent_score
          WHEN ce.home_school_id=tt.school_id THEN ce.away_score
          WHEN ce.away_school_id=tt.school_id THEN ce.home_score
          ELSE g.opponent_score
        END AS effective_opponent_score,
        CASE
          WHEN COALESCE(ce.conference_game,g.conference_game)=1 THEN 1
          WHEN tt.conference_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM teams ot
            WHERE ot.active=1
              AND ot.school_id=CASE
                WHEN ce.id IS NOT NULL AND ce.home_school_id=tt.school_id THEN ce.away_school_id
                WHEN ce.id IS NOT NULL AND ce.away_school_id=tt.school_id THEN ce.home_school_id
                ELSE g.opponent_school_id
              END
              AND ot.sport=tt.sport AND ot.gender=tt.gender AND ot.season=tt.season
              AND ot.conference_id=tt.conference_id
          ) THEN 1
          ELSE 0
        END AS effective_conference_game,
        COALESCE(src.authority_rank,100) AS authority_rank,src.source_priority,
        aus.id AS audit_source_id
      FROM games g
      JOIN target_teams tt ON tt.team_id=g.team_id
      JOIN sources src ON src.id=g.source_id
      LEFT JOIN audit_sources aus ON aus.team_id=g.team_id
      LEFT JOIN canonical_events ce ON ce.id=g.canonical_event_id
      WHERE g.canonical_event_id IS NOT NULL OR g.source_id=aus.id
    ),
    ranked_games AS (
      SELECT ge.*,
        ROW_NUMBER() OVER (
          PARTITION BY ge.team_id,ge.evidence_event_id
          ORDER BY ge.authority_rank,ge.source_priority,ge.source_id,ge.game_id
        ) AS authority_row
      FROM game_evidence ge
    ),
    game_counts AS (
      SELECT team_id,
        SUM(CASE WHEN source_id=audit_source_id THEN 1 ELSE 0 END) AS audit_source_game_count,
        SUM(CASE WHEN authority_row=1 THEN 1 ELSE 0 END) AS game_count,
        SUM(CASE WHEN authority_row=1 AND counts_for_record=1 AND datetime(effective_scheduled_at) < datetime('now','-${RESULT_GRACE_HOURS} hours') THEN 1 ELSE 0 END) AS result_due_count,
        SUM(CASE WHEN authority_row=1 AND counts_for_record=1 AND datetime(effective_scheduled_at) < datetime('now','-${RESULT_GRACE_HOURS} hours') AND (
          effective_status IN ('CANCELED','POSTPONED') OR (effective_status='FINAL' AND effective_team_score IS NOT NULL AND effective_opponent_score IS NOT NULL)
        ) THEN 1 ELSE 0 END) AS resolved_result_count,
        SUM(CASE WHEN authority_row=1 AND counts_for_record=1 AND datetime(effective_scheduled_at) < datetime('now','-${RESULT_GRACE_HOURS} hours') AND NOT (
          effective_status IN ('CANCELED','POSTPONED') OR (effective_status='FINAL' AND effective_team_score IS NOT NULL AND effective_opponent_score IS NOT NULL)
        ) THEN 1 ELSE 0 END) AS unresolved_due_count,
        SUM(CASE WHEN authority_row=1 AND effective_status='FINAL' AND (effective_team_score IS NULL OR effective_opponent_score IS NULL) THEN 1 ELSE 0 END) AS final_missing_score_count,
        SUM(CASE WHEN authority_row=1 AND counts_for_record=1 AND effective_status='FINAL' AND effective_team_score IS NOT NULL AND effective_opponent_score IS NOT NULL AND effective_team_score>effective_opponent_score THEN 1 ELSE 0 END) AS derived_wins,
        SUM(CASE WHEN authority_row=1 AND counts_for_record=1 AND effective_status='FINAL' AND effective_team_score IS NOT NULL AND effective_opponent_score IS NOT NULL AND effective_team_score<effective_opponent_score THEN 1 ELSE 0 END) AS derived_losses,
        SUM(CASE WHEN authority_row=1 AND counts_for_record=1 AND effective_status='FINAL' AND effective_team_score IS NOT NULL AND effective_opponent_score IS NOT NULL AND effective_team_score=effective_opponent_score THEN 1 ELSE 0 END) AS derived_ties,
        SUM(CASE WHEN authority_row=1 AND counts_for_record=1 AND effective_conference_game=1 AND effective_status='FINAL' AND effective_team_score IS NOT NULL AND effective_opponent_score IS NOT NULL AND effective_team_score>effective_opponent_score THEN 1 ELSE 0 END) AS derived_conference_wins,
        SUM(CASE WHEN authority_row=1 AND counts_for_record=1 AND effective_conference_game=1 AND effective_status='FINAL' AND effective_team_score IS NOT NULL AND effective_opponent_score IS NOT NULL AND effective_team_score<effective_opponent_score THEN 1 ELSE 0 END) AS derived_conference_losses,
        SUM(CASE WHEN authority_row=1 AND counts_for_record=1 AND effective_conference_game=1 AND effective_status='FINAL' AND effective_team_score IS NOT NULL AND effective_opponent_score IS NOT NULL AND effective_team_score=effective_opponent_score THEN 1 ELSE 0 END) AS derived_conference_ties,
        SUM(CASE WHEN authority_row=1 AND counts_for_record=1 AND effective_conference_game=1 AND effective_status='FINAL' AND effective_team_score IS NOT NULL AND effective_opponent_score IS NOT NULL THEN 1 ELSE 0 END) AS derived_conference_final_count,
        MAX(last_checked_at) AS last_game_check_at
      FROM ranked_games
      GROUP BY team_id
    ),
    standing_counts AS (
      SELECT team_id,COUNT(*) AS standings_count,MAX(calculated_at) AS standing_calculated_at,
        MAX(overall_record) AS standing_overall_record,MAX(conference_record) AS standing_conference_record
      FROM standings
      GROUP BY team_id
    )
    SELECT
      sch.id AS school_id,
      COALESCE(NULLIF(sch.location_matched_name,''),sch.name) AS school_name,
      sch.city,sch.state,sch.level,
      COALESCE(NULLIF(brand.logo_url,''),NULLIF(sch.logo_url,'')) AS logo_url,
      df.dragonfly_school_ids,
      tt.team_id,tt.sport,tt.gender,tt.season,tt.conference_id,tt.team_active,
      c.name AS conference_name,c.standings_method,c.coverage_complete AS conference_coverage_complete,c.source_url AS conference_source_url,
      COALESCE(src.source_count,0) AS source_count,COALESCE(src.enabled_source_count,0) AS enabled_source_count,src.last_source_check_at,
      aus.id AS audit_source_id,aus.source_type AS audit_source_type,aus.authority_rank AS audit_source_authority_rank,
      aus.collection_mode AS audit_source_collection_mode,aus.enabled AS audit_source_enabled,
      aus.expected_min_games AS audit_source_expected_min_games,aus.last_game_count AS audit_source_snapshot_count,
      aus.stale_after_minutes AS audit_source_stale_after_minutes,aus.suspicious_game_count AS audit_source_suspicious_game_count,
      aus.consecutive_failures AS audit_source_consecutive_failures,aus.last_successful_fetch_at AS audit_source_last_successful_fetch_at,
      COALESCE(g.audit_source_game_count,0) AS audit_source_game_count,COALESCE(g.game_count,0) AS game_count,
      COALESCE(g.result_due_count,0) AS result_due_count,COALESCE(g.resolved_result_count,0) AS resolved_result_count,
      COALESCE(g.unresolved_due_count,0) AS unresolved_due_count,COALESCE(g.final_missing_score_count,0) AS final_missing_score_count,
      COALESCE(g.derived_wins,0) AS derived_wins,COALESCE(g.derived_losses,0) AS derived_losses,COALESCE(g.derived_ties,0) AS derived_ties,
      COALESCE(g.derived_conference_wins,0) AS derived_conference_wins,COALESCE(g.derived_conference_losses,0) AS derived_conference_losses,
      COALESCE(g.derived_conference_ties,0) AS derived_conference_ties,COALESCE(g.derived_conference_final_count,0) AS derived_conference_final_count,
      g.last_game_check_at,
      CASE WHEN r.team_id IS NULL THEN 0 ELSE 1 END AS record_exists,
      r.wins AS record_wins,r.losses AS record_losses,r.ties AS record_ties,
      r.conference_wins AS record_conference_wins,r.conference_losses AS record_conference_losses,r.conference_ties AS record_conference_ties,
      COALESCE(st.standings_count,0) AS standings_count,st.standing_calculated_at,st.standing_overall_record,st.standing_conference_record
    FROM schools sch
    LEFT JOIN school_brand_assets brand ON brand.school_id=sch.id AND brand.status IN ('matched','curated')
    LEFT JOIN dragonfly_ids df ON df.school_id=sch.id
    LEFT JOIN target_teams tt ON tt.school_id=sch.id
    LEFT JOIN conferences c ON c.id=tt.conference_id
    LEFT JOIN source_counts src ON src.team_id=tt.team_id
    LEFT JOIN audit_sources aus ON aus.team_id=tt.team_id
    LEFT JOIN game_counts g ON g.team_id=tt.team_id
    LEFT JOIN team_records r ON r.team_id=tt.team_id
    LEFT JOIN standing_counts st ON st.team_id=tt.team_id
    WHERE sch.catalog_scope='local'
    ORDER BY sch.level,school_name,tt.sport,tt.gender,tt.team_id
  `).all();

  const visibleResults = (queryResult.results || []).filter(row => isSchoolCatalogVisible({
    id:row.school_id,
    name:row.school_name,
    level:row.level
  }));
  const report = rebuildReport(summarizeCoverageRows(visibleResults, { now:new Date() }), visibleResults);
  return {
    generated_at:new Date().toISOString(),
    inventory_note:"Expected-team denominator is independent of D1 team presence. Present-but-inactive supported college teams are audited as inactive source-resolution exceptions, not synthesized as missing. Schedule/result evidence includes retained statewide materializations even when their per-source collection row is disabled; unknown evidence is Unverified, never promoted to Complete.",
    catalog_identity:reviewedHighSchoolIdentitySummary(),
    d1:{
      rows_read:number(queryResult.meta?.rows_read),
      rows_written:number(queryResult.meta?.rows_written),
      duration_ms:nullableNumber(queryResult.meta?.duration)
    },
    ...report
  };
}

function exceptionView(report) {
  return {
    generated_at:report.generated_at,
    audit_contract:report.audit_contract,
    inventory_note:report.inventory_note,
    inventory:report.inventory,
    catalog_identity:report.catalog_identity,
    d1:report.d1,
    summary:report.summary,
    exceptions:report.exceptions
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/api/v1/coverage-report") {
      try {
        const report = await coverageSnapshotV4(env);
        return publicJson(request, url.searchParams.get("view") === "exceptions" ? exceptionView(report) : report);
      } catch (error) {
        console.error("coverage report v4 failed", error);
        return publicJson(request, { error:"coverage_report_failed", message:String(error?.message || error) }, 500);
      }
    }
    return app.fetch(request, env, ctx);
  },
  async scheduled(controller, env, ctx) {
    return app.scheduled(controller, env, ctx);
  }
};

export { AUDIT_CONTRACT_V4, coverageSnapshotV4, rebuildReport, hardenTeam, collegeSourceResolution };
