import test from "node:test";
import assert from "node:assert/strict";
import highSchoolInventory from "../data/arkansas-high-school-team-inventory.json" with { type:"json" };
import { scopeCoverageReport } from "../src/coverage-report-worker-v5.js";

function team(overrides = {}) {
  return {
    team_id:"expected-1",school_id:"school-1",school_name:"Expected High",level:"high-school",sport:"football",gender:"boys",
    expected_target:true,backend_team_present:true,backend_team_active:true,
    conference_status:"Unverified",schedule_status:"Complete",results_status:"Complete",records_status:"Complete",standings_status:"Unverified",
    issues:[{code:"conference_membership_unverified",category:"standings"}],
    ...overrides
  };
}

function report(teams) {
  const schools = [...new Set(teams.map(item => item.school_id))].map(schoolId => ({
    school_id:schoolId,
    teams:teams.filter(item => item.school_id === schoolId).map(item => ({...item})),
    conference_status:"Missing",schedule_status:"Missing",results_status:"Missing",records_status:"Missing",standings_status:"Missing"
  }));
  return {
    audit_contract:{version:"truthful-coverage-v4",rule:"Present is not Complete."},
    inventory:{total_expected_teams:1},
    summary:{expected_team_targets:1},
    teams:teams.map(item => ({...item,issues:[...(item.issues||[])]})),
    schools
  };
}

test("headline coverage counts only independently supported teams", () => {
  const supported = team();
  const productionOnly = team({
    team_id:"df-h73ln2-football-2026",school_id:"df-h73ln2",school_name:"Guy-Perkins High School",
    expected_target:false,schedule_status:"Missing",results_status:"Missing",records_status:"Missing",
    issues:[{code:"schedule_source_missing",category:"schedule"}]
  });
  const scoped = scopeCoverageReport(report([supported,productionOnly]));
  assert.equal(scoped.audit_contract.version,"truthful-coverage-v5");
  assert.equal(scoped.summary.teams,1);
  assert.equal(scoped.summary.supported_teams,1);
  assert.equal(scoped.summary.production_only_teams,1);
  assert.equal(scoped.summary.team_status.schedule.Complete,1);
  assert.equal(scoped.summary.team_status.schedule.Missing,0);
  assert.equal(scoped.summary.production_only_team_status.schedule.Missing,1);
  assert.equal(scoped.exceptions.length,1);
  assert.equal(scoped.production_only_exceptions.length,1);
  assert.equal(scoped.production_only_exceptions[0].coverage_scope,"production-only");
  assert.ok(scoped.production_only_exceptions[0].issues.some(issue => issue.code === "unexpected_production_team"));
  assert.equal(scoped.summary.exception_counts.schedule_source_missing || 0,0);
  assert.equal(scoped.summary.production_only_exception_counts.schedule_source_missing,1);
});

test("school coverage ignores production-only teams when supported teams exist", () => {
  const scoped = scopeCoverageReport(report([
    team(),
    team({team_id:"extra",expected_target:false,schedule_status:"Missing",results_status:"Missing",records_status:"Missing",issues:[{code:"schedule_source_missing",category:"schedule"}]})
  ]));
  const school = scoped.schools[0];
  assert.equal(school.coverage_scope,"supported");
  assert.equal(school.supported_team_count,1);
  assert.equal(school.production_only_team_count,1);
  assert.equal(school.schedule_status,"Complete");
  assert.equal(school.results_status,"Complete");
  assert.equal(school.records_status,"Complete");
});

test("Guy-Perkins football is not in the certified supported high-school inventory", () => {
  const codes = highSchoolInventory.certified_school_team_codes.H73LN2;
  assert.deepEqual(codes,["MBB","WBB","WVB"]);
  assert.equal(codes.includes("FB"),false);
});
