import test from "node:test";
import assert from "node:assert/strict";
import {
  AUDIT_CONTRACT,
  expectedInventorySummary,
  summarizeCoverageRows
} from "../src/coverage-report-worker.js";

const NOW = new Date("2026-09-12T02:00:00.000Z");

function baseRow(overrides = {}) {
  return {
    school_id:"alpha",school_name:"Alpha High",city:"Alpha",state:"AR",level:"high-school",logo_url:"https://example.test/logo.png",
    dragonfly_school_ids:"QRVX97",
    team_id:"alpha-basketball-boys-2026",sport:"basketball",gender:"boys",season:"2026",
    conference_id:"5a-west",conference_name:"5A West",standings_method:"calculated",conference_coverage_complete:1,conference_source_url:"https://example.test/standings",
    source_count:1,audit_source_id:"alpha-official",audit_source_type:"official-conference",audit_source_authority_rank:10,
    audit_source_expected_min_games:8,audit_source_snapshot_count:10,audit_source_game_count:10,
    audit_source_stale_after_minutes:720,audit_source_suspicious_game_count:0,audit_source_consecutive_failures:0,
    audit_source_last_successful_fetch_at:"2026-09-12T01:30:00.000Z",
    game_count:10,result_due_count:2,resolved_result_count:2,unresolved_due_count:0,final_missing_score_count:0,
    derived_wins:2,derived_losses:0,derived_ties:0,derived_conference_wins:1,derived_conference_losses:0,derived_conference_ties:0,derived_conference_final_count:1,
    record_exists:1,record_wins:2,record_losses:0,record_ties:0,record_conference_wins:1,record_conference_losses:0,record_conference_ties:0,
    standings_count:1,standing_calculated_at:"2026-09-12T01:45:00.000Z",standing_overall_record:"2-0",standing_conference_record:"1-0",
    ...overrides
  };
}

test("coverage contract never equates presence with completeness", () => {
  assert.equal(AUDIT_CONTRACT.rule, "Present is not Complete.");
  const report = summarizeCoverageRows([
    baseRow({ audit_source_snapshot_count:10, audit_source_game_count:1, game_count:1 })
  ], { now:NOW });
  const team = report.teams.find(item => item.team_id === "alpha-basketball-boys-2026");
  assert.equal(team.schedule_status, "Partial");
  assert.equal(team.schedule_basis, "source_snapshot_storage_mismatch");
  assert.ok(team.issues.some(issue => issue.code === "schedule_snapshot_storage_mismatch"));
});

test("fresh exact source snapshot can prove schedule/results/record complete", () => {
  const report = summarizeCoverageRows([baseRow()], { now:NOW });
  const team = report.teams.find(item => item.team_id === "alpha-basketball-boys-2026");
  assert.equal(team.schedule_status, "Complete");
  assert.equal(team.results_status, "Complete");
  assert.equal(team.records_status, "Complete");
  assert.equal(team.standings_status, "Complete");
});

test("a record row is a mismatch when stored W-L-T disagrees with effective finals", () => {
  const report = summarizeCoverageRows([baseRow({ record_wins:3 })], { now:NOW });
  const team = report.teams.find(item => item.team_id === "alpha-basketball-boys-2026");
  assert.equal(team.records_status, "Mismatch");
  assert.ok(team.issues.some(issue => issue.code === "record_vs_final_mismatch"));
});

test("past-due unresolved games block result completion", () => {
  const report = summarizeCoverageRows([baseRow({ result_due_count:3,resolved_result_count:2,unresolved_due_count:1 })], { now:NOW });
  const team = report.teams.find(item => item.team_id === "alpha-basketball-boys-2026");
  assert.equal(team.results_status, "Partial");
  assert.ok(team.issues.some(issue => issue.code === "missing_past_results" && issue.count === 1));
});

test("calculated standings configuration does not hide a missing standings row", () => {
  const report = summarizeCoverageRows([baseRow({ standings_count:0,standing_calculated_at:null,standing_overall_record:null,standing_conference_record:null })], { now:NOW });
  const team = report.teams.find(item => item.team_id === "alpha-basketball-boys-2026");
  assert.equal(team.standings_status, "Missing");
  assert.ok(team.issues.some(issue => issue.code === "standings_row_missing"));
});

test("expected inventory is independent of current D1 team rows", () => {
  const inventory = expectedInventorySummary();
  assert.equal(inventory.high_school_schools, 295);
  assert.equal(inventory.high_school_teams, 1102);
  assert.equal(inventory.college_teams, 130);
  assert.equal(inventory.total_expected_teams, 1232);

  const report = summarizeCoverageRows([], { now:NOW });
  assert.equal(report.summary.expected_team_targets, 1232);
  assert.equal(report.summary.expected_targets_missing, 1232);
  assert.equal(report.exceptions.length, 1232);
  assert.ok(report.exceptions.every(item => item.issues.some(issue => issue.code === "missing_expected_school" || issue.code === "missing_expected_team")));
});
