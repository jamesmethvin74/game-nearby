import test from "node:test";
import assert from "node:assert/strict";
import { summarizeCoverageRows } from "../src/coverage-report-worker.js";

test("coverage snapshot exposes exact team-level deficiencies without fanout", () => {
  const rows = [
    {
      school_id:"alpha",school_name:"Alpha High",city:"Alpha",state:"AR",level:"high-school",logo_url:"https://example.test/logo.png",
      team_id:"alpha-football",sport:"football",gender:"boys",season:"2026",conference_id:"5a-west",conference_name:"5A West",standings_method:"published",
      source_count:1,game_count:9,result_due_count:2,resolved_result_count:2,record_exists:1,standings_count:0
    },
    {
      school_id:"alpha",school_name:"Alpha High",city:"Alpha",state:"AR",level:"high-school",logo_url:"https://example.test/logo.png",
      team_id:"alpha-volleyball",sport:"volleyball",gender:"girls",season:"2026",conference_id:null,conference_name:null,standings_method:"unavailable",
      source_count:0,game_count:0,result_due_count:0,resolved_result_count:0,record_exists:0,standings_count:0
    }
  ];

  const report = summarizeCoverageRows(rows);
  assert.equal(report.summary.schools, 1);
  assert.equal(report.summary.teams, 2);
  assert.equal(report.schools[0].known_team_count, 2);
  assert.equal(report.schools[0].team_inventory_status, "Needs discovery");
  assert.equal(report.schools[0].logo_status, "Complete");
  assert.equal(report.schools[0].conference_status, "Partial");
  assert.equal(report.schools[0].schedule_status, "Partial");
  assert.equal(report.schools[0].results_status, "Partial");
  assert.equal(report.teams[0].schedule_status, "Complete");
  assert.equal(report.teams[0].results_status, "Complete");
  assert.equal(report.teams[1].schedule_status, "Missing");
  assert.equal(report.teams[1].conference_status, "Missing");
});
