import app from "./standings-worker.js";
import highSchoolInventory from "../data/arkansas-high-school-team-inventory.json" with { type: "json" };
import highSchoolNames from "../data/arkansas-high-school-team-inventory-names.json" with { type: "json" };
import { ARKANSAS_COLLEGE_TEAM_INVENTORY } from "./college-team-inventory.js";
import { isSchoolCatalogVisible, reviewedHighSchoolIdentitySummary } from "./high-school-catalog-identity.js";

const SEASON = "2026";
const RESULT_GRACE_HOURS = 6;
const DEFAULT_SOURCE_STALE_MINUTES = 12 * 60;
const STANDINGS_STALE_MINUTES = 36 * 60;

const HIGH_SCHOOL_TEAM_CODE_MAP = Object.freeze({
  FB:{ sport:"football", gender:"boys", slug:"football" },
  MBB:{ sport:"basketball", gender:"boys", slug:"boys-basketball" },
  WBB:{ sport:"basketball", gender:"girls", slug:"girls-basketball" },
  MSO:{ sport:"soccer", gender:"boys", slug:"boys-soccer" },
  WSO:{ sport:"soccer", gender:"girls", slug:"girls-soccer" },
  WVB:{ sport:"volleyball", gender:"girls", slug:"volleyball" }
});

const AUDIT_CONTRACT = Object.freeze({
  version:"truthful-coverage-v2",
  rule:"Present is not Complete.",
  schedule:"Complete only when a fresh successful enabled source has a nonzero schedule snapshot, that snapshot meets its configured minimum, and D1 contains exactly the same number of rows for that source.",
  results:"Complete only when the schedule is Complete and every past-due record-counting contest is terminal; FINAL contests must have both scores.",
  records:"Complete only when results are Complete and the stored W-L-T exactly matches independently derived effective FINAL scored contests.",
  standings:"Complete only when conference membership is known and locally materialized standings evidence is current and internally consistent. Published-but-not-materialized standings remain Unverified rather than being assumed complete.",
  inventory:"Expected-team coverage uses the certified 295-school AAA/DragonFly varsity inventory plus the Arkansas college supported-team inventory, not the rows that happen to exist in D1."
});

function publicJson(request, body, status = 200) {
  const origin = request.headers.get("origin");
  const allowed = !origin || origin === "https://jamesmethvin74.github.io" || origin.startsWith("http://localhost:")
    ? (origin || "*")
    : "null";
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=300",
      "access-control-allow-origin": allowed,
      "vary": "Origin"
    }
  });
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function number(value) {
  return nullableNumber(value) ?? 0;
}

function parseTimestamp(value) {
  if (!value) return NaN;
  const raw = String(value).trim();
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)
    ? `${raw.replace(" ", "T")}Z`
    : raw;
  return Date.parse(normalized);
}

function ageMinutes(value, now) {
  const timestamp = parseTimestamp(value);
  if (!Number.isFinite(timestamp)) return Infinity;
  return Math.max(0, (now.getTime() - timestamp) / 60000);
}

function isFresh(value, staleMinutes, now) {
  const threshold = Number.isFinite(Number(staleMinutes)) && Number(staleMinutes) > 0
    ? Number(staleMinutes)
    : DEFAULT_SOURCE_STALE_MINUTES;
  return ageMinutes(value, now) <= threshold;
}

function parseRecordText(value) {
  const match = String(value || "").trim().match(/^(\d+)\s*-\s*(\d+)(?:\s*-\s*(\d+))?$/);
  return match ? { wins:Number(match[1]), losses:Number(match[2]), ties:Number(match[3] || 0) } : null;
}

function recordsEqual(a, b) {
  return Boolean(a && b && a.wins === b.wins && a.losses === b.losses && a.ties === b.ties);
}

function addIssue(issues, code, category, detail = null, count = null) {
  issues.push({ code, category, ...(detail ? { detail } : {}), ...(count == null ? {} : { count:Number(count) }) });
}

function aggregateStatus(values = []) {
  if (!values.length) return "Missing";
  if (values.every(value => value === "Complete")) return "Complete";
  if (values.every(value => value === "Missing")) return "Missing";
  if (values.every(value => value === "Unverified")) return "Unverified";
  if (values.some(value => value === "Mismatch")) return "Mismatch";
  return "Partial";
}

export function expectedInventoryTargets() {
  const highSchools = [];
  for (const [externalSchoolId, codes] of Object.entries(highSchoolInventory.certified_school_team_codes || {})) {
    for (const code of Array.isArray(codes) ? codes : []) {
      const mapped = HIGH_SCHOOL_TEAM_CODE_MAP[code];
      if (!mapped) continue;
      highSchools.push({
        level:"high-school",
        external_school_id:String(externalSchoolId).toUpperCase(),
        expected_school_name:highSchoolNames.certified_school_names?.[externalSchoolId] || externalSchoolId,
        team_code:code,
        sport:mapped.sport,
        gender:mapped.gender,
        slug:mapped.slug,
        season:SEASON,
        inventory_authority:"AAA/DragonFly certified varsity inventory"
      });
    }
  }

  const colleges = [];
  for (const school of ARKANSAS_COLLEGE_TEAM_INVENTORY) {
    for (const team of school.teams || []) {
      colleges.push({
        level:"college",
        school_id:school.schoolId,
        expected_school_name:school.schoolName,
        sport:team.sport,
        gender:team.gender,
        season:SEASON,
        inventory_authority:school.verificationStatus === "verified" ? "official college inventory" : "provisional college inventory",
        inventory_verification_status:school.verificationStatus
      });
    }
  }

  return [...highSchools, ...colleges];
}

export function expectedInventorySummary() {
  const targets = expectedInventoryTargets();
  return {
    high_school_schools:Object.keys(highSchoolInventory.certified_school_team_codes || {}).length,
    high_school_teams:targets.filter(target => target.level === "high-school").length,
    college_schools:ARKANSAS_COLLEGE_TEAM_INVENTORY.length,
    college_teams:targets.filter(target => target.level === "college").length,
    total_expected_teams:targets.length,
    season:SEASON
  };
}

function cloneExpectedMissingRow(target, school = null) {
  const schoolId = school?.school_id || target.school_id || `missing:${target.level}:${target.external_school_id || target.expected_school_name}`;
  const expectedTeamId = target.level === "college"
    ? `${target.school_id}-${target.sport}-${target.gender}-${SEASON}`
    : school?.school_id ? `${school.school_id}-${target.slug}-${SEASON}` : `missing:${target.external_school_id}:${target.team_code}`;
  return {
    school_id:schoolId,
    school_name:school?.school_name || target.expected_school_name,
    city:school?.city || "",
    state:school?.state || "AR",
    level:target.level,
    logo_url:school?.logo_url || null,
    dragonfly_school_ids:school?.dragonfly_school_ids || target.external_school_id || null,
    team_id:expectedTeamId,
    sport:target.sport,
    gender:target.gender,
    season:SEASON,
    expected_target:1,
    expected_missing:1,
    expected_school_missing:school ? 0 : 1,
    inventory_authority:target.inventory_authority,
    inventory_verification_status:target.inventory_verification_status || "verified",
    source_count:0,
    game_count:0,
    result_due_count:0,
    resolved_result_count:0,
    unresolved_due_count:0,
    final_missing_score_count:0,
    derived_wins:0,
    derived_losses:0,
    derived_ties:0,
    derived_conference_wins:0,
    derived_conference_losses:0,
    derived_conference_ties:0,
    derived_conference_final_count:0,
    record_exists:0,
    standings_count:0
  };
}

export function reconcileExpectedTargets(rows = []) {
  const targets = expectedInventoryTargets();
  const actualRows = rows.map(row => ({ ...row, expected_target:0 }));
  const schoolsById = new Map();
  const highSchoolByExternalId = new Map();
  const teamByKey = new Map();

  for (const row of actualRows) {
    if (!schoolsById.has(row.school_id)) schoolsById.set(row.school_id, row);
    for (const externalId of String(row.dragonfly_school_ids || "").split("|").map(value => value.trim().toUpperCase()).filter(Boolean)) {
      if (!highSchoolByExternalId.has(externalId)) highSchoolByExternalId.set(externalId, row.school_id);
    }
    if (row.team_id) teamByKey.set(`${row.school_id}|${row.sport}|${row.gender}|${row.season}`, row);
  }

  const synthetic = [];
  for (const target of targets) {
    const schoolId = target.level === "college"
      ? target.school_id
      : highSchoolByExternalId.get(target.external_school_id);
    const school = schoolId ? schoolsById.get(schoolId) : null;
    const key = schoolId ? `${schoolId}|${target.sport}|${target.gender}|${target.season}` : null;
    const actual = key ? teamByKey.get(key) : null;
    if (actual) {
      actual.expected_target = 1;
      actual.inventory_authority = target.inventory_authority;
      actual.inventory_verification_status = target.inventory_verification_status || "verified";
      continue;
    }
    synthetic.push(cloneExpectedMissingRow(target, school));
  }

  return [...actualRows, ...synthetic];
}

function summarizeTeam(row, now) {
  const issues = [];
  const sourceCount = number(row.source_count);
  const gameCount = number(row.game_count);
  const auditSourceGameCount = number(row.audit_source_game_count);
  const snapshotCount = nullableNumber(row.audit_source_snapshot_count);
  const expectedMinGames = number(row.audit_source_expected_min_games);
  const suspiciousGameCount = number(row.audit_source_suspicious_game_count);
  const sourceFailures = number(row.audit_source_consecutive_failures);
  const resultDueCount = number(row.result_due_count);
  const resolvedResultCount = number(row.resolved_result_count);
  const unresolvedDueCount = number(row.unresolved_due_count);
  const finalMissingScoreCount = number(row.final_missing_score_count);
  const recordExists = number(row.record_exists) > 0;
  const standingsCount = number(row.standings_count);
  const standingsMethod = String(row.standings_method || "unavailable");
  const backendTeamPresent = !number(row.expected_missing);

  let scheduleStatus = "Unverified";
  let scheduleBasis = "insufficient_evidence";
  const sourceFresh = isFresh(row.audit_source_last_successful_fetch_at, row.audit_source_stale_after_minutes, now);

  if (!backendTeamPresent) {
    scheduleStatus = "Missing";
    scheduleBasis = "expected_team_missing";
    addIssue(issues, number(row.expected_school_missing) ? "missing_expected_school" : "missing_expected_team", "inventory", "Expected supported team is absent from production D1.");
  } else if (sourceCount === 0 || !row.audit_source_id) {
    scheduleStatus = "Missing";
    scheduleBasis = "enabled_source_missing";
    addIssue(issues, "schedule_source_missing", "schedule", "No enabled schedule source is attached to this supported team.");
  } else if (!row.audit_source_last_successful_fetch_at || snapshotCount == null) {
    scheduleStatus = "Unverified";
    scheduleBasis = "source_never_verified";
    addIssue(issues, "schedule_source_never_succeeded", "schedule", "No successful source snapshot exists, so schedule completeness cannot be asserted.");
  } else if (!sourceFresh) {
    scheduleStatus = "Partial";
    scheduleBasis = "source_snapshot_stale";
    addIssue(issues, "schedule_source_stale", "schedule", `Latest successful source snapshot is older than ${number(row.audit_source_stale_after_minutes) || DEFAULT_SOURCE_STALE_MINUTES} minutes.`);
  } else if (suspiciousGameCount > 0) {
    scheduleStatus = "Partial";
    scheduleBasis = "source_snapshot_suspicious";
    addIssue(issues, "schedule_source_suspicious", "schedule", "Collector marked the latest source snapshot suspicious.", suspiciousGameCount);
  } else if (snapshotCount <= 0) {
    scheduleStatus = "Missing";
    scheduleBasis = "source_snapshot_empty";
    addIssue(issues, "schedule_snapshot_empty", "schedule", "Latest successful source snapshot contained zero games.");
  } else if (snapshotCount < Math.max(1, expectedMinGames)) {
    scheduleStatus = "Partial";
    scheduleBasis = "source_snapshot_below_minimum";
    addIssue(issues, "schedule_snapshot_below_minimum", "schedule", `Source snapshot has ${snapshotCount} games but configured minimum is ${Math.max(1, expectedMinGames)}.`);
  } else if (auditSourceGameCount !== snapshotCount) {
    scheduleStatus = "Partial";
    scheduleBasis = "source_snapshot_storage_mismatch";
    addIssue(issues, "schedule_snapshot_storage_mismatch", "schedule", `Latest source snapshot has ${snapshotCount} games but D1 has ${auditSourceGameCount} rows for that source.`);
  } else {
    scheduleStatus = "Complete";
    scheduleBasis = "fresh_source_snapshot_exact_match";
  }

  if (sourceFailures > 0) {
    addIssue(issues, "source_collection_failures", "source", "Source has consecutive collection failures after its last successful state.", sourceFailures);
  }

  let resultsStatus;
  if (scheduleStatus === "Missing") {
    resultsStatus = "Missing";
  } else if (unresolvedDueCount > 0 || finalMissingScoreCount > 0) {
    resultsStatus = "Partial";
  } else if (scheduleStatus === "Complete") {
    resultsStatus = "Complete";
  } else {
    resultsStatus = "Unverified";
  }
  if (unresolvedDueCount > 0) addIssue(issues, "missing_past_results", "results", "Past-due record-counting contests are not in a terminal state with a usable result.", unresolvedDueCount);
  if (finalMissingScoreCount > 0) addIssue(issues, "final_missing_score", "results", "FINAL contests are missing one or both scores.", finalMissingScoreCount);

  const storedRecord = recordExists ? {
    wins:number(row.record_wins), losses:number(row.record_losses), ties:number(row.record_ties)
  } : null;
  const derivedRecord = {
    wins:number(row.derived_wins), losses:number(row.derived_losses), ties:number(row.derived_ties)
  };
  const recordMismatch = recordExists && !recordsEqual(storedRecord, derivedRecord);
  let recordsStatus;
  if (!recordExists) {
    recordsStatus = "Missing";
    addIssue(issues, "record_missing", "record", "No team_records row exists.");
  } else if (recordMismatch) {
    recordsStatus = "Mismatch";
    addIssue(issues, "record_vs_final_mismatch", "record", `Stored ${storedRecord.wins}-${storedRecord.losses}-${storedRecord.ties}; derived from effective scored FINALs ${derivedRecord.wins}-${derivedRecord.losses}-${derivedRecord.ties}.`);
  } else if (resultsStatus === "Complete") {
    recordsStatus = "Complete";
  } else {
    recordsStatus = "Unverified";
  }

  if (recordExists && row.conference_id && number(row.derived_conference_final_count) > 0) {
    const storedConference = {
      wins:number(row.record_conference_wins), losses:number(row.record_conference_losses), ties:number(row.record_conference_ties)
    };
    const derivedConference = {
      wins:number(row.derived_conference_wins), losses:number(row.derived_conference_losses), ties:number(row.derived_conference_ties)
    };
    if (!recordsEqual(storedConference, derivedConference)) {
      addIssue(issues, "conference_record_vs_final_mismatch", "record", `Stored conference ${storedConference.wins}-${storedConference.losses}-${storedConference.ties}; derived ${derivedConference.wins}-${derivedConference.losses}-${derivedConference.ties}.`);
      recordsStatus = "Mismatch";
    }
  }

  const conferenceStatus = row.conference_id ? "Complete" : "Unverified";
  let standingsStatus = "Unverified";
  if (!row.conference_id) {
    addIssue(issues, "conference_membership_unverified", "standings", "No conference/classification membership is attached to this active team.");
  } else if (standingsMethod === "unavailable") {
    standingsStatus = "Missing";
    addIssue(issues, "standings_unavailable", "standings", "Conference is configured with no standings authority.");
  } else if (standingsMethod === "calculated") {
    if (standingsCount === 0) {
      standingsStatus = "Missing";
      addIssue(issues, "standings_row_missing", "standings", "Calculated standings are configured but this team has no materialized standings row.");
    } else {
      const standingOverall = parseRecordText(row.standing_overall_record);
      const standingConference = parseRecordText(row.standing_conference_record);
      const storedConference = recordExists ? {
        wins:number(row.record_conference_wins), losses:number(row.record_conference_losses), ties:number(row.record_conference_ties)
      } : null;
      if (recordExists && standingOverall && !recordsEqual(standingOverall, storedRecord)) {
        standingsStatus = "Mismatch";
        addIssue(issues, "standings_overall_record_mismatch", "standings", `Standings overall ${row.standing_overall_record} does not match stored record ${storedRecord.wins}-${storedRecord.losses}-${storedRecord.ties}.`);
      } else if (recordExists && standingConference && !recordsEqual(standingConference, storedConference)) {
        standingsStatus = "Mismatch";
        addIssue(issues, "standings_conference_record_mismatch", "standings", `Standings conference ${row.standing_conference_record} does not match stored conference record.`);
      } else if (number(row.conference_coverage_complete) !== 1) {
        standingsStatus = "Partial";
        addIssue(issues, "standings_conference_incomplete", "standings", "Calculated conference is not marked coverage_complete.");
      } else {
        standingsStatus = "Complete";
      }
    }
  } else if (standingsMethod === "published") {
    if (!row.conference_source_url) {
      standingsStatus = "Missing";
      addIssue(issues, "published_standings_source_missing", "standings", "Published standings are configured but no conference source URL is present.");
    } else if (standingsCount === 0) {
      standingsStatus = "Unverified";
      addIssue(issues, "published_standings_not_materialized", "standings", "Published standings are available externally but no current team row is materialized for audit.");
    } else if (ageMinutes(row.standing_calculated_at, now) > STANDINGS_STALE_MINUTES) {
      standingsStatus = "Partial";
      addIssue(issues, "standings_stale", "standings", `Materialized standings are older than ${STANDINGS_STALE_MINUTES} minutes.`);
    } else {
      standingsStatus = "Complete";
    }
  }

  return {
    team_id:row.team_id,
    school_id:row.school_id,
    school_name:row.school_name,
    level:row.level,
    sport:row.sport,
    gender:row.gender,
    season:row.season,
    expected_target:Boolean(number(row.expected_target)),
    backend_team_present:backendTeamPresent,
    inventory_authority:row.inventory_authority || "production-active team",
    inventory_verification_status:row.inventory_verification_status || null,
    conference_id:row.conference_id || null,
    conference_name:row.conference_name || null,
    conference_status:conferenceStatus,
    schedule_status:scheduleStatus,
    schedule_basis:scheduleBasis,
    results_status:resultsStatus,
    records_status:recordsStatus,
    standings_status:standingsStatus,
    source_count:sourceCount,
    audit_source_id:row.audit_source_id || null,
    audit_source_type:row.audit_source_type || null,
    audit_source_authority_rank:nullableNumber(row.audit_source_authority_rank),
    audit_source_last_successful_fetch_at:row.audit_source_last_successful_fetch_at || null,
    audit_source_stale_after_minutes:number(row.audit_source_stale_after_minutes) || DEFAULT_SOURCE_STALE_MINUTES,
    audit_source_snapshot_count:snapshotCount,
    audit_source_game_count:auditSourceGameCount,
    expected_min_games:expectedMinGames,
    game_count:gameCount,
    result_due_count:resultDueCount,
    resolved_result_count:resolvedResultCount,
    unresolved_due_count:unresolvedDueCount,
    final_missing_score_count:finalMissingScoreCount,
    stored_record:storedRecord,
    derived_record:derivedRecord,
    standings_count:standingsCount,
    standing_overall_record:row.standing_overall_record || null,
    standing_conference_record:row.standing_conference_record || null,
    issues
  };
}

export function summarizeCoverageRows(rows = [], { now = new Date() } = {}) {
  const reconciledRows = reconcileExpectedTargets(rows);
  const bySchool = new Map();
  const teams = [];

  for (const row of reconciledRows) {
    if (!bySchool.has(row.school_id)) {
      bySchool.set(row.school_id, {
        school_id:row.school_id,
        school_name:row.school_name,
        city:row.city,
        state:row.state,
        level:row.level,
        backend_present:!number(row.expected_school_missing),
        logo_url:row.logo_url || null,
        logo_status:row.logo_url ? "Complete" : "Missing",
        known_team_count:0,
        expected_team_count:0,
        team_inventory_status:"Unverified",
        conference_status:"Missing",
        schedule_status:"Missing",
        results_status:"Missing",
        records_status:"Missing",
        standings_status:"Missing",
        teams:[]
      });
    }
    if (!row.team_id) continue;
    const team = summarizeTeam(row, now);
    const school = bySchool.get(row.school_id);
    school.teams.push(team);
    teams.push(team);
  }

  const schools = [...bySchool.values()];
  for (const school of schools) {
    school.known_team_count = school.teams.filter(team => team.backend_team_present).length;
    school.expected_team_count = school.teams.filter(team => team.expected_target).length;
    const expectedTeams = school.teams.filter(team => team.expected_target);
    if (!expectedTeams.length) school.team_inventory_status = "Production-only";
    else if (expectedTeams.every(team => team.backend_team_present)) school.team_inventory_status = "Complete";
    else if (expectedTeams.some(team => team.backend_team_present)) school.team_inventory_status = "Partial";
    else school.team_inventory_status = "Missing";
    school.conference_status = aggregateStatus(school.teams.map(team => team.conference_status));
    school.schedule_status = aggregateStatus(school.teams.map(team => team.schedule_status));
    school.results_status = aggregateStatus(school.teams.map(team => team.results_status));
    school.records_status = aggregateStatus(school.teams.map(team => team.records_status));
    school.standings_status = aggregateStatus(school.teams.map(team => team.standings_status));
  }

  const exceptions = teams
    .filter(team => team.issues.length > 0)
    .map(team => ({
      team_id:team.team_id,
      school_id:team.school_id,
      school_name:team.school_name,
      level:team.level,
      sport:team.sport,
      gender:team.gender,
      schedule_status:team.schedule_status,
      results_status:team.results_status,
      records_status:team.records_status,
      standings_status:team.standings_status,
      issues:team.issues
    }));
  const exceptionCounts = {};
  for (const exception of exceptions) {
    for (const issue of exception.issues) exceptionCounts[issue.code] = (exceptionCounts[issue.code] || 0) + 1;
  }

  const statusCount = key => Object.fromEntries(
    ["Complete","Partial","Missing","Mismatch","Unverified"].map(status => [status, teams.filter(team => team[key] === status).length])
  );
  const inventory = expectedInventorySummary();
  const summary = {
    schools:schools.length,
    teams:teams.length,
    expected_team_targets:inventory.total_expected_teams,
    expected_high_school_teams:inventory.high_school_teams,
    expected_college_teams:inventory.college_teams,
    expected_targets_missing:teams.filter(team => team.expected_target && !team.backend_team_present).length,
    high_schools:schools.filter(school => school.level === "high-school").length,
    colleges:schools.filter(school => school.level === "college").length,
    exception_teams:exceptions.length,
    clean_teams:teams.length - exceptions.length,
    exception_counts:exceptionCounts,
    team_status:{
      schedule:statusCount("schedule_status"),
      results:statusCount("results_status"),
      records:statusCount("records_status"),
      standings:statusCount("standings_status")
    }
  };

  return { audit_contract:AUDIT_CONTRACT, inventory, summary, exceptions, schools, teams };
}

async function coverageSnapshot(env) {
  const queryResult = await env.DB.prepare(`
    WITH target_teams AS (
      SELECT t.id AS team_id,t.school_id,t.sport,t.gender,t.season,t.conference_id
      FROM teams t
      JOIN schools sch ON sch.id=t.school_id
      WHERE t.active=1 AND t.season='${SEASON}' AND sch.catalog_scope='local'
    ),
    dragonfly_ids AS (
      SELECT school_id,GROUP_CONCAT(UPPER(external_school_id),'|') AS dragonfly_school_ids
      FROM school_external_identities
      WHERE provider='dragonfly'
      GROUP BY school_id
    ),
    source_counts AS (
      SELECT src.team_id,COUNT(*) AS source_count,MAX(src.last_checked_at) AS last_source_check_at
      FROM sources src
      JOIN target_teams tt ON tt.team_id=src.team_id
      WHERE src.enabled=1
      GROUP BY src.team_id
    ),
    ranked_sources AS (
      SELECT src.*,
        ROW_NUMBER() OVER (
          PARTITION BY src.team_id
          ORDER BY
            CASE WHEN src.last_successful_fetch_at IS NOT NULL AND src.last_game_count IS NOT NULL THEN 0 ELSE 1 END,
            COALESCE(src.authority_rank,100),src.source_priority,src.id
        ) AS audit_source_rank
      FROM sources src
      JOIN target_teams tt ON tt.team_id=src.team_id
      WHERE src.enabled=1
    ),
    audit_sources AS (
      SELECT * FROM ranked_sources WHERE audit_source_rank=1
    ),
    game_evidence AS (
      SELECT
        g.team_id,g.source_id,g.id AS game_id,COALESCE(g.canonical_event_id,g.id) AS evidence_event_id,
        g.counts_for_record,g.conference_game,g.last_checked_at,
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
        COALESCE(src.authority_rank,100) AS authority_rank,src.source_priority,
        aus.id AS audit_source_id
      FROM games g
      JOIN target_teams tt ON tt.team_id=g.team_id
      JOIN sources src ON src.id=g.source_id AND src.enabled=1
      LEFT JOIN audit_sources aus ON aus.team_id=g.team_id
      LEFT JOIN canonical_events ce ON ce.id=g.canonical_event_id
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
        SUM(CASE WHEN authority_row=1 AND counts_for_record=1 AND conference_game=1 AND effective_status='FINAL' AND effective_team_score IS NOT NULL AND effective_opponent_score IS NOT NULL AND effective_team_score>effective_opponent_score THEN 1 ELSE 0 END) AS derived_conference_wins,
        SUM(CASE WHEN authority_row=1 AND counts_for_record=1 AND conference_game=1 AND effective_status='FINAL' AND effective_team_score IS NOT NULL AND effective_opponent_score IS NOT NULL AND effective_team_score<effective_opponent_score THEN 1 ELSE 0 END) AS derived_conference_losses,
        SUM(CASE WHEN authority_row=1 AND counts_for_record=1 AND conference_game=1 AND effective_status='FINAL' AND effective_team_score IS NOT NULL AND effective_opponent_score IS NOT NULL AND effective_team_score=effective_opponent_score THEN 1 ELSE 0 END) AS derived_conference_ties,
        SUM(CASE WHEN authority_row=1 AND counts_for_record=1 AND conference_game=1 AND effective_status='FINAL' AND effective_team_score IS NOT NULL AND effective_opponent_score IS NOT NULL THEN 1 ELSE 0 END) AS derived_conference_final_count,
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
      tt.team_id,tt.sport,tt.gender,tt.season,tt.conference_id,
      c.name AS conference_name,c.standings_method,c.coverage_complete AS conference_coverage_complete,c.source_url AS conference_source_url,
      COALESCE(src.source_count,0) AS source_count,src.last_source_check_at,
      aus.id AS audit_source_id,aus.source_type AS audit_source_type,aus.authority_rank AS audit_source_authority_rank,
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
  const report = summarizeCoverageRows(visibleResults, { now:new Date() });
  return {
    generated_at:new Date().toISOString(),
    inventory_note:"Expected-team denominator is independent of D1 team presence: certified AAA/DragonFly varsity targets plus the supported Arkansas college inventory. Schedule completion is source-snapshot-backed; unknown evidence is reported as Unverified, never promoted to Complete.",
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
        const report = await coverageSnapshot(env);
        return publicJson(request, url.searchParams.get("view") === "exceptions" ? exceptionView(report) : report);
      } catch (error) {
        console.error("coverage report failed", error);
        return publicJson(request, { error:"coverage_report_failed", message:String(error?.message || error) }, 500);
      }
    }
    return app.fetch(request, env, ctx);
  },
  async scheduled(controller, env, ctx) {
    return app.scheduled(controller, env, ctx);
  }
};

export { AUDIT_CONTRACT, coverageSnapshot };
